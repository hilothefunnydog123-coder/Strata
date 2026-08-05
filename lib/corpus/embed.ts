/**
 * Embeddings and similarity, without a vector database.
 *
 * pgvector is not assumed present: it is absent on the PostgreSQL instance this
 * was developed against and its availability on Neon varies by project. So
 * `holding.embedding` is a plain float array and similarity is computed here.
 *
 * That is a defensible choice rather than a compromise, because retrieval
 * filters on the structured columns first. A query is always narrowed by
 * service type, payer type, and denial basis before anything is scored, which
 * takes the candidate set from the whole corpus to a few hundred rows. Cosine
 * over a few hundred vectors is sub-millisecond and exact, where an approximate
 * index is neither.
 *
 * When the corpus outgrows this, the migration is a column type change and an
 * index. No calling code changes.
 */
import { CONCEPT_PHRASES, CONCEPT_WORDS, STOPWORDS, stem } from './embed-vocabulary';

/**
 * A deterministic embedding computed locally, with no model call.
 *
 * This was character trigram hashing, and its weakness was the one that matters
 * most here: a denial and the provision answering it are written by different
 * people and almost never choose the same words. A payer writes "did not
 * require care on a daily basis", the manual says "skilled services must be
 * needed every day", and as strings those share nearly nothing while meaning
 * the same thing. Trigrams scored them apart. Similarity carries the second
 * highest weight in retrieval, so that was a real cost on every appeal.
 *
 * What replaces it works on words rather than characters, and does four things
 * trigrams could not:
 *
 *   1. Drops stopwords, which otherwise dominate every vector with "the" and
 *      "of" and make two unrelated passages look alike.
 *   2. Stems lightly, so "therapies" and "therapy" are one token.
 *   3. Maps the domain's synonyms onto one concept token each, which is where
 *      the paraphrase gap actually closes. See embed-vocabulary.ts.
 *   4. Emits adjacent bigrams as well as single words, so word order carries
 *      some weight and "not skilled" is not identical to "skilled".
 *
 * It is still not a model, and it is honest to say what it cannot do: a
 * paraphrase built from vocabulary nobody wrote down here will still be missed.
 * A sentence transformer would know that without being told. Swapping one in
 * remains a change to this one function, and the version stamp below is what
 * makes that swap safe.
 */
const DIMENSIONS = 384;

/**
 * Bump this whenever the function below changes what it produces.
 *
 * Two embeddings from different versions are points in unrelated spaces, and
 * the cosine between them is not a small error, it is noise presented with the
 * same confidence as a real score. Nothing would fail: retrieval would return
 * rows, in a plausible order, that had been ranked against a query it could not
 * actually compare to. Stamping the row is what lets the embed stage find the
 * stale ones and redo them instead of leaving the corpus quietly mixed.
 */
export const EMBEDDING_VERSION = 2;

/** Words and adjacent bigrams, after stopwords, stemming, and concept mapping. */
export function tokenize(text: string): string[] {
  let normalized = text.toLowerCase().replace(/[^a-z0-9\s]+/g, ' ');

  // Phrases before words, so "coverage criteria" becomes one concept rather
  // than a concept plus a leftover word.
  for (const [pattern, concept] of CONCEPT_PHRASES) {
    normalized = normalized.replace(pattern, ` ${concept} `);
  }

  const words: string[] = [];
  for (const raw of normalized.split(/\s+/)) {
    if (raw.length === 0) continue;
    if (raw.startsWith('\u03b6')) {
      words.push(raw);
      continue;
    }
    if (STOPWORDS.has(raw)) continue;

    const stemmed = stem(raw);
    words.push(CONCEPT_WORDS[raw] ?? CONCEPT_WORDS[stemmed] ?? stemmed);
  }

  // Bigrams over what survived, which is where a little word order comes back.
  const tokens = [...words];
  for (let i = 0; i + 1 < words.length; i += 1) {
    tokens.push(`${words[i]}\u00b7${words[i + 1]}`);
  }

  return tokens;
}

export function embed(text: string): number[] {
  const vector = new Float64Array(DIMENSIONS);
  const tokens = tokenize(text);

  if (tokens.length === 0) return Array.from(vector);

  for (const token of tokens) {
    const bucket = hash(token) % DIMENSIONS;
    // Signed, so unrelated tokens landing in one bucket tend to cancel rather
    // than accumulate into a false signal.
    const sign = hash(`${token}#`) % 2 === 0 ? 1 : -1;
    vector[bucket] = (vector[bucket] ?? 0) + sign;
  }

  // L2 normalise, so cosine similarity is a dot product and length does not
  // make a long document look similar to everything.
  let magnitude = 0;
  for (const value of vector) magnitude += value * value;
  magnitude = Math.sqrt(magnitude);
  if (magnitude === 0) return Array.from(vector);

  const out = new Array<number>(DIMENSIONS);
  for (let i = 0; i < DIMENSIONS; i += 1) out[i] = vector[i]! / magnitude;
  return out;
}

/** FNV-1a. Fast, well distributed, and stable across runs and machines. */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Cosine similarity between two normalised vectors, in [-1, 1].
 *
 * Vectors of differing length return 0 rather than throwing: a corpus part way
 * through a dimension change should degrade to "no signal" rather than take
 * down retrieval.
 */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i]! * b[i]!;
  return dot;
}

/** The text an embedding is computed over for a holding. */
export function holdingEmbeddingText(holding: {
  issue: string;
  ruleApplied: string;
  verbatimQuote: string;
}): string {
  return `${holding.issue} ${holding.ruleApplied} ${holding.verbatimQuote}`;
}
