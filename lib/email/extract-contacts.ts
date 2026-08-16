/**
 * Turning a messy paste into contacts.
 *
 * Formatting a spreadsheet by hand is the step that stops outreach happening at
 * all, so this takes whatever the operator actually has: a contact page copied
 * out of a browser, an email signature, a directory listing, three lines typed
 * from memory. The model reads it and returns rows.
 *
 * The rule that makes this safe rather than reckless:
 *
 *   An email address is kept only if it appears, character for character, in
 *   the text the operator pasted.
 *
 * A language model does not know anybody's email address. Asked for one it
 * cannot find, it will produce something plausible, and plausible is the worst
 * possible answer here: the message either bounces, which teaches every mail
 * provider that this domain sends to addresses that do not exist, or it reaches
 * a real person who was never meant to hear from us. Both are permanent in a
 * way no reply rate recovers from.
 *
 * So the model is used for what it is good at, reading unstructured text and
 * labelling the parts, and is given no authority at all over what the addresses
 * are. This is the same invariant the appeal letters run on, pointed at a
 * different kind of claim: nothing survives that cannot be found in the source.
 */
import { z } from 'zod';
import { complete } from '@/lib/llm/client';
import { log } from '@/lib/log';

export const extractedContactSchema = z.object({
  /** Copied from the paste, never composed. Checked afterwards. */
  email: z.string(),
  firstName: z.string().nullable().catch(null).default(null),
  lastName: z.string().nullable().catch(null).default(null),
  title: z.string().nullable().catch(null).default(null),
  orgName: z.string().nullable().catch(null).default(null),
});

export const extractionSchema = z.object({
  contacts: z.array(extractedContactSchema).default([]),
});

export type ExtractedContact = z.infer<typeof extractedContactSchema>;

export const EXTRACT_SYSTEM_PROMPT = `You read text a person has pasted and pull out the business contacts in it.

The text may be a copied web page, an email signature, a directory listing, a table, or a few lines typed from memory. It will be untidy. That is expected.

WHAT TO RETURN

One JSON object: {"contacts": [...]}. Each contact has:

- email: the address, copied exactly as it appears in the text.
- firstName: their first name, or null.
- lastName: their surname, or null.
- title: their job title, or null.
- orgName: the organisation they work for, or null.

THE RULE THAT MATTERS MOST

Only report an email address that literally appears in the text you were given. Copy it character for character.

Never construct an address. Do not guess one from a person's name and their employer's website. Do not complete a partial address. Do not correct a typo in one. Do not turn "dana at example dot com" into an address unless you are confident that is what it says, and if you do, write it in the normal form. If a person is named but no address for them appears anywhere in the text, do not include that person at all.

Every address you return is checked against the pasted text afterwards, and any that is not found there is discarded and reported as a mistake. There is no benefit to inventing one.

OTHER RULES

- One entry per address. If the same address appears twice, report it once.
- A general address such as info@ or contact@ is a real contact and should be reported, with the person fields null.
- Attach a title or organisation only when the text supports it. Null is a good answer.
- If the text contains no email addresses at all, return {"contacts": []}.

Return only JSON. No preamble, no commentary, no markdown fence.`;

/** Case-insensitive, so a signature block in title case still matches. */
function appearsIn(haystack: string, email: string): boolean {
  return haystack.toLowerCase().includes(email.trim().toLowerCase());
}

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface ExtractionResult {
  contacts: ExtractedContact[];
  /** Addresses the model produced that were not in the paste. Reported, never used. */
  invented: string[];
  /** Rows dropped for being malformed or duplicated. */
  discarded: string[];
}

/**
 * Keep only what the paste actually contains.
 *
 * Exported and tested on its own, because this is the whole safety property and
 * it should be provable without a model in the loop.
 */
export function keepOnlyWhatIsThere(
  source: string,
  candidates: readonly ExtractedContact[],
): ExtractionResult {
  const contacts: ExtractedContact[] = [];
  const invented: string[] = [];
  const discarded: string[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const email = candidate.email?.trim().toLowerCase() ?? '';

    if (!EMAIL_SHAPE.test(email)) {
      discarded.push(`${candidate.email || '(blank)'} is not an email address.`);
      continue;
    }
    if (!appearsIn(source, email)) {
      // The important branch. Named "invented" rather than "unmatched" because
      // that is what it is, and because the operator should see the word.
      invented.push(email);
      continue;
    }
    if (seen.has(email)) continue;

    seen.add(email);
    contacts.push({ ...candidate, email });
  }

  return { contacts, invented, discarded };
}

/**
 * Read a paste into contacts.
 *
 * containsPhi is false and stays false: this is a business contact list, and
 * the boundary refuses anything declared as patient information while the
 * deployment is in synthetic mode anyway.
 */
export async function extractContacts(text: string): Promise<ExtractionResult> {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return { contacts: [], invented: [], discarded: ['There was nothing to read.'] };
  }

  const response = await complete({
    stage: 'contact_extract',
    system: EXTRACT_SYSTEM_PROMPT,
    user: trimmed,
    schema: extractionSchema as z.ZodType<z.infer<typeof extractionSchema>>,
    containsPhi: false,
    maxTokens: 2048,
  });

  const result = keepOnlyWhatIsThere(trimmed, response.value.contacts);

  if (result.invented.length > 0) {
    log.warn('the model produced addresses that were not in the pasted text', {
      count: result.invented.length,
    });
  }

  return result;
}
