/**
 * What the drafting call gives up, and in what order, when it is refused.
 *
 * This ladder existed and was tested by nothing, and it was wrong in a way that
 * made the product impossible to run on a free tier for months without anyone
 * being able to see why.
 *
 * A request is its prompt plus the room it reserves for an answer, and a
 * provider charges the reservation against the limit in full whether it is used
 * or not. Drafting reserved 8192. The free allowance on the model it was being
 * run against is 8000 tokens a minute. So the reservation alone was over the
 * limit and the request was refused whatever it carried, while the only lever
 * this function pulled was how many authorities to cite. A real run walked
 * twenty two authorities down to two and was refused at every step.
 *
 * Nothing about that is visible in a log. It reads as a model that will not
 * accept a drafting prompt, which is a conclusion about the product rather than
 * about one number.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelRequestTooLargeError } from '@/lib/llm/client';
import { DRAFT_OUTPUT_TOKENS, MIN_DRAFT_OUTPUT_TOKENS, type DraftContext } from '@/lib/appeals/draft';

/** Every reservation and authority count the ladder tried, in order. */
const attempts: { maxTokens: number; authorities: number }[] = [];

/**
 * A provider with a fixed budget for the whole request.
 *
 * Modelled on the failure that prompted this: the reservation counts against
 * the budget in full, alongside a rough size for the prompt. Anything over is
 * refused. This is what a tokens per minute allowance smaller than one drafting
 * call actually does.
 */
let budget = 8000;
const TOKENS_PER_AUTHORITY = 500;
const PROMPT_FLOOR = 1500;

vi.mock('@/lib/appeals/draft', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/appeals/draft')>();
  return {
    ...actual,
    draftAppeal: vi.fn(
      (
        context: DraftContext,
        options: { containsPhi: boolean; denialId: string; maxTokens?: number },
      ) => {
        const authorities = context.holdings.length + context.regulations.length;
        const maxTokens = options.maxTokens ?? 0;
        attempts.push({ maxTokens, authorities });

        const size = maxTokens + PROMPT_FLOOR + authorities * TOKENS_PER_AUTHORITY;
        if (size > budget) {
          throw new ModelRequestTooLargeError(`refused: ${size} tokens against ${budget}`);
        }

        return Promise.resolve({
          value: { assertions: [] },
          inputTokens: size,
          outputTokens: 0,
          costCents: 0,
          latencyMs: 1,
        });
      },
    ),
  };
});

const { draftWithinTheLimit } = await import('@/lib/appeals/generate');

function contextWith(authorities: number): DraftContext {
  const half = Math.ceil(authorities / 2);
  return {
    payerName: 'A Plan',
    claimReference: 'C1',
    serviceType: 'skilled_nursing',
    serviceDates: '1 January 2026 to 10 January 2026',
    claimAmount: '$1',
    denialBasis: 'medical_necessity',
    denialQuote: 'the services were not medically necessary at the level billed',
    proprietaryCriteria: { detected: false, name: null, quote: null },
    holdings: Array.from({ length: half }, (_, i) => ({
      id: `h${i}`,
      citation: 'A decision',
      issue: 'issue',
      ruleApplied: 'rule',
      outcome: null,
      text: 'text',
    })),
    regulations: Array.from({ length: authorities - half }, (_, i) => ({
      id: `r${i}`,
      citation: '42 CFR 1',
      headingPath: [],
      text: 'text',
    })),
    facts: [],
    criteria: [],
    gaps: [],
  } as unknown as DraftContext;
}

beforeEach(() => {
  attempts.length = 0;
  budget = 8000;
});

describe('a drafting request that is refused for size', () => {
  it('gives up reserved output before it gives up an authority', async () => {
    // Comfortably over the budget at the starting reservation, and comfortably
    // under it once the reservation comes down. The whole point is that the
    // authorities never needed to move.
    await draftWithinTheLimit(contextWith(8), { containsPhi: false, denialId: 'd1' });

    expect(attempts[0]).toEqual({ maxTokens: DRAFT_OUTPUT_TOKENS, authorities: 8 });
    // Second attempt: less room reserved, the same argument intact.
    expect(attempts[1]?.authorities).toBe(8);
    expect(attempts[1]?.maxTokens).toBeLessThan(DRAFT_OUTPUT_TOKENS);
  });

  it('would have been refused forever at the reservation it used to send', async () => {
    // 8192 against 8000 is over the limit before a word of the prompt is added,
    // so no number of authorities, including none, could have made it fit. This
    // is the arithmetic that made a real run shed 22 authorities down to 2 and
    // get refused every time.
    expect(8192).toBeGreaterThan(budget);
    expect(DRAFT_OUTPUT_TOKENS + PROMPT_FLOOR).toBeLessThan(budget);
  });

  it('stops reserving less once a letter would no longer fit in the answer', async () => {
    // Small enough that shedding the reservation cannot save it, so the ladder
    // has to move on to authorities rather than shrinking the answer to
    // nothing. A truncated draft is invalid JSON, which fails somewhere else
    // entirely and sends someone to the wrong place.
    // Room for the smallest whole answer, the prompt, and four authorities, and
    // no room for the reservation this used to send. So the ladder has to spend
    // its output concession and then start on the argument.
    budget = 5600;

    await draftWithinTheLimit(contextWith(8), { containsPhi: false, denialId: 'd2' });

    expect(Math.min(...attempts.map((a) => a.maxTokens))).toBe(MIN_DRAFT_OUTPUT_TOKENS);
    expect(Math.min(...attempts.map((a) => a.authorities))).toBeLessThan(8);
  });

  it('never sheds past the floor it says it stops at', async () => {
    // Halving each list separately took four authorities to two, under a floor
    // documented as the point below which a letter is not worth writing. The
    // ladder is allowed to stop and fail; it is not allowed to quietly send a
    // thinner argument than the rule permits.
    budget = 1;

    await expect(
      draftWithinTheLimit(contextWith(22), { containsPhi: false, denialId: 'd5' }),
    ).rejects.toBeInstanceOf(ModelRequestTooLargeError);

    expect(Math.min(...attempts.map((a) => a.authorities))).toBeGreaterThanOrEqual(3);
  });

  it('refuses rather than writing a letter off one authority', async () => {
    // Below MIN_AUTHORITIES the argument is too thin to be worth sending, and
    // the provider's own message is more use than a letter nobody can tell was
    // written from the scraps that fitted.
    budget = 2000;

    await expect(
      draftWithinTheLimit(contextWith(8), { containsPhi: false, denialId: 'd3' }),
    ).rejects.toBeInstanceOf(ModelRequestTooLargeError);

    expect(Math.min(...attempts.map((a) => a.authorities))).toBeGreaterThanOrEqual(3);
  });

  it('does not touch anything when the first attempt is accepted', async () => {
    budget = 100_000;

    await draftWithinTheLimit(contextWith(22), { containsPhi: false, denialId: 'd4' });

    expect(attempts).toEqual([{ maxTokens: DRAFT_OUTPUT_TOKENS, authorities: 22 }]);
  });
});
