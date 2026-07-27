import { sha256 } from "@assent/parse";
import { politeFetch, userAgent } from "../rate-limit";
import { robotsAllows } from "../robots";
import type { RawDocument, RawCodeLink } from "../types";

/**
 * CMS Medicare Coverage Database — the real fetcher.
 *
 * CMS material is a US government work, so this source needs no licensing
 * conversation and no legal review: it is the one corpus we can ingest broadly
 * and immediately. That is why it is the reference implementation.
 *
 * ── Honesty note ───────────────────────────────────────────────────────────
 * This module has never executed against the live host from the environment it
 * was written in (outbound network is blocked there by policy). Everything is
 * therefore built to FAIL LOUDLY rather than quietly produce junk: if a response
 * is not JSON, is missing the fields we rely on, or yields zero documents, we
 * throw with the URL and a snippet of the body. No silent fallback, no synthesized
 * stand-in. Verify `MCD_BASE` against the live API on the first run — CMS has
 * reorganized these endpoints before.
 */

/** Override when CMS moves the endpoint. */
const MCD_BASE = process.env.ASSENT_CMS_MCD_BASE ?? "https://api.coverage.cms.gov/v1";

export interface McdListItem {
  documentId: string;
  documentVersion?: number;
  title: string;
  effectiveDate: string;
  documentType?: string;
}

interface FetchJsonResult<T> {
  url: string;
  data: T;
}

async function getJson<T>(url: string): Promise<FetchJsonResult<T>> {
  if (!(await robotsAllows(url, userAgent()))) {
    throw new Error(`[cms] robots.txt disallows ${url} for ${userAgent()} — not fetching.`);
  }
  const res = await politeFetch(url);
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`[cms] ${res.status} from ${url}: ${body.slice(0, 300)}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(
      `[cms] expected JSON from ${url} but got ${res.headers.get("content-type") ?? "unknown"}: ` +
        `${body.slice(0, 300)}. Verify ASSENT_CMS_MCD_BASE — CMS has moved these endpoints before.`,
    );
  }
  return { url, data: data as T };
}

/** List NCDs (national) or LCDs (local) available in the MCD. */
export async function listDocuments(kind: "ncd" | "lcd"): Promise<McdListItem[]> {
  const url = `${MCD_BASE}/reports/${kind}-alphabetical`;
  const { data } = await getJson<{ data?: McdListItem[] } | McdListItem[]>(url);
  const items = Array.isArray(data) ? data : data.data;
  if (!Array.isArray(items)) {
    throw new Error(`[cms] ${url} did not return a document list. Verify the endpoint shape.`);
  }
  if (items.length === 0) {
    throw new Error(`[cms] ${url} returned zero documents — refusing to treat that as success.`);
  }
  return items;
}

export interface McdDocument {
  documentId: string;
  version: number;
  title: string;
  effectiveDate: string;
  /** The policy body as HTML. */
  html: string;
  codes: RawCodeLink[];
  sourceUrl: string;
}

/** Fetch one document's full text + code links. */
export async function fetchDocument(kind: "ncd" | "lcd", documentId: string): Promise<McdDocument> {
  const url = `${MCD_BASE}/${kind}/${encodeURIComponent(documentId)}`;
  const { data } = await getJson<Record<string, unknown>>(url);

  const html =
    (data.documentHtml as string) ?? (data.description as string) ?? (data.text as string) ?? "";
  if (!html || html.length < 200) {
    throw new Error(
      `[cms] ${url} returned no usable document body (got ${html.length} chars). ` +
        `Refusing to store an empty policy.`,
    );
  }
  const codes: RawCodeLink[] = [];
  for (const key of ["cptCodes", "hcpcsCodes", "codes"]) {
    const arr = data[key];
    if (!Array.isArray(arr)) continue;
    for (const c of arr) {
      const code = typeof c === "string" ? c : ((c as { code?: string })?.code ?? "");
      if (code) codes.push({ code, relationship: "covers" });
    }
  }

  return {
    documentId,
    version: Number(data.documentVersion ?? data.version ?? 1),
    title: String(data.documentTitle ?? data.title ?? documentId),
    effectiveDate: String(data.effectiveDate ?? data.startDate ?? "").slice(0, 10),
    html,
    codes,
    sourceUrl: `https://www.cms.gov/medicare-coverage-database/view/${kind}.aspx?${kind}id=${encodeURIComponent(documentId)}`,
  };
}

export interface CmsIngestOptions {
  kind?: "ncd" | "lcd";
  /** Only keep documents whose title/body matches (e.g. molecular oncology terms). */
  filter?: RegExp;
  limit?: number;
  since?: string;
}

/**
 * Ingest CMS documents for real. Returns RawDocuments with `provenance: "fetched"` —
 * the only code path in the system that may set that value.
 */
export async function ingestCms(opts: CmsIngestOptions = {}): Promise<RawDocument[]> {
  const kind = opts.kind ?? "ncd";
  const list = await listDocuments(kind);
  const out: RawDocument[] = [];

  for (const item of list) {
    if (opts.limit && out.length >= opts.limit) break;
    if (opts.filter && !opts.filter.test(item.title)) continue;
    if (opts.since && item.effectiveDate && item.effectiveDate < opts.since) continue;

    const doc = await fetchDocument(kind, item.documentId);
    const bytes = new TextEncoder().encode(doc.html);
    out.push({
      source: "cms",
      payerId: "cms",
      externalId: doc.documentId,
      version: doc.version,
      title: doc.title,
      url: doc.sourceUrl,
      effectiveDate: doc.effectiveDate || "1900-01-01",
      contentType: "html",
      bytes,
      contentHash: sha256(bytes),
      rawStoragePath: `cms/${kind}/${doc.documentId}-v${doc.version}.html`,
      supersedesExternalVersion: doc.version > 1 ? doc.version - 1 : null,
      codes: doc.codes,
      provenance: "fetched",
    });
  }

  if (out.length === 0) {
    throw new Error(
      "[cms] ingest produced zero documents. That is a failure, not an empty result — " +
        "check the filter, the endpoint, and the robots policy.",
    );
  }
  return out;
}
