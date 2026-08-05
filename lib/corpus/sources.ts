/**
 * Where the corpus comes from.
 *
 * One adapter per source, each responsible only for producing a list of
 * documents to fetch and for naming them. Politeness, retries, hashing, and
 * storage all live in lib/corpus/fetch.ts and the pipeline, so an adapter is
 * small enough to correct when a URL shape turns out to be wrong.
 *
 * The findings behind these URLs, and which of them are unverified, are in
 * CORPUS.md. Every government host is blocked at this environment's egress
 * proxy, so none of this has run against the live sources. Each adapter is
 * written so that a wrong guess is a change in one place.
 */
import { z } from 'zod';
import { fetchDocument, userAgent, type FetchedDocument } from './fetch';
import { env } from '@/lib/env';
import { log } from '@/lib/log';

export type SourceKey = 'dab' | 'ecfr' | 'manual';

export interface DiscoveredDocument {
  sourceType: 'dab_decision' | 'regulation' | 'manual';
  citation: string;
  title: string;
  url: string;
  decidedAt: Date | null;
}

export interface Source {
  key: SourceKey;
  label: string;
  /** List what is available, newest first where the source has an order. */
  discover(options: { since?: Date; limit?: number }): Promise<DiscoveredDocument[]>;
  fetch(document: DiscoveredDocument): Promise<FetchedDocument>;
}

/* ─── Medicare Appeals Council decisions ──────────────────────────────────── */

/**
 * The Socrata dataset on HealthData.gov rather than the HTML index.
 *
 * Better in every way that matters: paginated, filterable by date, stable, and
 * it puts no load on a public website. The HTML index remains as a fallback
 * because a single dataset is a single point of failure.
 *
 * Column names are unverified. The schema below accepts several plausible
 * spellings and fails loudly rather than silently producing empty citations,
 * which is the failure mode that would poison the corpus quietly.
 */
const SOCRATA_DATASET = 'b8ey-rqrx';
const SOCRATA_ORIGIN = 'https://healthdata.gov';

const socrataRow = z
  .object({
    decision_number: z.string().optional(),
    docket_number: z.string().optional(),
    case_number: z.string().optional(),
    decision_id: z.string().optional(),
    title: z.string().optional(),
    subject: z.string().optional(),
    case_name: z.string().optional(),
    decision_date: z.string().optional(),
    date_decided: z.string().optional(),
    date: z.string().optional(),
    url: z.string().optional(),
    link: z.string().optional(),
    document_url: z.string().optional(),
  })
  .passthrough();

type SocrataRow = z.infer<typeof socrataRow>;

function firstString(...values: (string | undefined)[]): string | undefined {
  return values.find((v) => typeof v === 'string' && v.trim().length > 0)?.trim();
}

export function normalizeCouncilRow(raw: unknown): DiscoveredDocument | null {
  const parsed = socrataRow.safeParse(raw);
  if (!parsed.success) return null;

  const row: SocrataRow = parsed.data;

  const citation = firstString(
    row.decision_number,
    row.docket_number,
    row.case_number,
    row.decision_id,
  );
  const url = firstString(row.url, row.link, row.document_url);

  // Without a citation or a URL the row cannot become a source document that
  // anything could cite, so it is dropped rather than stored half formed.
  if (!citation || !url) return null;

  const dateText = firstString(row.decision_date, row.date_decided, row.date);
  const decidedAt = dateText ? new Date(dateText) : null;

  return {
    sourceType: 'dab_decision',
    citation: citation.startsWith('DAB') ? citation : `DAB No. ${citation}`,
    title: firstString(row.title, row.subject, row.case_name) ?? citation,
    url,
    decidedAt: decidedAt && !Number.isNaN(decidedAt.getTime()) ? decidedAt : null,
  };
}

export const dabSource: Source = {
  key: 'dab',
  label: 'Medicare Appeals Council decisions',

  async discover({ since, limit = 1000 }) {
    const found: DiscoveredDocument[] = [];
    const pageSize = 200;

    for (let offset = 0; offset < limit; offset += pageSize) {
      const url = new URL(`${SOCRATA_ORIGIN}/resource/${SOCRATA_DATASET}.json`);
      url.searchParams.set('$limit', String(Math.min(pageSize, limit - offset)));
      url.searchParams.set('$offset', String(offset));
      url.searchParams.set('$order', 'decision_date DESC');
      if (since) {
        url.searchParams.set(
          '$where',
          `decision_date > '${since.toISOString().slice(0, 19)}'`,
        );
      }

      // Socrata answers 403 to anonymous callers on a rising share of
      // datasets, and it is not a robots question: healthdata.gov's robots.txt
      // permits /resource/ outright. An application token, which is free and
      // needs an account, moves a caller from the shared anonymous pool onto
      // its own. Sent when there is one; the request goes out plain when there
      // is not, so nothing about this is required to develop against a dataset
      // that still answers.
      const response = await fetch(url, {
        headers: {
          'user-agent': userAgent(),
          ...(env.SOCRATA_APP_TOKEN ? { 'X-App-Token': env.SOCRATA_APP_TOKEN } : {}),
        },
      });
      if (!response.ok) {
        throw new Error(
          `The Council dataset returned ${response.status}. If this is a 400, the ` +
            'column names in lib/corpus/sources.ts do not match the dataset. Check with: ' +
            `curl -s '${SOCRATA_ORIGIN}/resource/${SOCRATA_DATASET}.json?$limit=1'` +
              (env.SOCRATA_APP_TOKEN
                ? ''
                : '\nA 403 with no token set is usually the anonymous rate pool. ' +
                  'A free application token from a healthdata.gov account, set as ' +
                  'SOCRATA_APP_TOKEN, is the documented remedy.'),
        );
      }

      const rows = (await response.json()) as unknown[];
      if (rows.length === 0) break;

      let dropped = 0;
      for (const raw of rows) {
        const document = normalizeCouncilRow(raw);
        if (document) found.push(document);
        else dropped += 1;
      }

      if (dropped > 0) {
        log.warn('rows dropped: no citation or no document url', {
          dropped,
          of: rows.length,
        });
      }

      if (rows.length < pageSize) break;
    }

    return found;
  },

  fetch: (document) => fetchDocument(document.url),
};

/* ─── eCFR Title 42 ───────────────────────────────────────────────────────── */

const ECFR_ORIGIN = 'https://www.ecfr.gov';

/**
 * The parts the product argues from. Narrow on purpose: fetching all of Title
 * 42 would be tens of megabytes of irrelevant text, and every extra part is
 * more surface for a retrieval to wander into.
 */
export const ECFR_PARTS: ReadonlyArray<{ part: string; title: string }> = [
  {
    part: '422',
    title: 'Medicare Advantage Program',
  },
  {
    part: '409',
    title: 'Hospital Insurance Benefits, including skilled nursing facility coverage',
  },
  {
    part: '412',
    title: 'Prospective Payment Systems, including inpatient rehabilitation criteria',
  },
  {
    part: '405',
    title: 'Federal Health Insurance for the Aged and Disabled, appeals procedures',
  },
];

export const ecfrSource: Source = {
  key: 'ecfr',
  label: 'eCFR Title 42',

  async discover() {
    // The current date is what "current" means to the versioner endpoint.
    const today = new Date().toISOString().slice(0, 10);

    return ECFR_PARTS.map(({ part, title }) => ({
      sourceType: 'regulation' as const,
      citation: `42 CFR Part ${part}`,
      title,
      url: `${ECFR_ORIGIN}/api/versioner/v1/full/${today}/title-42.xml?part=${part}`,
      decidedAt: null,
    }));
  },

  fetch: (document) => fetchDocument(document.url),
};

/* ─── CMS Internet-Only Manuals ───────────────────────────────────────────── */

const CMS_ORIGIN = 'https://www.cms.gov';

/**
 * Medicare Benefit Policy Manual, Publication 100-02.
 *
 * Discovered from the manual's own index page rather than from a list of
 * filenames kept here.
 *
 * The list used to be hardcoded, and it was wrong, in a way worth recording
 * because it is the shape of mistake this whole file invites. Chapter 8 was
 * found by hand and is published as bp102c08pdf.pdf. Chapter 1 was written by
 * pattern from it, as bp102c01pdf.pdf, and 404s. Reading the index shows why:
 * almost every chapter is bp102cNN.pdf, and chapters 3 and 8 alone carry the
 * doubled "pdf". The one chapter anyone had checked was one of the two
 * exceptions.
 *
 * No convention derived from a sample of one would have survived that, and no
 * convention needs to: the index is published, it is the authority on what
 * exists, and reading it costs one request. A chapter that CMS renumbers or
 * republishes is then picked up on the next run instead of quietly 404ing.
 */
const CMS_MANUAL_INDEX =
  '/regulations-and-guidance/guidance/manuals/internet-only-manuals-ioms-items/cms012673';

/** Chapters worth ingesting, and what to call them. */
const CMS_MANUAL_TITLES: Readonly<Record<string, string>> = {
  '01': 'Inpatient Hospital Services Covered Under Part A',
  '02': 'Inpatient Psychiatric Hospital Services',
  '06': 'Hospital Services Covered Under Part B',
  '07': 'Home Health Services',
  '08': 'Coverage of Extended Care (SNF) Services Under Hospital Insurance',
  '09': 'Coverage of Hospice Services Under Hospital Insurance',
  '11': 'End Stage Renal Disease (ESRD)',
  '12': 'Comprehensive Outpatient Rehabilitation Facility (CORF) Coverage',
  '13': 'Rural Health Clinic and Federally Qualified Health Center Services',
  '15': 'Covered Medical and Other Health Services',
  '16': 'General Exclusions from Coverage',
};

/**
 * Chapter files, but not the crosswalks beside them.
 *
 * Every chapter link has a bp102cNNcrosswalk.pdf next to it, which is a table
 * of what moved where in a revision. It holds no coverage rule and would be
 * ingested as though it did.
 */
const CHAPTER_LINK = /href="([^"]*\/downloads\/bp102c(\d{2})(?:pdf)?\.pdf)"/gi;

export function discoverManualChapters(html: string): DiscoveredDocument[] {
  const found = new Map<string, string>();

  for (const match of html.matchAll(CHAPTER_LINK)) {
    const [, path, chapter] = match;
    if (!path || !chapter) continue;
    if (/crosswalk/i.test(path)) continue;
    // First link for a chapter wins. The page lists each once, and a second
    // would be a revision link rather than the chapter itself.
    if (!found.has(chapter)) found.set(chapter, path);
  }

  return [...found]
    .filter(([chapter]) => chapter in CMS_MANUAL_TITLES)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([chapter, path]) => ({
      sourceType: 'manual' as const,
      citation: `Medicare Benefit Policy Manual, Ch. ${Number(chapter)}`,
      title: CMS_MANUAL_TITLES[chapter]!,
      url: path.startsWith('http') ? path : `${CMS_ORIGIN}${path}`,
      decidedAt: null,
    }));
}

export const manualSource: Source = {
  key: 'manual',
  label: 'CMS Internet-Only Manuals',

  async discover({ limit }: { limit?: number } = {}) {
    const response = await fetch(`${CMS_ORIGIN}${CMS_MANUAL_INDEX}`, {
      headers: { 'user-agent': userAgent() },
    });

    if (!response.ok) {
      throw new Error(
        `The Benefit Policy Manual index returned ${response.status}. Without it there ` +
          'is no list of chapters to fetch, and the filenames are not derivable: most ' +
          'are bp102cNN.pdf and chapters 3 and 8 are bp102cNNpdf.pdf.',
      );
    }

    const chapters = discoverManualChapters(await response.text());

    if (chapters.length === 0) {
      throw new Error(
        'The Benefit Policy Manual index parsed but held no chapter links. CMS has ' +
          'changed the page, and guessing filenames from a sample is what produced the ' +
          'last set of 404s. Check the page before changing the pattern.',
      );
    }

    log.info('discovered manual chapters', { count: chapters.length });
    return limit ? chapters.slice(0, limit) : chapters;
  },

  fetch: (document) => fetchDocument(document.url),
};

/* ─── Registry ────────────────────────────────────────────────────────────── */

export const SOURCES: Record<SourceKey, Source> = {
  dab: dabSource,
  ecfr: ecfrSource,
  manual: manualSource,
};

/**
 * The Medicare Coverage Database is deliberately absent.
 *
 * LCD and NCD data sit behind a click-through AMA licence, because the local
 * coverage data sets contain CPT and HCPCS coding information copyrighted by
 * the American Medical Association. Accepting that licence programmatically
 * would be this build script agreeing to AMA terms on the company's behalf,
 * which is not a decision a build script gets to make. See CORPUS.md section 5
 * and BLOCKED.md.
 *
 * The lcd and ncd values remain in the source_type enum so the schema does not
 * have to change on the day a licence is signed.
 */
export const UNAVAILABLE_SOURCES = ['lcd', 'ncd'] as const;
