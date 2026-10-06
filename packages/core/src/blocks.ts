import { childElements, createW, isW, remove, wChild, type XElement } from './xml';

/**
 * Block anchors cover whole paragraphs or whole table rows. "Units" are the
 * sibling elements that a block range stands for.
 */

function ancestors(el: XElement): XElement[] {
  const out: XElement[] = [];
  for (let n: XElement | null = el; n; n = n.parentNode as XElement | null) {
    if (n.nodeType !== 1) break;
    out.push(n);
    if (isW(n, 'body')) break;
  }
  return out;
}

function rowOf(p: XElement): XElement | null {
  return ancestors(p).find((a) => isW(a, 'tr')) ?? null;
}

function siblingsBetween(a: XElement, b: XElement): XElement[] {
  const out: XElement[] = [];
  let inside = false;
  for (const child of childElements(a.parentNode as XElement)) {
    if (child === a) inside = true;
    if (inside) out.push(child);
    if (child === b) break;
  }
  return out;
}

export function blockUnits(paragraphs: XElement[], pStart: number, pEnd: number, rows = false): XElement[] {
  const a = paragraphs[pStart];
  const b = paragraphs[pEnd];
  if (!a || !b || pEnd < pStart) throw new Error('The selection is outside the document.');
  if (rows) {
    const ra = rowOf(a);
    const rb = rowOf(b);
    if (!ra || !rb || ra.parentNode !== rb.parentNode) {
      throw new Error('The selection must stay inside one table.');
    }
    return siblingsBetween(ra, rb);
  }
  if (a === b) return [a];
  const chainA = ancestors(a);
  const chainB = ancestors(b);
  const lca = chainA.find((x) => chainB.includes(x));
  if (!lca) throw new Error('The selection is outside the document.');
  // Different cells of one row: the unit is the row itself.
  if (isW(lca, 'tr')) return [lca];
  const childA = chainA[chainA.indexOf(lca) - 1]!;
  const childB = chainB[chainB.indexOf(lca) - 1]!;
  return siblingsBetween(childA, childB);
}

function contains(units: XElement[], p: XElement): boolean {
  for (let n: XElement | null = p; n && n.nodeType === 1; n = n.parentNode as XElement | null) {
    if (units.includes(n)) return true;
  }
  return false;
}

/** The first and last paragraph index a block range really covers. */
export function coveredRange(
  paragraphs: XElement[],
  pStart: number,
  pEnd: number,
  rows = false,
): { start: number; end: number } {
  const units = blockUnits(paragraphs, pStart, pEnd, rows);
  let start = pStart;
  let end = pEnd;
  while (start > 0 && contains(units, paragraphs[start - 1]!)) start--;
  while (end < paragraphs.length - 1 && contains(units, paragraphs[end + 1]!)) end++;
  return { start, end };
}

export function isInTable(paragraphs: XElement[], p: number): boolean {
  const el = paragraphs[p];
  return !!el && !!rowOf(el);
}

function ensureCellEndsWithParagraph(cell: XElement): void {
  const kids = childElements(cell).filter((k) => !isW(k, 'tcPr'));
  const last = kids[kids.length - 1];
  if (!last || !isW(last, 'p')) cell.appendChild(createW(cell.ownerDocument!, 'p'));
}

/** Removes a unit while keeping the document valid for Word. */
export function removeUnit(el: XElement): void {
  const parent = el.parentNode as XElement | null;
  if (!parent) return;
  if (isW(el, 'p')) {
    const pPr = wChild(el, 'pPr');
    if (pPr && wChild(pPr, 'sectPr')) {
      // This paragraph carries a section break; empty it and keep the break.
      for (const child of childElements(el)) if (child !== pPr) remove(child);
      return;
    }
    remove(el);
    if (isW(parent, 'tc')) ensureCellEndsWithParagraph(parent);
    return;
  }
  if (isW(el, 'tr')) {
    remove(el);
    if (!childElements(parent).some((c) => isW(c, 'tr'))) removeUnit(parent);
    return;
  }
  remove(el);
  if (isW(parent, 'tc')) ensureCellEndsWithParagraph(parent);
}
