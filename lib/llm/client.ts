/**
 * The only file in this codebase that may talk to a language model.
 *
 * Compliance requirement 5. Enforced by the no-restricted-imports rule in
 * eslint.config.mjs: importing @anthropic-ai/sdk anywhere else is a build
 * failure, so a second call path cannot quietly appear alongside this one and
 * skip the checks below.
 *
 * Three gates run before anything is transmitted:
 *
 *   1. A key must be configured. Without one this throws rather than degrading
 *      to something that looks like it worked.
 *   2. In PHI_MODE=live, ANTHROPIC_BAA_CONFIRMED must be true. Protected health
 *      information may only be sent to a HIPAA-ready Anthropic API
 *      organisation covered by a signed Business Associate Agreement. A default
 *      API organisation is not covered, and a key from one looks identical, so
 *      the confirmation is a deliberate human act rather than something
 *      inferred.
 *   3. In PHI_MODE=synthetic, every call must be declared synthetic by its
 *      caller. A caller that cannot make that promise cannot make the call.
 *
 * What is recorded: a hash of the input, the token counts, the latency, the
 * cost. Never the prompt and never the completion. An llm_call row is for spend
 * reporting, and a table of prompts would be a second uncontrolled copy of the
 * clinical record.
 */
import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { db } from '@/lib/db';
import { llmCall } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { log } from '@/lib/log';

export const MODEL = 'claude-sonnet-4-6';

/**
 * Published price per million tokens, in cents, for the model above. Used to
 * compute the cost recorded against each call and shown on the operator
 * console. Update this when pricing changes; it is the one number in the
 * codebase that goes stale without anything failing.
 */
const PRICE_CENTS_PER_MTOK = { input: 300, output: 1500 } as const;

/** Which part of the product made the call. Spend is reported by this. */
export type LlmStage =
  | 'corpus_extract'
  | 'denial_classify'
  | 'fact_extract'
  | 'appeal_draft'
  | 'gap_check';

export class LlmBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmBoundaryError';
  }
}

export interface LlmRequest<T> {
  stage: LlmStage;
  system: string;
  user: string;
  /** The shape the model must return. Its output is parsed against this. */
  schema: z.ZodType<T>;
  /**
   * The caller's declaration about what is in this prompt. Required, and
   * required to be true: in synthetic mode a call carrying anything real is
   * refused, and the only thing that can know is the code assembling it.
   */
  containsPhi: boolean;
  /** The case this call belongs to, so spend can be reported per appeal. */
  denialId?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LlmResponse<T> {
  value: T;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  latencyMs: number;
}

let client: Anthropic | null = null;

/**
 * Run the gates and return a client, or throw explaining which gate closed.
 *
 * Separated from the call itself so tests can exercise the policy without a
 * network, and so the failure messages stay in one readable place.
 */
export function assertTransmissionPermitted(containsPhi: boolean): Anthropic {
  if (!env.ANTHROPIC_API_KEY) {
    throw new LlmBoundaryError(
      'ANTHROPIC_API_KEY is not configured, so no model call can be made. Set it in ' +
        'the environment. Nothing was transmitted.',
    );
  }

  if (env.phiLive && !env.ANTHROPIC_BAA_CONFIRMED) {
    throw new LlmBoundaryError(
      'PHI_MODE is live but ANTHROPIC_BAA_CONFIRMED is not true. Protected health ' +
        'information may only be transmitted to a HIPAA-ready Anthropic API ' +
        'organisation covered by a signed Business Associate Agreement. A default API ' +
        'organisation is not covered. Nothing was transmitted.',
    );
  }

  if (!env.phiLive && containsPhi) {
    throw new LlmBoundaryError(
      'This call was declared to contain protected health information, but PHI_MODE ' +
        'is synthetic. This environment is not approved for patient data. Nothing was ' +
        'transmitted.',
    );
  }

  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

export function llmConfigured(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

function costCents(inputTokens: number, outputTokens: number): number {
  const cents =
    (inputTokens / 1_000_000) * PRICE_CENTS_PER_MTOK.input +
    (outputTokens / 1_000_000) * PRICE_CENTS_PER_MTOK.output;
  // Rounded up, so reported spend is never optimistic.
  return Math.ceil(cents);
}

/**
 * Pull the JSON object out of a completion.
 *
 * The prompts ask for bare JSON, but a model that wraps it in a fence or adds a
 * sentence of preamble should not fail the whole appeal. Anything that is not
 * parseable JSON does fail, loudly: a half-understood response is worse than
 * none in a product where every output becomes a citation.
 */
function extractJson(text: string): unknown {
  const trimmed = text.trim();

  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.search(/[[{]/);
    const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));
    if (start !== -1 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error('The model did not return parseable JSON.');
  }
}

/**
 * Make one structured call.
 *
 * Every model interaction in the product goes through here and comes back
 * validated against a Zod schema, so no downstream code ever handles a free
 * text completion.
 */
export async function complete<T>(request: LlmRequest<T>): Promise<LlmResponse<T>> {
  const anthropic = assertTransmissionPermitted(request.containsPhi);

  const inputHash = createHash('sha256')
    .update(`${request.system}\n\n${request.user}`)
    .digest('hex');

  const started = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;
  let ok = false;

  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0,
      system: request.system,
      messages: [{ role: 'user', content: request.user }],
    });

    inputTokens = message.usage.input_tokens;
    outputTokens = message.usage.output_tokens;

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    const parsed = request.schema.parse(extractJson(text));
    ok = true;

    const latencyMs = Date.now() - started;
    const cost = costCents(inputTokens, outputTokens);

    await record(request, inputHash, inputTokens, outputTokens, cost, latencyMs, true);

    return { value: parsed, inputTokens, outputTokens, costCents: cost, latencyMs };
  } catch (error) {
    if (!ok) {
      await record(
        request,
        inputHash,
        inputTokens,
        outputTokens,
        costCents(inputTokens, outputTokens),
        Date.now() - started,
        false,
      );
    }
    // The error is logged through the redacting logger, which strips anything
    // the SDK attached from the request body.
    log.error('model call failed', { stage: request.stage, error });
    throw error;
  }
}

async function record(
  request: LlmRequest<unknown>,
  inputHash: string,
  promptTokens: number,
  completionTokens: number,
  cost: number,
  latencyMs: number,
  ok: boolean,
): Promise<void> {
  try {
    await db.insert(llmCall).values({
      stage: request.stage,
      model: MODEL,
      inputHash,
      denialId: request.denialId ?? null,
      promptTokens,
      completionTokens,
      costCents: cost,
      latencyMs,
      ok,
    });
  } catch (error) {
    // Spend accounting failing must not fail an appeal.
    log.error('could not record model spend', { error, stage: request.stage });
  }
}
