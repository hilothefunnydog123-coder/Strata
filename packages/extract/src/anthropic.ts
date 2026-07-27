import Anthropic from "@anthropic-ai/sdk";
import type { CachedResponse } from "./cache";

/**
 * Live model call (used only in PIPELINE_MODE=live with a real key). temperature 0
 * for extraction and classification (PROMPT §10). Returns text + token usage so the
 * caller can log an LlmCall.
 */
let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required in PIPELINE_MODE=live.");
    client = new Anthropic({ apiKey });
  }
  return client;
}

export async function callModel(args: {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<CachedResponse> {
  const res = await getClient().messages.create({
    model: args.model,
    max_tokens: args.maxTokens ?? 1500,
    temperature: 0,
    system: args.system,
    messages: [{ role: "user", content: args.user }],
  });
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return {
    text,
    model: args.model,
    promptTokens: res.usage.input_tokens,
    completionTokens: res.usage.output_tokens,
  };
}
