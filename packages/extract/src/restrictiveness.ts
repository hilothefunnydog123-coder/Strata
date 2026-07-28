import type { ChangeType, CriterionKind } from "@assent/core";

/**
 * Did a revision make a requirement HARDER or EASIER to satisfy?
 *
 * The first version of this scored a bag of cue words and called everything it did
 * not recognise "clarified". Against §9's 20-pair golden set that was 45% accurate
 * — barely above always answering "clarified". The cue list simply had no opinion
 * about the changes payers actually make.
 *
 * What real revisions do, and what this now models:
 *
 *   ADD AN ALTERNATIVE      "must be FDA-approved" → "…or CLIA-accredited"
 *                           a second way to comply — EASIER
 *   ADD A CONJUNCT          "CLIA" → "CLIA and CAP accredited"
 *                           another hurdle — HARDER
 *   WIDEN A LIST            depends on context: another covered stage is EASIER,
 *                           another excluded population is HARDER
 *   MOVE A NUMBER           direction depends on what the number counts. A higher
 *                           concordance threshold is HARDER; a higher test
 *                           allowance is EASIER. Same digit, opposite meaning.
 *   CARVE OUT AN EXCEPTION  "except where a new primary is identified" — EASIER
 *   CHANGE WHO QUALIFIES    "physician" → "board-certified oncologist" is HARDER;
 *                           the reverse is EASIER
 *
 * "Clarified" is now the answer only when the edit is genuinely definitional.
 */

// ── numbers, including the ones payers spell out ─────────────────────────────

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, twenty: 20, thirty: 30,
};

export function extractNumbers(text: string): number[] {
  const out: number[] = [];
  const digits = text.match(/\d+(?:\.\d+)?/g);
  if (digits) for (const d of digits) out.push(Number(d));
  for (const [word, value] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b`, "i").test(text)) out.push(value);
  }
  return out.filter((n) => Number.isFinite(n));
}

/**
 * For a frequency limit, a bigger number means MORE testing is allowed, so the
 * requirement got easier. For an evidence threshold, a bigger number means a
 * higher bar. Reading the digit without knowing which it is gets half of them backwards.
 */
function higherNumberIsHarder(kind: CriterionKind): boolean {
  return kind !== "frequency_limit";
}

// ── token diff: what did the revision add, and what did it drop? ─────────────

function words(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9%\- ]+/g, " ").split(/\s+/).filter(Boolean);
}

export interface TextDelta {
  added: string[];
  removed: string[];
  /** The word immediately preceding the first added run in the new text. */
  addedJoiner: string | null;
}

export function delta(from: string, to: string): TextDelta {
  const a = words(from);
  const b = words(to);
  const setA = new Set(a);
  const setB = new Set(b);
  const added = b.filter((w) => !setA.has(w));
  const removed = a.filter((w) => !setB.has(w));

  let addedJoiner: string | null = null;
  if (added.length > 0) {
    const first = added[0]!;
    if (first === "or" || first === "and" || first === "except" || first === "unless") {
      addedJoiner = first;
    }
    const firstAdded = b.indexOf(first);
    for (let i = firstAdded - 1; addedJoiner === null && i >= 0 && i >= firstAdded - 3; i--) {
      const w = b[i]!;
      if (w === "or" || w === "and" || w === "except" || w === "unless") {
        addedJoiner = w;
        break;
      }
    }
  }
  return { added, removed, addedJoiner };
}

// ── contexts and vocabularies ────────────────────────────────────────────────

const NEGATIVE = /\bnot covered\b|\bdoes not cover\b|\bnon-?covered\b|\binvestigational\b|\bexperimental\b|\bunproven\b|\bnot medically necessary\b|\bexcluded\b|\bnot established\b|\bhas not been\b/i;

/** In an exclusion, widening the scope excludes MORE people — that is harder. */
function isExclusionContext(kind: CriterionKind, from: string, to: string): boolean {
  return kind === "exclusion" || NEGATIVE.test(from) || NEGATIVE.test(to);
}

const CREDENTIAL = /\bboard-?certified\b|\bspecialist\b|\baccredited\b|\bcertified\b|\bregistered\b|\boncologist\b|\bqualified\b/i;
const DEFINITIONAL = /\bdefined as\b|\bdefinition\b|\bmeans\b|\bi\.e\.\b|\bthat is\b|\bper ajcc\b|\bas documented\b|\bfor (?:purposes of )?clarity\b|\bin the medical record\b|\bmade available\b/i;
const PERMISSION = /\bis permitted\b|\bare permitted\b|\bis allowed\b|\bmay be repeated\b|\bmay be demonstrated\b|\bmay be considered\b/i;
const OBLIGATION = /\bmust\b|\bshall\b|\bis required\b|\brequires\b/i;
const STRONGER_EVIDENCE = /\bprospective\b|\brandomized\b|\bcontrolled trial\b|\bclinical outcomes\b|\bsurvival\b/i;
const WEAKER_EVIDENCE = /\bretrospective\b|\bregistry\b|\bobservational\b|\bsupporting evidence\b|\bchange in management\b/i;
const TIME_WINDOW = /\bwithin the (?:preceding|previous|past)\b|\bper (?:calendar )?year\b|\bevery \w+ months\b|\bper lifetime\b/i;

/** Rough count of items in a comma / "or" separated enumeration. */
export function countListItems(text: string): number {
  const seps = (text.match(/,|\bor\b/gi) || []).length;
  return seps + 1;
}

export interface Verdict {
  changeType: ChangeType;
  rationale: string;
}

/**
 * Ordered rules, most decisive first. Each returns a rationale naming the signal it
 * fired on, so a reviewer can check the call against the two quotes.
 */
export function classifyRevision(from: string, to: string, kind: CriterionKind): Verdict {
  const d = delta(from, to);
  const addedText = d.added.join(" ");
  const removedText = d.removed.join(" ");
  const exclusion = isExclusionContext(kind, from, to);

  // 1. A moved number, read according to what it counts.
  const nFrom = extractNumbers(from);
  const nTo = extractNumbers(to);
  if (nFrom.length > 0 && nTo.length > 0) {
    const maxFrom = Math.max(...nFrom);
    const maxTo = Math.max(...nTo);
    if (maxTo !== maxFrom) {
      const harderWhenHigher = higherNumberIsHarder(kind);
      const higher = maxTo > maxFrom;
      const harder = higher === harderWhenHigher;
      return {
        changeType: harder ? "tightened" : "loosened",
        rationale: harder
          ? `Bar moved from ${maxFrom} to ${maxTo} — harder to satisfy.`
          : `Allowance moved from ${maxFrom} to ${maxTo} — easier to satisfy.`,
      };
    }
  }

  // 2. An exception carved out of the rule.
  if (d.addedJoiner === "except" || d.addedJoiner === "unless" || /\bexcept\b|\bunless\b/i.test(addedText)) {
    return { changeType: "loosened", rationale: "An exception was carved out of the rule." };
  }

  // 3. Evidence strength moved.
  if (STRONGER_EVIDENCE.test(addedText) && !STRONGER_EVIDENCE.test(removedText)) {
    return { changeType: "tightened", rationale: "Now demands stronger evidence (prospective / outcome based)." };
  }
  if (STRONGER_EVIDENCE.test(removedText) && !STRONGER_EVIDENCE.test(addedText)) {
    return { changeType: "loosened", rationale: "No longer demands prospective or outcome evidence." };
  }
  if (WEAKER_EVIDENCE.test(addedText) && PERMISSION.test(to)) {
    return { changeType: "loosened", rationale: "Weaker study designs are now accepted." };
  }

  // 4. Permission granted where there was a prohibition.
  if (PERMISSION.test(to) && !PERMISSION.test(from)) {
    return { changeType: "loosened", rationale: "What was withheld is now expressly permitted." };
  }

  // 5. A time window bounding a prohibition lets the clock run out on it.
  if (TIME_WINDOW.test(to) && !TIME_WINDOW.test(from) && (NEGATIVE.test(from) || kind === "frequency_limit")) {
    return { changeType: "loosened", rationale: "The restriction is now time-bounded rather than absolute." };
  }

  // 6. Alternative vs conjunct — the same added words mean opposite things.
  if (d.added.length > 0 && !DEFINITIONAL.test(addedText)) {
    if (d.addedJoiner === "or") {
      return exclusion
        ? { changeType: "tightened", rationale: "Another situation was added to the exclusion." }
        : { changeType: "loosened", rationale: "An alternative way to comply was added." };
    }
    if (d.addedJoiner === "and") {
      return { changeType: "tightened", rationale: "A further condition was added alongside the existing one." };
    }
  }

  // 6. A discretionary statement became a hard obligation. This outranks list
  //    arithmetic: "results will be used…" → "the physician must document…" is a
  //    new duty, not a shorter list.
  if (OBLIGATION.test(to) && !OBLIGATION.test(from)) {
    return { changeType: "tightened", rationale: "A discretionary statement became an obligation." };
  }
  if (OBLIGATION.test(from) && !OBLIGATION.test(to) && !exclusion) {
    return { changeType: "loosened", rationale: "An obligation became discretionary." };
  }

  // 8. Who qualifies got narrower or wider.
  const credAdded = CREDENTIAL.test(addedText);
  const credRemoved = CREDENTIAL.test(removedText);
  if (credAdded && !credRemoved) {
    return { changeType: "tightened", rationale: "A narrower class of provider or laboratory now qualifies." };
  }
  if (credRemoved && !credAdded) {
    return { changeType: "loosened", rationale: "A wider class of provider or laboratory now qualifies." };
  }

  // 9. An enumeration gained or lost an option. Last among the substantive rules
  //    because commas are unreliable — a parenthetical reads like a list item —
  //    so this only decides cases nothing stronger has already explained.
  const itemsFrom = countListItems(from);
  const itemsTo = countListItems(to);
  if (itemsTo !== itemsFrom && d.added.length > 0 && !DEFINITIONAL.test(addedText)) {
    const wider = itemsTo > itemsFrom;
    if (exclusion) {
      return wider
        ? { changeType: "tightened", rationale: "Another situation was added to the exclusion." }
        : { changeType: "loosened", rationale: "A situation was removed from the exclusion." };
    }
    return wider
      ? { changeType: "loosened", rationale: "Another option now satisfies the requirement." }
      : { changeType: "tightened", rationale: "An option that used to satisfy the requirement was removed." };
  }

  // 9. Scope, read in context.
  if (d.added.length >= 2 && !DEFINITIONAL.test(addedText)) {
    if (exclusion) {
      return { changeType: "tightened", rationale: "The exclusion now covers more situations." };
    }
    if (OBLIGATION.test(to) && !OBLIGATION.test(from)) {
      return { changeType: "tightened", rationale: "A discretionary statement became an obligation." };
    }
  }
  if (d.removed.length >= 2 && exclusion && d.added.length === 0) {
    return { changeType: "loosened", rationale: "The exclusion now covers fewer situations." };
  }

  // 10. Nothing substantive moved.
  return {
    changeType: "clarified",
    rationale: DEFINITIONAL.test(addedText)
      ? "Wording made more precise without changing what must be shown."
      : "Wording changed without altering what must be shown.",
  };
}
