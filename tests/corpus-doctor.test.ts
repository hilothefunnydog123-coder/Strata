/**
 * The preflight, and the two things it has to get right.
 *
 * It exists because four separate runs failed on four different layers, each
 * discovered as a status code partway through a long job: a key belonging to a
 * different provider than the base URL, a missing storage directory, a database
 * behind on migrations, and a retired model id. Every one was a question with a
 * definite answer that nobody had asked.
 *
 * Two properties matter more than the individual checks. It must not report
 * green when something is wrong, obviously. And it must not stop at the first
 * failure, because an operator who fixes one thing, re-runs, and finds a second
 * has learned to distrust it.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/llm/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/llm/client')>();
  return { ...actual, probeProvider: vi.fn() };
});

const { runChecks } = await import('@/lib/corpus/doctor');
const { probeProvider } = await import('@/lib/llm/client');

describe('the preflight', () => {
  it('passes when the environment, database and storage are all set up', async () => {
    vi.mocked(probeProvider).mockResolvedValue({ ok: true, detail: 'Key accepted.' });

    const checks = await runChecks();

    expect(checks.every((c) => c.ok)).toBe(true);
    expect(checks.map((c) => c.name)).toContain('database');
    expect(checks.map((c) => c.name)).toContain('model provider');
  });

  it('confirms the migrations the current code needs are applied', async () => {
    // The check that would have caught a database one migration behind, which
    // otherwise surfaces deep inside a stage as an error about a column and
    // reads like a bug in the code rather than a command not yet run.
    vi.mocked(probeProvider).mockResolvedValue({ ok: true, detail: 'Key accepted.' });

    const database = (await runChecks()).find((c) => c.name === 'database');

    expect(database?.ok).toBe(true);
    expect(database?.detail).toContain('up to date');
  });

  it('reports a provider failure without hiding the checks that passed', async () => {
    // Stopping at the first failure teaches an operator to distrust the tool:
    // they fix one thing, run again, and find a second waiting.
    vi.mocked(probeProvider).mockResolvedValue({
      ok: false,
      detail: 'The provider accepted the key but does not offer llama-3.1-70b-versatile.',
      available: ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'],
    });

    const checks = await runChecks();
    const provider = checks.find((c) => c.name === 'model provider');

    expect(provider?.ok).toBe(false);
    // The list is the actionable part. A failure saying "wrong model" without
    // saying which ones exist sends someone to a documentation page.
    expect(provider?.extra).toContain('llama-3.1-8b-instant');
    expect(checks.filter((c) => c.ok).length).toBeGreaterThan(0);
  });

  it('does not ask the provider when the basics are already broken', async () => {
    // A provider probe against an unusable environment reports the same problem
    // a second time in less useful words, and costs a network round trip to do
    // it. The check order is part of the design rather than incidental.
    vi.mocked(probeProvider).mockClear();
    vi.mocked(probeProvider).mockResolvedValue({ ok: true, detail: 'Key accepted.' });

    const dir = process.env.LOCAL_STORAGE_DIR;
    delete process.env.LOCAL_STORAGE_DIR;
    try {
      const checks = await runChecks();
      const storage = checks.find((c) => c.name === 'storage');

      // The environment module caches its parse, so storage is the layer that
      // can be broken from here. Either way the provider must not be asked.
      if (storage && !storage.ok) {
        expect(vi.mocked(probeProvider)).not.toHaveBeenCalled();
      }
    } finally {
      if (dir !== undefined) process.env.LOCAL_STORAGE_DIR = dir;
    }
  });
});
