/**
 * Turning verified assertions into a letter.
 *
 * The letter is assembled here, from rows, rather than generated as prose. That
 * is what makes every sentence in it traceable: the paragraph you read on
 * screen is the same object the citation hangs off, and clicking it opens the
 * source.
 */
import { SECTION_HEADINGS, SECTIONS, type Section } from './assertion';

export interface RenderableAssertion {
  id: string;
  ordinal: number;
  section: string;
  kind: 'legal' | 'clinical';
  text: string;
  sourceKind: 'holding' | 'source_span' | 'clinical_fact';
  sourceId: string;
  verbatimQuote: string;
}

export interface LetterHeader {
  organizationName: string;
  payerName: string;
  internalRef: string;
  serviceType: string;
  serviceDates: string;
  claimAmount: string;
  appealDeadline: string | null;
  today: string;
}

export interface CitationEntry {
  index: number;
  label: string;
  detail: string;
  url: string | null;
  quote: string;
}

export interface RenderedLetter {
  header: LetterHeader;
  sections: { section: Section; heading: string; assertions: RenderableAssertion[] }[];
  citations: CitationEntry[];
}

export function groupIntoSections(
  assertions: readonly RenderableAssertion[],
): RenderedLetter['sections'] {
  return SECTIONS.map((section) => ({
    section,
    heading: SECTION_HEADINGS[section],
    assertions: assertions
      .filter((a) => a.section === section)
      .sort((a, b) => a.ordinal - b.ordinal),
  })).filter((group) => group.assertions.length > 0);
}

export interface SourceDescriptor {
  label: string;
  detail: string;
  url: string | null;
}

/**
 * The citation appendix.
 *
 * Every source relied on, once each, numbered in the order it first appears.
 * The quoted passage is printed with it, so a reader with the letter and
 * nothing else can check the citation without our software.
 */
export function buildCitations(
  assertions: readonly RenderableAssertion[],
  describe: (kind: RenderableAssertion['sourceKind'], id: string) => SourceDescriptor,
): CitationEntry[] {
  const seen = new Map<string, CitationEntry>();
  let index = 0;

  for (const a of [...assertions].sort((x, y) => x.ordinal - y.ordinal)) {
    const key = `${a.sourceKind}:${a.sourceId}`;
    if (seen.has(key)) continue;
    const described = describe(a.sourceKind, a.sourceId);
    index += 1;
    seen.set(key, {
      index,
      label: described.label,
      detail: described.detail,
      url: described.url,
      quote: a.verbatimQuote,
    });
  }

  return [...seen.values()];
}

/** The citation number for one assertion, matching the appendix. */
export function citationIndexFor(
  assertion: RenderableAssertion,
  citations: readonly CitationEntry[],
  describe: (kind: RenderableAssertion['sourceKind'], id: string) => SourceDescriptor,
): number {
  const label = describe(assertion.sourceKind, assertion.sourceId).label;
  return citations.find((c) => c.label === label)?.index ?? 0;
}

/**
 * The letter as plain text.
 *
 * Used for the DOCX and PDF bodies, and it is also what a reader would get if
 * they copied the letter out of the browser. Deliberately plain: this is a
 * document that gets printed, faxed, and attached to a portal upload, and every
 * flourish is one more thing to survive that.
 */
export function renderPlainText(letter: RenderedLetter): string {
  const lines: string[] = [];

  lines.push(letter.header.organizationName.toUpperCase());
  lines.push('');
  lines.push(letter.header.today);
  lines.push('');
  lines.push(letter.header.payerName);
  lines.push('');
  lines.push('RE: Appeal of denied claim');
  lines.push(`    Reference:      ${letter.header.internalRef}`);
  lines.push(`    Service:        ${letter.header.serviceType.replace(/_/g, ' ')}`);
  lines.push(`    Dates:          ${letter.header.serviceDates}`);
  lines.push(`    Amount:         ${letter.header.claimAmount}`);
  if (letter.header.appealDeadline) {
    lines.push(`    Appeal due:     ${letter.header.appealDeadline}`);
  }
  lines.push('');
  lines.push('To the Appeals Department:');
  lines.push('');

  for (const group of letter.sections) {
    lines.push(group.heading.toUpperCase());
    lines.push('');
    for (const a of group.assertions) {
      lines.push(`${a.ordinal}. ${a.text}`);
      lines.push('');
    }
  }

  lines.push('ENCLOSURES');
  lines.push('');
  lines.push('  1. The denial letter at issue');
  lines.push('  2. The clinical record supporting this appeal');
  lines.push('  3. Citation appendix, below');
  lines.push('');
  lines.push('CITATION APPENDIX');
  lines.push('');
  lines.push(
    'Every assertion above rests on one of the sources below. The quoted passage is',
  );
  lines.push(
    'reproduced so this appeal can be checked against its sources without our software.',
  );
  lines.push('');

  for (const citation of letter.citations) {
    lines.push(`[${citation.index}] ${citation.label}`);
    if (citation.detail) lines.push(`    ${citation.detail}`);
    if (citation.url) lines.push(`    ${citation.url}`);
    lines.push('');
    for (const line of wrap(`"${citation.quote}"`, 76)) {
      lines.push(`    ${line}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (current.length === 0) current = word;
    else if (current.length + 1 + word.length <= width) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}
