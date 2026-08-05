/**
 * An environment variable that exists and is empty means it was not set.
 *
 * Zod fills a default only for undefined, and CI produces empty strings
 * constantly: a GitHub workflow writing `FOO: ${{ vars.FOO }}` with the
 * variable unset sets FOO to "", which is present, fails a min(1) check, and
 * takes the whole environment down before anything runs.
 *
 * That is exactly how a corpus run died: "MODEL_NAME_CORPUS: String must
 * contain at least 1 character(s)", about a variable nobody had ever set, in a
 * job where the default was the entire point of adding it.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

/** The helper under test, as lib/env.ts defines it. */
const withDefault = (fallback: string) =>
  z
    .string()
    .optional()
    .transform((v) => {
      const trimmed = v?.trim();
      return trimmed && trimmed.length > 0 ? trimmed : fallback;
    });

describe('a default that survives an empty variable', () => {
  const model = withDefault('llama-3.1-8b-instant');

  it('fills the default when the variable is absent', () => {
    expect(model.parse(undefined)).toBe('llama-3.1-8b-instant');
  });

  it('fills the default when the variable is present and empty', () => {
    // The case that broke the run. Plain z.default() returns "" here, because
    // "" is not undefined, and the min(1) after it then fails.
    expect(model.parse('')).toBe('llama-3.1-8b-instant');
    expect(z.string().min(1).default('x').safeParse('').success).toBe(false);
  });

  it('fills the default when the variable is only whitespace', () => {
    expect(model.parse('   ')).toBe('llama-3.1-8b-instant');
  });

  it('keeps a real value, trimmed', () => {
    // Trailing whitespace out of a console paste is the same accident wearing a
    // different hat, and a model id with a space on the end fails at the
    // provider with a 404 naming a model that looks right.
    expect(model.parse('openai/gpt-oss-20b')).toBe('openai/gpt-oss-20b');
    expect(model.parse('  openai/gpt-oss-20b \n')).toBe('openai/gpt-oss-20b');
  });

  it('still validates what it produces when piped', () => {
    // MODEL_BASE_URL defaults and then has to be a URL. The default must
    // satisfy the check it is piped into, or an unset variable becomes a
    // startup failure rather than a working default.
    const url = withDefault('https://api.groq.com/openai/v1').pipe(z.string().url());

    expect(url.parse('')).toBe('https://api.groq.com/openai/v1');
    expect(url.safeParse('not a url').success).toBe(false);
  });
});
