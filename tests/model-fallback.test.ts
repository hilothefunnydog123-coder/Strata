/**
 * Rotating to a model with allowance left, instead of dying with one that has
 * none.
 *
 * A real run against a real account: every request to the configured model was
 * refused for six straight minutes, at sixty second spacing, while the same
 * key could list fifty other models it was welcome to use. A quota belongs to
 * a model on a project rather than to the key. The corpus pipeline has known
 * this for a long time and rotates; generation ended the appeal at the first
 * empty bucket.
 *
 * These tests drive the real withModelFallback with the rate limit patience
 * underneath it. Every refusal uses an interval above the patience cap, which
 * rethrows without sleeping, so the suite spends no wall clock waiting.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The environment is parsed once and cached, deliberately, so changing
 * MODEL_NAME_FALLBACKS between tests needs a fresh module graph. Loaded per
 * test for that reason, the same way tests/provider-compat.test.ts does.
 */
async function load(fallbacks: string) {
  vi.resetModules();
  process.env.MODEL_NAME_FALLBACKS = fallbacks;

  const client = await import('@/lib/llm/client');
  const generate = await import('@/lib/appeals/generate');
  generate.forgetSpentModels();

  return {
    withModelFallback: generate.withModelFallback,
    /** A refusal patience will not wait out: the daily allowance signal. */
    exhausted: () => new client.ModelRateLimitedError('429', 1_200),
    ModelRateLimitedError: client.ModelRateLimitedError,
  };
}

beforeEach(() => {
  vi.resetModules();
});

describe('a stage whose model has no allowance left', () => {
  it('moves to a fallback and comes back with an answer', async () => {
    const { withModelFallback, exhausted } = await load('second-model,third-model');
    const asked: (string | undefined)[] = [];

    const result = await withModelFallback('writing the appeal', async (model) => {
      asked.push(model);
      if (model === undefined) throw exhausted();
      return `written by ${model}`;
    });

    expect(result).toBe('written by second-model');
    expect(asked).toEqual([undefined, 'second-model']);
  });

  it('remembers a spent model across stages instead of relearning it', async () => {
    const { withModelFallback, exhausted } = await load('second-model,third-model');
    // Rediscovery is not free: it costs the full patience per stage, which on
    // a real run was three minutes of spaced refusals per call to find out
    // what the previous stage already knew.
    let asksOfPrimary = 0;

    await withModelFallback('reading the denial letter', async (model) => {
      if (model === undefined) {
        asksOfPrimary += 1;
        throw exhausted();
      }
      return 'ok';
    });

    await withModelFallback('reading the clinical record', async (model) => {
      if (model === undefined) {
        asksOfPrimary += 1;
        throw exhausted();
      }
      return 'ok';
    });

    expect(asksOfPrimary).toBe(1);
  });

  it('surfaces the refusal when every model on the list is spent', async () => {
    const { withModelFallback, exhausted, ModelRateLimitedError } = await load(
      'second-model,third-model',
    );

    await expect(
      withModelFallback('writing the appeal', async () => {
        throw exhausted();
      }),
    ).rejects.toBeInstanceOf(ModelRateLimitedError);
  });

  it('does not rotate on anything that is not a rate limit', async () => {
    const { withModelFallback } = await load('second-model,third-model');
    // A rejected key fails the same way on every model, and trying three
    // models turns one clear failure into three slow ones.
    const asked: (string | undefined)[] = [];

    await expect(
      withModelFallback('writing the appeal', async (model) => {
        asked.push(model);
        throw new Error('the key is wrong');
      }),
    ).rejects.toThrow('the key is wrong');

    expect(asked).toEqual([undefined]);
  });

  it('is the old behaviour exactly when no fallbacks are configured', async () => {
    const { withModelFallback, exhausted, ModelRateLimitedError } = await load('');
    const asked: (string | undefined)[] = [];

    await expect(
      withModelFallback('writing the appeal', async (model) => {
        asked.push(model);
        throw exhausted();
      }),
    ).rejects.toBeInstanceOf(ModelRateLimitedError);

    expect(asked).toEqual([undefined]);
  });
});
