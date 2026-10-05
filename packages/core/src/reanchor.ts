import type { Docx } from './docx';
import { blockRange } from './locate';
import { listParagraphs, paragraphText } from './model';
import type { Anchor, TemplateDefinition } from './types';

function occurrences(texts: string[], quote: string): { p: number; o: number }[] {
  const out: { p: number; o: number }[] = [];
  texts.forEach((text, p) => {
    for (let o = text.indexOf(quote); o !== -1; o = text.indexOf(quote, o + 1)) out.push({ p, o });
  });
  return out;
}

/**
 * Carries a definition over to an edited copy of its document. Each range
 * is found again by its text; ranges whose text is gone are dropped and
 * returned so the author can place them again.
 */
export function reanchor(
  before: Docx,
  after: Docx,
  def: TemplateDefinition,
): { definition: TemplateDefinition; lost: Anchor[] } {
  const oldTexts = listParagraphs(before.document).map(paragraphText);
  const newTexts = listParagraphs(after.document).map(paragraphText);
  const kept: Anchor[] = [];
  const lost: Anchor[] = [];

  for (const a of def.anchors) {
    const isBlock = (a.kind === 'conditional' || a.kind === 'repeat') && a.block;
    if (isBlock) {
      // Whole paragraphs are matched by the text of their first and last one.
      const first = oldTexts[a.range.start.p];
      const last = oldTexts[a.range.end.p];
      const span = a.range.end.p - a.range.start.p;
      const start = first === undefined ? -1 : newTexts.findIndex((t, i) => t === first && newTexts[i + span] === last);
      if (start === -1 || first === '') {
        lost.push(a);
        continue;
      }
      try {
        kept.push({ ...a, range: blockRange(after, start, start + span, a.rows) });
      } catch {
        lost.push(a);
      }
      continue;
    }
    const quote = a.range.quote;
    if (quote === '') {
      lost.push(a);
      continue;
    }
    // Keep the same occurrence: the second "[NAME]" stays the second one.
    const nth = occurrences(oldTexts, quote).findIndex((m) => m.p === a.range.start.p && m.o === a.range.start.o);
    const matches = occurrences(newTexts, quote);
    const hit = matches[nth === -1 ? 0 : nth] ?? (matches.length === 1 ? matches[0] : undefined);
    if (!hit) {
      lost.push(a);
      continue;
    }
    kept.push({ ...a, range: { start: hit, end: { p: hit.p, o: hit.o + quote.length }, quote } });
  }
  return { definition: { ...def, anchors: kept }, lost };
}
