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

/**
 * Candidate bases, tried in order.
 *
 * CMS has published the Coverage Database under several shapes over the years and
 * this code has never met the live host, so committing to one guess would make the
 * whole ingest a coin flip. Each candidate is attempted and the failure recorded;
 * `probeCms()` returns the lot, which is what turns "it didn't work" into a specific
 * URL and response body somebody can act on.
 *
 * ASSENT_CMS_MCD_BASE, when set, is used alone — an operator who knows the endpoint
 * should not have their answer second-guessed.
 */
const CANDIDATE_BASES: string[] = process.env.ASSENT_CMS_MCD_BASE
  ? [process.env.ASSENT_CMS_MCD_BASE]
  : [
      "https://api.coverage.cms.gov/v1",
      "https://api.coverage.cms.gov",
      "https://www.cms.gov/medicare-coverage-database/api/v1",
    ];

/** Resolved once a candidate answers usefully, so the rest of a run stays on it. */
let resolvedBase: string | null = null;

/**
 * CMS publishes an OpenAPI description of this API, and it told us so itself.
 *
 * The first live run came back 400 with:
 *
 *   {"message":"Hello MCIM API Users! Please reference the documentation at
 *    /docs/v1/swagger to make use of the proper endpoints.","id":404}
 *
 * which is the API saying the base was right and the path was invented. So instead
 * of guessing better, this reads the spec and finds the operations by shape. That
 * survives CMS renaming a route, which they have done before and will again.
 */
const API_ROOT = "https://api.coverage.cms.gov";

const SWAGGER_CANDIDATES = [
  `${API_ROOT}/docs/v1/swagger`,
  `${API_ROOT}/docs/v1/swagger.json`,
  `${API_ROOT}/docs/v1/swagger/v1/swagger.json`,
  `${API_ROOT}/v1/docs/swagger`,
  `${API_ROOT}/v1/swagger.json`,
  `${API_ROOT}/swagger/v1/swagger.json`,
  `${API_ROOT}/docs`,
];

/**
 * The API's own "no such route" message.
 *
 * This is the single most useful thing the live probe found. Every invented path
 * returns it; a real one never does. So a 400 saying "You must include a ncdid" is
 * not a failure at all — it is `/v1/data/ncd` confirming it exists and telling us
 * what it wants. That turns endpoint discovery from guessing into a test with a
 * reliable answer.
 */
const ROUTE_NOT_FOUND = /Hello MCIM API Users/i;

export function routeExists(body: string): boolean {
  return body.length > 0 && !ROUTE_NOT_FOUND.test(body);
}

/**
 * Names to try under `/v1/data/`. The API told us the shape itself:
 *
 *   /v1/data  →  {"message":"Please add one of the data endpoints, like /contractor"}
 *
 * so `contractor` is known-real and anchors the pattern. The rest are the
 * collections a coverage database would expose, filtered by the discriminator above
 * rather than by hope.
 */
const DATA_RESOURCES = [
  "contractor", "ncd", "lcd", "article", "mcd",
  "ncd-document", "ncd-documents", "ncd-tracking-sheet", "ncd-alphabetical-index",
  "lcd-document", "lcd-documents", "national-coverage", "local-coverage",
  "report", "reports", "index", "indexes", "search", "keyword",
  "state", "jurisdiction", "contractor-type", "hcpcs", "code",
];

/**
 * Route shapes to try when the spec cannot be read.
 *
 * Every wrong guess from here costs a full redeploy on the box that can actually
 * reach CMS, so the deep probe walks the whole list in ONE pass and reports what
 * each returned. One reload of /api/diagnostics then contains the answer instead of
 * another round of me guessing and waiting.
 *
 * The live 400 told us `/v1` is the right prefix and `reports/` is not a real
 * collection, so these vary the collection segment rather than the version.
 */
function listPathCandidates(kind: "ncd" | "lcd"): string[] {
  const long = kind === "ncd" ? "national-coverage-determinations" : "local-coverage-determinations";
  return [
    `/v1/data/${kind}`,
    `/v1/data/${kind}s`,
    `/v1/data/${kind}-alphabetical`,
    `/v1/${kind}`,
    `/v1/${kind}s`,
    `/v1/${kind}/alphabetical`,
    `/v1/data/${long}`,
    `/v1/coverage/${kind}`,
    `/v1/documents/${kind}`,
    `/v1/search/${kind}`,
    `/v1/reports/${kind}-alphabetical`, // the known 400, kept so its answer stays visible
  ];
}

/** Meta routes worth seeing the body of — they usually name the real collections. */
const META_PATHS = ["/v1", "/", "/v1/data"];

interface OpenApiSpec {
  paths?: Record<string, Record<string, unknown>>;
  servers?: Array<{ url?: string }>;
  basePath?: string;
}

let specCache: OpenApiSpec | null | undefined;

/**
 * Find the spec by reading the documentation page.
 *
 * `/docs` returns HTML titled "Coverage API" — a Swagger UI page. Such a page always
 * names the spec it renders, so rather than guessing more .json locations, this
 * scrapes the URL out of it and follows that. Guessing was already tried; seven
 * candidates all 404'd.
 */
export function specUrlsFromHtml(html: string, root: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /url\s*:\s*["']([^"']+)["']/gi,          // SwaggerUIBundle({ url: "..." })
    /["']([^"']*swagger[^"']*\.json[^"']*)["']/gi,
    /["']([^"']*openapi[^"']*\.json[^"']*)["']/gi,
    /["'](\/[^"']*\/swagger(?:\.json)?)["']/gi,
  ];
  for (const re of patterns) {
    for (const m of html.matchAll(re)) {
      const raw = m[1];
      if (!raw || raw.startsWith("#")) continue;
      if (!/swagger|openapi|\.json/i.test(raw)) continue;
      try {
        found.add(new URL(raw, root).toString());
      } catch {
        /* not a resolvable URL */
      }
    }
  }
  return [...found];
}

async function specFromDocsPage(): Promise<OpenApiSpec | null> {
  for (const docsUrl of [`${API_ROOT}/docs`, `${API_ROOT}/`]) {
    try {
      const res = await politeFetch(docsUrl);
      if (!res.ok) continue;
      const html = await res.text();
      for (const specUrl of specUrlsFromHtml(html, docsUrl)) {
        try {
          const sres = await politeFetch(specUrl);
          if (!sres.ok) continue;
          const spec = JSON.parse(await sres.text()) as OpenApiSpec;
          if (spec?.paths) return spec;
        } catch {
          /* next candidate */
        }
      }
    } catch {
      /* next docs page */
    }
  }
  return null;
}

async function loadSpec(): Promise<OpenApiSpec | null> {
  if (specCache !== undefined) return specCache;

  // The documentation page first: it states the answer instead of us guessing it.
  const fromDocs = await specFromDocsPage().catch(() => null);
  if (fromDocs) {
    specCache = fromDocs;
    return fromDocs;
  }

  for (const url of SWAGGER_CANDIDATES) {
    try {
      const res = await politeFetch(url);
      if (!res.ok) continue;
      const body = await res.text();
      const spec = JSON.parse(body) as OpenApiSpec;
      if (spec && typeof spec === "object" && spec.paths) {
        specCache = spec;
        return spec;
      }
    } catch {
      /* try the next candidate */
    }
  }
  specCache = null;
  return null;
}

/** Every GET path in the spec, which is the raw material for both selectors below. */
function getPaths(spec: OpenApiSpec): string[] {
  return Object.entries(spec.paths ?? {})
    .filter(([, ops]) => Object.keys(ops).some((m) => m.toLowerCase() === "get"))
    .map(([p]) => p);
}

const hasParam = (p: string) => /\{[^}]+\}/.test(p);

/**
 * A listing operation: mentions the document kind, takes no path parameter, and
 * looks like an index rather than a lookup. Scored rather than pattern-matched, so
 * an unexpected but reasonable route still wins over nothing.
 */
export function selectListPath(paths: string[], kind: "ncd" | "lcd"): string | null {
  const scored = paths
    .filter((p) => !hasParam(p) && new RegExp(`\\b${kind}s?\\b|${kind}`, "i").test(p))
    .map((p) => {
      let score = 0;
      if (/alphabetical|all|list|index|report/i.test(p)) score += 3;
      if (/search|lookup|query/i.test(p)) score += 2;
      if (/download|export/i.test(p)) score += 1;
      // Shallower paths are the more general ones.
      score -= p.split("/").filter(Boolean).length * 0.1;
      return { p, score };
    })
    .sort((a, b) => b.score - a.score);
  return scored[0]?.p ?? null;
}

/** A detail operation: mentions the kind and takes exactly one path parameter. */
export function selectDetailPath(paths: string[], kind: "ncd" | "lcd"): string | null {
  const candidates = paths
    .filter((p) => hasParam(p) && new RegExp(`${kind}`, "i").test(p))
    .filter((p) => (p.match(/\{[^}]+\}/g) ?? []).length === 1)
    .sort((a, b) => a.split("/").length - b.split("/").length);
  return candidates[0] ?? null;
}

function specBase(spec: OpenApiSpec): string {
  const server = spec.servers?.[0]?.url;
  if (server) return server.replace(/\/+$/, "");
  if (spec.basePath) return `https://api.coverage.cms.gov${spec.basePath.replace(/\/+$/, "")}`;
  return "https://api.coverage.cms.gov";
}

/** Paths the spec advertises, resolved to absolute URLs. */
async function discover(kind: "ncd" | "lcd"): Promise<{ list: string | null; detail: string | null; base: string } | null> {
  const spec = await loadSpec();
  if (!spec) return null;
  const paths = getPaths(spec);
  const base = specBase(spec);
  const list = selectListPath(paths, kind);
  const detail = selectDetailPath(paths, kind);
  return { list: list ? `${base}${list}` : null, detail: detail ? `${base}${detail}` : null, base };
}

export interface ProbeResult {
  base: string;
  url: string;
  ok: boolean;
  status: number | null;
  contentType: string | null;
  /** First bytes of the body — the thing that actually identifies what went wrong. */
  bodyHead: string;
  error?: string;
}

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

/**
 * Ask every candidate base for a document list and report what each said.
 *
 * Deliberately returns results instead of throwing: the point is to produce
 * evidence, including from the failures. Surfaced through /api/diagnostics so the
 * exact status, content-type and body head from the live host are readable without
 * shell access to the box that could reach it.
 */
/**
 * Pull the row array out of whatever envelope the API uses.
 *
 * The shape is unknown until it answers, and committing to `{data:[…]}` would fail
 * on `{results:[…]}` for no good reason. So: the conventional keys first, then any
 * array-valued property, then a bare array.
 */
export function extractItems(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  for (const key of ["data", "results", "items", "records", "rows", "documents"]) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[];
  }
  for (const v of Object.values(obj)) {
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object") return v as unknown[];
  }
  return null;
}

/** One HTTP call, reduced to the few facts that identify what happened. */
async function probeOne(url: string, label: string): Promise<ProbeResult> {
  try {
    const res = await politeFetch(url);
    const body = await res.text();
    let listLength: number | null = null;
    try {
      const items = extractItems(JSON.parse(body) as unknown);
      if (items) listLength = items.length;
    } catch {
      /* not JSON; contentType + bodyHead say so */
    }
    // EXISTS is the fact worth surfacing: a real route that wants a parameter is a
    // find, and looks identical to a 404 if you only read the status code.
    const exists = routeExists(body);
    return {
      base: label,
      url,
      ok: res.ok && (listLength ?? 0) > 0,
      status: res.status,
      contentType: res.headers.get("content-type"),
      bodyHead:
        (exists ? "[ROUTE EXISTS] " : "") +
        (listLength !== null ? `[${listLength} items] ` : "") +
        body.slice(0, 260),
    };
  } catch (err) {
    return {
      base: label, url, ok: false, status: null, contentType: null, bodyHead: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Walk every candidate in one pass: the spec locations, the meta routes, and each
 * plausible collection path. Deliberately exhaustive — a redeploy costs minutes and
 * a wrong guess costs another one, so this trades a dozen cheap requests for
 * finishing the search in a single round trip.
 */
export async function deepProbeCms(kind: "ncd" | "lcd" = "ncd"): Promise<ProbeResult[]> {
  const out: ProbeResult[] = [];

  // The documentation page names the spec; report what was scraped from it so a
  // failure to follow it is visible rather than silent.
  try {
    const res = await politeFetch(`${API_ROOT}/docs`);
    const html = await res.text();
    const urls = specUrlsFromHtml(html, `${API_ROOT}/docs`);
    out.push({
      base: "docs-scrape", url: `${API_ROOT}/docs`, ok: urls.length > 0,
      status: res.status, contentType: res.headers.get("content-type"),
      bodyHead: urls.length ? `spec URLs found: ${urls.join(" , ")}` : `no spec URL in page; head: ${html.slice(0, 200)}`,
    });
    for (const u of urls.slice(0, 4)) out.push(await probeOne(u, "spec-from-docs"));
  } catch (err) {
    out.push({
      base: "docs-scrape", url: `${API_ROOT}/docs`, ok: false, status: null,
      contentType: null, bodyHead: "", error: err instanceof Error ? err.message : String(err),
    });
  }

  for (const url of SWAGGER_CANDIDATES) out.push(await probeOne(url, "spec"));
  for (const p of META_PATHS) out.push(await probeOne(`${API_ROOT}${p}`, "meta"));

  // Enumerate /v1/data/*. Anything not answering with the route-not-found message
  // is a real collection, whatever it says next.
  for (const name of DATA_RESOURCES) out.push(await probeOne(`${API_ROOT}/v1/data/${name}`, "data"));

  for (const p of listPathCandidates(kind)) out.push(await probeOne(`${API_ROOT}${p}`, "list"));
  return out;
}

export async function probeCms(kind: "ncd" | "lcd" = "ncd"): Promise<ProbeResult[]> {
  const out: ProbeResult[] = [];

  // The spec first, and its GET paths verbatim. If the selectors below pick the
  // wrong route, this list is what makes the right one obvious without another
  // round of guessing.
  const spec = await loadSpec().catch(() => null);
  out.push({
    base: "openapi",
    url: SWAGGER_CANDIDATES[0]!,
    ok: !!spec,
    status: spec ? 200 : null,
    contentType: spec ? "application/json" : null,
    bodyHead: spec
      ? JSON.stringify({
          getPaths: getPaths(spec).slice(0, 60),
          chosenList: selectListPath(getPaths(spec), kind),
          chosenDetail: selectDetailPath(getPaths(spec), kind),
          base: specBase(spec),
        })
      : "",
    error: spec ? undefined : "no OpenAPI document at any known location",
  });
  for (const base of CANDIDATE_BASES) {
    const url = `${base}/reports/${kind}-alphabetical`;
    try {
      const res = await politeFetch(url);
      const body = await res.text();
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(body);
      } catch {
        /* recorded below via contentType + bodyHead */
      }
      const items = Array.isArray(parsed)
        ? parsed
        : (parsed as { data?: unknown } | null)?.data;
      out.push({
        base,
        url,
        ok: res.ok && Array.isArray(items) && items.length > 0,
        status: res.status,
        contentType: res.headers.get("content-type"),
        bodyHead: body.slice(0, 400),
      });
    } catch (err) {
      out.push({
        base,
        url,
        ok: false,
        status: null,
        contentType: null,
        bodyHead: "",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

/** Where the last discovery landed, so a run's detail calls match its list call. */
let discoveredDetail: string | null = null;

/** List NCDs (national) or LCDs (local) available in the MCD. */
export async function listDocuments(kind: "ncd" | "lcd"): Promise<McdListItem[]> {
  const failures: string[] = [];

  // Ask the API what it offers before assuming anything.
  const found = await discover(kind).catch(() => null);
  if (found?.list) {
    try {
      const { data } = await getJson<unknown>(found.list);
      const items = extractItems(data) as McdListItem[] | null;
      if (items && items.length > 0) {
        resolvedBase = found.base;
        discoveredDetail = found.detail;
        return items;
      }
      failures.push(`${found.list} (from the API's own spec): parsed but held no document list`);
    } catch (err) {
      failures.push(`${found.list} (from the API's own spec): ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    failures.push("the OpenAPI spec could not be read, or advertised no listing route");
  }

  // Fall back to the candidate shapes only after the spec has had its say. Walking
  // the whole list here means a single run can still succeed when the spec is
  // unreadable but a conventional route exists.
  for (const path of listPathCandidates(kind)) {
    const url = `${API_ROOT}${path}`;
    try {
      const { data } = await getJson<unknown>(url);
      const items = extractItems(data) as McdListItem[] | null;
      if (!items || items.length === 0) {
        failures.push(`${url}: parsed but held no document list`);
        continue;
      }
      // Pin the prefix this path lives under so detail calls stay consistent.
      resolvedBase = `${API_ROOT}${path.split("/").slice(0, 3).join("/")}`;
      return items;
    } catch (err) {
      failures.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(
    `[cms] no candidate endpoint returned a document list.\n` +
      failures.map((f) => `  · ${f}`).join("\n") +
      `\n  Set ASSENT_CMS_MCD_BASE to the correct base once known, or read` +
      ` /api/diagnostics?probe=cms for the raw responses.`,
  );
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
  // The live probe settled how detail is addressed:
  //
  //   /v1/data/ncd  →  {"message":"You must include a ncdid","id":400}
  //
  // a query parameter, not a path segment. That form is tried first; a route the
  // spec advertised, and the older path style, follow it.
  const base = resolvedBase ?? CANDIDATE_BASES[0]!;
  const id = encodeURIComponent(documentId);
  const attempts = [
    `${API_ROOT}/v1/data/${kind}?${kind}id=${id}`,
    discoveredDetail?.replace(/\{[^}]+\}/, id),
    `${base}/${kind}/${id}`,
  ].filter((u): u is string => typeof u === "string");

  let data: Record<string, unknown> | null = null;
  let url = attempts[0]!;
  const failures: string[] = [];
  for (const attempt of attempts) {
    try {
      const got = await getJson<Record<string, unknown>>(attempt);
      data = got.data;
      url = attempt;
      break;
    } catch (err) {
      failures.push(`${attempt}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (!data) {
    throw new Error(`[cms] could not fetch ${kind} ${documentId}:\n` + failures.map((f) => `  · ${f}`).join("\n"));
  }

  // Detail responses may be wrapped the same way lists are. Unwrap a single-row
  // envelope so field lookup below works either way.
  const rows = extractItems(data);
  const doc: Record<string, unknown> =
    rows && rows.length > 0 && typeof rows[0] === "object"
      ? (rows[0] as Record<string, unknown>)
      : typeof data.data === "object" && data.data !== null && !Array.isArray(data.data)
        ? (data.data as Record<string, unknown>)
        : data;

  const html =
    (doc.documentHtml as string) ??
    (doc.description as string) ??
    (doc.text as string) ??
    (doc.indicationsAndLimitations as string) ??
    (doc.coverageIndications as string) ??
    "";
  if (!html || html.length < 200) {
    throw new Error(
      `[cms] ${url} returned no usable document body (got ${html.length} chars). ` +
        `Refusing to store an empty policy.`,
    );
  }
  const codes: RawCodeLink[] = [];
  for (const key of ["cptCodes", "hcpcsCodes", "codes", "hcpcsCodeList"]) {
    const arr = doc[key];
    if (!Array.isArray(arr)) continue;
    for (const c of arr) {
      const code = typeof c === "string" ? c : ((c as { code?: string })?.code ?? "");
      if (code) codes.push({ code, relationship: "covers" });
    }
  }

  return {
    documentId,
    version: Number(doc.documentVersion ?? doc.version ?? 1),
    title: String(doc.documentTitle ?? doc.title ?? doc.ncdTitle ?? doc.lcdTitle ?? documentId),
    effectiveDate: String(doc.effectiveDate ?? doc.startDate ?? "").slice(0, 10),
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
