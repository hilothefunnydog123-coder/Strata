/**
 * The only file in this codebase that may talk to a language model.
 *
 * Compliance requirement 5. Enforced by the no-restricted-imports rule in
 * eslint.config.mjs: importing a model SDK anywhere else is a build failure, so
 * a second call path cannot quietly appear alongside this one and skip the
 * checks below.
 *
 * Three gates run before anything is transmitted:
 *
 *   1. A key must be configured. Without one this throws rather than degrading
 *      to something that looks like it worked.
 *   2. In PHI_MODE=live, MODEL_BAA_CONFIRMED must be true. Protected health
 *      information may only be sent to a provider account covered by a signed
 *      Business Associate Agreement. A free or default account is not covered,
 *      and its key looks identical, so the confirmation is a deliberate human
 *      act rather than something inferred.
 *   3. In PHI_MODE=synthetic, every call must be declared synthetic by its
 *      caller. A caller that cannot make that promise cannot make the call.
 *
 * Why the provider is configuration rather than a hard dependency: the second
 * gate is about a contract, not a vendor, and the cheapest way to get that
 * contract differs by company size. A free development tier trains on what you
 * send it, which is fine for fabricated documents and unlawful for a patient
 * record, and the same three gates express both cases.
 *
 * The wire protocol is the OpenAI chat completions shape, which Groq, Together,
 * Cerebras, OpenRouter, a local llama.cpp server, Google's Gemini endpoint and
 * Vertex AI all speak. So moving between them, including from a free tier to
 * whichever provider will sign a Business Associate Agreement, is two
 * environment variables rather than a code change. Everything downstream of
 * complete() was already provider agnostic, because it only ever sees a parsed
 * object.
 *
 * What is recorded: a hash of the input, the token counts, the latency, the
 * cost. Never the prompt and never the completion. An llm_call row is for spend
 * reporting, and a table of prompts would be a second uncontrolled copy of the
 * clinical record.
 */
import OpenAI from 'openai';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { db } from '@/lib/db';
import { llmCall } from '@/lib/db/schema';
import { env } from '@/lib/env';
import { log } from '@/lib/log';

/**
 * The model in use.
 *
 * A function rather than a constant, deliberately. Reading env at module scope
 * forces the whole environment to be parsed the moment anything imports this
 * file, which is before a test or a script has had a chance to set a variable.
 * That is exactly how this broke the first time.
 */
export function modelName(stage?: LlmStage, override?: string): string {
  // An explicit override wins over everything. Extraction uses it to move to
  // another model when the one it was using runs out of allowance for the day,
  // which is a different allowance rather than merely a retry: providers meter
  // per model, so the next model's budget is untouched by the first one's.
  if (override && override.trim().length > 0) return override.trim();

  // Corpus extraction may run on a different model from the one that drafts
  // appeals. See MODEL_NAME_CORPUS in lib/env.ts for why that is safe here and
  // nowhere else: every holding's quote is verified verbatim against its span,
  // so a weaker model costs discards rather than correctness.
  if (stage === 'corpus_extract') return env.MODEL_NAME_CORPUS;
  return env.MODEL_NAME;
}

/**
 * Published price per million tokens, in cents, for the model above. Used to
 * compute the cost recorded against each call and shown on the operator
 * console. Update this when pricing changes or the model changes; it is the one
 * number in the codebase that goes stale without anything failing.
 *
 * On a free tier these are zero in practice and the recorded figures are what
 * the same traffic would cost once the account is paid, which is the number
 * worth watching before a real customer arrives.
 */
function pricePerMtokCents(): { input: number; output: number } {
  return { input: env.MODEL_PRICE_INPUT_CENTS, output: env.MODEL_PRICE_OUTPUT_CENTS };
}

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

/**
 * The request was too big for the provider to accept.
 *
 * Its own class because it is the one provider failure a caller can do
 * something about without human involvement: send less. The corpus extractor
 * catches this and halves its batch. Everything else is a wall.
 *
 * Providers disagree about the status. The OpenAI shape is 413, Groq returns
 * 413 with a rate_limit_exceeded code whose type is "tokens", and several
 * return 400 with a message about context length. All three mean the same
 * thing, so all three land here.
 */
export class ModelRequestTooLargeError extends LlmBoundaryError {
  constructor(message: string) {
    super(message);
    this.name = 'ModelRequestTooLargeError';
  }
}

/**
 * The provider's per minute allowance is spent, and it will accept the same
 * request again shortly.
 *
 * Also its own class, and for the same reason: the remedy is mechanical. On a
 * free tier a long run will meet this many times, and the difference between a
 * corpus that ingests overnight and one that never finishes is whether waiting
 * is something the program does or something a person does.
 *
 * retryAfterSeconds is the provider's own number when it sends one. It usually
 * does, in a Retry-After header, and it is more accurate than any backoff we
 * would invent because it knows when the window rolls over.
 */
export class ModelRateLimitedError extends LlmBoundaryError {
  readonly retryAfterSeconds: number | undefined;

  constructor(message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = 'ModelRateLimitedError';
    this.retryAfterSeconds = retryAfterSeconds;
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
  /**
   * Run this one call on a named model instead of the stage's usual one.
   *
   * Only extraction sets it, and only to rotate off a model whose daily
   * allowance is spent. Safe there for the reason the whole stage is safe on a
   * small model: every quote is checked verbatim against its span afterwards,
   * so the model chosen changes how many holdings survive, not whether the
   * survivors are real.
   */
  model?: string;
}

export interface LlmResponse<T> {
  value: T;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  latencyMs: number;
}

let client: OpenAI | null = null;

/**
 * Run the gates and return a client, or throw explaining which gate closed.
 *
 * Separated from the call itself so tests can exercise the policy without a
 * network, and so the failure messages stay in one readable place.
 */
export function assertTransmissionPermitted(containsPhi: boolean): OpenAI {
  if (!env.MODEL_API_KEY) {
    throw new LlmBoundaryError(
      'MODEL_API_KEY is not configured, so no model call can be made. Set it in ' +
        'the environment. Nothing was transmitted.',
    );
  }

  if (env.phiLive && !env.MODEL_BAA_CONFIRMED) {
    throw new LlmBoundaryError(
      'PHI_MODE is live but MODEL_BAA_CONFIRMED is not true. Protected health ' +
        'information may only be transmitted to a model provider account covered by a ' +
        'signed Business Associate Agreement. A free or default account is not covered, ' +
        'and a free tier additionally trains on what it is sent. Nothing was transmitted.',
    );
  }

  if (!env.phiLive && containsPhi) {
    throw new LlmBoundaryError(
      'This call was declared to contain protected health information, but PHI_MODE ' +
        'is synthetic. This environment is not approved for patient data. Nothing was ' +
        'transmitted.',
    );
  }

  client ??= new OpenAI({
    apiKey: env.MODEL_API_KEY,
    baseURL: env.MODEL_BASE_URL,
    // No retries in here, deliberately.
    //
    // The SDK retries a 429 by sleeping inside the call, and there is no hook
    // to say anything while it does. A measured run spent 44 seconds that way
    // between two log lines, which is exactly what a hang looks like from
    // outside, and the previous run was killed by hand for looking like one.
    //
    // Retrying belongs to the caller here, because the caller is the only layer
    // that knows the work is resumable. The corpus extractor waits out a rate
    // limit itself, reports how long it is waiting and why, and has a
    // checkpoint per passage so anything it does lose is a batch rather than a
    // chapter. Nothing is gained by a second, silent retry loop underneath it.
    maxRetries: 0,
    // A 70B model reading twenty pages of a manual is slow, and the default cut
    // it off before the provider had finished thinking.
    timeout: 120_000,
  });
  return client;
}

export function llmConfigured(): boolean {
  return Boolean(env.MODEL_API_KEY);
}

export interface ProviderProbe {
  ok: boolean;
  detail: string;
  /** Model ids the provider offers, when it would say. */
  available?: string[];
}

/**
 * Ask the provider whether the key works and the model exists.
 *
 * Everything about a misconfigured model boundary looks the same from the
 * outside: a run starts, works for a while or not at all, and dies with an HTTP
 * status buried in generated client code. A key belonging to a different
 * provider, a model id that was retired last quarter, and a base URL with a
 * missing path segment all present as a number.
 *
 * This asks directly, before any work starts, and it is cheap: listing models
 * costs nothing against any allowance and takes a second. Retired model ids are
 * the case worth the trouble, because providers rotate them without notice and
 * the failure arrives in the middle of a long run rather than at the start of
 * it.
 */
export async function probeProvider(): Promise<ProviderProbe> {
  if (!env.MODEL_API_KEY) {
    return { ok: false, detail: 'MODEL_API_KEY is not set.' };
  }

  try {
    const provider = assertTransmissionPermitted(false);
    const listing = await provider.models.list();
    const available = listing.data.map((m) => m.id).sort();

    const wanted = [modelName(), modelName('corpus_extract')].filter(
      (name, index, all) => all.indexOf(name) === index,
    );
    const missing = wanted.filter((name) => !available.includes(name));

    if (missing.length > 0) {
      return {
        ok: false,
        available,
        detail:
          `The provider accepted the key but does not offer ${missing.join(' or ')}. ` +
          'Model ids are retired without notice, and the run would fail on the first ' +
          'call. Pick one from the list below.',
      };
    }

    return { ok: true, available, detail: `Key accepted. ${wanted.join(' and ')} available.` };
  } catch (error) {
    const readable = asReadableError(error);
    return { ok: false, detail: (readable as Error).message };
  }
}

function costCents(inputTokens: number, outputTokens: number): number {
  const price = pricePerMtokCents();
  const cents =
    (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
  // Rounded up, so reported spend is never optimistic.
  return Math.ceil(cents);
}

/**
 * Pull the JSON object out of a completion.
 *
 * The model is asked for bare JSON and told the response type, but a model that
 * wraps it in a fence or adds a sentence of preamble should not fail the whole
 * appeal. Anything that is not parseable JSON does fail, loudly: a half
 * understood response is worse than none in a product where every output
 * becomes a citation.
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
 * Does this error mean "you sent too much"?
 *
 * Deliberately generous, because the alternative is worse. A missed match means
 * a document that could have been extracted in smaller pieces is abandoned
 * instead; a false match means one wasted retry at half the size, which then
 * fails the same way and surfaces the original error. So this errs toward
 * matching, and the retry loop is bounded so a wrong guess terminates.
 */
function isTooLarge(error: unknown, status: number | undefined): boolean {
  // Groq's shape arrives here: 413, carrying a rate_limit_exceeded code whose
  // type is "tokens". The code makes it read like a per minute limit and it is
  // not one, which is why the status decides and the code is ignored. A real
  // per minute limit is a 429 and must not be mistaken for this, or the
  // extractor would split batches forever chasing a limit that is about time.
  if (status === 413) return true;
  if (status !== 400) return false;

  // Several providers report an oversized request as an ordinary 400. Only the
  // message separates it from a malformed one.
  const message = (error as { message?: string } | null)?.message ?? '';
  return /context length|context_length|too large|maximum context|reduce the length|request entity/i.test(
    message,
  );
}

/**
 * Read one header off a provider error.
 *
 * Two shapes, because the SDK attaches a Headers instance and older versions
 * and hand rolled errors attach a plain object. A Headers instance does not
 * answer to bracket indexing and serialises as {}, so reading it the plain way
 * silently returns nothing: the first version of this looked correct, logged
 * "headers":{} next to a response that definitely carried Retry-After, and
 * quietly fell back to a made up interval on every rate limit.
 */
function header(error: unknown, name: string): string | undefined {
  const headers = (error as { headers?: unknown } | null)?.headers;
  if (!headers) return undefined;

  const get = (headers as { get?: unknown }).get;
  if (typeof get === 'function') {
    return (get.call(headers, name) as string | null) ?? undefined;
  }

  const plain = headers as Record<string, string>;
  return plain[name] ?? plain[name.toLowerCase()] ?? plain[name.toUpperCase()];
}

/**
 * How long the provider says to wait, if it says.
 *
 * Retry-After is either a number of seconds or an HTTP date, and providers use
 * both. Some send a fractional number of seconds, which is not to spec and is
 * still more useful than guessing. Anything unparseable returns undefined and
 * the caller falls back to its own interval.
 *
 * Capped at ten minutes. A provider that asks for longer than that has a
 * problem a batch job should not sit and wait through, and an unbounded value
 * read off the wire is a way to hang a run forever on one malformed header.
 */
function retryAfterSeconds(error: unknown): number | undefined {
  const raw = header(error, 'retry-after');
  if (!raw) return undefined;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds, 600);

  const at = Date.parse(raw);
  if (Number.isNaN(at)) return undefined;

  return Math.min(Math.max(0, (at - Date.now()) / 1000), 600);
}

/**
 * Turn a provider error into something that names the thing to go and fix.
 *
 * The SDK's own errors are accurate and unreadable: an HTTP status buried in a
 * stack trace through three layers of generated client code, with the useful
 * sentence redacted out of the log because it might carry the key. Someone
 * seeing that for the first time cannot tell a rejected key from a quota from
 * an outage, and those have completely different remedies.
 *
 * Only the classes with a clear remedy are rewritten. Anything else is passed
 * through untouched, because inventing an explanation for an error nobody has
 * seen is worse than showing the original.
 */
export function asReadableError(error: unknown): unknown {
  const status = (error as { status?: number } | null)?.status;

  if (isTooLarge(error, status)) {
    return new ModelRequestTooLargeError(
      'The model provider refused the request for being too large. This is a size ' +
        'limit rather than a broken key or a bad prompt: the same request succeeds ' +
        'once it is split. A free tier sets this low, often a few thousand tokens per ' +
        'request. The corpus extractor splits and retries on its own; anything else ' +
        'reaching this needs a smaller input.',
    );
  }

  if (status === 401 || status === 403) {
    return new LlmBoundaryError(
      `The model provider rejected the API key (HTTP ${status}). MODEL_API_KEY is set, ` +
        'so this is not a missing key: it is the wrong one, or it does not belong to ' +
        'the provider MODEL_BASE_URL points at. Those two have to match. Verify the key ' +
        'on its own with:\n' +
        `  curl ${env.MODEL_BASE_URL}/models -H "Authorization: Bearer YOUR_KEY"`,
    );
  }

  if (status === 429) {
    return new ModelRateLimitedError(
      'The model provider refused the call for exceeding a rate or quota limit (HTTP ' +
        '429), and it was still refusing after the automatic retries. On a free tier ' +
        'this is expected on long runs. Every corpus stage records its progress per ' +
        'passage in the database, so re-running the same command resumes where it ' +
        'stopped rather than starting again.',
      retryAfterSeconds(error),
    );
  }

  if (status !== undefined && status >= 500) {
    return new LlmBoundaryError(
      `The model provider failed with HTTP ${status}. That is their side rather than ` +
        'yours. Nothing was saved, so re-running the command is safe.',
    );
  }

  return error;
}

/**
 * Make one structured call.
 *
 * Every model interaction in the product goes through here and comes back
 * validated against a Zod schema, so no downstream code ever handles a free
 * text completion.
 */
export async function complete<T>(request: LlmRequest<T>): Promise<LlmResponse<T>> {
  const provider = assertTransmissionPermitted(request.containsPhi);

  const inputHash = createHash('sha256')
    .update(`${request.system}\n\n${request.user}`)
    .digest('hex');

  const started = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;
  let ok = false;

  try {
    const response = await provider.chat.completions.create({
      model: modelName(request.stage, request.model),
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0,
      // Ask for JSON at the API level rather than only in the prompt. Not every
      // provider or model honours this, which is why the fence stripping below
      // stays: it costs nothing, and a model that ignores the response format
      // should not take an appeal down. MODEL_JSON_MODE=false turns it off for
      // a provider that rejects the field outright.
      ...(env.MODEL_JSON_MODE ? { response_format: { type: 'json_object' as const } } : {}),
    });

    inputTokens = response.usage?.prompt_tokens ?? 0;
    outputTokens = response.usage?.completion_tokens ?? 0;

    const text = response.choices[0]?.message?.content ?? '';
    if (text.trim().length === 0) {
      // An empty completion usually means the response was stopped by a safety
      // filter or hit the output cap. Either way there is nothing to parse, and
      // saying so beats a JSON error that sends someone to the wrong place.
      throw new Error(
        'The model returned no text. This usually means the response was filtered or ' +
          'the output limit was reached.',
      );
    }

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
    const readable = asReadableError(error);

    if (readable instanceof ModelRequestTooLargeError) {
      // Routine, and usually handled by the caller sending less. Logging it at
      // error level buried a working run in stack traces: the first corpus run
      // to actually make progress printed six of these, each one indicating the
      // splitting logic doing its job, and read like six failures.
      log.info('model refused the request as too large', {
        stage: request.stage,
        tokens: inputTokens,
      });
    } else if (readable instanceof ModelRateLimitedError) {
      // Same reasoning. The caller waits this out and says so; a stack trace
      // printed immediately above "waiting 20 seconds" only makes the wait look
      // like a crash that was somehow survived.
      log.info('model rate limited the call', {
        stage: request.stage,
        retryAfterSeconds: readable.retryAfterSeconds,
      });
    } else {
      log.error('model call failed', { stage: request.stage, error });
    }

    throw readable;
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
      model: modelName(request.stage, request.model),
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
