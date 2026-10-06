import type { Docx } from './docx';
import { ATTR } from './generate';
import { bodyOf, listParagraphs, listSegments } from './model';
import { Numbering } from './numbering';
import { Styles, readParaProps, readRunProps, type ParaProps, type RunProps } from './styles';
import { childElements, isW, wAttr, wChild, wVal, type XElement } from './xml';

/**
 * A plain-data picture of the document for the browser to draw. Every span
 * carries its paragraph offset, so a text selection on screen maps back to
 * the exact characters in the DOCX.
 */
export interface RenderSpan {
  text: string;
  /** Offset of the first character inside the paragraph. */
  start: number;
  props: RunProps;
  /** Preview only: the anchor that produced this text. */
  fill?: string;
  fillKind?: string;
  empty?: boolean;
}

export interface RenderParagraph {
  type: 'p';
  index: number;
  spans: RenderSpan[];
  text: string;
  props: ParaProps;
  label?: { text: string; props: RunProps };
  heading?: number;
  pageBreakAfter?: boolean;
}

export interface RenderCell {
  blocks: RenderBlock[];
  colSpan: number;
  rowSpan: number;
  /** Width in points, when the document sets one. */
  width?: number;
  shade?: string;
}

export interface RenderTable {
  type: 'table';
  rows: { cells: RenderCell[] }[];
  bordered: boolean;
}

export type RenderBlock = RenderParagraph | RenderTable;

export interface RenderDoc {
  blocks: RenderBlock[];
  /** Page geometry in points. */
  page: { width: number; marginLeft: number; marginRight: number; marginTop: number; marginBottom: number };
  paragraphCount: number;
}

const twips = (v: string | null, fallback: number): number => {
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) ? n / 20 : fallback;
};

export function renderDocx(docx: Docx): RenderDoc {
  const styles = new Styles(docx);
  const numbering = new Numbering(docx);
  const body = bodyOf(docx.document);
  const indexOf = new Map<XElement, number>();
  listParagraphs(docx.document).forEach((p, i) => indexOf.set(p, i));

  const paragraph = (p: XElement): RenderParagraph => {
    const direct = readParaProps(wChild(p, 'pPr'));
    const style = styles.paragraph(direct.styleId);
    const numId = direct.numId ?? style.para.numId;
    const ilvl = direct.ilvl ?? (direct.numId ? undefined : style.para.ilvl);
    const label = numbering.next(numId, ilvl, direct.styleId);
    const props: ParaProps = { ...style.para, ...(label?.para ?? {}), ...direct };

    const spans: RenderSpan[] = [];
    let pageBreakAfter = false;
    let lastRun: XElement | null = null;
    for (const seg of listSegments(p)) {
      if (seg.run === lastRun) {
        spans[spans.length - 1]!.text += seg.text;
        continue;
      }
      lastRun = seg.run;
      const rPr = wChild(seg.run, 'rPr');
      const charStyle = rPr ? wVal(wChild(rPr, 'rStyle')) : null;
      const span: RenderSpan = {
        text: seg.text,
        start: seg.start,
        props: { ...style.run, ...styles.character(charStyle ?? undefined), ...readRunProps(rPr) },
      };
      const fill = seg.run.getAttribute(ATTR.fill);
      if (fill) {
        span.fill = fill;
        span.fillKind = seg.run.getAttribute(ATTR.kind) ?? undefined;
        if (seg.run.getAttribute(ATTR.empty)) span.empty = true;
      }
      spans.push(span);
    }
    for (const br of Array.from(p.getElementsByTagNameNS(p.namespaceURI!, 'br'))) {
      if (wAttr(br as XElement, 'type') === 'page') pageBreakAfter = true;
    }

    const headingMatch = /^heading (\d)/i.exec(style.name);
    const heading = headingMatch
      ? Number(headingMatch[1])
      : props.outlineLevel !== undefined && props.outlineLevel < 9
        ? props.outlineLevel + 1
        : /^title$/i.test(style.name)
          ? 1
          : undefined;

    return {
      type: 'p',
      index: indexOf.get(p) ?? -1,
      spans,
      text: spans.map((s) => s.text).join(''),
      props,
      label: label ? { text: label.text, props: { ...style.run, ...label.run } } : undefined,
      heading,
      pageBreakAfter: pageBreakAfter || undefined,
    };
  };

  const table = (tbl: XElement): RenderTable => {
    const tblPr = wChild(tbl, 'tblPr');
    const borders = tblPr && wChild(tblPr, 'tblBorders');
    const ownBorders =
      !!borders && childElements(borders).some((b) => !['none', 'nil'].includes(wVal(b) ?? 'none'));
    const bordered = ownBorders || (!borders && styles.tableHasBorders(wVal(tblPr && wChild(tblPr, 'tblStyle')) ?? undefined));

    const trs = childElements(tbl).filter((c) => isW(c, 'tr'));
    // First pass: lay cells on the grid so vertical merges can be counted.
    const grid: { cell: RenderCell; col: number; merge: string | null }[][] = trs.map((tr) => {
      let col = 0;
      return childElements(tr)
        .filter((c) => isW(c, 'tc'))
        .map((tc) => {
          const tcPr = wChild(tc, 'tcPr');
          const span = Number(wVal(tcPr && wChild(tcPr, 'gridSpan')) ?? 1) || 1;
          const vMerge = tcPr && wChild(tcPr, 'vMerge');
          const w = tcPr && wChild(tcPr, 'tcW');
          const shade = wAttr(tcPr && wChild(tcPr, 'shd'), 'fill');
          const entry = {
            col,
            merge: vMerge ? (wVal(vMerge) ?? 'continue') : null,
            cell: {
              blocks: blocks(tc),
              colSpan: span,
              rowSpan: 1,
              width: w && wAttr(w, 'type') !== 'pct' && wAttr(w, 'type') !== 'auto' ? twips(wAttr(w, 'w'), 0) || undefined : undefined,
              shade: shade && shade !== 'auto' ? shade : undefined,
            } as RenderCell,
          };
          col += span;
          return entry;
        });
    });
    const rows = grid.map((row, r) => ({
      cells: row
        .filter((entry) => entry.merge !== 'continue')
        .map((entry) => {
          if (entry.merge === 'restart') {
            for (let below = r + 1; below < grid.length; below++) {
              const under = grid[below]!.find((e) => e.col === entry.col);
              if (under?.merge !== 'continue') break;
              entry.cell.rowSpan++;
            }
          }
          return entry.cell;
        }),
    }));
    return { type: 'table', rows, bordered };
  };

  function blocks(container: XElement): RenderBlock[] {
    const out: RenderBlock[] = [];
    for (const child of childElements(container)) {
      if (isW(child, 'p')) out.push(paragraph(child));
      else if (isW(child, 'tbl')) out.push(table(child));
      else if (isW(child, 'sdt') || isW(child, 'sdtContent') || isW(child, 'customXml')) out.push(...blocks(child));
    }
    return out;
  }

  let sect = wChild(body, 'sectPr');
  if (!sect) {
    // Fall back to the last section break stored inside a paragraph.
    for (const p of listParagraphs(docx.document)) {
      const pPr = wChild(p, 'pPr');
      const s = pPr && wChild(pPr, 'sectPr');
      if (s) sect = s;
    }
  }
  const size = sect && wChild(sect, 'pgSz');
  const mar = sect && wChild(sect, 'pgMar');

  return {
    blocks: blocks(body),
    page: {
      width: twips(wAttr(size, 'w'), 612),
      marginLeft: twips(wAttr(mar, 'left'), 72),
      marginRight: twips(wAttr(mar, 'right'), 72),
      marginTop: twips(wAttr(mar, 'top'), 72),
      marginBottom: twips(wAttr(mar, 'bottom'), 72),
    },
    paragraphCount: indexOf.size,
  };
}
