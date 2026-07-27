/**
 * Deterministic feature-hashing embedding. This is a real embedding (bag-of-words
 * hashed into a fixed-dim vector with L2 normalization) so cosine similarity is
 * meaningful and reproducible with zero network. In PIPELINE_MODE=live a learned
 * text-embedding model plugs in behind the same {embed, cosine} interface, and the
 * vectors move to pgvector; nothing downstream changes.
 */
const DIM = 256;

function hashToken(tok: string): number {
  let h = 2166136261;
  for (let i = 0; i < tok.length; i++) {
    h ^= tok.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % DIM;
}

const STOP = new Set(["the", "and", "for", "that", "with", "must", "when", "has", "not", "are", "was", "this"]);

export function embed(text: string): number[] {
  const vec = new Array<number>(DIM).fill(0);
  const toks = text.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
  for (const t of toks) { const i = hashToken(t); vec[i] = (vec[i] ?? 0) + 1; }
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return vec.map((v) => v / norm);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot; // inputs are L2-normalized
}
