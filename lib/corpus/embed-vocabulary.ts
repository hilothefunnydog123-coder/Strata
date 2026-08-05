/**
 * The vocabulary this domain actually argues in.
 *
 * A denial letter and the manual provision that answers it are written by
 * different people for different purposes and almost never choose the same
 * words. A payer writes "the member did not require care on a daily basis";
 * the manual says "skilled services must be needed every day". They are the
 * same proposition and share, as strings, almost nothing.
 *
 * A model embedding would know that. This is what can be done without one:
 * name the concepts the argument turns on, list the ways each is written, and
 * map every one of them onto a single token before hashing. It is narrow, it is
 * hand maintained, and within this domain it closes most of the gap that
 * matters, because the set of things a Medicare denial can say is small and
 * well documented.
 */

/** Words that carry no signal and would otherwise dominate every vector. */
export const STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'about', 'above', 'after', 'all', 'also', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'been', 'being', 'but', 'by', 'can', 'did', 'do', 'does', 'each', 'for', 'from',
  'had', 'has', 'have', 'he', 'her', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it',
  'its', 'may', 'more', 'most', 'must', 'no', 'not', 'of', 'on', 'one', 'only', 'or',
  'other', 'our', 'out', 'over', 'own', 'said', 'same', 'she', 'should', 'since',
  'so', 'some', 'such', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these',
  'they', 'this', 'those', 'through', 'to', 'under', 'up', 'was', 'we', 'were', 'what',
  'when', 'where', 'which', 'while', 'who', 'will', 'with', 'would', 'you', 'your',
]);

/**
 * Phrases first, longest first, because the multi word ones carry the meaning.
 *
 * "practical matter" is a term of art in the extended care benefit and means
 * something quite specific; the two words apart mean nothing in particular.
 * Matched before single words so the phrase wins.
 */
export const CONCEPT_PHRASES: ReadonlyArray<readonly [RegExp, string]> = [
  // Frequency of care, the hinge of most skilled nursing denials.
  [/\b(?:on a )?daily basis\b/g, 'ζdaily'],
  [/\bevery day\b/g, 'ζdaily'],
  [/\beach day\b/g, 'ζdaily'],
  [/\bday to day\b/g, 'ζdaily'],
  [/\bseven days a week\b/g, 'ζdaily'],
  [/\bfive days a week\b/g, 'ζdaily'],

  // Medical necessity.
  [/\bmedically necessary\b/g, 'ζmednec'],
  [/\bmedical necessity\b/g, 'ζmednec'],
  [/\bnot medically reasonable\b/g, 'ζmednec'],
  [/\breasonable and necessary\b/g, 'ζmednec'],

  // The criteria argument, which is the strongest one available.
  [/\bcoverage criteria\b/g, 'ζcriteria'],
  [/\bcoverage guidelines\b/g, 'ζcriteria'],
  [/\binternal criteria\b/g, 'ζcriteria'],
  [/\bproprietary criteria\b/g, 'ζcriteria'],
  [/\bscreening tool\b/g, 'ζcriteria'],
  [/\bclinical guidelines\b/g, 'ζcriteria'],
  [/\bmore restrictive\b/g, 'ζrestrictive'],
  [/\bmore stringent\b/g, 'ζrestrictive'],
  [/\bstricter\b/g, 'ζrestrictive'],

  // Level and setting of care.
  [/\bskilled nursing facility\b/g, 'ζsnf'],
  [/\bextended care\b/g, 'ζsnf'],
  [/\bnursing home\b/g, 'ζsnf'],
  [/\blevel of care\b/g, 'ζlevelofcare'],
  [/\bas a practical matter\b/g, 'ζpracticalmatter'],
  [/\bpractical matter\b/g, 'ζpracticalmatter'],
  [/\binpatient basis\b/g, 'ζinpatient'],
  [/\bcustodial care\b/g, 'ζcustodial'],
  [/\bpersonal care\b/g, 'ζcustodial'],

  // Who is deciding, and what they did.
  [/\bmedicare advantage\b/g, 'ζplan'],
  [/\bma organization\b/g, 'ζplan'],
  [/\bma plan\b/g, 'ζplan'],
  [/\bhealth plan\b/g, 'ζplan'],
  [/\btraditional medicare\b/g, 'ζtraditional'],
  [/\boriginal medicare\b/g, 'ζtraditional'],
  [/\bfee for service\b/g, 'ζtraditional'],
  [/\badverse determination\b/g, 'ζdenial'],
  [/\borganization determination\b/g, 'ζdenial'],

  // Evidence.
  [/\bmedical record\b/g, 'ζrecord'],
  [/\bplan of care\b/g, 'ζrecord'],
  [/\bphysician order\b/g, 'ζorder'],
  [/\bphysician certification\b/g, 'ζorder'],
  [/\bqualifying hospital stay\b/g, 'ζqualifyingstay'],
  [/\bthree day\b/g, 'ζqualifyingstay'],
];

/** Single words that mean the same thing as a concept above. */
export const CONCEPT_WORDS: Readonly<Record<string, string>> = {
  daily: 'ζdaily',
  everyday: 'ζdaily',
  snf: 'ζsnf',
  custodial: 'ζcustodial',
  restrictive: 'ζrestrictive',
  stringent: 'ζrestrictive',
  stricter: 'ζrestrictive',
  criteria: 'ζcriteria',
  criterion: 'ζcriteria',
  guideline: 'ζcriteria',
  mcg: 'ζcriteria',
  interqual: 'ζcriteria',
  milliman: 'ζcriteria',
  denial: 'ζdenial',
  denied: 'ζdenial',
  deny: 'ζdenial',
  denies: 'ζdenial',
  noncoverage: 'ζdenial',
  inpatient: 'ζinpatient',
  hospitalization: 'ζinpatient',
  documentation: 'ζrecord',
  chart: 'ζrecord',
  records: 'ζrecord',
  necessary: 'ζmednec',
  necessity: 'ζmednec',
  rehabilitation: 'ζrehab',
  rehab: 'ζrehab',
  therapy: 'ζrehab',
  therapies: 'ζrehab',
};

/**
 * Strip the suffixes that make one word look like two.
 *
 * Not a full stemmer. A real one over-stems legal vocabulary in ways that hurt
 * here: Porter turns "coverage" into "cover" and "certification" into "certif",
 * collapsing distinctions this domain draws on purpose. These are the endings
 * that genuinely produce the same word.
 */
export function stem(word: string): string {
  if (word.length <= 4) return word;

  for (const suffix of ['ingly', 'edly', 'ing', 'ies', 'ed', 'es', 's']) {
    if (!word.endsWith(suffix)) continue;
    const base = word.slice(0, -suffix.length);
    if (base.length < 3) continue;
    // "ies" to "y": "therapies" and "therapy" are one word.
    if (suffix === 'ies') return `${base}y`;
    return dropSilentE(base);
  }

  return dropSilentE(word);
}

/**
 * Drop a trailing "e", so a word and its stripped form land together.
 *
 * Without this the endings above half work: "required" loses "ed" and becomes
 * "requir", while "require" keeps its "e" and stays "require", so the two are
 * different tokens and the stemmer has achieved nothing for that pair. Same for
 * "nursing" against "nurse".
 *
 * Only from five characters up, which is what keeps it consistent rather than
 * merely aggressive: "cares" loses its "s" to become "care", and "care" is left
 * alone, so both sides of that pair agree too.
 */
function dropSilentE(word: string): string {
  return word.length >= 5 && word.endsWith('e') ? word.slice(0, -1) : word;
}
