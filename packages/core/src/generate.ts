import { blockUnits, removeUnit } from './blocks';
import { cloneDocx, readDocx, writeDocx, type Docx } from './docx';
import { formatAnswer } from './format';
import { insertEmptyRunAt, listParagraphs, paragraphText, runsInRange, splitAt } from './model';
import { effectiveAnswers, evaluate, isItemList, lookupFor, missingAnswers, type Lookup, type MissingAnswer } from './rules';
import type {
  Anchor,
  Answers,
  ItemAnswers,
  SignaturePart,
  SignerRole,
  TemplateDefinition,
} from './types';
import { W_NS, childElements, createText, createW, isW, remove, walk, wChild, type XDocument, type XElement } from './xml';

/** Working attributes. They never reach a finished document. */
export const ATTR = {
  tags: 'wa-tags',
  block: 'wa-block',
  scope: 'wa-scope',
  /** Preview only: the anchor a piece of inserted text came from. */
  fill: 'wa-fill',
  kind: 'wa-kind',
  empty: 'wa-empty',
} as const;

export interface SignatureTag {
  text: string;
  /** Hidden tags are set in white so the signer never sees them. */
  hidden?: boolean;
}

export interface GenerateOptions {
  /**
   * `preview` keeps markers for the on-screen renderer and shows a labelled
   * placeholder for anything unanswered. `final` produces a clean document
   * and refuses to run while required answers are missing.
   */
  mode: 'preview' | 'final';
  signatureTag?: (signer: SignerRole, part: SignaturePart) => SignatureTag;
}

export class MissingAnswersError extends Error {
  constructor(public missing: MissingAnswer[]) {
    super(`Required answers are missing: ${missing.map((m) => m.label).join(', ')}`);
  }
}

export class TemplateDriftError extends Error {}

const AFTER_COLOR = new Set([
  'spacing', 'w', 'kern', 'position', 'sz', 'szCs', 'highlight', 'u', 'effect', 'bdr', 'shd',
  'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath',
]);

const SIGNATURE_LINE: Record<SignaturePart, string> = {
  signature: '______________________________',
  initials: '________',
  date: '________________',
};

function addToken(el: XElement, attr: string, token: string): void {
  const current = el.getAttribute(attr);
  el.setAttribute(attr, current ? `${current} ${token}` : token);
}

function hasToken(el: XElement, attr: string, token: string): boolean {
  const v = el.getAttribute(attr);
  return !!v && v.split(' ').includes(token);
}

function findWithToken(root: XElement, attr: string, token: string): XElement[] {
  const out: XElement[] = [];
  walk(root, (el) => {
    if (hasToken(el, attr, token)) out.push(el);
  });
  return out;
}

/** Stage one: turn every range into tags on the runs and blocks it covers. */
function materialize(doc: XDocument, def: TemplateDefinition): void {
  const paragraphs = listParagraphs(doc);
  const inline = def.anchors.filter((a) => !isBlock(a));

  const cuts = new Map<number, Set<number>>();
  for (const a of inline) {
    const p = paragraphs[a.range.start.p];
    if (!p || a.range.start.p !== a.range.end.p) {
      throw new TemplateDriftError(`"${a.range.quote}" no longer matches the document.`);
    }
    const text = paragraphText(p);
    if (text.slice(a.range.start.o, a.range.end.o) !== a.range.quote) {
      throw new TemplateDriftError(`"${a.range.quote}" no longer matches the document.`);
    }
    const set = cuts.get(a.range.start.p) ?? new Set<number>();
    set.add(a.range.start.o).add(a.range.end.o);
    cuts.set(a.range.start.p, set);
  }
  // Split from the end of each paragraph so earlier offsets stay valid.
  for (const [index, offsets] of cuts) {
    for (const o of [...offsets].sort((x, y) => y - x)) splitAt(paragraphs[index]!, o);
  }
  for (const a of inline) {
    const p = paragraphs[a.range.start.p]!;
    const { o: start } = a.range.start;
    const { o: end } = a.range.end;
    const runs = start === end ? [insertEmptyRunAt(p, start)] : runsInRange(p, start, end);
    for (const run of runs) addToken(run, ATTR.tags, a.id);
  }
  for (const a of def.anchors) {
    if (!isBlock(a)) continue;
    const units = blockUnits(paragraphs, a.range.start.p, a.range.end.p, a.rows);
    for (const unit of units) addToken(unit, ATTR.block, a.id);
  }
}

function isBlock(a: Anchor): a is Extract<Anchor, { block: boolean }> & { block: true } {
  return (a.kind === 'conditional' || a.kind === 'repeat') && a.block === true;
}

/** The repeat entry an element sits in, if any. */
function scopeOf(el: XElement, answers: Answers): ItemAnswers | undefined {
  for (let n: XElement | null = el; n && n.nodeType === 1; n = n.parentNode as XElement | null) {
    const scope = n.getAttribute(ATTR.scope);
    if (scope) {
      const cut = scope.lastIndexOf(':');
      const list = answers[scope.slice(0, cut)];
      return isItemList(list) ? (list[Number(scope.slice(cut + 1))] ?? {}) : {};
    }
  }
  return undefined;
}

function lookupAt(el: XElement, answers: Answers): Lookup {
  return lookupFor(answers, scopeOf(el, answers));
}

function expandRepeats(root: XElement, def: TemplateDefinition, answers: Answers, preview: boolean): void {
  for (const a of def.anchors) {
    if (a.kind !== 'repeat') continue;
    const units = findWithToken(root, ATTR.block, a.id);
    const first = units[0];
    if (!first) continue;
    const list = answers[a.group];
    let count = isItemList(list) ? list.length : 0;
    // An empty preview still shows the block once so its fields are visible.
    if (count === 0 && preview) count = 1;
    if (count === 0) {
      for (const u of units) removeUnit(u);
      continue;
    }
    const parent = first.parentNode!;
    for (let i = 0; i < count; i++) {
      for (const u of units) {
        const copy = u.cloneNode(true) as XElement;
        copy.setAttribute(ATTR.scope, `${a.group}:${i}`);
        parent.insertBefore(copy, first);
      }
    }
    for (const u of units) remove(u);
  }
}

function applyConditionals(root: XElement, def: TemplateDefinition, answers: Answers): void {
  for (const a of def.anchors) {
    if (a.kind !== 'conditional') continue;
    if (a.block) {
      for (const unit of findWithToken(root, ATTR.block, a.id)) {
        if (!evaluate(a.when, lookupAt(unit, answers))) removeUnit(unit);
      }
    } else {
      for (const run of findWithToken(root, ATTR.tags, a.id)) {
        if (!evaluate(a.when, lookupAt(run, answers))) remove(run);
      }
    }
  }
}

function paragraphOf(run: XElement): XElement | null {
  for (let n = run.parentNode as XElement | null; n && n.nodeType === 1; n = n.parentNode as XElement | null) {
    if (isW(n, 'p')) return n;
  }
  return null;
}

interface Replacement {
  text: string;
  empty?: boolean;
  hidden?: boolean;
}

function buildRun(model: XElement, anchor: Anchor, r: Replacement, preview: boolean): XElement {
  const doc = model.ownerDocument!;
  const run = createW(doc, 'r');
  const rPr = wChild(model, 'rPr')?.cloneNode(true) as XElement | undefined;
  const props = rPr ?? createW(doc, 'rPr');
  // Placeholders are often highlighted in the template; the answer is not.
  for (const name of ['highlight', 'shd']) {
    const el = wChild(props, name);
    if (el) remove(el);
  }
  if (r.hidden && !preview) {
    const existing = wChild(props, 'color');
    if (existing) remove(existing);
    const color = createW(doc, 'color');
    color.setAttributeNS(W_NS, 'w:val', 'FFFFFF');
    // Word expects run properties in schema order.
    const after = childElements(props).find((c) => AFTER_COLOR.has(c.localName!));
    props.insertBefore(color, after ?? null);
  }
  if (props.firstChild) run.appendChild(props);

  const lines = r.text.split('\n');
  lines.forEach((line, i) => {
    if (i > 0) run.appendChild(createW(doc, 'br'));
    line.split('\t').forEach((piece, j) => {
      if (j > 0) run.appendChild(createW(doc, 'tab'));
      if (piece !== '') run.appendChild(createText(doc, piece));
    });
  });

  if (preview) {
    run.setAttribute(ATTR.fill, anchor.id);
    run.setAttribute(ATTR.kind, anchor.kind);
    if (r.empty) run.setAttribute(ATTR.empty, '1');
  }
  return run;
}

function applyReplacements(root: XElement, def: TemplateDefinition, answers: Answers, opts: GenerateOptions): void {
  const preview = opts.mode === 'preview';
  const fields = new Map(def.fields.map((f) => [f.id, f]));
  const signers = new Map(def.signers.map((s) => [s.id, s]));

  for (const a of def.anchors) {
    if (a.kind === 'conditional' || a.kind === 'repeat') continue;
    const runs = findWithToken(root, ATTR.tags, a.id);
    // After a repeat the same anchor appears once per entry.
    const groups = new Map<XElement, XElement[]>();
    for (const run of runs) {
      const p = paragraphOf(run);
      if (!p) continue;
      groups.set(p, [...(groups.get(p) ?? []), run]);
    }
    for (const group of groups.values()) {
      const first = group[0]!;
      const get = lookupAt(first, answers);
      let r: Replacement;
      if (a.kind === 'field') {
        const field = fields.get(a.field);
        const text = field ? formatAnswer(field, get(a.field), a) : '';
        r = text === '' && preview ? { text: `[${field?.label ?? a.range.quote}]`, empty: true } : { text };
      } else if (a.kind === 'alternatives') {
        const value = get(a.field);
        const key = Array.isArray(value) ? (value[0] ?? '') : String(value ?? '');
        const text = a.variants[key] ?? a.otherwise ?? '';
        const unanswered = value === undefined || value === null || value === '';
        r = unanswered && preview ? { text: `[${fields.get(a.field)?.label ?? 'Choose wording'}]`, empty: true } : { text };
      } else {
        const signer = signers.get(a.signer);
        if (preview || !signer) {
          r = { text: `[${signer?.label ?? 'Signer'}: ${a.part}]`, empty: true };
        } else {
          r = opts.signatureTag?.(signer, a.part) ?? { text: SIGNATURE_LINE[a.part] };
        }
      }
      first.parentNode!.insertBefore(buildRun(first, a, r, preview), first);
      for (const run of group) remove(run);
    }
  }
}

export function stripMarkers(doc: XDocument): void {
  const root = doc.documentElement;
  if (!root) return;
  walk(root, (el) => {
    for (const name of Object.values(ATTR)) if (el.hasAttribute(name)) el.removeAttribute(name);
  });
}

/**
 * Applies a definition and answers to a parsed document, in place.
 * In preview mode the working markers are left for the renderer.
 */
export function applyDefinition(docx: Docx, def: TemplateDefinition, given: Answers, opts: GenerateOptions): void {
  const answers = effectiveAnswers(def, given);
  if (opts.mode === 'final') {
    const missing = missingAnswers(def, answers);
    if (missing.length) throw new MissingAnswersError(missing);
  }
  const root = docx.document.documentElement!;
  materialize(docx.document, def);
  expandRepeats(root, def, answers, opts.mode === 'preview');
  applyConditionals(root, def, answers);
  applyReplacements(root, def, answers, opts);
  if (opts.mode === 'final') stripMarkers(docx.document);
}

/** A filled copy for on-screen preview. The source is not modified. */
export function previewDocx(source: Docx, def: TemplateDefinition, answers: Answers): Docx {
  const copy = cloneDocx(source);
  applyDefinition(copy, def, answers, { mode: 'preview' });
  return copy;
}

/** The finished agreement as DOCX bytes. */
export function generateDocx(
  template: Uint8Array,
  def: TemplateDefinition,
  answers: Answers,
  opts: Omit<GenerateOptions, 'mode'> = {},
): Uint8Array {
  const docx = readDocx(template);
  applyDefinition(docx, def, answers, { ...opts, mode: 'final' });
  return writeDocx(docx);
}
