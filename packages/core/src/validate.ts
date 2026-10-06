import { coveredRange } from './blocks';
import type { Docx } from './docx';
import { listParagraphs, paragraphText } from './model';
import { ruleFields } from './rules';
import type { Anchor, TemplateDefinition } from './types';
import { wChild } from './xml';

export interface Problem {
  message: string;
  anchor?: string;
  field?: string;
}

const REPLACES = new Set(['field', 'alternatives', 'signature']);

function isBlock(a: Anchor): boolean {
  return (a.kind === 'conditional' || a.kind === 'repeat') && a.block === true;
}

/**
 * Everything that would make a template produce a wrong or broken document.
 * A template can be saved with problems but not published.
 */
export function validateDefinition(docx: Docx, def: TemplateDefinition): Problem[] {
  const problems: Problem[] = [];
  const paragraphs = listParagraphs(docx.document);
  const texts = paragraphs.map(paragraphText);
  const fields = new Map(def.fields.map((f) => [f.id, f]));
  const groups = new Map(def.groups.map((g) => [g.id, g]));
  const signers = new Set(def.signers.map((s) => s.id));

  const seen = new Set<string>();
  for (const f of def.fields) {
    if (seen.has(f.id)) problems.push({ field: f.id, message: `Two questions share the id "${f.id}".` });
    seen.add(f.id);
    if (!f.label.trim()) problems.push({ field: f.id, message: 'A question has no label.' });
    if ((f.type === 'select' || f.type === 'multiselect') && !(f.options?.length ?? 0)) {
      problems.push({ field: f.id, message: `"${f.label}" needs at least one option.` });
    }
    if (f.group && !groups.has(f.group)) {
      problems.push({ field: f.id, message: `"${f.label}" belongs to a repeating group that no longer exists.` });
    }
    for (const ref of ruleFields(f.visibleWhen)) {
      if (!fields.has(ref)) problems.push({ field: f.id, message: `"${f.label}" depends on a deleted question.` });
      if (ref === f.id) problems.push({ field: f.id, message: `"${f.label}" depends on itself.` });
    }
  }

  const ids = new Set<string>();
  for (const a of def.anchors) {
    // Ids become space-separated tokens while generating, so they must be plain.
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(a.id)) problems.push({ anchor: a.id, message: 'A mark has an invalid id.' });
    if (ids.has(a.id)) problems.push({ anchor: a.id, message: 'Two marks share the same id.' });
    ids.add(a.id);
  }

  const repeats = def.anchors.filter((a) => a.kind === 'repeat');
  const blockSpan = new Map<string, { start: number; end: number }>();

  for (const a of def.anchors) {
    const { start, end } = a.range;
    if (!paragraphs[start.p] || !paragraphs[end.p]) {
      problems.push({ anchor: a.id, message: `"${a.range.quote}" points outside the document.` });
      continue;
    }
    if (isBlock(a)) {
      try {
        const rows = (a as { rows?: boolean }).rows;
        const covered = coveredRange(paragraphs, start.p, end.p, rows);
        if (covered.start !== start.p || covered.end !== end.p) {
          problems.push({ anchor: a.id, message: 'A block must cover whole paragraphs or whole table rows.' });
        }
        blockSpan.set(a.id, covered);
        if (a.kind === 'repeat') {
          for (let i = covered.start; i <= covered.end; i++) {
            const pPr = wChild(paragraphs[i]!, 'pPr');
            if (pPr && wChild(pPr, 'sectPr')) {
              problems.push({ anchor: a.id, message: 'A repeating block cannot include a section break.' });
              break;
            }
          }
        }
      } catch (e) {
        problems.push({ anchor: a.id, message: (e as Error).message });
      }
    } else {
      if (start.p !== end.p) {
        problems.push({ anchor: a.id, message: `"${a.range.quote}" spans more than one paragraph.` });
        continue;
      }
      if (start.o < 0 || end.o < start.o || end.o > texts[start.p]!.length) {
        problems.push({ anchor: a.id, message: 'A mark points outside its paragraph.' });
        continue;
      }
      if (texts[start.p]!.slice(start.o, end.o) !== a.range.quote) {
        problems.push({ anchor: a.id, message: `"${a.range.quote}" no longer matches the document text.` });
      }
    }

    if (a.kind === 'field' || a.kind === 'alternatives') {
      const f = fields.get(a.field);
      if (!f) problems.push({ anchor: a.id, message: `"${a.range.quote}" is linked to a deleted question.` });
      else if (f.group) {
        const home = repeats.find((r) => r.group === f.group);
        const inside = home && start.p >= home.range.start.p && end.p <= home.range.end.p;
        if (!inside) {
          problems.push({
            anchor: a.id,
            message: `"${f.label}" repeats, so it can only be placed inside its repeating block.`,
          });
        }
      }
    }
    if (a.kind === 'signature' && !signers.has(a.signer)) {
      problems.push({ anchor: a.id, message: 'A signature block is linked to a deleted signer.' });
    }
    if (a.kind === 'repeat' && !groups.has(a.group)) {
      problems.push({ anchor: a.id, message: 'A repeating block is linked to a deleted group.' });
    }
    if (a.kind === 'conditional') {
      if (ruleFields(a.when).length === 0) {
        problems.push({ anchor: a.id, message: `The condition on "${a.range.quote}" has no rule yet.` });
      }
      for (const ref of ruleFields(a.when)) {
        if (!fields.has(ref)) problems.push({ anchor: a.id, message: 'A condition depends on a deleted question.' });
      }
    }
  }

  // Inline anchors in one paragraph may nest but may not partially overlap,
  // and two replacements may not touch the same text at all.
  const inline = def.anchors.filter((a) => !isBlock(a) && a.range.start.p === a.range.end.p);
  for (let i = 0; i < inline.length; i++) {
    for (let j = i + 1; j < inline.length; j++) {
      const a = inline[i]!;
      const b = inline[j]!;
      if (a.range.start.p !== b.range.start.p) continue;
      const [as, ae, bs, be] = [a.range.start.o, a.range.end.o, b.range.start.o, b.range.end.o];
      const overlap = as < be && bs < ae;
      if (!overlap) continue;
      const nested = (as <= bs && be <= ae) || (bs <= as && ae <= be);
      if (!nested || (REPLACES.has(a.kind) && REPLACES.has(b.kind))) {
        problems.push({ anchor: b.id, message: `"${a.range.quote}" and "${b.range.quote}" overlap.` });
      }
    }
  }

  for (let i = 0; i < repeats.length; i++) {
    for (let j = i + 1; j < repeats.length; j++) {
      const a = blockSpan.get(repeats[i]!.id);
      const b = blockSpan.get(repeats[j]!.id);
      if (a && b && a.start <= b.end && b.start <= a.end) {
        problems.push({ anchor: repeats[j]!.id, message: 'Repeating blocks cannot overlap or nest.' });
      }
    }
  }
  // A conditional block sits wholly inside a repeat, or wholly outside it.
  for (const c of def.anchors) {
    if (c.kind !== 'conditional' || !c.block) continue;
    const cs = blockSpan.get(c.id);
    for (const r of repeats) {
      const rs = blockSpan.get(r.id);
      if (!cs || !rs || cs.end < rs.start || rs.end < cs.start) continue;
      const inside = rs.start <= cs.start && cs.end <= rs.end;
      const around = cs.start <= rs.start && rs.end <= cs.end;
      if (!inside && !around) {
        problems.push({ anchor: c.id, message: 'A conditional block cannot straddle the edge of a repeating block.' });
      }
    }
  }
  for (const g of def.groups) {
    if (!repeats.some((r) => r.group === g.id)) {
      problems.push({ message: `The repeating group "${g.label}" is not placed in the document.` });
    }
  }

  return problems;
}
