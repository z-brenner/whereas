import type { AnswerValue, Answers, Condition, Field, Group, ItemAnswers, Rule, TemplateDefinition } from './types';

/** Looks up an answer, preferring the current repeat entry when there is one. */
export type Lookup = (fieldId: string) => AnswerValue | undefined;

export function lookupFor(answers: Answers, item?: ItemAnswers): Lookup {
  return (id) => {
    if (item && Object.hasOwn(item, id)) return item[id];
    const v = Object.hasOwn(answers, id) ? answers[id] : undefined;
    return isItemList(v) ? undefined : (v as AnswerValue | undefined);
  };
}

export function isItemList(v: unknown): v is ItemAnswers[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'object' && x !== null && !Array.isArray(x));
}

export function isEmpty(v: AnswerValue | undefined): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function asNumber(v: AnswerValue | undefined): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Numbers compare as numbers, ISO dates and other strings as strings. */
function compare(a: AnswerValue | undefined, b: AnswerValue | undefined): number | null {
  if (isEmpty(a) || isEmpty(b)) return null;
  const na = asNumber(a);
  const nb = asNumber(b);
  if (na !== null && nb !== null) return na - nb;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function same(a: AnswerValue | undefined, b: AnswerValue | undefined): boolean {
  if (isEmpty(a) && isEmpty(b)) return true;
  if (typeof a === 'boolean' || typeof b === 'boolean') return toBool(a) === toBool(b);
  const na = asNumber(a);
  const nb = asNumber(b);
  if (na !== null && nb !== null) return na === nb;
  return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
}

function toBool(v: AnswerValue | undefined): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return ['true', 'yes', '1'].includes(v.trim().toLowerCase());
  return !!v;
}

function evalCondition(c: Condition, get: Lookup): boolean {
  const actual = get(c.field);
  const expected = c.value;
  switch (c.op) {
    case 'empty':
      return isEmpty(actual);
    case 'notEmpty':
      return !isEmpty(actual);
    case 'eq':
      return Array.isArray(actual) ? actual.some((a) => same(a, expected)) : same(actual, expected);
    case 'neq':
      return Array.isArray(actual) ? !actual.some((a) => same(a, expected)) : !same(actual, expected);
    case 'in': {
      const list = Array.isArray(expected) ? expected : [expected as AnswerValue];
      const values = Array.isArray(actual) ? actual : [actual];
      return values.some((a) => list.some((e) => same(a, e)));
    }
    case 'contains':
      if (Array.isArray(actual)) return actual.some((a) => same(a, expected));
      return String(actual ?? '')
        .toLowerCase()
        .includes(String(expected ?? '').toLowerCase());
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const d = compare(actual, expected);
      if (d === null) return false;
      return c.op === 'gt' ? d > 0 : c.op === 'gte' ? d >= 0 : c.op === 'lt' ? d < 0 : d <= 0;
    }
  }
}

/** An empty group is true, so a rule with nothing in it hides nothing. */
export function evaluate(rule: Rule | undefined, get: Lookup): boolean {
  if (!rule) return true;
  if ('all' in rule) return rule.all.every((r) => evaluate(r, get));
  if ('any' in rule) return rule.any.length === 0 || rule.any.some((r) => evaluate(r, get));
  if ('not' in rule) return !evaluate(rule.not, get);
  return evalCondition(rule, get);
}

export function ruleFields(rule: Rule | undefined): string[] {
  if (!rule) return [];
  if ('all' in rule) return rule.all.flatMap(ruleFields);
  if ('any' in rule) return rule.any.flatMap(ruleFields);
  if ('not' in rule) return ruleFields(rule.not);
  return [rule.field];
}

export interface MissingAnswer {
  field: string;
  label: string;
  /** Set when the question sits inside a repeating group. */
  group?: string;
  index?: number;
}

function isVisibleField(f: Field, get: Lookup): boolean {
  return evaluate(f.visibleWhen, get);
}

export function isVisibleGroup(g: Group, answers: Answers): boolean {
  return evaluate(g.visibleWhen, lookupFor(answers));
}

/** The answers a new request starts with. */
export function defaultAnswers(def: TemplateDefinition): Answers {
  const out: Answers = {};
  for (const f of def.fields) if (!f.group && f.defaultValue !== undefined) out[f.id] = f.defaultValue;
  return out;
}

/**
 * Answers with hidden questions blanked out. A question that is no longer
 * asked must not keep steering the document with a stale answer.
 */
export function effectiveAnswers(def: TemplateDefinition, answers: Answers): Answers {
  let current: Answers = { ...answers };
  // Hiding one question can hide another, so repeat until nothing changes.
  for (let pass = 0; pass <= def.fields.length; pass++) {
    let changed = false;
    const next: Answers = { ...current };
    const top = lookupFor(current);
    for (const f of def.fields) {
      if (f.group) continue;
      if (!isEmpty(top(f.id)) && !isVisibleField(f, top)) {
        next[f.id] = null;
        changed = true;
      }
    }
    for (const g of def.groups) {
      const list = current[g.id];
      if (!isItemList(list)) continue;
      if (!isVisibleGroup(g, current)) {
        if (list.length) {
          next[g.id] = [];
          changed = true;
        }
        continue;
      }
      const fields = def.fields.filter((f) => f.group === g.id);
      const cleaned = list.map((item) => {
        const get = lookupFor(current, item);
        let copy = item;
        for (const f of fields) {
          if (!isEmpty(item[f.id]) && !isVisibleField(f, get)) {
            copy = { ...copy, [f.id]: null };
            changed = true;
          }
        }
        return copy;
      });
      next[g.id] = cleaned;
    }
    current = next;
    if (!changed) break;
  }
  return current;
}

/**
 * Required questions that are visible and unanswered. `audience` limits the
 * check to what one side is expected to fill in; omit it to check everything.
 */
export function missingAnswers(
  def: TemplateDefinition,
  answers: Answers,
  audience?: 'requester' | 'legal',
): MissingAnswer[] {
  answers = effectiveAnswers(def, answers);
  const out: MissingAnswer[] = [];
  const top = lookupFor(answers);
  for (const f of def.fields) {
    if (f.group || !f.required) continue;
    if (audience && f.audience !== audience) continue;
    if (isVisibleField(f, top) && isEmpty(top(f.id))) out.push({ field: f.id, label: f.label });
  }
  for (const g of def.groups) {
    if (audience && g.audience !== audience) continue;
    if (!isVisibleGroup(g, answers)) continue;
    const items = isItemList(answers[g.id]) ? (answers[g.id] as ItemAnswers[]) : [];
    if ((g.min ?? 0) > items.length) {
      out.push({ field: g.id, label: `${g.label}: add at least ${g.min}`, group: g.id });
    }
    items.forEach((item, index) => {
      const get = lookupFor(answers, item);
      for (const f of def.fields) {
        if (f.group !== g.id || !f.required) continue;
        if (isVisibleField(f, get) && isEmpty(get(f.id))) {
          out.push({ field: f.id, label: `${g.itemLabel} ${index + 1}: ${f.label}`, group: g.id, index });
        }
      }
    });
  }
  return out;
}
