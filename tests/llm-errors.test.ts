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
  ModelRateLimitedError,
  ModelRequestTooLargeError,
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

  it('still refuses to transmit when no key is configured at all', async () => {
    // The gate that runs before any of the above, and the one that must not be
    // confused with a rejected key.
    const result = await callWithNoKey();
    expect(result).toBeInstanceOf(LlmBoundaryError);
    expect((result as Error).message).toContain('MODEL_API_KEY is not configured');
  });
});
