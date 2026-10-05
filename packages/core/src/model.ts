import {
  W_NS,
  childElements,
  createText,
  createW,
  insertAfter,
  isW,
  setText,
  wAttr,
  wChild,
  type XDocument,
  type XElement,
} from './xml';

/**
 * The text model. One function decides what counts as a paragraph and one
 * decides what counts as its text, and the renderer, the template builder
 * and the generator all go through them. That shared definition is what
 * keeps a highlighted range pointing at the same characters everywhere.
 */

export function bodyOf(doc: XDocument): XElement {
  const root = doc.documentElement;
  const body = root && wChild(root, 'body');
  if (!body) throw new Error('The document has no body.');
  return body;
}

/** Containers whose children are block-level content. */
const BLOCK_CONTAINERS = new Set(['body', 'tbl', 'tr', 'tc', 'sdt', 'sdtContent', 'customXml']);

/**
 * Paragraphs in document order, including those inside tables. Paragraphs
 * inside text boxes and drawings are left out: they live inside runs and
 * Word stores them twice.
 */
export function listParagraphs(doc: XDocument): XElement[] {
  const out: XElement[] = [];
  const visit = (el: XElement) => {
    for (const child of childElements(el)) {
      if (isW(child, 'p')) out.push(child);
      else if (child.namespaceURI === W_NS && BLOCK_CONTAINERS.has(child.localName!)) visit(child);
    }
  };
  visit(bodyOf(doc));
  return out;
}

/** Inline wrappers whose runs count as part of the paragraph. */
const INLINE_CONTAINERS = new Set([
  'hyperlink',
  'ins',
  'moveTo',
  'smartTag',
  'sdt',
  'sdtContent',
  'fldSimple',
  'customXml',
  'bdo',
  'dir',
]);

export interface Segment {
  run: XElement;
  /** The `w:t`, `w:tab`, `w:br`, `w:cr` or `w:noBreakHyphen` element. */
  node: XElement;
  start: number;
  text: string;
}

function nodeText(node: XElement): string | null {
  if (node.namespaceURI !== W_NS) return null;
  switch (node.localName) {
    case 't':
      return node.textContent ?? '';
    case 'tab':
      return '\t';
    case 'br':
      // Page and column breaks are layout, not text.
      return wAttr(node, 'type') && wAttr(node, 'type') !== 'textWrapping' ? null : '\n';
    case 'cr':
      return '\n';
    case 'noBreakHyphen':
      return '‑';
    default:
      return null;
  }
}

/** Runs of a paragraph in document order, skipping deleted text. */
export function listRuns(p: XElement): XElement[] {
  const out: XElement[] = [];
  const visit = (el: XElement) => {
    for (const child of childElements(el)) {
      if (isW(child, 'r')) out.push(child);
      else if (child.namespaceURI === W_NS && INLINE_CONTAINERS.has(child.localName!)) visit(child);
    }
  };
  visit(p);
  return out;
}

export function listSegments(p: XElement): Segment[] {
  const out: Segment[] = [];
  let offset = 0;
  for (const run of listRuns(p)) {
    for (const node of childElements(run)) {
      const text = nodeText(node);
      if (text === null || text === '') continue;
      out.push({ run, node, start: offset, text });
      offset += text.length;
    }
  }
  return out;
}

export function paragraphText(p: XElement): string {
  return listSegments(p)
    .map((s) => s.text)
    .join('');
}

/**
 * Makes `offset` fall on a boundary between two runs, splitting a run if it
 * has to. Formatting is copied to both halves.
 */
export function splitAt(p: XElement, offset: number): void {
  if (offset <= 0) return;
  const segments = listSegments(p);
  const seg = segments.find((s) => offset > s.start && offset <= s.start + s.text.length);
  if (!seg) return;
  const within = offset - seg.start;
  const run = seg.run;
  const doc = run.ownerDocument!;

  const tail = run.cloneNode(false) as XElement;
  const rPr = wChild(run, 'rPr');
  if (rPr) tail.appendChild(rPr.cloneNode(true));

  // Everything after the split point moves to the new run.
  const moving: XElement[] = [];
  let after = false;
  for (const child of childElements(run)) {
    if (after) moving.push(child);
    if (child === seg.node) after = true;
  }
  if (within < seg.text.length) {
    // Only w:t can be split mid-node; the other nodes are one character.
    const full = seg.text;
    setText(seg.node, full.slice(0, within));
    tail.appendChild(createText(doc, full.slice(within)));
  } else if (moving.length === 0) {
    return; // Already at the end of the run.
  }
  for (const m of moving) tail.appendChild(m);
  insertAfter(tail, run);
}

/** Runs whose text lies entirely inside [start, end). */
export function runsInRange(p: XElement, start: number, end: number): XElement[] {
  const out: XElement[] = [];
  for (const seg of listSegments(p)) {
    if (seg.start >= start && seg.start + seg.text.length <= end && !out.includes(seg.run)) {
      out.push(seg.run);
    }
  }
  return out;
}

/**
 * Inserts an empty run at `offset`, borrowing the formatting of the text
 * around it. Used for fields placed at a cursor position, not over text.
 */
export function insertEmptyRunAt(p: XElement, offset: number): XElement {
  const doc = p.ownerDocument!;
  const segments = listSegments(p);
  const run = createW(doc, 'r');
  const next = segments.find((s) => s.start >= offset);
  const prev = [...segments].reverse().find((s) => s.start + s.text.length <= offset);
  const model = prev?.run ?? next?.run;
  const rPr = model && wChild(model, 'rPr');
  if (rPr) run.appendChild(rPr.cloneNode(true));
  if (next) next.run.parentNode!.insertBefore(run, next.run);
  else if (prev) insertAfter(run, prev.run);
  else p.appendChild(run);
  return run;
}
