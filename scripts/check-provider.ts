/**
 * One small real call, before any real work is paid for.
 *
 * Everything about a misconfigured model boundary looks the same from outside:
 * a run starts, does something or nothing, and dies with an HTTP status buried
 * in generated client code. A key from the wrong provider, a retired model id, a
 * base URL missing a path segment and a model that refuses a parameter this
 * codebase sends on every request all present as a number.
 *
 * corpus:doctor already asks the provider whether the key works and the model
 * exists, by listing models. That is free and it is not enough: listing proves
 * the account, not the request. The failure this script was written for was a
 * model that lists perfectly and then returns 400 for a field every stage of
 * this product sets, which no amount of listing would have found.
 *
 * So this sends the real thing. The same complete() every stage goes through,
 * with the same schema validation and the same error translation, on a prompt
 * small enough that the answer costs a rounding error. What it proves is what
 * the next command would otherwise have to discover expensively: that a request
 * this codebase builds is a request this provider accepts.
 */
import 'dotenv/config';
import { z } from 'zod';
import {
  availableModels,
  complete,
  llmConfigured,
  modelName,
  outputBudget,
  acceptsTemperature,
} from '../lib/llm/client';
import { env, envStatus } from '../lib/env';

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

/**
 * One tiny real request on a named model. Null when it worked.
 *
 * Small enough to cost a rounding error, and real enough to catch what listing
 * cannot: a model an account can see and may not spend on.
 */
async function tryModel(model: string): Promise<string | null> {
  try {
    await complete({
      stage: 'appeal_draft',
      system: 'You return JSON and nothing else. No preamble, no commentary, no markdown fence.',
      user: 'Return exactly {"ok": true}',
      schema: z.object({ ok: z.boolean() }),
      containsPhi: false,
      maxTokens: 64,
      model,
    });
    return null;
  } catch (error) {
    // Short, because this prints once per model and the long explanation has
    // already been printed once above. A list of ten identical paragraphs
    // hides the one column that matters, which is which name worked.
    const message = (error as Error).message;
    if (/without payment/.test(message)) return 'not entitled, HTTP 402';
    if (/rate or quota limit/.test(message)) return 'rate limited';
    if (/rejected the API key/.test(message)) return 'key rejected';
    if (/too large/.test(message)) return 'request too large';
    return message.split('\n')[0]?.slice(0, 60) ?? 'failed';
  }
}

async function main(): Promise<number> {
  out('');

  // Checked before anything is printed, because an environment that fails to
  // validate falls back to a set of defaults rather than throwing, and those
  // defaults include a Groq endpoint and no key. Reporting that as "the key is
  // not set" sends someone to add a variable that is already there, which is
  // the exact misdiagnosis the rest of this file exists to prevent. The first
  // draft of this script did it.
  const status = envStatus();
  if (!status.configured) {
    out('The environment is not valid, so the configuration below would be defaults');
    out('rather than yours. Nothing was sent.');
    out('');
    out(`  not set: ${status.missing.join(', ')}`);
    out('');
    return 1;
  }

  out('Configuration');
  out(`  endpoint    ${env.MODEL_BASE_URL}`);
  out(`  model       ${modelName()}`);
  out(`  corpus      ${modelName('corpus_extract')}`);
  out(`  json mode   ${env.MODEL_JSON_MODE ? 'on' : 'off'}`);
  out(`  phi mode    ${env.PHI_MODE}`);
  out('');

  if (!llmConfigured()) {
    out('MODEL_API_KEY is not set, so there is nothing to check. Nothing was sent.');
    return 1;
  }

  // Reported because both are decided by the model id rather than by the
  // caller, and a surprise in either is the thing this script exists to catch.
  const drafting = modelName();
  out('What the drafting stage will send');
  out(`  temperature ${acceptsTemperature(drafting) ? '0' : 'omitted, this model refuses it'}`);
  out(`  max_tokens  ${outputBudget(drafting, 8192)} (8192 reserved for the answer)`);
  out('');

  // Asked before the live call because it is free and because it separates two
  // failures that look identical from a stack trace: a key the provider will
  // not take, and a key it takes for a model it does not have. The second is
  // the common one when moving providers, since the same open weights are
  // published under a different id by every host that serves them.
  const offered = await availableModels();
  if (offered.length > 0 && !offered.includes(drafting)) {
    out(`The provider took the key but does not offer ${drafting}.`);
    out('Nothing else will work until MODEL_NAME names something below.');
    out('');
    for (const id of offered) out(`  ${id}`);
    out('');
    return 1;
  }

  out('Sending one small request through the real boundary.');

  try {
    const response = await complete({
      // Drafting rather than a cheaper stage, because drafting is the stage
      // with the largest reservation and the one whose model MODEL_NAME names.
      // Checking the stage that is not going to be the problem proves nothing.
      stage: 'appeal_draft',
      system:
        'You return JSON and nothing else. No preamble, no commentary, no markdown fence.',
      user:
        'Return exactly {"ok": true, "model_said": "<one short sentence confirming you can read this>"}',
      schema: z.object({ ok: z.boolean(), model_said: z.string() }),
      // Synthetic by construction: there is no patient in this prompt. The
      // boundary refuses a call declared otherwise while PHI_MODE is synthetic.
      containsPhi: false,
      // Small on purpose. With thinking headroom added on a model that thinks,
      // this is still a fraction of a cent.
      maxTokens: 256,
    });

    out('');
    out('It works.');
    out(`  answer      ${JSON.stringify(response.value)}`);
    out(`  tokens      ${response.inputTokens} in, ${response.outputTokens} out`);
    out(`  latency     ${response.latencyMs} ms`);
    if (env.MODEL_PRICE_INPUT_CENTS === 0 && env.MODEL_PRICE_OUTPUT_CENTS === 0) {
      out('  cost        not priced. Set MODEL_PRICE_INPUT_CENTS and');
      out('              MODEL_PRICE_OUTPUT_CENTS so spend reporting means something.');
    } else {
      // The true figure rather than the recorded one. costCents rounds up to a
      // whole cent so that reported spend is never optimistic, which is right
      // for a ledger and useless here: a call costing three hundredths of a
      // cent would be reported as one, and someone reading this line to work
      // out what a run will cost would be out by a factor of thirty.
      const exact =
        (response.inputTokens / 1_000_000) * env.MODEL_PRICE_INPUT_CENTS +
        (response.outputTokens / 1_000_000) * env.MODEL_PRICE_OUTPUT_CENTS;
      out(`  cost        ${exact.toFixed(4)} cents at the configured price`);
      out(`              (recorded as ${response.costCents}, rounded up, never optimistic)`);
    }
    out('');
    return 0;
  } catch (error) {
    out('');
    out('It does not work. Nothing else will either, so fix this first.');
    out('');
    out(`  ${(error as Error).message.split('\n').join('\n  ')}`);
    out('');

    // When the provider refused on entitlement rather than on the request, the
    // useful question is not "why this model" but "which models at all". One
    // model answering 402 looks like a paid model; every model answering 402 is
    // an account with nothing to spend, and those have completely different
    // remedies. Guessing between them one push at a time is what this avoids.
    const entitlement = /without payment/.test((error as Error).message);
    if (entitlement && offered.length > 1) {
      out('Trying every model this account is offered, to tell a paid model apart');
      out('from an account with no balance.');
      out('');
      for (const id of offered) {
        const failure = await tryModel(id);
        out(`  ${failure === null ? 'usable  ' : 'refused '} ${id}${failure ? `  (${failure})` : ''}`);
      }
      out('');
    }

    return 1;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    process.stderr.write(`${String(error)}\n`);
    process.exit(1);
  });
