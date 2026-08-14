/**
 * Triage: is this denial worth fighting, and what is wrong with it.
 *
 * Two questions, answered before a letter is drafted, and answered
 * deterministically. The published overturn data says most appealed Medicare
 * Advantage denials are overturned, and the reason is not that appellants
 * write beautifully: it is that denials are produced at volume by software
 * applying standards the law does not allow, and the notices carry the
 * evidence of it. Software producing defects at volume is exactly the thing
 * software is good at catching.
 *
 * So this module scans the denial letter for the defects that recur, scores
 * the case, and recommends taking it, strengthening it, or declining it. The
 * scan is regex and set arithmetic rather than a model call, for the same
 * reason findGaps is: whether a letter says "plateau" is a fact, and asking a
 * model whether a denial "seems defective" invites exactly the softening a
 * triage exists to prevent. A model's judgment enters in one place only, the
 * proprietary criteria classification, and it arrives here already made and
 * already quoted.
 *
 * Every defect found becomes ammunition: its evidence is quoted to the
 * drafting prompt, and its subject steers which regulation passages are
 * retrieved, so the letter can argue the defect from authority it was
 * actually given. The recommendation is advice to the specialist, never a
 * gate: a case scored "decline" can still be generated, because the decision
 * to fight belongs to the hospital.
 */

export interface LetterSpan {
  ordinal: number;
  text: string;
}

/** What the scanner needs from the classification, already made and quoted. */
export interface ClassificationForTriage {
  criteriaCited: readonly string[];
  proprietaryCriteria: {
    detected: boolean;
    criteriaName: string | null;
    spanOrdinal: number | null;
    verbatimQuote: string | null;
  };
}

export interface DenialDefect {
  /** Stable identifier, so tests and displays can name a defect precisely. */
  id:
    | 'improvement_standard'
    | 'proprietary_criteria'
    | 'therapy_threshold'
    | 'no_criteria_disclosed'
    | 'no_physician_reviewer'
    | 'no_appeal_rights';
  title: string;
  /** The rule the defect offends, as a citation a specialist can look up. */
  authority: string;
  /** Why it is a defect, in one or two sentences. */
  explanation: string;
  /**
   * The payer's own words showing it, verbatim from the letter, with the span
   * they came from. Null for an absence defect: a notice that names no
   * criteria cannot be quoted naming none.
   */
  evidence: string | null;
  spanOrdinal: number | null;
  /** Contribution to the winnability score. */
  weight: number;
}

/* ─── The scan ────────────────────────────────────────────────────────────── */

/**
 * The improvement standard, by its usual names.
 *
 * The most common substantive defect in skilled care denials: coverage
 * conditioned on the patient getting better. Jimmo v. Sebelius settled that
 * coverage turns on the need for skilled care, not on improvement, and CMS
 * rewrote the Benefit Policy Manual to say so. A denial that says "plateau"
 * is applying a standard the agency itself has disavowed, and plans keep
 * saying it because their utilization software predates the settlement's
 * vocabulary.
 */
const IMPROVEMENT_PATTERNS: RegExp[] = [
  /plateau(?:ed|ing)?/i,
  /no (?:further |significant |measurable |continued )?(?:functional )?(?:improvement|progress)/i,
  /(?:failed|failure|unable) to (?:improve|progress|make (?:further )?progress)/i,
  /(?:has|have|had) not (?:improved|progressed|made progress|shown (?:any )?(?:improvement|progress))/i,
  /restoration potential/i,
  /custodial/i,
];

/**
 * Proprietary criteria, by product name or by self-description.
 *
 * The classification already asks a model this question with the whole letter
 * in front of it, and its answer is preferred because it can weigh context.
 * This list is the belt to that suspender: the named products are unambiguous
 * on their face, and a model that misses "InterQual" should not take the
 * strongest argument in the domain down with it. MCG is matched
 * case-sensitively because "mcg" is how a chart writes micrograms.
 */
const PROPRIETARY_PATTERNS: RegExp[] = [
  /\bMCG\b/,
  /\bMilliman\b/i,
  /\bInterQual\b/i,
  /(?:our|the plan's|internal|proprietary) (?:clinical|medical|coverage) (?:policy|criteria|guidelines)/i,
  /medical policy (?:number|no\.?|#)/i,
];

/**
 * A numeric therapy floor. Medicare's SNF level of care criteria require
 * daily skilled services and say nothing about minutes, so a denial that
 * counts minutes has imported a criterion from somewhere else.
 */
const THERAPY_THRESHOLD_PATTERN =
  /(?:at least|minimum of|fewer than|less than) \d+ ?(?:minutes|hours) (?:of|per)/i;

/** Signals that a notice discloses the rule it applied. */
const CITED_RULE_PATTERN = /42 C\.?F\.?R\.?|Medicare Benefit Policy Manual|§/;

/**
 * Signals that a physician was involved in the determination.
 *
 * Bare "MD" is included even though it can also be a state or a stray
 * initialism, because a false hit here suppresses a flag rather than raising
 * one, and missing a defect is the direction this check is allowed to err in.
 */
const PHYSICIAN_PATTERN = /physician|medical director|\bM\.?D\.?\b/i;

/** Signals that the notice tells the member how to contest it. */
const APPEAL_RIGHTS_PATTERN = /appeal|reconsideration/i;

/**
 * The sentence around a match, verbatim.
 *
 * Evidence has to be quotable and checkable, so it is a contiguous substring
 * of the span, expanded to the nearest sentence boundaries so a specialist
 * reading it sees a thought rather than a fragment.
 */
function sentenceAround(text: string, index: number, length: number): string {
  let start = index;
  while (start > 0 && !'.!?\n'.includes(text[start - 1]!)) start -= 1;
  let end = index + length;
  while (end < text.length && !'.!?\n'.includes(text[end]!)) end += 1;
  if (end < text.length && text[end] !== '\n') end += 1;
  return text.slice(start, end).trim();
}

function firstMatch(
  spans: readonly LetterSpan[],
  patterns: readonly RegExp[],
): { spanOrdinal: number; evidence: string } | null {
  for (const span of spans) {
    for (const pattern of patterns) {
      const match = pattern.exec(span.text);
      if (match) {
        return {
          spanOrdinal: span.ordinal,
          evidence: sentenceAround(span.text, match.index, match[0].length),
        };
      }
    }
  }
  return null;
}

function anywhere(spans: readonly LetterSpan[], pattern: RegExp): boolean {
  return spans.some((span) => pattern.test(span.text));
}

/**
 * Scan a denial letter for the defects that recur.
 *
 * Presence defects quote the letter; absence defects report what a compliant
 * notice would contain and this one does not. The absence checks are
 * deliberately conservative: "the letter never mentions a physician" is a
 * fact, "the physician mentioned was not the reviewer" is a judgment, and
 * only facts belong here. A notice that mentions a physician in any capacity
 * is given the benefit of the doubt.
 */
export function scanDefects(
  spans: readonly LetterSpan[],
  classification: ClassificationForTriage,
  serviceType: string,
  denialBasis: string,
): DenialDefect[] {
  const defects: DenialDefect[] = [];

  const improvement = firstMatch(spans, IMPROVEMENT_PATTERNS);
  if (improvement) {
    defects.push({
      id: 'improvement_standard',
      title: 'Coverage conditioned on improvement',
      authority:
        'Jimmo v. Sebelius settlement; Medicare Benefit Policy Manual, ch. 8, sec. 30.2.3.1',
      explanation:
        'Skilled care coverage turns on whether skilled services are required, not on ' +
        'whether the patient is improving. Skilled care to maintain a condition or to ' +
        'prevent or slow decline is covered, and a denial resting on a plateau or on ' +
        'recharacterising maintenance-level skilled care as custodial applies a standard ' +
        'CMS has disavowed.',
      evidence: improvement.evidence,
      spanOrdinal: improvement.spanOrdinal,
      weight: 20,
    });
  }

  // The model's finding first, because it saw the whole letter in context and
  // its quote was made for exactly this argument. The pattern scan backstops a
  // model that missed a product name sitting in plain sight.
  const modelFound =
    classification.proprietaryCriteria.detected &&
    classification.proprietaryCriteria.verbatimQuote !== null;
  const patternFound = modelFound ? null : firstMatch(spans, PROPRIETARY_PATTERNS);
  if (modelFound || patternFound) {
    defects.push({
      id: 'proprietary_criteria',
      title: 'Internal criteria applied in place of Medicare rules',
      authority: '42 CFR 422.101(b)(2) and (b)(6)',
      explanation:
        'A Medicare Advantage organisation must apply Medicare coverage criteria where ' +
        'Medicare has them, and may not apply internal or commercial criteria that are ' +
        'more restrictive. A denial resting on the plan\'s own guidelines for a service ' +
        'Medicare covers applies the wrong standard.',
      evidence: modelFound
        ? classification.proprietaryCriteria.verbatimQuote
        : patternFound!.evidence,
      spanOrdinal: modelFound
        ? classification.proprietaryCriteria.spanOrdinal
        : patternFound!.spanOrdinal,
      weight: 20,
    });
  }

  if (serviceType === 'skilled_nursing') {
    const threshold = firstMatch(spans, [THERAPY_THRESHOLD_PATTERN]);
    if (threshold) {
      defects.push({
        id: 'therapy_threshold',
        title: 'A therapy minutes floor Medicare does not impose',
        authority: '42 CFR 409.31',
        explanation:
          'The SNF level of care criteria require skilled services on a daily basis and ' +
          'set no minimum therapy minutes. A numeric floor is a criterion the plan added.',
        evidence: threshold.evidence,
        spanOrdinal: threshold.spanOrdinal,
        weight: 12,
      });
    }
  }

  const medicalBasis = denialBasis === 'medical_necessity' || denialBasis === 'level_of_care';

  if (
    medicalBasis &&
    classification.criteriaCited.length === 0 &&
    !defects.some((d) => d.id === 'proprietary_criteria') &&
    !anywhere(spans, CITED_RULE_PATTERN)
  ) {
    defects.push({
      id: 'no_criteria_disclosed',
      title: 'The notice does not disclose the criteria applied',
      authority: '42 CFR 422.568(e)',
      explanation:
        'A denial notice must state the specific reasons for the denial, and this one ' +
        'names no coverage criterion, rule, or policy as its basis. A member cannot ' +
        'meaningfully contest a standard the notice withholds.',
      evidence: null,
      spanOrdinal: null,
      weight: 10,
    });
  }

  if (medicalBasis && !anywhere(spans, PHYSICIAN_PATTERN)) {
    defects.push({
      id: 'no_physician_reviewer',
      title: 'No physician involvement appears in the notice',
      authority: '42 CFR 422.566(d)',
      explanation:
        'A denial on medical necessity grounds must be made by a physician or other ' +
        'appropriate health care professional, and nothing in this notice shows one ' +
        'was involved.',
      evidence: null,
      spanOrdinal: null,
      weight: 8,
    });
  }

  if (!anywhere(spans, APPEAL_RIGHTS_PATTERN)) {
    defects.push({
      id: 'no_appeal_rights',
      title: 'The notice does not describe appeal rights',
      authority: '42 CFR 422.568(f)',
      explanation:
        'A denial notice must describe the right to a reconsideration and how to ' +
        'exercise it. This one does not mention an appeal at all.',
      evidence: null,
      spanOrdinal: null,
      weight: 8,
    });
  }

  return defects.sort((a, b) => b.weight - a.weight);
}

/**
 * Search terms that fetch the authority each defect is argued from.
 *
 * Retrieval scores passages by term hits, so a defect that will be argued in
 * the letter has to pull the passages that carry its rule into the prompt.
 * Without this, the drafter is told about a defect and given nothing to cite
 * for it, and the instruction to argue only from given sources, which is the
 * right instruction, silently drops the argument.
 */
export function defectRetrievalTerms(defects: readonly DenialDefect[]): string[] {
  const terms = new Set<string>();
  for (const defect of defects) {
    switch (defect.id) {
      case 'improvement_standard':
        for (const t of ['improvement', 'maintain', 'maintenance', 'restoration potential'])
          terms.add(t);
        break;
      case 'proprietary_criteria':
        for (const t of ['more restrictive', 'coverage criteria', 'internal']) terms.add(t);
        break;
      case 'therapy_threshold':
        for (const t of ['daily basis', 'therapy']) terms.add(t);
        break;
      case 'no_criteria_disclosed':
      case 'no_physician_reviewer':
      case 'no_appeal_rights':
        for (const t of ['notice', 'specific reasons', 'reconsideration']) terms.add(t);
        break;
    }
  }
  return [...terms];
}

/* ─── The score ───────────────────────────────────────────────────────────── */

export type TriageRecommendation = 'take' | 'strengthen' | 'decline';

export interface Triage {
  /** 0 to 100. Record support, defects, and available authority, summed. */
  score: number;
  recommendation: TriageRecommendation;
  /** Why, in sentences a specialist reads before deciding. */
  reasons: string[];
  defects: DenialDefect[];
  criteriaSupported: number;
  criteriaTotal: number;
  /** Negative when the deadline has passed. Null when none is recorded. */
  daysToDeadline: number | null;
}

/** Below this, the case is declined; from here to TAKE_AT, strengthened. */
const STRENGTHEN_AT = 40;
const TAKE_AT = 70;

/** The most the defect column can contribute, however many are found. */
const DEFECT_POINTS_CAP = 40;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Score a case and recommend a posture.
 *
 * The arithmetic is deliberately simple enough to explain to a hospital in
 * one breath: half the score is how much of the record supports the criteria,
 * most of the rest is what is wrong with the denial itself, and a little is
 * whether the corpus holds authority to argue from. Selection is the honest
 * road to a high overturn rate, and selection only works if the score's
 * reasons can be read, checked, and disagreed with.
 *
 * A passed deadline caps the recommendation at decline whatever the merits,
 * because an untimely appeal needs good cause before it needs arguments. The
 * score is still computed and shown: it is the measure of what a good cause
 * filing would be fighting for.
 */
export function triageDenial(input: {
  defects: readonly DenialDefect[];
  criteria: readonly string[];
  gaps: readonly { criterion: string }[];
  authorityCount: number;
  appealDeadline: Date | null;
  now?: Date;
}): Triage {
  const criteriaTotal = input.criteria.length;
  const criteriaSupported = Math.max(0, criteriaTotal - input.gaps.length);

  const recordPoints =
    criteriaTotal === 0 ? 0 : Math.round((criteriaSupported / criteriaTotal) * 50);
  const defectPoints = Math.min(
    DEFECT_POINTS_CAP,
    input.defects.reduce((sum, d) => sum + d.weight, 0),
  );
  const authorityPoints = input.authorityCount > 0 ? 10 : 0;
  const score = Math.min(100, recordPoints + defectPoints + authorityPoints);

  const now = input.now ?? new Date();
  const daysToDeadline = input.appealDeadline
    ? Math.floor((input.appealDeadline.getTime() - now.getTime()) / DAY_MS)
    : null;

  const reasons: string[] = [];

  reasons.push(
    criteriaTotal === 0
      ? 'No coverage criteria are recorded for this service type, so record strength could not be scored.'
      : `The record supports ${criteriaSupported} of ${criteriaTotal} coverage criteria.`,
  );

  if (input.defects.length > 0) {
    reasons.push(
      `The denial itself carries ${input.defects.length} defect${
        input.defects.length === 1 ? '' : 's'
      }: ${input.defects.map((d) => d.title.toLowerCase()).join('; ')}.`,
    );
  } else {
    reasons.push('No defect was found in the denial notice itself.');
  }

  if (input.authorityCount === 0) {
    reasons.push('The corpus holds no authority for this denial, so there is nothing to argue from.');
  }

  let recommendation: TriageRecommendation =
    score >= TAKE_AT ? 'take' : score >= STRENGTHEN_AT ? 'strengthen' : 'decline';

  if (daysToDeadline !== null && daysToDeadline < 0) {
    recommendation = 'decline';
    reasons.push(
      `The appeal deadline passed ${-daysToDeadline} day${daysToDeadline === -1 ? '' : 's'} ago. ` +
        'An untimely appeal needs a good cause showing before it needs arguments, and that ' +
        'is a decision for the hospital, not for software.',
    );
  } else if (daysToDeadline !== null && daysToDeadline <= 7) {
    reasons.push(`The appeal deadline is ${daysToDeadline} day${daysToDeadline === 1 ? '' : 's'} away.`);
  }

  if (recommendation === 'strengthen' && input.gaps.length > 0) {
    reasons.push(
      'Documentation closing the unsupported criteria would move this case into the ' +
        'range worth taking; the gap list names exactly what is missing.',
    );
  }

  return {
    score,
    recommendation,
    reasons,
    defects: [...input.defects],
    criteriaSupported,
    criteriaTotal,
    daysToDeadline,
  };
}
