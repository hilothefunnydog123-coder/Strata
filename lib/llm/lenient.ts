/**
 * Reading a model's answer without throwing away the parts it got right.
 *
 * This lives on its own because the lesson had to be learned twice. It was
 * written for corpus extraction, where a strict enum was discarding verified
 * quotes over a label. Generation then failed on its first real run for the
 * same reason in a different file, because the reasoning had been recorded next
 * to one schema rather than shared with the other.
 *
 * The principle both schemas need: be strict about evidence and lenient about
 * description. A quote is what a citation rests on and it is checked, character
 * for character, against the passage it came from. A label beside that quote
 * decides which cases it surfaces for. Losing the first is a wrong citation.
 * Losing the second is a slightly worse search result, and discarding the whole
 * answer to avoid it trades something valuable for nothing.
 */
import { z } from 'zod';

/**
 * A facet the source may simply not state, taken from a model that has several
 * ways of saying so.
 *
 * Measured on a real corpus run: 74 holdings were discarded across seven
 * chapters, and the dominant reason was `outcome: Invalid enum value, received
 * 'null'`. Not JSON null, the four character string. A model asked for a
 * nullable field writes "null", or "none", or "N/A", or an empty string, or the
 * value with different capitalisation, and every one of those is the model
 * correctly saying the source is silent.
 *
 * Measured again on the first real generation run: the classifier returned
 * `serviceType: "skilled nursing facility care"`, which is the right answer
 * written as prose, and the strict enum threw and ended the letter.
 *
 * An unrecognised value becomes null rather than failing. Matching is exact
 * after normalising case, spaces, and hyphens, deliberately: "skilled nursing
 * facility care" becomes null rather than being guessed into `skilled_nursing`.
 * Every caller of this has a value of its own to fall back on, and a null it
 * can see is better than a guess it cannot. `inpatient_acute` and
 * `inpatient_rehab` are one substring apart, and quietly picking the wrong one
 * would aim the whole appeal at the wrong coverage standard.
 */
export function statedOrNull<const T extends readonly [string, ...string[]]>(values: T) {
  return z.preprocess((raw) => {
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== 'string') return null;

    const normalised = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (['', 'null', 'none', 'n/a', 'na', 'unknown', 'unspecified'].includes(normalised)) {
      return null;
    }

    return (values as readonly string[]).includes(normalised) ? normalised : null;
  }, z.enum(values).nullable());
}
