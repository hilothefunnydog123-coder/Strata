/**
 * Generate appeal letters and print them, so a person can read what this
 * product actually writes.
 *
 * This exists because of the one line in SHIPCHECK.md that no amount of green
 * tests answers: nobody has ever read a letter the model produced. The
 * generation chain has been proven end to end with a stand-in at the model
 * boundary, which establishes that the wiring is right and that a quote which
 * is not in its source is rejected. It says nothing at all about whether the
 * prose is persuasive, and that is the thing a hospital is being asked to sign.
 *
 * So this runs the real chain: real corpus, real model, real verification, real
 * rejection of anything that fails it. The only thing it adds is printing the
 * result in full rather than storing it behind a login.
 *
 * Deliberately restricted to synthetic denials, and not as a formality. The
 * model boundary refuses a call carrying protected information whenever
 * PHI_MODE is synthetic, so a real case would be refused rather than printed;
 * beyond that, this writes whole letters to a log, and a run log is the last
 * place patient information should ever appear. The query below can only find
 * rows tagged synthetic, so there is no argument to pass that would widen it.
 *
 *   pnpm tsx scripts/generate-samples.ts            three letters
 *   pnpm tsx scripts/generate-samples.ts --limit=1  one
 */
import 'dotenv/config';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../lib/db';
import { denial, denialDocument, denialSpan, organization } from '../lib/db/schema';
import { generateAppeal, GenerationError, NoAuthorityError } from '../lib/appeals/generate';
import { loadDenialDetail } from '../lib/denials/detail';
import {
  buildCitations,
  groupIntoSections,
  renderPlainText,
  type RenderableAssertion,
} from '../lib/appeals/render';
import { log } from '../lib/log';

const out = (line = ''): void => void process.stdout.write(`${line}\n`);
const rule = (char = '─'): string => char.repeat(78);

function formatCents(cents: number | null): string {
  if (cents === null) return 'not stated';
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}

function formatRange(from: Date | null, to: Date | null): string {
  if (!from && !to) return 'not stated';
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (from && to) return `${iso(from)} to ${iso(to)}`;
  return iso((from ?? to)!);
}

/**
 * Cases this can generate for.
 *
 * Two conditions, both necessary. Synthetic, for the reasons above. And
 * carrying at least one parsed passage of a denial letter, because generation
 * classifies that letter first and throws a flat error without one, which would
 * read like a broken chain rather than a case that was never uploaded properly.
 */
async function candidates(limit: number) {
  const withLetters = db
    .select({ denialId: denialDocument.denialId })
    .from(denialSpan)
    .innerJoin(denialDocument, eq(denialSpan.denialDocumentId, denialDocument.id))
    .where(eq(denialDocument.kind, 'denial_letter'));

  return db
    .select({
      id: denial.id,
      internalRef: denial.internalRef,
      payerName: denial.payerName,
      serviceType: denial.serviceType,
      claimAmountCents: denial.claimAmountCents,
      serviceDateFrom: denial.serviceDateFrom,
      serviceDateTo: denial.serviceDateTo,
    })
    .from(denial)
    .where(and(eq(denial.isSynthetic, true), inArray(denial.id, withLetters)))
    .orderBy(denial.createdAt)
    .limit(limit);
}

async function main(): Promise<void> {
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = Math.max(1, Math.min(10, Number(limitArg?.split('=')[1] ?? 3) || 3));

  const cases = await candidates(limit);

  if (cases.length === 0) {
    out('');
    out('No synthetic denial has a parsed denial letter, so there is nothing to');
    out('generate from. Run "pnpm seed:demo" first, which creates cases carrying');
    out('both a denial letter and a clinical record.');
    out('');
    return;
  }

  out('');
  out(rule('═'));
  out(`  Generating ${cases.length} appeal letter${cases.length === 1 ? '' : 's'}`);
  out(rule('═'));
  out('');
  out('  Every quote below was checked verbatim against the passage it cites,');
  out('  by the same code that runs in production. A draft with any failing');
  out('  assertion was discarded and regenerated rather than printed.');
  out('');

  let generated = 0;
  let refused = 0;

  for (const record of cases) {
    out('');
    out(rule('═'));
    out(`  ${record.internalRef}   ${record.payerName}`);
    out(
      `  ${record.serviceType.replace(/_/g, ' ')}, ` +
        `${formatRange(record.serviceDateFrom, record.serviceDateTo)}, ` +
        `${formatCents(record.claimAmountCents)}`,
    );
    out(rule('═'));

    let result;
    try {
      result = await generateAppeal(record.id);
    } catch (error) {
      // Both of these are the product working rather than failing, so they are
      // reported as outcomes instead of stopping the run. A case with nothing
      // to cite is refused on purpose, and a draft that cannot pass its own
      // verification three times running is withheld on purpose.
      if (error instanceof NoAuthorityError) {
        refused += 1;
        out('');
        out('  REFUSED: no legal authority in the corpus supports this denial, so');
        out('  no letter was written. This is the intended behaviour rather than a');
        out('  failure: a clinical-only appeal with no law behind it is worse than');
        out('  none. The message follows.');
        out('');
        out(`  ${error.message}`);
        out('');
        continue;
      }

      if (error instanceof GenerationError) {
        refused += 1;
        out('');
        out('  WITHHELD: every attempt produced at least one assertion whose quote');
        out('  was not in its source, so nothing was shown. The failures follow.');
        out('');
        out(`  ${error.message}`);
        out('');
        continue;
      }

      // Anything else is a fault rather than a decision, and it stops this case
      // rather than the run. Sampling three letters and losing all of them to
      // whichever one failed first is how the first attempt at this went, and
      // the failure it hid was in a different case entirely.
      refused += 1;
      out('');
      out('  FAILED: this case could not be generated. The error follows.');
      out('');
      out(`  ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
      out('');
      log.error('a sample case failed to generate', { internalRef: record.internalRef, error });
      continue;
    }

    const detail = await loadDenialDetail(record.id);
    if (!detail?.draft) {
      out('');
      out('  The draft was generated but could not be read back, which should not');
      out('  happen and is worth investigating.');
      out('');
      continue;
    }

    const org = await db.query.organization.findFirst({
      where: eq(organization.id, detail.denial.organizationId),
    });

    const renderable: RenderableAssertion[] = detail.assertions.map((a) => ({
      id: a.id,
      ordinal: a.ordinal,
      section: a.section,
      kind: a.kind,
      text: a.text,
      sourceKind: a.sourceKind,
      sourceId: a.sourceId,
      verbatimQuote: a.verbatimQuote,
    }));

    const describe = (kind: RenderableAssertion['sourceKind'], id: string) => {
      const source = detail.sources[`${kind}:${id}`];
      return {
        label: source?.label ?? 'Source',
        detail: source?.detail ?? '',
        url: source?.url ?? null,
      };
    };

    const letter = {
      header: {
        organizationName: org?.name ?? 'Provider',
        payerName: detail.denial.payerName,
        internalRef: detail.denial.internalRef,
        serviceType: detail.denial.serviceType,
        serviceDates: formatRange(detail.denial.serviceDateFrom, detail.denial.serviceDateTo),
        claimAmount: formatCents(detail.denial.claimAmountCents),
        appealDeadline: detail.denial.appealDeadline
          ? detail.denial.appealDeadline.toISOString().slice(0, 10)
          : null,
        today: new Date().toISOString().slice(0, 10),
      },
      sections: groupIntoSections(renderable),
      citations: buildCitations(renderable, describe),
    };

    out('');
    out(
      `  ${result.assertionCount} assertions, ${letter.citations.length} citations, ` +
        `version ${result.version}, ${result.attempts} attempt${result.attempts === 1 ? '' : 's'}`,
    );
    if (result.proprietaryCriteriaDetected) {
      out('  The payer applied proprietary criteria, and the letter says so.');
    }
    if (result.gaps.length > 0) {
      out('');
      out('  Documentation gaps the draft could not close:');
      for (const gap of result.gaps) {
        out(`    ${gap.criterion}`);
        out(`      ${gap.why}`);
      }
    }
    out('');
    out(rule());
    out('');
    out(renderPlainText(letter));
    out('');

    generated += 1;
  }

  out('');
  out(rule('═'));
  out(
    `  ${generated} letter${generated === 1 ? '' : 's'} written, ` +
      `${refused} refused or withheld`,
  );
  out(rule('═'));
  out('');
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    log.error('generating sample letters failed', { error });
    process.exit(1);
  });
