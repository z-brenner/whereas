import { readPart, type Docx } from './docx';
import { readParaProps, readRunProps, type ParaProps, type RunProps } from './styles';
import { childElements, isW, wAttr, wChild, wVal } from './xml';

interface Level {
  start: number;
  format: string;
  text: string;
  pStyle?: string;
  para: ParaProps;
  run: RunProps;
}

interface Num {
  abstractId: string;
  overrides: Map<number, number>;
}

function roman(n: number): string {
  if (n <= 0 || n >= 4000) return String(n);
  const table: [number, string][] = [
    [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
    [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
  ];
  let out = '';
  for (const [value, sym] of table) while (n >= value) { out += sym; n -= value; }
  return out;
}

/** Word letters go a..z, aa..zz, aaa.. */
function letters(n: number): string {
  if (n <= 0) return String(n);
  const ch = String.fromCharCode(97 + ((n - 1) % 26));
  return ch.repeat(Math.floor((n - 1) / 26) + 1);
}

function formatCounter(n: number, format: string): string {
  switch (format) {
    case 'lowerLetter': return letters(n);
    case 'upperLetter': return letters(n).toUpperCase();
    case 'lowerRoman': return roman(n);
    case 'upperRoman': return roman(n).toUpperCase();
    case 'decimalZero': return n < 10 ? `0${n}` : String(n);
    case 'none': return '';
    default: return String(n);
  }
}

export interface NumberLabel {
  text: string;
  para: ParaProps;
  run: RunProps;
}

/**
 * Computes list labels ("1.", "2.1", "(a)") by walking paragraphs in order,
 * the way Word does. Removing a clause therefore renumbers what follows.
 */
export class Numbering {
  private abstracts = new Map<string, Map<number, Level>>();
  private nums = new Map<string, Num>();
  private counters = new Map<string, (number | undefined)[]>();
  private started = new Set<string>();

  constructor(docx: Docx) {
    const root = readPart(docx, 'word/numbering.xml')?.documentElement;
    if (!root) return;
    for (const el of childElements(root)) {
      if (isW(el, 'abstractNum')) {
        const levels = new Map<number, Level>();
        for (const lvl of childElements(el)) {
          if (!isW(lvl, 'lvl')) continue;
          levels.set(Number(wAttr(lvl, 'ilvl') ?? 0), {
            start: Number(wVal(wChild(lvl, 'start')) ?? 1),
            format: wVal(wChild(lvl, 'numFmt')) ?? 'decimal',
            text: wVal(wChild(lvl, 'lvlText')) ?? '',
            pStyle: wVal(wChild(lvl, 'pStyle')) ?? undefined,
            para: readParaProps(wChild(lvl, 'pPr')),
            run: readRunProps(wChild(lvl, 'rPr')),
          });
        }
        this.abstracts.set(wAttr(el, 'abstractNumId') ?? '', levels);
      } else if (isW(el, 'num')) {
        const overrides = new Map<number, number>();
        for (const o of childElements(el)) {
          if (!isW(o, 'lvlOverride')) continue;
          const start = wVal(wChild(o, 'startOverride'));
          if (start !== null) overrides.set(Number(wAttr(o, 'ilvl') ?? 0), Number(start));
        }
        this.nums.set(wAttr(el, 'numId') ?? '', {
          abstractId: wVal(wChild(el, 'abstractNumId')) ?? '',
          overrides,
        });
      }
    }
  }

  /** Call once per numbered paragraph, in document order. */
  next(numId: string | undefined, ilvl: number | undefined, styleId: string | undefined): NumberLabel | null {
    if (!numId || numId === '0') return null;
    const num = this.nums.get(numId);
    const levels = num && this.abstracts.get(num.abstractId);
    if (!num || !levels) return null;
    let level = ilvl;
    if (level === undefined) {
      level = 0;
      for (const [i, l] of levels) if (styleId && l.pStyle === styleId) level = i;
    }
    const def = levels.get(level);
    if (!def) return null;

    const counters = this.counters.get(num.abstractId) ?? [];
    this.counters.set(num.abstractId, counters);
    if (!this.started.has(numId)) {
      this.started.add(numId);
      for (const [l, start] of num.overrides) counters[l] = start - 1;
    }
    const current = counters[level];
    counters[level] = current === undefined ? def.start : current + 1;
    counters.length = level + 1;

    let text: string;
    if (def.format === 'bullet') {
      const ch = def.text;
      // Symbol-font bullets live in the private use area; show a plain one.
      text = !ch || /[-]/.test(ch) || ch === 'o' ? '•' : ch;
    } else {
      text = def.text.replace(/%(\d)/g, (_, d: string) => {
        const i = Number(d) - 1;
        const lvl = levels.get(i);
        const value = counters[i] ?? lvl?.start ?? 1;
        return formatCounter(value, i === level ? def.format : (lvl?.format ?? 'decimal'));
      });
    }
    return { text, para: def.para, run: def.format === 'bullet' ? {} : def.run };
  }
}
