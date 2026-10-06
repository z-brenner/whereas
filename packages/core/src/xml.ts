import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

/**
 * xmldom is used in the browser as well as on the server so that both sides
 * parse and serialize a document identically.
 */
export type XDocument = ReturnType<DOMParser['parseFromString']>;
export type XElement = NonNullable<XDocument['documentElement']>;
export type XNode = XElement['childNodes'][number];

export const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

export function parseXml(text: string): XDocument {
  return new DOMParser({
    onError: (level, message) => {
      if (level === 'fatalError') throw new Error(`Invalid XML: ${message}`);
    },
  }).parseFromString(text, 'text/xml');
}

export function serializeXml(doc: XDocument): string {
  const out = new XMLSerializer().serializeToString(doc);
  return out.startsWith('<?xml')
    ? out
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${out}`;
}

export function isElement(node: unknown): node is XElement {
  return !!node && (node as { nodeType?: number }).nodeType === 1;
}

/** True when the node is a WordprocessingML element with this local name. */
export function isW(node: unknown, name: string): boolean {
  return isElement(node) && node.namespaceURI === W_NS && node.localName === name;
}

export function childElements(el: XElement): XElement[] {
  const out: XElement[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) if (isElement(n)) out.push(n);
  return out;
}

export function wChild(el: XElement, name: string): XElement | null {
  for (let n = el.firstChild; n; n = n.nextSibling) if (isElement(n) && isW(n, name)) return n;
  return null;
}

export function wChildren(el: XElement, name: string): XElement[] {
  return childElements(el).filter((c) => isW(c, name));
}

/** Reads a `w:`-namespaced attribute such as `w:val`. */
export function wAttr(el: XElement | null | undefined, name: string): string | null {
  if (!el) return null;
  const v = el.getAttributeNS(W_NS, name);
  if (v !== null && v !== '') return v;
  return el.getAttribute(`w:${name}`) || null;
}

export function wVal(el: XElement | null | undefined): string | null {
  return wAttr(el, 'val');
}

export function createW(doc: XDocument, name: string): XElement {
  return doc.createElementNS(W_NS, `w:${name}`) as XElement;
}

/** Creates a `w:t` that keeps leading and trailing spaces. */
export function createText(doc: XDocument, text: string): XElement {
  const t = createW(doc, 't');
  t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
  t.appendChild(doc.createTextNode(text));
  return t;
}

export function setText(t: XElement, text: string): void {
  while (t.firstChild) t.removeChild(t.firstChild);
  t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
  t.appendChild(t.ownerDocument!.createTextNode(text));
}

export function remove(node: XNode | XElement): void {
  node.parentNode?.removeChild(node);
}

export function insertAfter(node: XElement, ref: XElement): void {
  ref.parentNode!.insertBefore(node, ref.nextSibling);
}

/** Depth-first walk over elements, in document order. */
export function walk(el: XElement, visit: (el: XElement) => void | false): void {
  if (visit(el) === false) return;
  for (let n = el.firstChild; n; ) {
    const next = n.nextSibling;
    if (isElement(n)) walk(n, visit);
    n = next;
  }
}
