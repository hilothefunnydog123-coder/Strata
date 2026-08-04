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
import { asReadableError, complete, LlmBoundaryError } from '@/lib/llm/client';
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
