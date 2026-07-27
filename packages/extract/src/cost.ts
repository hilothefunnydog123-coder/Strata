import type { LlmCall } from "@assent/core";

/** Per-model price table (USD per 1M tokens). Update as pricing changes. */
const PRICES: Record<string, { in: number; out: number }> = {
  "claude-sonnet-4-6": { in: 3, out: 15 },
  default: { in: 3, out: 15 },
};

export function estimateCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  const p = PRICES[model] ?? PRICES.default!;
  return (promptTokens / 1_000_000) * p.in + (completionTokens / 1_000_000) * p.out;
}

export function makeLlmCall(args: {
  id: string;
  inputHash: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  stage: string;
}): LlmCall {
  return {
    ...args,
    costUsd: estimateCostUsd(args.model, args.promptTokens, args.completionTokens),
  };
}
