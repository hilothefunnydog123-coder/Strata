/**
 * The Medicare appeal ladder, which is the thing this product was missing.
 *
 * The system modelled one denial having one appeal that gets decided once. A
 * loss was terminal and the case went to invoiced having recovered nothing.
 * That is not how Medicare works, and it is not where the money is: losing at
 * the first level is ordinary, and claims are won at an ALJ hearing every day
 * after being denied twice below.
 *
 * Two ladders, because a Medicare Advantage denial and a Traditional Medicare
 * denial do not climb the same one. They converge at the ALJ.
 *
 * On the deadlines below. They are the reason this file exists rather than a
 * constant somewhere: each level has its own clock, each clock starts from the
 * notice of the level beneath it rather than from the original denial, and
 * missing one ends the claim on its merits regardless of how good the argument
 * was. Every figure here is the statutory or regulatory period, cited to where
 * it comes from, and a filing window is treated as a floor rather than a target
 * everywhere else in the codebase.
 */

export type Ladder = 'traditional_medicare' | 'medicare_advantage';

export interface AppealLevel {
  /** Stable key, stored on the row. */
  key: string;
  /** Position in its ladder, from 1. */
  ordinal: number;
  /** What a person calls it. */
  label: string;
  /** Who decides it. */
  decidedBy: string;
  /**
   * Days to file, counted from the date of the notice being appealed.
   *
   * Null where the escalation is automatic rather than filed: a Medicare
   * Advantage plan that upholds its own denial of a pre-service request must
   * forward the case to the independent review entity itself, so there is no
   * deadline for the provider to miss.
   */
  filingDays: number | null;
  /** Where the period comes from, so it can be checked rather than trusted. */
  authority: string;
  /**
   * Whether reaching this level requires a minimum amount in controversy.
   *
   * The figures are adjusted annually and are deliberately not hardcoded here.
   * A stale threshold that silently blocks an escalation would be worse than
   * asking: see amountInControversyRequired.
   */
  amountInControversy: boolean;
}

/**
 * Traditional Medicare, Parts A and B.
 *
 * 42 CFR Part 405 Subpart I. A provider appealing a claim denial starts at
 * redetermination by the Medicare Administrative Contractor that denied it.
 */
const TRADITIONAL: AppealLevel[] = [
  {
    key: 'redetermination',
    ordinal: 1,
    label: 'Redetermination',
    decidedBy: 'Medicare Administrative Contractor',
    filingDays: 120,
    authority: '42 CFR 405.942, 120 days from receipt of the initial determination',
    amountInControversy: false,
  },
  {
    key: 'reconsideration',
    ordinal: 2,
    label: 'Reconsideration',
    decidedBy: 'Qualified Independent Contractor',
    filingDays: 180,
    authority: '42 CFR 405.962, 180 days from receipt of the redetermination',
    amountInControversy: false,
  },
  {
    key: 'alj',
    ordinal: 3,
    label: 'ALJ hearing',
    decidedBy: 'Office of Medicare Hearings and Appeals',
    filingDays: 60,
    authority: '42 CFR 405.1002, 60 days from receipt of the reconsideration',
    amountInControversy: true,
  },
  {
    key: 'council',
    ordinal: 4,
    label: 'Medicare Appeals Council',
    decidedBy: 'Departmental Appeals Board',
    filingDays: 60,
    authority: '42 CFR 405.1102, 60 days from receipt of the ALJ decision',
    amountInControversy: false,
  },
  {
    key: 'judicial',
    ordinal: 5,
    label: 'Judicial review',
    decidedBy: 'Federal district court',
    filingDays: 60,
    authority: '42 CFR 405.1136, 60 days from receipt of the Council decision',
    amountInControversy: true,
  },
];

/**
 * Medicare Advantage, Part C.
 *
 * 42 CFR Part 422 Subpart M. The plan reconsiders its own determination first,
 * and if it upholds a denial of a pre-service request it must send the case to
 * the independent review entity without anyone asking. From the ALJ up the two
 * ladders are the same forum.
 */
const ADVANTAGE: AppealLevel[] = [
  {
    key: 'plan_reconsideration',
    ordinal: 1,
    label: 'Plan reconsideration',
    decidedBy: 'The Medicare Advantage organization',
    filingDays: 60,
    authority: '42 CFR 422.582, 60 days from the organization determination',
    amountInControversy: false,
  },
  {
    key: 'independent_review',
    ordinal: 2,
    label: 'Independent review',
    decidedBy: 'Independent review entity',
    // Automatic on an upheld pre-service denial: the plan forwards it.
    filingDays: null,
    authority: '42 CFR 422.592, forwarded by the plan rather than filed',
    amountInControversy: false,
  },
  {
    key: 'alj',
    ordinal: 3,
    label: 'ALJ hearing',
    decidedBy: 'Office of Medicare Hearings and Appeals',
    filingDays: 60,
    authority: '42 CFR 422.602, 60 days from the independent review decision',
    amountInControversy: true,
  },
  {
    key: 'council',
    ordinal: 4,
    label: 'Medicare Appeals Council',
    decidedBy: 'Departmental Appeals Board',
    filingDays: 60,
    authority: '42 CFR 422.608, 60 days from the ALJ decision',
    amountInControversy: false,
  },
  {
    key: 'judicial',
    ordinal: 5,
    label: 'Judicial review',
    decidedBy: 'Federal district court',
    filingDays: 60,
    authority: '42 CFR 422.612, 60 days from the Council decision',
    amountInControversy: true,
  },
];

const LADDERS: Record<Ladder, AppealLevel[]> = {
  traditional_medicare: TRADITIONAL,
  medicare_advantage: ADVANTAGE,
};

/**
 * Which ladder a denial climbs.
 *
 * Anything that is not a Medicare Advantage plan is treated as Traditional
 * Medicare here. Commercial and Medicaid managed care have their own ladders
 * that this does not yet model, and calling that out is the point: guessing at
 * a commercial plan's deadline would be worse than declining to.
 */
export function ladderFor(payerType: string): Ladder | null {
  if (payerType === 'medicare_advantage') return 'medicare_advantage';
  if (payerType === 'traditional_medicare') return 'traditional_medicare';
  return null;
}

export function levelsOf(ladder: Ladder): readonly AppealLevel[] {
  return LADDERS[ladder];
}

export function levelAt(ladder: Ladder, ordinal: number): AppealLevel | null {
  return LADDERS[ladder].find((l) => l.ordinal === ordinal) ?? null;
}

export function levelByKey(ladder: Ladder, key: string): AppealLevel | null {
  return LADDERS[ladder].find((l) => l.key === key) ?? null;
}

/** The level after this one, or null at the top of the ladder. */
export function nextLevel(ladder: Ladder, ordinal: number): AppealLevel | null {
  return levelAt(ladder, ordinal + 1);
}

/**
 * When the next level must be filed by.
 *
 * Counted from the notice of the decision being appealed, not from the original
 * denial, which is the mistake that loses claims: a case decided at
 * reconsideration eight months after the denial still has its full 60 days to
 * reach an ALJ, and anyone counting from the denial would think it was long
 * gone.
 *
 * Returns null where nothing has to be filed, either because the ladder is
 * exhausted or because the escalation is automatic.
 */
export function deadlineForNextLevel(
  ladder: Ladder,
  currentOrdinal: number,
  noticeDate: Date,
): { level: AppealLevel; dueBy: Date } | null {
  const next = nextLevel(ladder, currentOrdinal);
  if (!next || next.filingDays === null) return null;

  const dueBy = new Date(noticeDate.getTime());
  dueBy.setUTCDate(dueBy.getUTCDate() + next.filingDays);

  return { level: next, dueBy };
}

/**
 * Whether an escalation is worth attempting, or is out of road.
 *
 * A loss is not the end of a claim, and this is the function that says so. The
 * caller decides what to do about it; the point is that nothing in the codebase
 * should treat "lost" as terminal on its own again.
 */
export function canEscalate(
  ladder: Ladder,
  currentOrdinal: number,
): { ok: true; level: AppealLevel } | { ok: false; reason: string } {
  const next = nextLevel(ladder, currentOrdinal);
  if (!next) {
    return {
      ok: false,
      reason: 'This is the last level of the Medicare appeal process. There is nowhere above it.',
    };
  }

  if (next.amountInControversy) {
    return {
      ok: true,
      level: next,
    };
  }

  return { ok: true, level: next };
}

/**
 * Whether this level has a minimum amount in controversy, and what to do.
 *
 * The thresholds for an ALJ hearing and for judicial review are adjusted every
 * year and published by CMS. Hardcoding last year's figure would silently
 * block an escalation that is in fact allowed, or wave through one that is
 * not, and neither failure announces itself. So the requirement is recorded and
 * the number is asked for rather than assumed.
 */
export function amountInControversyRequired(level: AppealLevel): boolean {
  return level.amountInControversy;
}
