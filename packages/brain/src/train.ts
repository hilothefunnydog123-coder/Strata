import { Mlp, mulberry32, type MlpConfig } from "./nn";
import { FEATURE_DIM } from "./features";
import { LABELS, indexToLabel, type BrainLabel } from "./labels";
import type { Example } from "./dataset";

/**
 * Training. Standard supervised setup with the two adjustments this domain needs:
 *
 *  1. CLASS WEIGHTING — `none` is the majority class by a wide margin. Without
 *     reweighting the model would learn to always abstain.
 *  2. PRECISION-FIRST THRESHOLD — the product tolerates missing a requirement far
 *     better than inventing one, so after training we pick the confidence floor
 *     that maximizes recall subject to a precision target, and the model abstains
 *     below it.
 */

export interface TrainOptions {
  epochs?: number;
  lr?: number;
  batchSize?: number;
  weightDecay?: number;
  hidden?: number[];
  dropout?: number;
  seed?: number;
  /** Precision we insist on when choosing the abstention threshold. */
  targetPrecision?: number;
  valFraction?: number;
  patience?: number;
  verbose?: boolean;
}

export interface ClassMetrics {
  label: BrainLabel;
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  support: number;
}

export interface EvalReport {
  /** Detection = "is this a criterion at all" (any non-none class), the metric that matters most. */
  detectionPrecision: number;
  detectionRecall: number;
  detectionF1: number;
  /** Of correctly-detected criteria, how often the kind is right. */
  kindAccuracy: number;
  /** Predicted a criterion where the gold label was none. */
  falsePositives: number;
  /** Overall accuracy across all classes including none. */
  accuracy: number;
  perClass: ClassMetrics[];
  total: number;
  threshold: number;
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}

/** Inverse-frequency class weights, dampened by a square root and capped. */
export function classWeights(examples: Example[]): Float64Array {
  const counts = new Float64Array(LABELS.length);
  for (const e of examples) counts[e.y] = counts[e.y]! + 1;
  const total = examples.length;
  const w = new Float64Array(LABELS.length);
  for (let i = 0; i < LABELS.length; i++) {
    const c = counts[i]!;
    w[i] = c === 0 ? 1 : Math.min(6, Math.sqrt(total / (LABELS.length * c)));
  }
  return w;
}

export interface TrainResult {
  model: Mlp;
  threshold: number;
  validation: EvalReport;
  epochsRun: number;
}

export function train(examples: Example[], opts: TrainOptions = {}): TrainResult {
  const {
    epochs = 600,
    lr = 0.002,
    batchSize = 16,
    weightDecay = 2e-4,
    hidden = [96, 48],
    dropout = 0.25,
    seed = 20260727,
    targetPrecision = 0.95,
    valFraction = 0.2,
    patience = 120,
    verbose = false,
  } = opts;

  const rand = mulberry32(seed);
  const shuffled = shuffle(examples, rand);
  const cut = Math.max(1, Math.floor(shuffled.length * (1 - valFraction)));
  const trainSet = shuffled.slice(0, cut);
  const valSet = shuffled.slice(cut);

  const config: MlpConfig = { inDim: FEATURE_DIM, hidden, outDim: LABELS.length, dropout, seed };
  const model = new Mlp(config);
  const weights = classWeights(trainSet);

  let bestLoss = Infinity;
  let bestSnapshot = model.serialize(0.5, LABELS as string[], {});
  let sinceBest = 0;
  let epochsRun = 0;

  for (let epoch = 0; epoch < epochs; epoch++) {
    epochsRun = epoch + 1;
    const order = shuffle(trainSet, rand);
    for (let i = 0; i < order.length; i += batchSize) {
      const batch = order.slice(i, i + batchSize);
      for (const ex of batch) {
        const probs = model.forward(ex.x, true);
        model.backward(probs, ex.y, weights[ex.y]!);
      }
      model.step(lr, weightDecay, batch.length);
    }

    // Early stopping on weighted validation loss.
    let vLoss = 0;
    for (const ex of valSet) {
      const p = model.predict(ex.x);
      vLoss += -Math.log(Math.max(p[ex.y]!, 1e-12)) * weights[ex.y]!;
    }
    vLoss /= Math.max(1, valSet.length);

    if (vLoss < bestLoss - 1e-4) {
      bestLoss = vLoss;
      bestSnapshot = model.serialize(0.5, LABELS as string[], {});
      sinceBest = 0;
    } else if (++sinceBest >= patience) {
      if (verbose) console.log(`  early stop at epoch ${epoch + 1} (val loss ${vLoss.toFixed(4)})`);
      break;
    }
    if (verbose && (epoch + 1) % 40 === 0) {
      console.log(`  epoch ${epoch + 1}: val loss ${vLoss.toFixed(4)}`);
    }
  }

  const best = Mlp.deserialize(bestSnapshot);
  const threshold = tuneThreshold(best, valSet, targetPrecision);
  const validation = evaluate(best, valSet, threshold);
  return { model: best, threshold, validation, epochsRun };
}

/**
 * Choose the smallest confidence floor that reaches the precision target on the
 * validation split (so we keep as much recall as possible at that precision).
 */
export function tuneThreshold(model: Mlp, valSet: Example[], targetPrecision: number): number {
  const scored = valSet.map((ex) => {
    const p = model.predict(ex.x);
    let bestI = 0;
    let bestP = -1;
    for (let i = 0; i < p.length; i++) {
      if (p[i]! > bestP) {
        bestP = p[i]!;
        bestI = i;
      }
    }
    return { gold: ex.y, pred: bestI, conf: bestP };
  });

  let chosen = -1;
  let bestFallback = { t: 0.5, fbeta: -1 };
  for (let t = 0.30; t <= 0.995; t += 0.005) {
    let tp = 0;
    let fp = 0;
    for (const s of scored) {
      const predIsCriterion = s.pred !== 0 && s.conf >= t;
      if (!predIsCriterion) continue;
      if (s.gold !== 0) tp++;
      else fp++;
    }
    const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
    const totalPos = scored.filter((s) => s.gold !== 0).length;
    const recall = totalPos === 0 ? 1 : tp / totalPos;
    if (precision >= targetPrecision && chosen < 0) {
      // Lowest threshold meeting the precision bar keeps the most recall.
      chosen = Number(t.toFixed(3));
    }
    // Fallback operating point: F-beta with beta=0.5 (precision weighted 4:1).
    const b2 = 0.25;
    const fbeta =
      precision + recall === 0 ? 0 : ((1 + b2) * precision * recall) / (b2 * precision + recall);
    if (fbeta > bestFallback.fbeta) bestFallback = { t: Number(t.toFixed(3)), fbeta };
  }
  // If no threshold reaches the target, take the precision-weighted best rather
  // than silently clamping to a value that destroys recall.
  return chosen >= 0 ? chosen : bestFallback.t;
}

/** Score a model on a set. Detection = any non-`none` class. */
export function evaluate(model: Mlp, set: Example[], threshold: number): EvalReport {
  const nLab = LABELS.length;
  const tp = new Array<number>(nLab).fill(0);
  const fp = new Array<number>(nLab).fill(0);
  const fn = new Array<number>(nLab).fill(0);
  const support = new Array<number>(nLab).fill(0);

  let detTp = 0;
  let detFp = 0;
  let detFn = 0;
  let kindRight = 0;
  let correct = 0;

  for (const ex of set) {
    const p = model.predict(ex.x);
    let bestI = 0;
    let bestP = -1;
    for (let i = 0; i < p.length; i++) {
      if (p[i]! > bestP) {
        bestP = p[i]!;
        bestI = i;
      }
    }
    // Abstain below the confidence floor.
    const pred = bestI !== 0 && bestP < threshold ? 0 : bestI;

    support[ex.y] = support[ex.y]! + 1;
    if (pred === ex.y) {
      correct++;
      tp[pred] = tp[pred]! + 1;
    } else {
      fp[pred] = fp[pred]! + 1;
      fn[ex.y] = fn[ex.y]! + 1;
    }

    const goldIsCrit = ex.y !== 0;
    const predIsCrit = pred !== 0;
    if (goldIsCrit && predIsCrit) {
      detTp++;
      if (pred === ex.y) kindRight++;
    } else if (!goldIsCrit && predIsCrit) detFp++;
    else if (goldIsCrit && !predIsCrit) detFn++;
  }

  const perClass: ClassMetrics[] = LABELS.map((label, i) => {
    const precision = tp[i]! + fp[i]! === 0 ? 1 : tp[i]! / (tp[i]! + fp[i]!);
    const recall = tp[i]! + fn[i]! === 0 ? 1 : tp[i]! / (tp[i]! + fn[i]!);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    return { label: indexToLabel(i), tp: tp[i]!, fp: fp[i]!, fn: fn[i]!, precision, recall, f1, support: support[i]! };
  });

  const detectionPrecision = detTp + detFp === 0 ? 1 : detTp / (detTp + detFp);
  const detectionRecall = detTp + detFn === 0 ? 1 : detTp / (detTp + detFn);
  const detectionF1 =
    detectionPrecision + detectionRecall === 0
      ? 0
      : (2 * detectionPrecision * detectionRecall) / (detectionPrecision + detectionRecall);

  return {
    detectionPrecision,
    detectionRecall,
    detectionF1,
    kindAccuracy: detTp === 0 ? 1 : kindRight / detTp,
    falsePositives: detFp,
    accuracy: set.length === 0 ? 1 : correct / set.length,
    perClass,
    total: set.length,
    threshold,
  };
}
