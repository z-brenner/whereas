import { readPart, type Docx } from './docx';
import { childElements, isW, wAttr, wChild, wVal, type XElement } from './xml';

export interface RunProps {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  caps?: boolean;
  smallCaps?: boolean;
  /** Hex colour without the leading #. */
  color?: string;
  /** Font size in points. */
  size?: number;
  font?: string;
  highlight?: string;
  vertAlign?: 'superscript' | 'subscript';
}

export interface ParaProps {
  align?: 'left' | 'center' | 'right' | 'justify';
  /** Indents and spacing are in points. */
  indentLeft?: number;
  indentRight?: number;
  hanging?: number;
  firstLine?: number;
  spaceBefore?: number;
  spaceAfter?: number;
  /** Line height as a multiple of the font size. */
  lineHeight?: number;
  numId?: string;
  ilvl?: number;
  outlineLevel?: number;
  pageBreakBefore?: boolean;
  styleId?: string;
}

const pt = (twips: string | null): number | undefined => {
  if (twips === null) return undefined;
  const n = Number(twips);
  return Number.isFinite(n) ? n / 20 : undefined;
};

function toggle(rPr: XElement, name: string): boolean | undefined {
  const el = wChild(rPr, name);
  if (!el) return undefined;
  const v = wVal(el);
  return !(v === '0' || v === 'false' || v === 'off');
}

function define<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

export function readRunProps(rPr: XElement | null): RunProps {
  if (!rPr) return {};
  const u = wChild(rPr, 'u');
  const color = wVal(wChild(rPr, 'color'));
  const sz = wVal(wChild(rPr, 'sz'));
  const fonts = wChild(rPr, 'rFonts');
  const va = wVal(wChild(rPr, 'vertAlign'));
  const hl = wVal(wChild(rPr, 'highlight'));
  return define<RunProps>({
    bold: toggle(rPr, 'b'),
    italic: toggle(rPr, 'i'),
    strike: toggle(rPr, 'strike'),
    caps: toggle(rPr, 'caps'),
    smallCaps: toggle(rPr, 'smallCaps'),
    underline: u ? wVal(u) !== 'none' : undefined,
    color: color && color !== 'auto' ? color : undefined,
    size: sz ? Number(sz) / 2 : undefined,
    font: (fonts && (wAttr(fonts, 'ascii') ?? wAttr(fonts, 'hAnsi'))) ?? undefined,
    highlight: hl && hl !== 'none' ? hl : undefined,
    vertAlign: va === 'superscript' || va === 'subscript' ? va : undefined,
  });
}

export function readParaProps(pPr: XElement | null): ParaProps {
  if (!pPr) return {};
  const jc = wVal(wChild(pPr, 'jc'));
  const ind = wChild(pPr, 'ind');
  const spacing = wChild(pPr, 'spacing');
  const numPr = wChild(pPr, 'numPr');
  const outline = wVal(wChild(pPr, 'outlineLvl'));
  const pbb = wChild(pPr, 'pageBreakBefore');
  const align =
    jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : jc === 'both' || jc === 'distribute' ? 'justify' : jc ? 'left' : undefined;
  let lineHeight: number | undefined;
  if (spacing && wAttr(spacing, 'line') && (wAttr(spacing, 'lineRule') ?? 'auto') === 'auto') {
    lineHeight = Number(wAttr(spacing, 'line')) / 240;
  }
  const ilvl = numPr ? wVal(wChild(numPr, 'ilvl')) : null;
  return define<ParaProps>({
    align,
    indentLeft: ind ? pt(wAttr(ind, 'left') ?? wAttr(ind, 'start')) : undefined,
    indentRight: ind ? pt(wAttr(ind, 'right') ?? wAttr(ind, 'end')) : undefined,
    hanging: ind ? pt(wAttr(ind, 'hanging')) : undefined,
    firstLine: ind ? pt(wAttr(ind, 'firstLine')) : undefined,
    spaceBefore: spacing ? pt(wAttr(spacing, 'before')) : undefined,
    spaceAfter: spacing ? pt(wAttr(spacing, 'after')) : undefined,
    lineHeight,
    numId: numPr ? (wVal(wChild(numPr, 'numId')) ?? undefined) : undefined,
    ilvl: ilvl !== null ? Number(ilvl) : undefined,
    outlineLevel: outline !== null ? Number(outline) : undefined,
    pageBreakBefore: pbb ? wVal(pbb) !== '0' && wVal(pbb) !== 'false' : undefined,
    styleId: wVal(wChild(pPr, 'pStyle')) ?? undefined,
  });
}

interface Style {
  id: string;
  name: string;
  type: string;
  basedOn?: string;
  para: ParaProps;
  run: RunProps;
  hasTableBorders: boolean;
}

export class Styles {
  private byId = new Map<string, Style>();
  private defaultPara?: string;
  readonly docRun: RunProps = {};
  readonly docPara: ParaProps = {};

  constructor(docx: Docx) {
    const part = readPart(docx, 'word/styles.xml');
    const root = part?.documentElement;
    if (!root) return;
    const defaults = wChild(root, 'docDefaults');
    if (defaults) {
      const r = wChild(defaults, 'rPrDefault');
      const p = wChild(defaults, 'pPrDefault');
      this.docRun = readRunProps(r && wChild(r, 'rPr'));
      this.docPara = readParaProps(p && wChild(p, 'pPr'));
    }
    for (const el of childElements(root)) {
      if (!isW(el, 'style')) continue;
      const id = wAttr(el, 'styleId');
      if (!id) continue;
      const type = wAttr(el, 'type') ?? 'paragraph';
      const tblPr = wChild(el, 'tblPr');
      this.byId.set(id, {
        id,
        type,
        name: wVal(wChild(el, 'name')) ?? id,
        basedOn: wVal(wChild(el, 'basedOn')) ?? undefined,
        para: readParaProps(wChild(el, 'pPr')),
        run: readRunProps(wChild(el, 'rPr')),
        hasTableBorders: !!(tblPr && wChild(tblPr, 'tblBorders')),
      });
      const isDefault = wAttr(el, 'default');
      if (type === 'paragraph' && (isDefault === '1' || isDefault === 'true')) this.defaultPara = id;
    }
  }

  private chain(id: string | undefined): Style[] {
    const out: Style[] = [];
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      seen.add(id);
      const s = this.byId.get(id);
      if (!s) break;
      out.unshift(s);
      id = s.basedOn;
    }
    return out;
  }

  /** Paragraph and run formatting a paragraph inherits from its style. */
  paragraph(styleId: string | undefined): { para: ParaProps; run: RunProps; name: string } {
    const chain = this.chain(styleId ?? this.defaultPara);
    const para: ParaProps = { ...this.docPara };
    const run: RunProps = { ...this.docRun };
    for (const s of chain) {
      Object.assign(para, s.para);
      Object.assign(run, s.run);
    }
    return { para, run, name: chain[chain.length - 1]?.name ?? '' };
  }

  character(styleId: string | undefined): RunProps {
    const run: RunProps = {};
    for (const s of this.chain(styleId)) Object.assign(run, s.run);
    return run;
  }

  tableHasBorders(styleId: string | undefined): boolean {
    return this.chain(styleId).some((s) => s.hasTableBorders);
  }
}
