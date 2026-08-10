/**
 * Provider failures, translated into the thing to go and fix.
 *
 * The first real corpus run died on an HTTP 401 that surfaced as an SDK stack
 * trace through three layers of generated client code, with the explanatory
 * sentence redacted out of the log because it might have carried the key. That
 * is indistinguishable, to anyone reading it, from a quota problem or an
 * outage, and those have completely different remedies.
 */
import { describe, expect, it } from 'vitest';
import {
  asReadableError,
  complete,
  LlmBoundaryError,
  ModelMalformedOutputError,
  ModelRateLimitedError,
  ModelRequestTooLargeError,
  withRateLimitPatience,
  correctionFor,
  SCHEMA_RETRIES,
} from '@/lib/llm/client';
import { z } from 'zod';

/** A provider error carries the HTTP status as a property, as the SDK's does. */
function providerError(status: number): Error & { status: number } {
  return Object.assign(new Error('generated client noise'), { status });
}

/** Drive the real complete() so the gate that runs before any call is covered. */
async function callWithNoKey(): Promise<unknown> {
  return complete({
    stage: 'corpus_extract',
    system: 's',
    user: 'u',
    schema: z.object({}),
    containsPhi: false,
  }).catch((error: unknown) => error);
}

describe('provider errors name the remedy', () => {
  it('a rejected key says the key is wrong, not that it is missing', () => {
    // Distinguishing these two matters: "not configured" sends someone to add a
    // variable that is already there.
    const translated = asReadableError(providerError(401));

    expect(translated).toBeInstanceOf(LlmBoundaryError);
    expect((translated as Error).message).toContain('MODEL_API_KEY is set');
  });

  it('a rejected key names the provider the key has to match', () => {
    // The single most common cause once the endpoint is configurable: a key
    // from one provider sent to another. Both are present and both look right,
    // and nothing but the pairing is wrong, so the message has to say so and
    // has to name the endpoint actually in use rather than a vendor guess.
    const message = (asReadableError(providerError(401)) as Error).message;

    expect(message).toContain('MODEL_BASE_URL');
    expect(message).toContain(process.env.MODEL_BASE_URL ?? 'https://api.groq.com/openai/v1');
  });

  it('403 is treated the same as 401, because the remedy is the same', () => {
    expect((asReadableError(providerError(403)) as Error).message).toContain(
      'rejected the API key',
    );
  });

  it('a refusal on size is its own class, because a caller can act on it', () => {
    // Every other provider failure is a wall. This one has a remedy the code
    // can apply without a human: send less. The corpus extractor catches this
    // exact class and halves its batch, so it has to be distinguishable.
    const translated = asReadableError(providerError(413));

    expect(translated).toBeInstanceOf(ModelRequestTooLargeError);
    expect((translated as Error).message).toContain('too large');
  });

  it('is not fooled by Groq calling a size refusal a rate limit', () => {
    // Groq returns 413 with code rate_limit_exceeded and type "tokens", which
    // reads as a per minute quota and is not one. Waiting would never fix it.
    const groq = Object.assign(new Error('generated client noise'), {
      status: 413,
      code: 'rate_limit_exceeded',
      type: 'tokens',
      error: { type: 'tokens', code: 'rate_limit_exceeded' },
    });

    expect(asReadableError(groq)).toBeInstanceOf(ModelRequestTooLargeError);
  });

  it('does not mistake a real rate limit for a size problem', () => {
    // The mirror image, and the more dangerous one: treating a per minute quota
    // as a size refusal would send the extractor splitting batches forever
    // chasing a limit that is about time.
    const translated = asReadableError(providerError(429));

    expect(translated).not.toBeInstanceOf(ModelRequestTooLargeError);
    expect(translated).toBeInstanceOf(LlmBoundaryError);
  });

  it('catches a provider that reports an oversized request as a 400', () => {
    const verbose = Object.assign(
      new Error("This model's maximum context length is 8192 tokens."),
      { status: 400 },
    );

    expect(asReadableError(verbose)).toBeInstanceOf(ModelRequestTooLargeError);
  });

  it('leaves an ordinary 400 alone', () => {
    // A malformed request is a bug in our prompt assembly, not something to
    // retry at half the size.
    const malformed = Object.assign(new Error('unknown field: temperatur'), { status: 400 });

    expect(asReadableError(malformed)).toBe(malformed);
  });

  it('a completion the provider refuses as invalid JSON is its own class', () => {
    // The failure that stalled Benefit Policy Manual Ch. 7 on fourteen passages
    // across repeated runs. Groq validates the completion against the requested
    // response format and refuses its own model's output with a 400, which is
    // not a rate limit and not a size refusal, so nothing in the extractor
    // caught it and it ended the document instead of the call.
    const groq = Object.assign(new Error('json validate failed'), {
      status: 400,
      code: 'json_validate_failed',
      error: { code: 'json_validate_failed', type: 'invalid_request_error' },
    });

    const translated = asReadableError(groq);

    expect(translated).toBeInstanceOf(ModelMalformedOutputError);
    expect((translated as Error).message).toContain('json_validate_failed');
  });

  it('recognises it from the code alone, whatever the message says', () => {
    // The SDK's message is generated client noise on some versions and the
    // provider's sentence on others. The code is the part that is stable.
    const coded = Object.assign(new Error('generated client noise'), {
      status: 400,
      code: 'json_validate_failed',
    });

    expect(asReadableError(coded)).toBeInstanceOf(ModelMalformedOutputError);
  });

  it('recognises it from the message alone, for a provider that sends no code', () => {
    // Groq's actual sentence, copied from the run that stalled Ch. 7 rather
    // than invented. The wording is close enough to a dozen other messages
    // that guessing at it was not good enough.
    const worded = Object.assign(
      new Error(
        "400 Failed to generate JSON. Please adjust your prompt. See 'failed_generation' " +
          'for more details.',
      ),
      { status: 400 },
    );

    expect(asReadableError(worded)).toBeInstanceOf(ModelMalformedOutputError);
  });

  it('does not mistake an ordinary bad request for a cut off answer', () => {
    // The mirror of the test above it, and the reason this classifier is
    // narrow where the size one is generous. Both arrive as a 400. Treating a
    // bug in our prompt assembly as something to retry smaller would bury it
    // in a splitting loop that ends with a passage skipped for no reason.
    const bug = Object.assign(new Error('unknown field: temperatur'), { status: 400 });

    expect(asReadableError(bug)).not.toBeInstanceOf(ModelMalformedOutputError);
  });

  it('keeps a size refusal a size refusal, even worded as a JSON problem', () => {
    // Order matters between the two 400 classifiers. A context length message
    // is answered by splitting either way, but the class names the reason, and
    // the reason is what someone reads in the log.
    const sized = Object.assign(
      new Error("This model's maximum context length is 8192 tokens."),
      { status: 400 },
    );

    expect(asReadableError(sized)).toBeInstanceOf(ModelRequestTooLargeError);
  });

  it('reads Retry-After off a Headers instance, not just a plain object', () => {
    // The SDK attaches a Headers instance, which does not answer to bracket
    // indexing and serialises as {}. The first version of this read it the
    // plain way, logged "headers":{} next to a response that definitely carried
    // Retry-After, and fell back to an invented interval on every rate limit.
    // Nothing failed. It just waited the wrong amount of time, forever.
    const withHeaders = Object.assign(new Error('429'), {
      status: 429,
      headers: new Headers({ 'retry-after': '20' }),
    });

    expect((asReadableError(withHeaders) as ModelRateLimitedError).retryAfterSeconds).toBe(20);
  });

  it('reads it off a plain object too', () => {
    const plain = Object.assign(new Error('429'), {
      status: 429,
      headers: { 'retry-after': '17' },
    });

    expect((asReadableError(plain) as ModelRateLimitedError).retryAfterSeconds).toBe(17);
  });

  it('accepts the HTTP date form', () => {
    const at = new Date(Date.now() + 30_000).toUTCString();
    const dated = Object.assign(new Error('429'), {
      status: 429,
      headers: new Headers({ 'retry-after': at }),
    });

    const seconds = (asReadableError(dated) as ModelRateLimitedError).retryAfterSeconds!;
    expect(seconds).toBeGreaterThan(25);
    expect(seconds).toBeLessThanOrEqual(30);
  });

  it('caps an absurd wait rather than hanging the run on it', () => {
    // An unbounded number read off the wire is a way to hang a batch job all
    // night on one malformed header.
    const absurd = Object.assign(new Error('429'), {
      status: 429,
      headers: new Headers({ 'retry-after': '86400' }),
    });

    expect((asReadableError(absurd) as ModelRateLimitedError).retryAfterSeconds).toBe(600);
  });

  it('says nothing rather than guessing when there is no header', () => {
    // undefined means "use your own interval", which is honest. Zero would mean
    // "retry immediately", which would spin against a provider that is
    // rate limiting.
    expect(
      (asReadableError(providerError(429)) as ModelRateLimitedError).retryAfterSeconds,
    ).toBeUndefined();
  });

  it('a quota refusal says the work resumes rather than restarts', () => {
    const message = (asReadableError(providerError(429)) as Error).message;

    expect(message).toContain('429');
    expect(message).toContain('resumes');
  });

  it('a provider outage says it is their side and re-running is safe', () => {
    const message = (asReadableError(providerError(503)) as Error).message;

    expect(message).toContain('their side');
  });

  it('passes through anything it has no remedy for', () => {
    // Inventing an explanation for an unseen error is worse than showing the
    // original, which at least has a stack trace someone can search for.
    const original = new Error('something nobody has seen before');

    expect(asReadableError(original)).toBe(original);
  });

  it('waits out a short rate limit rather than losing the appeal', async () => {
    // The generation chain's first run against a real provider reached fact
    // extraction, was told to wait nine seconds, and ended the appeal. Every
    // call already paid for went with it, because an appeal saves nothing until
    // the end.
    const slept: number[] = [];
    let calls = 0;

    const value = await withRateLimitPatience(
      'writing the appeal',
      async () => {
        calls += 1;
        if (calls < 3) {
          throw new ModelRateLimitedError('429', 9);
        }
        return 'a letter';
      },
      { sleep: async (ms) => void slept.push(ms) },
    );

    expect(value).toBe('a letter');
    expect(calls).toBe(3);
    expect(slept).toEqual([9000, 9000]);
  });

  it('does not sit on a daily allowance pretending it is a minute', async () => {
    // A provider asking for twenty minutes is not rate limiting this request,
    // it is out of allowance. Waiting would hold a specialist with the case
    // open in front of them for no reason.
    const slept: number[] = [];

    await expect(
      withRateLimitPatience(
        'writing the appeal',
        async () => {
          throw new ModelRateLimitedError('429', 1_200);
        },
        { sleep: async (ms) => void slept.push(ms) },
      ),
    ).rejects.toBeInstanceOf(ModelRateLimitedError);

    expect(slept).toEqual([]);
  });

  it('gives up after a bounded number of waits', async () => {
    const slept: number[] = [];
    let calls = 0;

    await expect(
      withRateLimitPatience(
        'writing the appeal',
        async () => {
          calls += 1;
          throw new ModelRateLimitedError('429', 5);
        },
        { waits: 2, sleep: async (ms) => void slept.push(ms) },
      ),
    ).rejects.toBeInstanceOf(ModelRateLimitedError);

    // Two waits, and a third attempt that is allowed to fail for good.
    expect(slept).toHaveLength(2);
    expect(calls).toBe(3);
  });

  it('passes anything that is not a rate limit straight through', async () => {
    // Waiting cannot fix a rejected key, and retrying one four times turns a
    // clear failure into a slow one.
    await expect(
      withRateLimitPatience('writing the appeal', async () => {
        throw new LlmBoundaryError('the key is wrong');
      }),
    ).rejects.toThrow('the key is wrong');
  });

  it('tells the model which fields it missed, not to try harder', () => {
    // Four stages failed on their first contact with a real model and three
    // were fixed separately before it was obvious they were one bug. What the
    // retry sends back is the whole reason it is worth sending: a model
    // corrects a named omission far more reliably than a general scolding.
    const failed = z
      .object({ spanOrdinal: z.number(), verbatimQuote: z.string() })
      .safeParse({});

    const correction = correctionFor((failed as { error: z.ZodError }).error);

    expect(correction).toContain('spanOrdinal');
    expect(correction).toContain('verbatimQuote');
    expect(correction).toMatch(/previous answer could not be used/i);
  });

  it('does not invite the model to invent a quote to satisfy the schema', () => {
    // The one way this retry could do harm. A model told only that
    // verbatimQuote is required could fill it with something plausible, and a
    // fabricated quote is the failure the whole product exists to prevent.
    const failed = z.object({ verbatimQuote: z.string() }).safeParse({});
    const correction = correctionFor((failed as { error: z.ZodError }).error);

    expect(correction).toMatch(/do not invent a quote/i);
    expect(correction).toMatch(/copied exactly/i);
  });

  it('asks again a bounded number of times', () => {
    // Each attempt is a real call against a real allowance, and a model that
    // has returned an unusable object three times with the fields named back
    // to it is not going to manage on the fourth.
    expect(SCHEMA_RETRIES).toBeGreaterThan(0);
    expect(SCHEMA_RETRIES).toBeLessThanOrEqual(3);
  });

  it('still refuses to transmit when no key is configured at all', async () => {
    // The gate that runs before any of the above, and the one that must not be
    // confused with a rejected key.
    const result = await callWithNoKey();
    expect(result).toBeInstanceOf(LlmBoundaryError);
    expect((result as Error).message).toContain('MODEL_API_KEY is not configured');
  });
});
