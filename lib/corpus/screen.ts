/**
 * Deciding which passages are worth a model call.
 *
 * The extraction stage used to send every passage of every document to the
 * model and ask whether there was a holding in it. That is the wrong shape for
 * a government manual. A CMS chapter is a few hundred passages of rule text
 * wrapped in a thousand passages of contents listings, transmittal notices,
 * cross references and form instructions, and the model was being paid to read
 * all of it. Measured on Benefit Policy Manual Ch. 8: 1,302 passages, about
 * 216,000 tokens, more than a day's allowance on a free account, for a document
 * whose citable content is a fraction of that.
 *
 * So this runs first, locally, for nothing.
 *
 * The asymmetry that makes it safe: a passage that is wrongly skipped is a
 * holding we do not have, and a passage that is wrongly kept is one wasted
 * call. Missing authority is the worse of the two, so every rule here is
 * written to keep when unsure, and every skip is recorded on the row with its
 * reason. Loosening the screen later and re-running the skipped passages is one
 * update statement, and nothing about the corpus already built has to change.
 *
 * What this cannot do is affect correctness. A passage that is never sent
 * cannot produce a false holding, and a passage that is sent still has to
 * survive verbatim verification. The screen trades recall for cost and touches
 * nothing else.
 */

export type ScreenReason =
  | 'contents_listing'
  | 'revision_notice'
  | 'cross_reference_only'
  | 'no_rule_language';

export interface ScreenResult {
  keep: boolean;
  reason?: ScreenReason;
}

/**
 * Language that states an obligation, a permission, or a prohibition.
 *
 * This is what a holding is made of. A passage without any of it is describing
 * something rather than requiring it.
 */
const DEONTIC =
  /\b(shall|must|may not|is required|are required|is not required|need not|may only|is entitled|are entitled|is covered|are covered|not covered|does not cover|is excluded|are excluded|qualifies|does not qualify|meets the (?:requirements?|criteria)|fails to meet|criteria)\b/i;

/**
 * Language that decides something.
 *
 * Decisions carry their holdings in these verbs. Kept separate from the above
 * because a decision's operative sentence often has no modal in it at all:
 * "the determination is reversed" states a holding and contains no "shall".
 */
const ADJUDICATIVE =
  /\b(we (?:conclude|find|hold)|the Board (?:finds|concludes|holds|determines)|the ALJ (?:found|concluded|held)|is reversed|is affirmed|is remanded|we agree|we disagree|the determination)\b/i;

/**
 * Language that defines a term.
 *
 * Included after a first draft left it out, which would have discarded most of
 * what a coverage manual is actually useful for. "Skilled nursing care means
 * care that requires the skills of qualified personnel" carries no obligation
 * and is among the most citable sentences in Chapter 8: a great many denials
 * turn on whether what was provided meets a definition.
 */
const DEFINITIONAL = /\b(means|is defined as|are defined as|refers to|includes|does not include)\b/i;

/** A contents listing: dot leaders running to a page number. */
const DOT_LEADERS = /\.{4,}\s*\d+\s*$/m;
const CONTENTS_HEADING = /\b(table of contents|contents)\b/i;

/** CMS manuals carry a revision block at the top of every chapter. */
const REVISION_NOTICE =
  /^\s*(transmittal|rev\.|revision|implementation date|effective date|change request)\b/i;

/** A pointer to somewhere else, carrying nothing of its own. */
const CROSS_REFERENCE = /^\s*(see|refer to|as (?:described|set forth|provided) in)\b/i;
const CROSS_REFERENCE_MAX_CHARS = 200;

/**
 * A passage that is mostly not prose: page furniture, tables of figures, form
 * fields. Measured as the share of characters that are letters or spaces.
 */
const MINIMUM_PROSE_RATIO = 0.6;

function proseRatio(text: string): number {
  if (text.length === 0) return 0;
  const prose = text.replace(/[^A-Za-z\s]/g, '').length;
  return prose / text.length;
}

/**
 * Should this passage be sent to the model?
 *
 * Order matters. The three definite exclusions run first, because a contents
 * line can easily contain the word "criteria" and would otherwise be kept by
 * the rule language test below.
 */
export function screen(text: string, headingPath: readonly string[] = []): ScreenResult {
  const trimmed = text.trim();

  if (DOT_LEADERS.test(trimmed) || headingPath.some((h) => CONTENTS_HEADING.test(h))) {
    return { keep: false, reason: 'contents_listing' };
  }

  if (REVISION_NOTICE.test(trimmed)) {
    return { keep: false, reason: 'revision_notice' };
  }

  if (CROSS_REFERENCE.test(trimmed) && trimmed.length < CROSS_REFERENCE_MAX_CHARS) {
    return { keep: false, reason: 'cross_reference_only' };
  }

  if (proseRatio(trimmed) < MINIMUM_PROSE_RATIO) {
    return { keep: false, reason: 'contents_listing' };
  }

  if (DEONTIC.test(trimmed) || ADJUDICATIVE.test(trimmed) || DEFINITIONAL.test(trimmed)) {
    return { keep: true };
  }

  return { keep: false, reason: 'no_rule_language' };
}

/** Roughly what a batch of this text will be charged, for the estimate command. */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 3.6);
}
