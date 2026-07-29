/**
 * Level one of the citation invariant: the type system.
 *
 *   No assertion in a generated appeal letter may exist without a verbatim
 *   quote from a source that is programmatically verified to contain it.
 *
 * There is no constructor path here that omits a source or a quote, and no
 * exported way to build an Assertion except through `assertion()`, which takes
 * both and refuses without them. The database enforces the same thing with NOT
 * NULL; this exists so the failure happens at compile time instead.
 *
 * The nominal branding is what makes it stick. `VerifiedAssertion` cannot be
 * produced by writing an object literal that happens to have the right fields,
 * only by passing through `verified()`, which is called from exactly one place:
 * after lib/appeals/verify.ts has checked the quote against its source.
 */

declare const verifiedBrand: unique symbol;

export type AssertionKind = 'legal' | 'clinical';
export type AssertionSourceKind = 'holding' | 'source_span' | 'clinical_fact';

/** The sections of an appeal letter, in the order they are written. */
export const SECTIONS = [
  'identification',
  'standard',
  'application',
  'argument',
  'relief',
] as const;

export type Section = (typeof SECTIONS)[number];

export const SECTION_HEADINGS: Record<Section, string> = {
  identification: 'The claim and the denial',
  standard: 'The applicable standard',
  application: 'The record against each criterion',
  argument: 'Argument',
  relief: 'Relief requested',
};

/**
 * A claim the letter makes, with the source it rests on.
 *
 * Every field is required. `sourceId` and `verbatimQuote` are not optional and
 * not nullable, here or in the schema.
 */
export interface Assertion {
  readonly ordinal: number;
  readonly section: Section;
  readonly kind: AssertionKind;
  readonly text: string;
  readonly sourceKind: AssertionSourceKind;
  readonly sourceId: string;
  readonly verbatimQuote: string;
}

/** An assertion whose quote has been checked against its source. */
export interface VerifiedAssertion extends Assertion {
  readonly [verifiedBrand]: true;
  /** Offsets into the source text, so the interface can highlight in place. */
  readonly charStart: number;
  readonly charEnd: number;
}

export class InvalidAssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAssertionError';
  }
}

/**
 * The only way to make an Assertion.
 *
 * Rejects at construction rather than deferring to verification, because the
 * cases below are not "this quote turned out not to match", they are "this is
 * not an assertion at all", and there is nothing to verify.
 */
export function assertion(input: {
  ordinal: number;
  section: Section;
  kind: AssertionKind;
  text: string;
  sourceKind: AssertionSourceKind;
  sourceId: string;
  verbatimQuote: string;
}): Assertion {
  const { sourceId, verbatimQuote, text } = input;

  if (!sourceId || sourceId.trim().length === 0) {
    throw new InvalidAssertionError(
      'An assertion needs the identifier of the source it rests on. There is no path ' +
        'that creates one without.',
    );
  }
  if (!verbatimQuote || verbatimQuote.trim().length === 0) {
    throw new InvalidAssertionError(
      'An assertion needs the verbatim words from its source. A citation without the ' +
        'quoted passage cannot be checked, and an unchecked citation is the thing this ' +
        'product exists not to produce.',
    );
  }
  if (!text || text.trim().length === 0) {
    throw new InvalidAssertionError('An assertion needs text.');
  }
  if (!Number.isInteger(input.ordinal) || input.ordinal < 1) {
    throw new InvalidAssertionError('Assertion ordinals start at 1.');
  }

  return Object.freeze({
    ordinal: input.ordinal,
    section: input.section,
    kind: input.kind,
    text: text.trim(),
    sourceKind: input.sourceKind,
    sourceId: sourceId.trim(),
    verbatimQuote,
  });
}

/**
 * Brand an assertion as verified.
 *
 * Called from exactly one place, lib/appeals/generate.ts, immediately after
 * verifyDraft has confirmed the quote appears in the source at these offsets.
 * Nothing else should call it, and nothing else does.
 */
export function verified(
  base: Assertion,
  charStart: number,
  charEnd: number,
): VerifiedAssertion {
  return Object.freeze({
    ...base,
    charStart,
    charEnd,
  }) as VerifiedAssertion;
}

/** A legal assertion cites a holding or a regulation; a clinical one, the chart. */
export function expectedSourceKinds(kind: AssertionKind): AssertionSourceKind[] {
  return kind === 'legal' ? ['holding', 'source_span'] : ['clinical_fact'];
}

/**
 * Whether an assertion cites the right kind of thing.
 *
 * A clinical claim resting on a published decision would be citing the wrong
 * document entirely, and would still pass the quote check, because the quote
 * really is in that decision. This catches that.
 */
export function sourceKindMatches(a: Assertion): boolean {
  return expectedSourceKinds(a.kind).includes(a.sourceKind);
}
