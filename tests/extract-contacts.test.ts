/**
 * Reading a paste into contacts, and refusing to invent one.
 *
 * The model is genuinely useful here: it reads an untidy page and works out
 * which line is a title and which is an organisation. It is also, given the
 * chance, entirely willing to produce firstname.lastname@company.com for a
 * person whose address was never in the text, because that is what the pattern
 * of the question suggests.
 *
 * That address goes to a stranger, or bounces and teaches every mail provider
 * that this domain writes to people who do not exist. Neither is recoverable by
 * writing better emails afterwards. So the filter below is the actual product,
 * and it is tested without a model in the loop because it has to hold whatever
 * the model does.
 */
import { describe, expect, it } from 'vitest';
import {
  EXTRACT_SYSTEM_PROMPT,
  keepOnlyWhatIsThere,
  type ExtractedContact,
} from '@/lib/email/extract-contacts';

const PASTE = `Windsor Gardens Care Center of Hayward
Skilled nursing and rehabilitation

Contact us
Main: (510) 537-8848
Dana Whitfield, Business Office Manager
Dana.Whitfield@example.com

General enquiries: info@example.com`;

function found(over: Partial<ExtractedContact> = {}): ExtractedContact {
  return {
    email: 'dana.whitfield@example.com',
    firstName: 'Dana',
    lastName: 'Whitfield',
    title: 'Business Office Manager',
    orgName: 'Windsor Gardens Care Center of Hayward',
    ...over,
  };
}

describe('keeping only what the paste contains', () => {
  it('keeps an address that is in the text, with its labels', () => {
    const result = keepOnlyWhatIsThere(PASTE, [found()]);

    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0]!.email).toBe('dana.whitfield@example.com');
    expect(result.contacts[0]!.title).toBe('Business Office Manager');
    expect(result.invented).toEqual([]);
  });

  it('matches regardless of the case the paste used', () => {
    // The text says Dana.Whitfield@example.com; the model reports it lowercased.
    // Mail addresses are not case sensitive and a signature block is often title
    // case, so insisting on an exact byte match would discard real addresses.
    const result = keepOnlyWhatIsThere(PASTE, [found({ email: 'DANA.WHITFIELD@EXAMPLE.COM' })]);
    expect(result.contacts).toHaveLength(1);
  });

  it('discards an address that was never in the text, and says so', () => {
    // The exact failure this module exists for: a plausible address built from
    // a name and an employer, for a person whose address the page never gave.
    const result = keepOnlyWhatIsThere(PASTE, [
      found(),
      found({ email: 'alex.moreno@example.com', firstName: 'Alex', lastName: 'Moreno' }),
    ]);

    expect(result.contacts.map((c) => c.email)).toEqual(['dana.whitfield@example.com']);
    expect(result.invented).toEqual(['alex.moreno@example.com']);
  });

  it('keeps a general address, which is a real contact', () => {
    const result = keepOnlyWhatIsThere(PASTE, [
      found({ email: 'info@example.com', firstName: null, lastName: null, title: null }),
    ]);
    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0]!.email).toBe('info@example.com');
  });

  it('reports the same address once', () => {
    const result = keepOnlyWhatIsThere(PASTE, [found(), found()]);
    expect(result.contacts).toHaveLength(1);
  });

  it('drops anything that is not an address at all', () => {
    const result = keepOnlyWhatIsThere(PASTE, [
      found({ email: 'Business Office Manager' }),
      found({ email: '' }),
    ]);
    expect(result.contacts).toHaveLength(0);
    expect(result.discarded).toHaveLength(2);
  });

  it('returns nothing from a paste with no addresses in it', () => {
    const result = keepOnlyWhatIsThere('Windsor Gardens, Hayward. Call (510) 537-8848.', [
      found(),
    ]);
    expect(result.contacts).toHaveLength(0);
    expect(result.invented).toEqual(['dana.whitfield@example.com']);
  });

  it('is not fooled by an address that only shares a domain with the paste', () => {
    // "@example.com" appears in the text many times. That is not permission to
    // write to a different mailbox at that domain.
    const result = keepOnlyWhatIsThere(PASTE, [found({ email: 'billing@example.com' })]);
    expect(result.contacts).toHaveLength(0);
    expect(result.invented).toEqual(['billing@example.com']);
  });
});

describe('the instruction given to the model', () => {
  it('forbids constructing an address in the words a model will follow', () => {
    expect(EXTRACT_SYSTEM_PROMPT).toContain('Never construct an address');
    expect(EXTRACT_SYSTEM_PROMPT).toContain('Do not guess one');
    // And tells it the check exists, which removes any upside to guessing.
    expect(EXTRACT_SYSTEM_PROMPT).toContain('checked against the pasted text');
  });

  it('names every field the schema requires, so none is silently omitted', () => {
    for (const field of ['email', 'firstName', 'lastName', 'title', 'orgName']) {
      expect(EXTRACT_SYSTEM_PROMPT).toContain(field);
    }
  });
});
