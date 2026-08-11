/**
 * The boundary against a provider that is not Groq.
 *
 * Everything else in this suite exercises complete() with the network stubbed
 * or the error hand built, which proves the policy and the parsing and says
 * nothing about the request that actually goes out. This file puts a real HTTP
 * server on the other end and reads what arrived.
 *
 * It exists because of a specific near miss. Moving to Anthropic was described
 * in this repository as two environment variables, on the strength of the wire
 * protocol being the same shape, and it was not: every stage of this product
 * sends temperature 0, and Anthropic's newest models return HTTP 400 for any
 * non-default sampling parameter on every request. The first call of the first
 * stage would have failed, and the shape of that failure (a 400 with a message
 * about a parameter) is one this boundary already has two other meanings for.
 *
 * So the server below refuses a temperature the way the real one does. A
 * regression that puts the field back does not fail some assertion about a
 * request body, it fails the call, which is what it would do in production.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { z } from 'zod';

/** Every request body the fake provider received, in order. */
const received: Record<string, unknown>[] = [];

/** The request that went out, or a clear failure if none did. */
function sent(): Record<string, unknown> {
  const last = received.at(-1);
  if (!last) throw new Error('The provider was never called, so there is nothing to assert on.');
  return last;
}

/**
 * A provider that enforces the two rules that matter here.
 *
 * Sampling: models whose ids Anthropic documents as rejecting non-default
 * sampling get a 400 if a temperature arrives at all, which is what the real
 * endpoint does and is deliberately stricter than checking the value. Sending
 * temperature 1 to say "the default" is still sending the parameter.
 *
 * Output: the reservation is echoed back in the usage block so a test can read
 * what the model was actually given to work with.
 */
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on('end', () => {
      const parsed = JSON.parse(body || '{}') as Record<string, unknown>;
      received.push(parsed);

      const model = String(parsed.model ?? '');
      const rejectsSampling = /^claude-(fable-5|mythos-5|opus-5|opus-4-[78]|sonnet-5)/.test(model);

      if (rejectsSampling && 'temperature' in parsed) {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            error: {
              type: 'invalid_request_error',
              message: '`temperature` is not supported on this model.',
            },
          }),
        );
        return;
      }

      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          id: 'msg_1',
          object: 'chat.completion',
          created: 0,
          model,
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: { role: 'assistant', content: '{"ok":true}' },
            },
          ],
          usage: {
            prompt_tokens: 11,
            completion_tokens: 3,
            total_tokens: 14,
          },
        }),
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/**
 * Call the boundary with a named model, against the fake provider.
 *
 * Modules are reset and re-imported per call because both the environment and
 * the provider client are cached after first read, deliberately, and this needs
 * a different model on each pass.
 */
async function callWith(model: string): Promise<unknown> {
  const { resetModules } = await import('vitest').then((m) => ({
    resetModules: m.vi.resetModules.bind(m.vi),
  }));
  resetModules();

  process.env.MODEL_API_KEY = 'test-key';
  process.env.MODEL_BASE_URL = baseUrl;
  process.env.MODEL_NAME = model;
  // The compatibility layer ignores response_format rather than honouring it,
  // and this is how it is turned off. Left on it would be silently dropped, so
  // the test asserts the request rather than trusting either behaviour.
  process.env.MODEL_JSON_MODE = 'false';

  const { complete } = await import('@/lib/llm/client');

  return complete({
    // Not corpus_extract, which reads MODEL_NAME_CORPUS and would have made
    // every case below assert against the extraction model instead of the
    // named one. Drafting is the stage a letter depends on anyway.
    stage: 'appeal_draft',
    system: 'system',
    user: 'user',
    schema: z.object({ ok: z.boolean() }),
    containsPhi: false,
  });
}

describe('a model that rejects sampling parameters', () => {
  it('is not sent a temperature, and so is not refused', async () => {
    received.length = 0;

    // Without the omission this throws, because the fake refuses it exactly as
    // the real endpoint does. That is the point of asserting through a call
    // rather than inspecting a body: the failure mode under test is a dead
    // stage, not a cosmetic difference in a request.
    const result = (await callWith('claude-sonnet-5')) as { value: { ok: boolean } };

    expect(result.value.ok).toBe(true);
    expect(received).toHaveLength(1);
    expect(sent()).not.toHaveProperty('temperature');
  });

  it('is recognised by prefix, so a dated model id behaves like its alias', async () => {
    received.length = 0;

    const result = (await callWith('claude-opus-5-20260115')) as { value: { ok: boolean } };

    expect(result.value.ok).toBe(true);
    expect(sent()).not.toHaveProperty('temperature');
  });

  it('is given room to think on top of what the caller reserved', async () => {
    received.length = 0;

    await callWith('claude-sonnet-5');

    const { THINKING_HEADROOM_TOKENS } = await import('@/lib/llm/client');
    // 4096 is the default reservation in complete().
    expect(sent().max_tokens).toBe(4096 + THINKING_HEADROOM_TOKENS);
  });
});

describe('a model that takes sampling parameters', () => {
  it('still gets temperature 0, because determinism is worth having where it is offered', async () => {
    received.length = 0;

    const result = (await callWith('claude-sonnet-4-6')) as { value: { ok: boolean } };

    expect(result.value.ok).toBe(true);
    expect(sent().temperature).toBe(0);
  });

  it('is not given thinking headroom it does not need', async () => {
    received.length = 0;

    await callWith('claude-haiku-4-5');

    expect(sent().max_tokens).toBe(4096);
  });

  it('covers the models this product has actually been run on', async () => {
    received.length = 0;

    await callWith('llama-3.1-8b-instant');

    // The whole corpus was ingested through this path. A capability table that
    // changed its behaviour would be a regression in the one part of this
    // system with a year of output behind it.
    expect(sent().temperature).toBe(0);
    expect(sent().max_tokens).toBe(4096);
  });
});

describe('the request is the shape the compatibility layer documents', () => {
  it('sends one system message and one user message', async () => {
    received.length = 0;

    await callWith('claude-sonnet-5');

    // Anthropic supports a single initial system message and concatenates any
    // others into it. This boundary only ever sends one, so nothing is merged
    // and the prompt that arrives is the prompt that was written.
    const messages = sent().messages as { role: string }[];
    expect(messages.map((m) => m.role)).toEqual(['system', 'user']);
  });

  it('omits response_format when the provider would ignore it', async () => {
    received.length = 0;

    await callWith('claude-sonnet-5');

    expect(sent()).not.toHaveProperty('response_format');
  });
});
