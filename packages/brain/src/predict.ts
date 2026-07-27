import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Mlp, type SerializedModel } from "./nn";
import { featurize, type FeatureContext } from "./features";
import { segment } from "./segment";
import { indexToLabel, isCriterionLabel, type BrainLabel } from "./labels";
import type { CriterionKind } from "@assent/core";

/**
 * Inference. Loads the trained weights (a JSON file, no runtime dependencies)
 * and scores candidate spans cut from a document.
 *
 * Every returned prediction carries `start`/`end` offsets into the span text and
 * a `quote` that is exactly `spanText.slice(start, end)` — the citation is a
 * substring by construction, not by verification.
 */

const here = dirname(fileURLToPath(import.meta.url));

export interface Prediction {
  kind: CriterionKind;
  confidence: number;
  /** Offsets into the span text this was cut from. */
  start: number;
  end: number;
  /** Exactly spanText.slice(start, end). */
  quote: string;
}

export class CriterionClassifier {
  private model: Mlp;
  readonly threshold: number;
  readonly meta: Record<string, unknown>;

  constructor(serialized: SerializedModel) {
    this.model = Mlp.deserialize(serialized);
    this.threshold = serialized.threshold;
    this.meta = serialized.meta ?? {};
  }

  static modelPath(): string {
    return join(here, "..", "model", "model.json");
  }

  static isTrained(): boolean {
    return existsSync(CriterionClassifier.modelPath());
  }

  /** Load the committed weights. Throws loudly if the model was never trained. */
  static load(path = CriterionClassifier.modelPath()): CriterionClassifier {
    if (!existsSync(path)) {
      throw new Error(
        `No trained model at ${path}. Run: pnpm --filter @assent/brain train`,
      );
    }
    return new CriterionClassifier(JSON.parse(readFileSync(path, "utf8")) as SerializedModel);
  }

  /** Score a single piece of text in context. Returns the label and confidence. */
  classify(text: string, ctx: FeatureContext): { label: BrainLabel; confidence: number } {
    const probs = this.model.predict(featurize(text, ctx));
    let bestI = 0;
    let bestP = -1;
    for (let i = 0; i < probs.length; i++) {
      if (probs[i]! > bestP) {
        bestP = probs[i]!;
        bestI = i;
      }
    }
    // Abstain below the tuned confidence floor — precision beats recall here.
    if (bestI !== 0 && bestP < this.threshold) return { label: "none", confidence: bestP };
    return { label: indexToLabel(bestI), confidence: bestP };
  }

  /**
   * Extract criteria from one document span: segment into candidates, score each,
   * keep the ones classified as a real criterion kind.
   */
  extract(spanText: string, headingPath: string[]): Prediction[] {
    const candidates = segment(spanText);
    const out: Prediction[] = [];
    for (const c of candidates) {
      const ctx: FeatureContext = { headingPath, index: c.index, total: c.total };
      const { label, confidence } = this.classify(c.text, ctx);
      if (!isCriterionLabel(label)) continue;
      out.push({
        kind: label,
        confidence,
        start: c.start,
        end: c.end,
        // Slice from the source rather than trusting the candidate's copy.
        quote: spanText.slice(c.start, c.end),
      });
    }
    return out;
  }
}

let shared: CriterionClassifier | null = null;
/** Process-wide singleton so the weights are parsed once. */
export function classifier(): CriterionClassifier {
  if (!shared) shared = CriterionClassifier.load();
  return shared;
}
