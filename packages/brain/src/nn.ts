/**
 * A small feed-forward neural network, implemented from scratch — no LLM, no
 * external ML runtime. Dense layers, ReLU, dropout, softmax + cross-entropy,
 * trained by backpropagation with the Adam optimizer and L2 weight decay.
 *
 * Why this rather than a language model (see docs/BRAIN.md):
 *   The product's hard requirement is that no claim may exist without a verbatim
 *   source quote. A generative model can emit text that is not in the document,
 *   so it needs a verification gate after the fact. This classifier never
 *   *writes* anything — it scores candidate spans that were cut out of the
 *   document itself, so the quote is a literal substring BY CONSTRUCTION.
 *   Fabrication is structurally impossible rather than filtered.
 *
 * Everything here is deterministic given a seed, runs in milliseconds on CPU,
 * needs no API key, and ships as a JSON weight file.
 */

// ── Deterministic RNG (seeded) ───────────────────────────────────────────────

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller normal sample from a uniform RNG. */
function gauss(rand: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ── Dense layer ──────────────────────────────────────────────────────────────

export interface DenseParams {
  /** Row-major [outDim][inDim] flattened to length outDim*inDim. */
  w: Float64Array;
  b: Float64Array;
  inDim: number;
  outDim: number;
}

interface AdamState {
  mW: Float64Array;
  vW: Float64Array;
  mB: Float64Array;
  vB: Float64Array;
}

export class Dense {
  params: DenseParams;
  private gW: Float64Array;
  private gB: Float64Array;
  private adam: AdamState;
  // Cached forward activations for the backward pass.
  private lastInput: Float64Array | null = null;

  constructor(inDim: number, outDim: number, rand: () => number) {
    // He initialization — correct for ReLU networks.
    const scale = Math.sqrt(2 / inDim);
    const w = new Float64Array(inDim * outDim);
    for (let i = 0; i < w.length; i++) w[i] = gauss(rand) * scale;
    this.params = { w, b: new Float64Array(outDim), inDim, outDim };
    this.gW = new Float64Array(inDim * outDim);
    this.gB = new Float64Array(outDim);
    this.adam = {
      mW: new Float64Array(inDim * outDim),
      vW: new Float64Array(inDim * outDim),
      mB: new Float64Array(outDim),
      vB: new Float64Array(outDim),
    };
  }

  static fromParams(p: DenseParams): Dense {
    const d = Object.create(Dense.prototype) as Dense;
    d.params = p;
    // Inference-only: gradient/optimizer buffers are not allocated.
    return d;
  }

  forward(x: Float64Array): Float64Array {
    const { w, b, inDim, outDim } = this.params;
    this.lastInput = x;
    const out = new Float64Array(outDim);
    for (let o = 0; o < outDim; o++) {
      let sum = b[o]!;
      const row = o * inDim;
      for (let i = 0; i < inDim; i++) sum += w[row + i]! * x[i]!;
      out[o] = sum;
    }
    return out;
  }

  /** Accumulate parameter gradients and return dL/dx. */
  backward(gradOut: Float64Array): Float64Array {
    const { w, inDim, outDim } = this.params;
    const x = this.lastInput!;
    const gradIn = new Float64Array(inDim);
    for (let o = 0; o < outDim; o++) {
      const go = gradOut[o]!;
      if (go === 0) continue;
      const row = o * inDim;
      this.gB[o] = (this.gB[o] ?? 0) + go;
      for (let i = 0; i < inDim; i++) {
        this.gW[row + i] = (this.gW[row + i] ?? 0) + go * (x[i] ?? 0);
        gradIn[i] = (gradIn[i] ?? 0) + go * (w[row + i] ?? 0);
      }
    }
    return gradIn;
  }

  /** Adam update with decoupled L2. `t` is the 1-based step count. */
  step(lr: number, t: number, weightDecay: number, batchSize: number): void {
    const b1 = 0.9;
    const b2 = 0.999;
    const eps = 1e-8;
    const { w, b } = this.params;
    const bc1 = 1 - Math.pow(b1, t);
    const bc2 = 1 - Math.pow(b2, t);
    const { mW, vW, mB, vB } = this.adam;

    for (let i = 0; i < w.length; i++) {
      const g = this.gW[i]! / batchSize + weightDecay * w[i]!;
      mW[i] = b1 * mW[i]! + (1 - b1) * g;
      vW[i] = b2 * vW[i]! + (1 - b2) * g * g;
      w[i] = w[i]! - (lr * (mW[i]! / bc1)) / (Math.sqrt(vW[i]! / bc2) + eps);
      this.gW[i] = 0;
    }
    for (let o = 0; o < b.length; o++) {
      const g = this.gB[o]! / batchSize;
      mB[o] = b1 * mB[o]! + (1 - b1) * g;
      vB[o] = b2 * vB[o]! + (1 - b2) * g * g;
      b[o] = b[o]! - (lr * (mB[o]! / bc1)) / (Math.sqrt(vB[o]! / bc2) + eps);
      this.gB[o] = 0;
    }
  }
}

// ── Activations / loss ───────────────────────────────────────────────────────

export function relu(x: Float64Array): Float64Array {
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i]! > 0 ? x[i]! : 0;
  return out;
}

export function reluBackward(gradOut: Float64Array, preAct: Float64Array): Float64Array {
  const g = new Float64Array(gradOut.length);
  for (let i = 0; i < gradOut.length; i++) g[i] = preAct[i]! > 0 ? gradOut[i]! : 0;
  return g;
}

/** Numerically stable softmax. */
export function softmax(logits: Float64Array): Float64Array {
  let max = -Infinity;
  for (const v of logits) if (v > max) max = v;
  const out = new Float64Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    const e = Math.exp((logits[i] ?? 0) - max);
    out[i] = e;
    sum += e;
  }
  const denom = sum || 1;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] ?? 0) / denom;
  return out;
}

// ── The classifier ───────────────────────────────────────────────────────────

export interface MlpConfig {
  inDim: number;
  hidden: number[];
  outDim: number;
  dropout: number;
  seed: number;
}

export interface SerializedModel {
  config: MlpConfig;
  layers: Array<{ w: number[]; b: number[]; inDim: number; outDim: number }>;
  /** Confidence threshold below which the model abstains (precision-first). */
  threshold: number;
  labels: string[];
  /** Metadata for provenance — recorded at training time. */
  meta: Record<string, unknown>;
}

export class Mlp {
  readonly config: MlpConfig;
  private layers: Dense[];
  private rand: () => number;
  private step_ = 0;
  // Forward caches for backprop.
  private preActs: Float64Array[] = [];
  private acts: Float64Array[] = [];
  private masks: Array<Float64Array | null> = [];

  constructor(config: MlpConfig, layers?: Dense[]) {
    this.config = config;
    this.rand = mulberry32(config.seed);
    if (layers) {
      this.layers = layers;
    } else {
      const dims = [config.inDim, ...config.hidden, config.outDim];
      this.layers = [];
      for (let i = 0; i < dims.length - 1; i++) {
        this.layers.push(new Dense(dims[i]!, dims[i + 1]!, this.rand));
      }
    }
  }

  /** Forward pass. `training` enables dropout on hidden activations. */
  forward(x: Float64Array, training: boolean): Float64Array {
    this.preActs = [];
    this.acts = [x];
    this.masks = [];
    let h = x;
    for (let i = 0; i < this.layers.length; i++) {
      const z = this.layers[i]!.forward(h);
      this.preActs.push(z);
      if (i === this.layers.length - 1) {
        return softmax(z);
      }
      let a = relu(z);
      if (training && this.config.dropout > 0) {
        // Inverted dropout — scale at train time so inference needs no change.
        const keep = 1 - this.config.dropout;
        const mask = new Float64Array(a.length);
        for (let j = 0; j < a.length; j++) {
          const on = this.rand() < keep ? 1 : 0;
          mask[j] = on / keep;
          a[j] = a[j]! * mask[j]!;
        }
        this.masks.push(mask);
      } else {
        this.masks.push(null);
      }
      this.acts.push(a);
      h = a;
    }
    /* istanbul ignore next — loop always returns at the last layer */
    throw new Error("unreachable");
  }

  /**
   * Backward pass for one example. `probs` is the softmax output, `target` the
   * gold class index, `weight` the per-class loss weight. Returns the loss.
   * dL/dlogits for softmax+cross-entropy is simply (p - onehot).
   */
  backward(probs: Float64Array, target: number, weight: number): number {
    const grad = new Float64Array(probs.length);
    for (let i = 0; i < probs.length; i++) grad[i] = probs[i]! * weight;
    grad[target] = (probs[target]! - 1) * weight;
    const loss = -Math.log(Math.max(probs[target]!, 1e-12)) * weight;

    let g: Float64Array = grad;
    for (let i = this.layers.length - 1; i >= 0; i--) {
      g = this.layers[i]!.backward(g);
      if (i > 0) {
        const mask = this.masks[i - 1];
        if (mask) for (let j = 0; j < g.length; j++) g[j] = g[j]! * mask[j]!;
        g = reluBackward(g, this.preActs[i - 1]!);
      }
    }
    return loss;
  }

  step(lr: number, weightDecay: number, batchSize: number): void {
    this.step_ += 1;
    for (const l of this.layers) l.step(lr, this.step_, weightDecay, batchSize);
  }

  predict(x: Float64Array): Float64Array {
    return this.forward(x, false);
  }

  serialize(threshold: number, labels: string[], meta: Record<string, unknown>): SerializedModel {
    return {
      config: this.config,
      layers: this.layers.map((l) => ({
        w: Array.from(l.params.w),
        b: Array.from(l.params.b),
        inDim: l.params.inDim,
        outDim: l.params.outDim,
      })),
      threshold,
      labels,
      meta,
    };
  }

  static deserialize(m: SerializedModel): Mlp {
    const layers = m.layers.map((l) =>
      Dense.fromParams({
        w: Float64Array.from(l.w),
        b: Float64Array.from(l.b),
        inDim: l.inDim,
        outDim: l.outDim,
      }),
    );
    return new Mlp(m.config, layers);
  }
}
