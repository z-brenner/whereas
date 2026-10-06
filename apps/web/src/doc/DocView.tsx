import type { Anchor, Pos, RenderBlock, RenderDoc, RenderParagraph, RenderSpan, RenderTable, RunProps } from '@whereas/core';
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cx } from '../ui';

export interface DocSelection {
  start: Pos;
  end: Pos;
  /** Selected text when the selection stays inside one paragraph. */
  text: string;
  /** True when the selection covers whole paragraphs. */
  whole: boolean;
  rect: DOMRect;
}

interface Props {
  doc: RenderDoc;
  /** Builder: the template's anchors, drawn as highlighter marks. */
  anchors?: Anchor[];
  selectedId?: string | null;
  blockLabel?: (anchor: Anchor) => string;
  onAnchorClick?: (id: string) => void;
  onSelect?: (selection: DocSelection | null) => void;
  /** Preview: called when filled-in text is clicked. */
  onFillClick?: (anchorId: string) => void;
}

const PT = 96 / 72;

function runStyle(p: RunProps): CSSProperties {
  const deco = [p.underline && 'underline', p.strike && 'line-through'].filter(Boolean).join(' ');
  return {
    fontWeight: p.bold ? 700 : undefined,
    fontStyle: p.italic ? 'italic' : undefined,
    textDecoration: deco || undefined,
    textTransform: p.caps ? 'uppercase' : undefined,
    fontVariant: p.smallCaps ? 'small-caps' : undefined,
    color: p.color ? `#${p.color}` : undefined,
    fontSize: p.size ? `${p.size}pt` : undefined,
    fontFamily: p.font ? `"${p.font}", "Times New Roman", serif` : undefined,
    verticalAlign: p.vertAlign === 'superscript' ? 'super' : p.vertAlign === 'subscript' ? 'sub' : undefined,
  };
}

const isBlock = (a: Anchor): boolean => (a.kind === 'conditional' || a.kind === 'repeat') && a.block === true;

interface Piece {
  text: string;
  start: number;
  span: RenderSpan;
  covering: Anchor[];
}

/** Cuts a paragraph's spans wherever an anchor starts or ends. */
function pieces(p: RenderParagraph, inline: Anchor[]): Piece[] {
  const cuts = new Set<number>();
  for (const a of inline) cuts.add(a.range.start.o).add(a.range.end.o);
  const out: Piece[] = [];
  for (const span of p.spans) {
    const end = span.start + span.text.length;
    const inner = [...cuts].filter((c) => c > span.start && c < end).sort((x, y) => x - y);
    let from = span.start;
    for (const to of [...inner, end]) {
      out.push({
        text: span.text.slice(from - span.start, to - span.start),
        start: from,
        span,
        covering: inline.filter((a) => a.range.start.o <= from && to <= a.range.end.o && a.range.end.o > a.range.start.o),
      });
      from = to;
    }
  }
  return out;
}

function span(blocks: RenderBlock[]): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const b of blocks) {
    if (b.type === 'p') {
      min = Math.min(min, b.index);
      max = Math.max(max, b.index);
    } else {
      for (const r of b.rows) for (const c of r.cells) {
        const [a, z] = span(c.blocks);
        min = Math.min(min, a);
        max = Math.max(max, z);
      }
    }
  }
  return [min, max];
}

export const DocView = memo(function DocView({ doc, anchors = [], selectedId, blockLabel, onAnchorClick, onSelect, onFillClick }: Props) {
  const outer = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const widthPx = doc.page.width * PT;

  useEffect(() => {
    const el = outer.current;
    if (!el) return;
    const fit = () => setZoom(Math.min(1, Math.max(0.5, (el.clientWidth - 2) / widthPx)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [widthPx]);

  const { inlineBy, blocks } = useMemo(() => {
    const inlineBy = new Map<number, Anchor[]>();
    for (const a of anchors) {
      if (isBlock(a)) continue;
      inlineBy.set(a.range.start.p, [...(inlineBy.get(a.range.start.p) ?? []), a]);
    }
    return { inlineBy, blocks: anchors.filter(isBlock) };
  }, [anchors]);

  const texts = useMemo(() => {
    const map = new Map<number, string>();
    const visit = (list: RenderBlock[]) => {
      for (const b of list) {
        if (b.type === 'p') map.set(b.index, b.text);
        else b.rows.forEach((r) => r.cells.forEach((c) => visit(c.blocks)));
      }
    };
    visit(doc.blocks);
    return map;
  }, [doc]);

  const readSelection = () => {
    if (!onSelect) return;
    const sel = window.getSelection();
    const root = page.current;
    if (!sel || sel.isCollapsed || !root || !sel.anchorNode || !root.contains(sel.anchorNode)) {
      onSelect(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const hit = Array.from(root.querySelectorAll<HTMLElement>('[data-o]')).filter((s) => range.intersectsNode(s));
    // Drop spans the selection only touches at an edge.
    while (hit.length && range.startContainer === hit[0]!.firstChild && range.startOffset === hit[0]!.textContent!.length) hit.shift();
    while (hit.length && range.endContainer === hit[hit.length - 1]!.firstChild && range.endOffset === 0) hit.pop();
    const first = hit[0];
    const last = hit[hit.length - 1];
    if (!first || !last) {
      onSelect(null);
      return;
    }
    const startOff = range.startContainer === first.firstChild ? range.startOffset : 0;
    const endOff = range.endContainer === last.firstChild ? range.endOffset : last.textContent!.length;
    const start = { p: Number(first.dataset.p), o: Number(first.dataset.o) + startOff };
    const end = { p: Number(last.dataset.p), o: Number(last.dataset.o) + endOff };
    const same = start.p === end.p;
    if (same && start.o === end.o) {
      onSelect(null);
      return;
    }
    onSelect({
      start,
      end,
      text: same ? (texts.get(start.p) ?? '').slice(start.o, end.o) : '',
      whole: start.o === 0 && end.o === (texts.get(end.p) ?? '').length,
      rect: range.getBoundingClientRect(),
    });
  };

  const paragraph = (p: RenderParagraph, inRow: boolean): ReactNode => {
    const props = p.props;
    const covering = inRow ? [] : blocks.filter((a) => a.range.start.p <= p.index && p.index <= a.range.end.p && !(a as { rows?: boolean }).rows);
    const style: CSSProperties = {
      marginLeft: props.indentLeft ? `${props.indentLeft}pt` : undefined,
      ['--indent' as string]: props.indentLeft ? `${props.indentLeft}pt` : undefined,
      marginRight: props.indentRight ? `${props.indentRight}pt` : undefined,
      textIndent: props.hanging ? `-${props.hanging}pt` : props.firstLine ? `${props.firstLine}pt` : undefined,
      marginTop: props.spaceBefore ? `${props.spaceBefore}pt` : undefined,
      marginBottom: props.spaceAfter !== undefined ? `${props.spaceAfter}pt` : undefined,
      textAlign: props.align,
      lineHeight: props.lineHeight,
    };
    const body = onSelect || anchors.length
      ? pieces(p, inlineBy.get(p.index) ?? []).map((piece) => {
          // The smallest anchor is the one a click means.
          const inner = [...piece.covering].sort((a, b) => a.range.end.o - a.range.start.o - (b.range.end.o - b.range.start.o))[0];
          const replacing = piece.covering.find((a) => a.kind !== 'conditional');
          const conditional = piece.covering.some((a) => a.kind === 'conditional');
          return (
            <span
              key={piece.start}
              data-p={p.index}
              data-o={piece.start}
              style={runStyle(piece.span.props)}
              className={cx(
                piece.span.props.highlight && !inner && 'word-highlight',
                inner && 'mark',
                replacing && `mark-${replacing.kind}`,
                conditional && 'mark-conditional',
                piece.covering.some((a) => a.id === selectedId) && 'mark-selected',
              )}
              onClick={inner && onAnchorClick ? (e) => { e.stopPropagation(); onAnchorClick(inner.id); } : undefined}
            >
              {piece.text}
            </span>
          );
        })
      : p.spans.map((s) => (
          <span
            key={s.start}
            style={runStyle(s.props)}
            className={cx(s.fill && (s.fillKind === 'signature' ? 'mark mark-signature' : s.empty ? 'mark mark-empty' : 'mark mark-filled'))}
            onClick={s.fill && onFillClick ? () => onFillClick(s.fill!) : undefined}
          >
            {s.text}
          </span>
        ));
    const tagged = covering.filter((a) => a.range.start.p === p.index);
    return (
      <p
        key={`p${p.index}`}
        style={style}
        className={cx(
          covering.map((a) => `block-${a.kind}`).join(' '),
          covering.some((a) => a.id === selectedId) && 'block-selected',
        )}
        onClick={
          covering.length && onAnchorClick
            ? () => window.getSelection()?.isCollapsed !== false && onAnchorClick(covering[covering.length - 1]!.id)
            : undefined
        }
      >
        {tagged.map((a) => (
          <span key={a.id} className="block-tag" contentEditable={false}>
            {blockLabel?.(a)}
          </span>
        ))}
        {p.label && (
          <span className="doc-label" style={{ ...runStyle(p.label.props), minWidth: props.hanging ? `${props.hanging}pt` : '18pt' }}>
            {p.label.text}{props.hanging ? '' : ' '}
          </span>
        )}
        {body}
      </p>
    );
  };

  const table = (t: RenderTable, key: number): ReactNode => (
    <table key={`t${key}`} className={cx(t.bordered && 'bordered')}>
      <tbody>
        {t.rows.map((row, r) => {
          const [min, max] = span(row.cells.flatMap((c) => c.blocks));
          const covering = blocks.filter((a) => a.range.start.p <= min && max <= a.range.end.p);
          return (
            <tr
              key={r}
              className={cx(covering.map((a) => `block-${a.kind}`).join(' '), covering.some((a) => a.id === selectedId) && 'block-selected')}
              onClick={
                covering.length && onAnchorClick
                  ? () => window.getSelection()?.isCollapsed !== false && onAnchorClick(covering[covering.length - 1]!.id)
                  : undefined
              }
            >
              {row.cells.map((cell, c) => (
                <td
                  key={c}
                  colSpan={cell.colSpan}
                  rowSpan={cell.rowSpan}
                  style={{ width: cell.width ? `${cell.width}pt` : undefined, background: cell.shade ? `#${cell.shade}` : undefined }}
                >
                  {render(cell.blocks, covering.length > 0)}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  function render(list: RenderBlock[], inRow = false): ReactNode[] {
    return list.flatMap((b, i) => {
      if (b.type === 'table') return [table(b, i)];
      const node = paragraph(b, inRow);
      return b.pageBreakAfter ? [node, <hr key={`br${b.index}`} className="doc-break" />] : [node];
    });
  }

  return (
    <div ref={outer} className="w-full">
      <div
        ref={page}
        className="doc-page mx-auto"
        onMouseUp={readSelection}
        onKeyUp={readSelection}
        style={{
          width: widthPx,
          zoom,
          padding: `${doc.page.marginTop}pt ${doc.page.marginRight}pt ${doc.page.marginBottom}pt ${doc.page.marginLeft}pt`,
        }}
      >
        {render(doc.blocks)}
      </div>
    </div>
  );
});
