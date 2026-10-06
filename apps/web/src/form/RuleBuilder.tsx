import type { AnswerValue, Condition, Field, Rule, RuleOp } from '@whereas/core';
import { Plus, X } from 'lucide-react';
import { Button, Input, Select } from '../ui';

type Mode = 'all' | 'any';
interface GroupNode {
  mode: Mode;
  items: (Condition | GroupNode)[];
}

const isCondition = (x: Condition | GroupNode | Rule): x is Condition => 'field' in x;

function toNode(rule: Rule | undefined): GroupNode {
  if (!rule) return { mode: 'all', items: [] };
  if (isCondition(rule)) return { mode: 'all', items: [rule] };
  if ('not' in rule) return toNode(rule.not);
  const mode: Mode = 'all' in rule ? 'all' : 'any';
  const list = 'all' in rule ? rule.all : rule.any;
  return {
    mode,
    items: list.map((r) => (isCondition(r) ? r : { ...toNode(r), items: toNode(r).items.filter(isCondition) })),
  };
}

function toRule(node: GroupNode): Rule {
  const items: Rule[] = node.items.map((i) => (isCondition(i) ? i : toRule(i)));
  return node.mode === 'all' ? { all: items } : { any: items };
}

interface OpChoice {
  key: string;
  label: string;
  op: RuleOp;
  value?: AnswerValue;
  input: 'none' | 'option' | 'number' | 'date' | 'text';
}

function choices(field: Field | undefined): OpChoice[] {
  const answered: OpChoice[] = [
    { key: 'notEmpty', label: 'is answered', op: 'notEmpty', input: 'none' },
    { key: 'empty', label: 'is not answered', op: 'empty', input: 'none' },
  ];
  switch (field?.type) {
    case 'boolean':
      return [
        { key: 'yes', label: 'is yes', op: 'eq', value: true, input: 'none' },
        { key: 'no', label: 'is no', op: 'eq', value: false, input: 'none' },
      ];
    case 'select':
      return [
        { key: 'eq', label: 'is', op: 'eq', input: 'option' },
        { key: 'neq', label: 'is not', op: 'neq', input: 'option' },
        ...answered,
      ];
    case 'multiselect':
      return [
        { key: 'contains', label: 'includes', op: 'contains', input: 'option' },
        { key: 'neq', label: 'does not include', op: 'neq', input: 'option' },
        ...answered,
      ];
    case 'number':
    case 'currency':
      return [
        { key: 'eq', label: 'equals', op: 'eq', input: 'number' },
        { key: 'gt', label: 'is more than', op: 'gt', input: 'number' },
        { key: 'gte', label: 'is at least', op: 'gte', input: 'number' },
        { key: 'lt', label: 'is less than', op: 'lt', input: 'number' },
        { key: 'lte', label: 'is at most', op: 'lte', input: 'number' },
        ...answered,
      ];
    case 'date':
      return [
        { key: 'lt', label: 'is before', op: 'lt', input: 'date' },
        { key: 'gt', label: 'is after', op: 'gt', input: 'date' },
        { key: 'eq', label: 'is on', op: 'eq', input: 'date' },
        ...answered,
      ];
    default:
      return [
        { key: 'eq', label: 'is', op: 'eq', input: 'text' },
        { key: 'neq', label: 'is not', op: 'neq', input: 'text' },
        { key: 'contains', label: 'contains', op: 'contains', input: 'text' },
        ...answered,
      ];
  }
}

function currentChoice(c: Condition, list: OpChoice[]): OpChoice {
  return list.find((o) => o.op === c.op && (o.value === undefined || o.value === c.value)) ?? list[0]!;
}

function ConditionRow({ condition, fields, onChange, onRemove }: { condition: Condition; fields: Field[]; onChange: (c: Condition) => void; onRemove: () => void }) {
  const field = fields.find((f) => f.id === condition.field);
  const list = choices(field);
  const choice = currentChoice(condition, list);
  return (
    <div className="flex items-start gap-1.5">
      <div className="grid min-w-0 flex-1 gap-1.5">
        <Select
          aria-label="Question"
          value={condition.field}
          onChange={(e) => {
            const next = fields.find((f) => f.id === e.target.value);
            const first = choices(next)[0]!;
            onChange({ field: e.target.value, op: first.op, value: first.value });
          }}
        >
          {!field && <option value="">Choose a question…</option>}
          {fields.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </Select>
        <div className="flex gap-1.5">
          <Select
            aria-label="Comparison"
            className="!w-auto shrink-0"
            value={choice.key}
            onChange={(e) => {
              const next = list.find((o) => o.key === e.target.value)!;
              onChange({ field: condition.field, op: next.op, value: next.value ?? (next.input === 'none' ? undefined : condition.value) });
            }}
          >
            {list.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </Select>
          {choice.input === 'option' && (
            <Select aria-label="Value" value={String(condition.value ?? '')} onChange={(e) => onChange({ ...condition, value: e.target.value })}>
              <option value="">Choose…</option>
              {(field?.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          )}
          {choice.input === 'number' && (
            <Input aria-label="Value" inputMode="decimal" value={String(condition.value ?? '')} onChange={(e) => onChange({ ...condition, value: e.target.value === '' ? null : Number(e.target.value) || 0 })} />
          )}
          {choice.input === 'date' && (
            <Input aria-label="Value" type="date" value={String(condition.value ?? '')} onChange={(e) => onChange({ ...condition, value: e.target.value })} />
          )}
          {choice.input === 'text' && (
            <Input aria-label="Value" value={String(condition.value ?? '')} onChange={(e) => onChange({ ...condition, value: e.target.value })} />
          )}
        </div>
      </div>
      <button type="button" aria-label="Remove condition" className="mt-1.5 rounded p-1 text-muted hover:bg-desk-deep hover:text-wax" onClick={onRemove}>
        <X size={15} />
      </button>
    </div>
  );
}

function ModePicker({ mode, onChange, nested }: { mode: Mode; onChange: (m: Mode) => void; nested?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-[13px] text-ink-soft">
      {nested ? 'and' : 'When'}
      <Select aria-label="Match" className="!h-7 !w-auto !py-0 text-[13px]" value={mode} onChange={(e) => onChange(e.target.value as Mode)}>
        <option value="all">all</option>
        <option value="any">any</option>
      </Select>
      of these are true
    </div>
  );
}

/**
 * Builds "all of" / "any of" rules, with one level of nested groups, which
 * covers "A and (B or C)". The stored rule format allows deeper nesting.
 */
export function RuleBuilder({ rule, fields, onChange }: { rule: Rule | undefined; fields: Field[]; onChange: (rule: Rule) => void }) {
  const node = toNode(rule);
  const commit = (next: GroupNode) => onChange(toRule(next));
  const blank = (): Condition => {
    const f = fields[0];
    const first = choices(f)[0]!;
    return { field: f?.id ?? '', op: first.op, value: first.value };
  };
  const setItem = (i: number, item: Condition | GroupNode | null) =>
    commit({ ...node, items: item === null ? node.items.filter((_, j) => j !== i) : node.items.map((x, j) => (j === i ? item : x)) });

  if (fields.length === 0) {
    return <p className="text-[13px] text-muted">Add a question first. Conditions depend on answers.</p>;
  }
  return (
    <div className="space-y-2.5">
      <ModePicker mode={node.mode} onChange={(mode) => commit({ ...node, mode })} />
      {node.items.map((item, i) =>
        isCondition(item) ? (
          <ConditionRow key={i} condition={item} fields={fields} onChange={(c) => setItem(i, c)} onRemove={() => setItem(i, null)} />
        ) : (
          <div key={i} className="space-y-2 rounded-md bg-desk/70 p-2.5 ring-1 ring-inset ring-line-soft">
            <div className="flex items-center justify-between">
              <ModePicker nested mode={item.mode} onChange={(mode) => setItem(i, { ...item, mode })} />
              <button type="button" aria-label="Remove group" className="rounded p-1 text-muted hover:text-wax" onClick={() => setItem(i, null)}>
                <X size={15} />
              </button>
            </div>
            {item.items.filter(isCondition).map((c, k) => (
              <ConditionRow
                key={k}
                condition={c}
                fields={fields}
                onChange={(next) => setItem(i, { ...item, items: item.items.map((x, j) => (j === k ? next : x)) })}
                onRemove={() => setItem(i, { ...item, items: item.items.filter((_, j) => j !== k) })}
              />
            ))}
            <Button size="sm" variant="quiet" onClick={() => setItem(i, { ...item, items: [...item.items, blank()] })}>
              <Plus size={14} /> Add condition
            </Button>
          </div>
        ),
      )}
      <div className="flex gap-1.5">
        <Button size="sm" onClick={() => commit({ ...node, items: [...node.items, blank()] })}>
          <Plus size={14} /> Add condition
        </Button>
        <Button size="sm" variant="quiet" onClick={() => commit({ ...node, items: [...node.items, { mode: node.mode === 'all' ? 'any' : 'all', items: [blank()] }] })}>
          <Plus size={14} /> Add group
        </Button>
      </div>
    </div>
  );
}
