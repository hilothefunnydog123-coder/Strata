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

/**
 * A deterministic embedding computed locally, with no model call.
 *
 * Character trigram hashing into a fixed number of dimensions. It captures
 * lexical overlap, which is most of what matters when matching a denial
 * against holdings that use the same statutory vocabulary, and it costs
 * nothing per document.
 *
 * What it does not capture is paraphrase: "the plan applied stricter rules" and
 * "the organization imposed more restrictive criteria" score lower than they
 * should. That is a real limitation and it is why retrieval combines this
 * signal with structured filters and with term overlap on the denial basis
 * rather than relying on it alone. Swapping in a model embedding later is a
 * change to this one function.
 */
const DIMENSIONS = 384;

export function embed(text: string): number[] {
  const vector = new Float64Array(DIMENSIONS);
  const normalized = text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

  if (normalized.length === 0) return Array.from(vector);

  for (let i = 0; i + 3 <= normalized.length; i += 1) {
    const trigram = normalized.slice(i, i + 3);
    const bucket = hash(trigram) % DIMENSIONS;
    // Signed, so unrelated trigrams landing in one bucket tend to cancel rather
    // than accumulate into a false signal.
    const sign = hash(`${trigram}#`) % 2 === 0 ? 1 : -1;
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
