import type { AnswerValue, DateFormat, Field, TextCase } from './types';
import { isEmpty } from './rules';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Dates are stored as YYYY-MM-DD and formatted without time zones. */
export function formatDate(iso: string, format: DateFormat = 'long'): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m as unknown as [string, string, string, string];
  const month = MONTHS[Number(mo) - 1] ?? mo;
  switch (format) {
    case 'iso':
      return `${y}-${mo}-${d}`;
    case 'short':
      return `${mo}/${d}/${y}`;
    case 'longDayFirst':
      return `${Number(d)} ${month} ${y}`;
    default:
      return `${month} ${Number(d)}, ${y}`;
  }
}

/**
 * Makes text safe to place in a document. Pasted text often carries Word's
 * vertical-tab line break or other control characters that XML forbids, and
 * a single one would make the whole file unreadable.
 */
export function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u000B\u000C\u2028\u2029]/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
}

function groupThousands(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatNumber(n: number, decimals?: number): string {
  if (!Number.isFinite(n)) return '';
  const fixed = decimals === undefined ? String(n) : n.toFixed(decimals);
  const [int = '0', frac] = fixed.replace('-', '').split('.');
  return `${n < 0 ? '-' : ''}${groupThousands(int)}${frac ? `.${frac}` : ''}`;
}

const SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', CAD: 'CA$', AUD: 'A$', JPY: '¥' };

export function formatCurrency(n: number, currency = 'USD'): string {
  const symbol = SYMBOLS[currency];
  const body = formatNumber(Math.abs(n), currency === 'JPY' ? 0 : 2);
  const sign = n < 0 ? '-' : '';
  return symbol ? `${sign}${symbol}${body}` : `${sign}${body} ${currency}`;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function applyCase(text: string, textCase: TextCase | undefined): string {
  switch (textCase) {
    case 'upper':
      return text.toUpperCase();
    case 'lower':
      return text.toLowerCase();
    case 'title':
      return text.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
    default:
      return text;
  }
}

export interface FormatOptions {
  dateFormat?: DateFormat;
  textCase?: TextCase;
}

/** The text an answer becomes inside the agreement. */
export function formatAnswer(field: Field, value: AnswerValue | undefined, opts: FormatOptions = {}): string {
  if (isEmpty(value)) return '';
  let text: string;
  switch (field.type) {
    case 'date':
      text = formatDate(String(value), opts.dateFormat);
      break;
    case 'number':
      text = typeof value === 'number' ? formatNumber(value) : formatNumber(Number(value));
      break;
    case 'currency':
      text = formatCurrency(Number(value), field.currency);
      break;
    case 'boolean':
      text = value === true || value === 'true' ? 'Yes' : 'No';
      break;
    case 'select': {
      const opt = field.options?.find((o) => o.value === value);
      text = opt?.label ?? String(value);
      break;
    }
    case 'multiselect': {
      const values = Array.isArray(value) ? value : [String(value)];
      text = joinList(values.map((v) => field.options?.find((o) => o.value === v)?.label ?? v));
      break;
    }
    default:
      text = String(value);
  }
  return applyCase(text, opts.textCase);
}
