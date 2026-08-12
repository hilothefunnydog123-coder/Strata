/**
 * The fact extraction prompt names every field it demands.
 *
 * The schema discards a fact missing spanOrdinal or factType, and the prompt
 * described the quote and the criterion without ever naming either field. On a
 * real run every extracted fact came back without them, every one was
 * discarded, all five coverage criteria were reported as unsupported, and the
 * drafter was then correctly forbidden from writing the application section.
 * The letter went out one sentence long with a clean verification record.
 *
 * Classification had this exact failure and gained a WHAT TO RETURN block that
 * ended it. This holds the same repair in place here, because a prompt is the
 * one part of a contract nothing type checks.
 */
import { describe, expect, it } from 'vitest';
import { FACT_EXTRACTION_SYSTEM_PROMPT, clinicalFactSchema } from '@/lib/appeals/facts';

describe('the fact extraction prompt', () => {
  it('names every field the schema will discard a fact for lacking', () => {
    const shape = clinicalFactSchema.shape;

    for (const field of Object.keys(shape)) {
      expect(FACT_EXTRACTION_SYSTEM_PROMPT).toContain(field);
    }
  });

  it('tells the model where the span number comes from', () => {
    // The ordinal is meaningless unless the prompt says it is the N in the
    // "--- span N ---" labels the input carries.
    expect(FACT_EXTRACTION_SYSTEM_PROMPT).toContain('--- span N ---');
  });

  it('lists every factType the schema accepts', () => {
    for (const value of clinicalFactSchema.shape.factType.options) {
      expect(FACT_EXTRACTION_SYSTEM_PROMPT).toContain(value);
    }
  });
});
