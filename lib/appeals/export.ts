/**
 * Exporting a finished appeal.
 *
 * DOCX for a specialist who wants to edit before filing, PDF for the record.
 * Both are generated server side and both carry the citation appendix, so the
 * document that leaves this system can be checked against its sources by
 * someone who has never heard of us.
 *
 * Export is blocked before the draft is approved. That check lives in the
 * server action, not here, because this module should not be the thing deciding
 * workflow state.
 */
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from 'docx';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { RenderedLetter } from './render';

/* ─── DOCX ────────────────────────────────────────────────────────────────── */

export async function toDocx(letter: RenderedLetter): Promise<Buffer> {
  const children: Paragraph[] = [];

  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: letter.header.organizationName, bold: true, size: 28 }),
      ],
    }),
    new Paragraph({ text: '' }),
    new Paragraph({ text: letter.header.today }),
    new Paragraph({ text: '' }),
    new Paragraph({ text: letter.header.payerName }),
    new Paragraph({ text: '' }),
    new Paragraph({
      children: [new TextRun({ text: 'RE: Appeal of denied claim', bold: true })],
    }),
  );

  const fields: [string, string | null][] = [
    ['Reference', letter.header.internalRef],
    ['Service', letter.header.serviceType.replace(/_/g, ' ')],
    ['Dates of service', letter.header.serviceDates],
    ['Amount at issue', letter.header.claimAmount],
    ['Appeal due', letter.header.appealDeadline],
  ];
  for (const [label, value] of fields) {
    if (value) children.push(new Paragraph({ text: `${label}: ${value}` }));
  }

  children.push(
    new Paragraph({ text: '' }),
    new Paragraph({ text: 'To the Appeals Department:' }),
    new Paragraph({ text: '' }),
  );

  for (const group of letter.sections) {
    children.push(
      new Paragraph({ text: group.heading, heading: HeadingLevel.HEADING_2 }),
    );
    for (const a of group.assertions) {
      children.push(new Paragraph({ text: `${a.ordinal}. ${a.text}` }));
    }
    children.push(new Paragraph({ text: '' }));
  }

  children.push(
    new Paragraph({ text: 'Enclosures', heading: HeadingLevel.HEADING_2 }),
    new Paragraph({ text: '1. The denial letter at issue' }),
    new Paragraph({ text: '2. The clinical record supporting this appeal' }),
    new Paragraph({ text: '3. Citation appendix, below' }),
    new Paragraph({ text: '' }),
    new Paragraph({ text: 'Citation appendix', heading: HeadingLevel.HEADING_2 }),
    new Paragraph({
      text:
        'Every assertion above rests on one of the sources below. The quoted passage is ' +
        'reproduced so this appeal can be checked against its sources directly.',
    }),
    new Paragraph({ text: '' }),
  );

  for (const citation of letter.citations) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: `[${citation.index}] `, bold: true }),
          new TextRun({ text: citation.label, bold: true }),
        ],
      }),
    );
    if (citation.detail) children.push(new Paragraph({ text: citation.detail }));
    if (citation.url) children.push(new Paragraph({ text: citation.url }));
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `"${citation.quote}"`, italics: true })],
        indent: { left: 480 },
      }),
      new Paragraph({ text: '' }),
    );
  }

  const document = new Document({
    creator: 'Strata',
    title: `Appeal ${letter.header.internalRef}`,
    description: 'Appeal of a denied claim, with citation appendix',
    sections: [{ properties: {}, children }],
  });

  return Buffer.from(await Packer.toBuffer(document));
}

/* ─── PDF ─────────────────────────────────────────────────────────────────── */

const PAGE = { width: 612, height: 792 };
const MARGIN = 64;
const LEADING = 14;

/**
 * A plain, correct PDF.
 *
 * pdf-lib draws text rather than laying it out, so wrapping and pagination are
 * done here. Deliberately unstyled: this document gets printed, scanned, faxed,
 * and attached to a payer portal, and everything decorative is one more thing
 * that has to survive that trip.
 */
export async function toPdf(letter: RenderedLetter): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Appeal ${letter.header.internalRef}`);
  pdf.setCreator('Strata');

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);

  let page = pdf.addPage([PAGE.width, PAGE.height]);
  let y = PAGE.height - MARGIN;

  const newPage = () => {
    page = pdf.addPage([PAGE.width, PAGE.height]);
    y = PAGE.height - MARGIN;
  };

  const write = (
    text: string,
    options: { font?: 'regular' | 'bold' | 'italic'; size?: number; indent?: number } = {},
  ) => {
    const font =
      options.font === 'bold' ? bold : options.font === 'italic' ? italic : regular;
    const size = options.size ?? 10;
    const indent = options.indent ?? 0;
    const maxWidth = PAGE.width - MARGIN * 2 - indent;

    for (const line of wrapToWidth(text, font, size, maxWidth)) {
      if (y < MARGIN + LEADING) newPage();
      page.drawText(line, {
        x: MARGIN + indent,
        y,
        size,
        font,
        color: rgb(0.07, 0.06, 0.05),
      });
      y -= LEADING;
    }
  };

  const gap = (amount = LEADING) => {
    y -= amount;
    if (y < MARGIN) newPage();
  };

  write(letter.header.organizationName, { font: 'bold', size: 14 });
  gap();
  write(letter.header.today);
  gap(LEADING / 2);
  write(letter.header.payerName);
  gap();
  write('RE: Appeal of denied claim', { font: 'bold' });

  const fields: [string, string | null][] = [
    ['Reference', letter.header.internalRef],
    ['Service', letter.header.serviceType.replace(/_/g, ' ')],
    ['Dates of service', letter.header.serviceDates],
    ['Amount at issue', letter.header.claimAmount],
    ['Appeal due', letter.header.appealDeadline],
  ];
  for (const [label, value] of fields) {
    if (value) write(`${label}: ${value}`, { indent: 16 });
  }

  gap();
  write('To the Appeals Department:');
  gap();

  for (const group of letter.sections) {
    write(group.heading.toUpperCase(), { font: 'bold', size: 11 });
    gap(LEADING / 2);
    for (const a of group.assertions) {
      write(`${a.ordinal}. ${a.text}`);
      gap(LEADING / 2);
    }
    gap(LEADING / 2);
  }

  write('ENCLOSURES', { font: 'bold', size: 11 });
  gap(LEADING / 2);
  write('1. The denial letter at issue', { indent: 16 });
  write('2. The clinical record supporting this appeal', { indent: 16 });
  write('3. Citation appendix, below', { indent: 16 });
  gap();

  write('CITATION APPENDIX', { font: 'bold', size: 11 });
  gap(LEADING / 2);
  write(
    'Every assertion above rests on one of the sources below. The quoted passage is ' +
      'reproduced so this appeal can be checked against its sources directly.',
  );
  gap();

  for (const citation of letter.citations) {
    write(`[${citation.index}] ${citation.label}`, { font: 'bold' });
    if (citation.detail) write(citation.detail, { indent: 16 });
    if (citation.url) write(citation.url, { indent: 16, size: 9 });
    write(`"${citation.quote}"`, { font: 'italic', indent: 16 });
    gap(LEADING / 2);
  }

  return Buffer.from(await pdf.save());
}

function wrapToWidth(
  text: string,
  font: { widthOfTextAtSize(text: string, size: number): number },
  size: number,
  maxWidth: number,
): string[] {
  // pdf-lib's standard fonts cannot encode characters outside WinAnsi, and a
  // stray typographic quote from a source document would throw mid-render.
  const safe = text
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x20-\xFF]/g, '');

  const words = safe.split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      if (current.length > 0) lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines.length > 0 ? lines : [''];
}
