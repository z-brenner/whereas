import { coveredRange } from './blocks';
import type { Docx } from './docx';
import { listParagraphs, paragraphText } from './model';
import type { Range } from './types';

/** The range of the nth occurrence of `quote` in the document, or null. */
export function findText(docx: Docx, quote: string, nth = 0): Range | null {
  const paragraphs = listParagraphs(docx.document);
  let seen = 0;
  for (let p = 0; p < paragraphs.length; p++) {
    const text = paragraphText(paragraphs[p]!);
    for (let o = text.indexOf(quote); o !== -1; o = text.indexOf(quote, o + 1)) {
      if (seen++ === nth) return { start: { p, o }, end: { p, o: o + quote.length }, quote };
    }
  }
  return null;
}

/** A block range over the whole paragraphs or table rows around a position. */
export function blockRange(docx: Docx, pStart: number, pEnd: number, rows = false): Range {
  const paragraphs = listParagraphs(docx.document);
  const covered = coveredRange(paragraphs, pStart, pEnd, rows);
  const first = paragraphText(paragraphs[covered.start]!);
  const last = paragraphText(paragraphs[covered.end]!);
  return {
    start: { p: covered.start, o: 0 },
    end: { p: covered.end, o: last.length },
    quote: first.length > 80 ? `${first.slice(0, 80)}…` : first,
  };
}
