import { countWords } from "./segment";

/**
 * Feature extraction. The input to the network is a hashed lexical signature of
 * the candidate concatenated with a block of engineered domain features drawn
 * from how coverage policy is actually written.
 *
 * Policy prose is highly conventionalized ("is considered medically necessary
 * when…", "must demonstrate…", "is considered investigational…", "this section is
 * provided for context"), which is why a compact feature-based classifier can do
 * this job well without a language model.
 */

export const HASH_DIM = 512;

function hashStr(s: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % HASH_DIM;
}

const STOP = new Set([
  "the", "a", "an", "of", "and", "or", "to", "in", "for", "on", "at", "by", "as",
  "is", "are", "be", "been", "was", "were", "that", "this", "these", "those", "it",
  "with", "from", "has", "have", "had", "which", "when", "if", "than", "then",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9%\- ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Domain cue lexicons. Each becomes a normalized count feature, and the strongest
 * ones also become binary presence features. These encode "how payers write",
 * which is the actual signal.
 */
const CUES: Record<string, string[]> = {
  deontic: ["must", "shall", "required", "requires", "require", "should"],
  coverage_pos: [
    "covered", "covers", "cover", "medically necessary", "reasonable and necessary",
    "considered established", "established", "proven", "eligible", "will be covered",
  ],
  coverage_neg: [
    "not covered", "does not cover", "non-covered", "noncovered", "investigational",
    "experimental", "unproven", "not medically necessary", "not established",
    "excluded", "exclusion", "is not", "denied",
  ],
  evidence: [
    "evidence", "peer-reviewed", "published", "study", "studies", "trial", "trials",
    "literature", "data", "demonstrate", "demonstrated", "shown", "establish",
  ],
  study_design: ["prospective", "retrospective", "randomized", "controlled", "registry", "cohort", "single-arm"],
  endpoint: ["outcomes", "endpoint", "survival", "sensitivity", "specificity", "concordance", "accuracy", "change in management"],
  validity_analytic: ["analytical validity", "analytic validity", "concordance", "limit of detection", "reproducibility", "precision", "specimen"],
  validity_clinical: ["clinical validity", "associated with", "predictive", "clinical condition"],
  utility: ["clinical utility", "change in patient management", "improves health outcomes", "affect treatment", "guide treatment", "inform treatment"],
  test_specific: ["clia", "z-code", "zcode", "dex", "registered", "accreditation", "accredited", "fda", "cleared", "companion", "laboratory", "cap"],
  frequency: ["once per", "one per", "limited to one", "repeat", "previously tested", "per diagnosis", "per lifetime", "more than", "each", "annually"],
  ordering: ["ordered by", "ordering", "treating physician", "oncologist", "board-certified", "specialist", "prescriber", "consultation"],
  documentation: ["document", "documented", "documentation", "attest", "attestation", "medical record", "submit", "submitted", "records"],
  indication: ["stage", "metastatic", "advanced", "recurrent", "relapsed", "refractory", "diagnosis of", "cancer", "tumor", "malignancy", "carcinoma"],
  prior_therapy: ["prior", "previously received", "failed", "progressed", "after treatment", "first-line", "second-line", "line of therapy", "refractory to"],
  population: ["adult", "adults", "pediatric", "children", "years of age", "age", "female", "male", "asymptomatic", "patients who"],
  site: ["inpatient", "outpatient", "facility", "place of service", "office", "hospital", "ambulatory"],
  // Strong NEGATIVE cues: background, definitions, and disclaimers are not criteria.
  background: [
    "background", "for context", "does not itself establish", "provided for reference",
    "summarizes", "summary", "review of the literature", "discussion", "refers to",
    "is defined as", "definition", "for educational", "does not constitute",
    "readers are referred", "this section", "the following discussion", "overview",
  ],
};

const CUE_KEYS = Object.keys(CUES);

/** Section-heading buckets — where a sentence sits is a strong prior. */
const SECTION_BUCKETS = [
  { key: "coverage", pat: /coverage|indication|medical necessity|criteria|policy statement|when.*covered/i },
  { key: "limitation", pat: /limitation|exclusion|not covered|non-?covered|experimental|investigational/i },
  { key: "technical", pat: /technical assessment|analytical|clinical validity|clinical utility|validity|utility/i },
  { key: "background", pat: /background|rationale|discussion|literature|references|history|overview/i },
  { key: "definition", pat: /definition|glossary|terms|abbreviation/i },
  { key: "coding", pat: /coding|cpt|hcpcs|icd|billing/i },
];

export interface FeatureContext {
  /** Section heading path for the parent span, root → leaf. */
  headingPath: string[];
  /** Candidate position within its span. */
  index: number;
  total: number;
}

/** Number of engineered (non-hashed) features. Keep in sync with `engineered()`. */
export const ENGINEERED_DIM = CUE_KEYS.length * 2 + SECTION_BUCKETS.length + 12;
export const FEATURE_DIM = HASH_DIM + ENGINEERED_DIM;

function engineered(text: string, ctx: FeatureContext): number[] {
  const lower = text.toLowerCase();
  const words = countWords(text);
  const out: number[] = [];

  // Per-lexicon: normalized count + binary presence.
  for (const key of CUE_KEYS) {
    const terms = CUES[key]!;
    let hits = 0;
    for (const t of terms) {
      if (t.includes(" ")) {
        if (lower.includes(t)) hits++;
      } else {
        // Whole-word match for single tokens.
        const re = new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
        if (re.test(lower)) hits++;
      }
    }
    out.push(Math.min(hits / 3, 1));
    out.push(hits > 0 ? 1 : 0);
  }

  // Section bucket one-hot (from the leaf heading, falling back to the full path).
  const heading = (ctx.headingPath[ctx.headingPath.length - 1] ?? "") + " " + ctx.headingPath.join(" ");
  for (const b of SECTION_BUCKETS) out.push(b.pat.test(heading) ? 1 : 0);

  // Structural / surface features.
  out.push(Math.min(words / 40, 1));                       // length
  out.push(words < 8 ? 1 : 0);                             // very short
  out.push(ctx.total > 1 ? ctx.index / (ctx.total - 1) : 0); // relative position
  out.push(ctx.index === 0 ? 1 : 0);                       // first in span
  out.push(ctx.index === ctx.total - 1 ? 1 : 0);           // last in span
  out.push(/\d/.test(text) ? 1 : 0);                       // has a number
  out.push(/\d+\s?%/.test(text) ? 1 : 0);                  // has a percentage
  out.push(/\b(?:stage|grade)\s+[ivx0-9]/i.test(text) ? 1 : 0); // staging language
  out.push(/^[A-Z][a-z]+ (?:considers|covers)/.test(text.trim()) ? 1 : 0); // "Aetna considers…"
  out.push(/\b(?:when all of the following|all of the following|any of the following)\b/i.test(lower) ? 1 : 0);
  out.push(/\bnot\b/.test(lower) ? 1 : 0);                 // negation present
  out.push(/\bunless\b|\babsent\b|\bexcept\b/.test(lower) ? 1 : 0); // conditional exception
  return out;
}

/** Build the full input vector for one candidate. */
export function featurize(text: string, ctx: FeatureContext): Float64Array {
  const vec = new Float64Array(FEATURE_DIM);
  const toks = tokenize(text);

  // Hashed unigrams (stopwords dropped) + bigrams (kept, they carry the idioms).
  let n = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]!;
    if (!STOP.has(t)) {
      const h1 = hashStr(t, 1);
      vec[h1] = (vec[h1] ?? 0) + 1;
      n++;
    }
    if (i + 1 < toks.length) {
      const h2 = hashStr(`${t}_${toks[i + 1]!}`, 2);
      vec[h2] = (vec[h2] ?? 0) + 1;
      n++;
    }
  }
  // L2-normalize the hashed block so long sentences do not dominate.
  let norm = 0;
  for (let i = 0; i < HASH_DIM; i++) { const v = vec[i] ?? 0; norm += v * v; }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < HASH_DIM; i++) vec[i] = (vec[i] ?? 0) / norm;

  const eng = engineered(text, ctx);
  for (let i = 0; i < eng.length; i++) vec[HASH_DIM + i] = eng[i]!;
  return vec;
}
