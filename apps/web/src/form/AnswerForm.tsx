import {
  effectiveAnswers,
  evaluate,
  formatAnswer,
  isEmpty,
  isItemList,
  lookupFor,
  type AnswerValue,
  type Answers,
  type Field,
  type Group,
  type ItemAnswers,
  type MissingAnswer,
  type TemplateDefinition,
} from '@whereas/core';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Checkbox, cx, Input, Label, Select, Textarea } from '../ui';

interface Props {
  definition: TemplateDefinition;
  answers: Answers;
  onChange: (next: Answers) => void;
  /** Which side's questions to show. */
  audience: 'requester' | 'legal';
  readOnly?: boolean;
  /** Required questions to flag, usually after a failed submit. */
  missing?: MissingAnswer[];
  /** Scroll to and focus this question. */
  focus?: { field: string; at: number } | null;
}

function NumberInput({ id, value, onChange, prefix, disabled }: { id: string; value: AnswerValue | undefined; onChange: (v: number | null) => void; prefix?: string; disabled?: boolean }) {
  const [text, setText] = useState(value === null || value === undefined ? '' : String(value));
  // Follow outside changes without fighting the person typing.
  useEffect(() => {
    const parsed = text.trim() === '' ? null : Number(text.replace(/,/g, ''));
    const current = value === undefined ? null : value;
    if (parsed !== current && !(Number.isNaN(parsed as number) && current === null)) {
      setText(current === null ? '' : String(current));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className="relative">
      {prefix && <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-muted">{prefix}</span>}
      <Input
        id={id}
        inputMode="decimal"
        disabled={disabled}
        className={prefix ? 'pl-12' : undefined}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const raw = e.target.value.replace(/,/g, '').trim();
          const n = Number(raw);
          onChange(raw === '' || !Number.isFinite(n) ? null : n);
        }}
      />
    </div>
  );
}

function Choice<T extends string | boolean>({ options, value, onChange, disabled, name }: { options: { value: T; label: string }[]; value: T | null; onChange: (v: T) => void; disabled?: boolean; name: string }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup">
      {options.map((o) => (
        <label
          key={String(o.value)}
          className={cx(
            'cursor-pointer rounded-md px-3 py-1.5 text-sm ring-1 ring-inset transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ink',
            value === o.value ? 'bg-ink text-white ring-ink' : 'bg-paper text-ink ring-line hover:bg-desk',
            disabled && 'pointer-events-none opacity-60',
          )}
        >
          <input type="radio" name={name} className="sr-only" checked={value === o.value} disabled={disabled} onChange={() => onChange(o.value)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}

function FieldInput({ field, value, onChange, id, disabled }: { field: Field; value: AnswerValue | undefined; onChange: (v: AnswerValue) => void; id: string; disabled?: boolean }) {
  switch (field.type) {
    case 'longtext':
      return <Textarea id={id} disabled={disabled} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return <NumberInput id={id} disabled={disabled} value={value} onChange={onChange} />;
    case 'currency':
      return <NumberInput id={id} disabled={disabled} value={value} onChange={onChange} prefix={field.currency ?? 'USD'} />;
    case 'date':
      return <Input id={id} type="date" disabled={disabled} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || null)} />;
    case 'email':
      return <Input id={id} type="email" autoComplete="off" disabled={disabled} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
    case 'boolean':
      return (
        <Choice
          name={id}
          disabled={disabled}
          value={typeof value === 'boolean' ? value : null}
          onChange={onChange}
          options={[{ value: true, label: 'Yes' }, { value: false, label: 'No' }]}
        />
      );
    case 'select': {
      const options = field.options ?? [];
      if (options.length <= 4 && options.every((o) => o.label.length <= 28)) {
        return <Choice name={id} disabled={disabled} value={(value as string) ?? null} onChange={onChange} options={options} />;
      }
      return (
        <Select id={id} disabled={disabled} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">Choose…</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      );
    }
    case 'multiselect': {
      const picked = Array.isArray(value) ? value : [];
      return (
        <div className="space-y-1.5">
          {(field.options ?? []).map((o) => (
            <Checkbox
              key={o.value}
              disabled={disabled}
              checked={picked.includes(o.value)}
              onChange={(on) => onChange(on ? [...picked, o.value] : picked.filter((v) => v !== o.value))}
            >
              {o.label}
            </Checkbox>
          ))}
        </div>
      );
    }
    default:
      return <Input id={id} disabled={disabled} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
  }
}

export function AnswerForm({ definition, answers, onChange, audience, readOnly, missing = [], focus }: Props) {
  const effective = effectiveAnswers(definition, answers);
  const top = lookupFor(effective);

  useEffect(() => {
    if (!focus) return;
    const el = document.querySelector<HTMLElement>(`[data-question="${focus.field}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el?.querySelector<HTMLElement>('input, select, textarea')?.focus({ preventScroll: true });
  }, [focus]);

  const isMissing = (field: string, group?: string, index?: number) =>
    missing.some((m) => m.field === field && m.group === group && m.index === index);

  const question = (f: Field, value: AnswerValue | undefined, set: (v: AnswerValue) => void, key: string, flagged: boolean) => {
    if (readOnly) {
      const text = formatAnswer(f, value);
      return (
        <div key={key} data-question={f.id}>
          <dt className="text-[13px] text-muted">{f.label}</dt>
          <dd className={cx('text-sm whitespace-pre-wrap', !text && 'text-muted')}>{text || 'Not answered'}</dd>
        </div>
      );
    }
    return (
      <div key={key} data-question={f.id}>
        <Label label={f.label} hint={f.help} required={f.required} error={flagged && isEmpty(value) ? 'This answer is required.' : undefined}>
          {(id) => <FieldInput id={id} field={f} value={value} onChange={set} />}
        </Label>
      </div>
    );
  };

  const group = (g: Group) => {
    const fields = definition.fields.filter((f) => f.group === g.id);
    const items: ItemAnswers[] = isItemList(answers[g.id]) ? (answers[g.id] as ItemAnswers[]) : [];
    const setItems = (next: ItemAnswers[]) => onChange({ ...answers, [g.id]: next });
    const short = isMissing(g.id, g.id) && items.length < (g.min ?? 0);
    return (
      <fieldset key={g.id} className="space-y-3">
        <legend className="text-[13px] font-medium">{g.label}</legend>
        {items.length === 0 && readOnly && <p className="text-sm text-muted">None added</p>}
        {items.map((item, index) => {
          const get = lookupFor(effective, (effective[g.id] as ItemAnswers[] | undefined)?.[index] ?? item);
          return (
            <div key={index} className="rounded-md bg-desk/70 p-3 ring-1 ring-inset ring-line-soft">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] text-muted">{g.itemLabel} {index + 1}</span>
                {!readOnly && (
                  <button
                    type="button"
                    aria-label={`Remove ${g.itemLabel} ${index + 1}`}
                    className="rounded p-1 text-muted hover:bg-desk-deep hover:text-wax"
                    onClick={() => setItems(items.filter((_, i) => i !== index))}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
              <div className={readOnly ? 'space-y-2' : 'space-y-3'}>
                {fields
                  .filter((f) => evaluate(f.visibleWhen, get))
                  .map((f) =>
                    question(
                      f,
                      item[f.id],
                      (v) => setItems(items.map((it, i) => (i === index ? { ...it, [f.id]: v } : it))),
                      `${g.id}:${index}:${f.id}`,
                      isMissing(f.id, g.id, index),
                    ),
                  )}
              </div>
            </div>
          );
        })}
        {!readOnly && (g.max === undefined || items.length < g.max) && (
          <Button size="sm" onClick={() => setItems([...items, {}])}>
            <Plus size={14} /> Add {g.itemLabel.toLowerCase()}
          </Button>
        )}
        {short && <p className="text-[13px] text-wax">Add at least {g.min}.</p>}
      </fieldset>
    );
  };

  // Questions keep the template's order; a group appears where its first question is.
  const shown = new Set<string>();
  const nodes = definition.fields.flatMap((f) => {
    if (f.group) {
      const g = definition.groups.find((x) => x.id === f.group);
      if (!g || shown.has(g.id) || g.audience !== audience || !evaluate(g.visibleWhen, top)) return [];
      shown.add(g.id);
      return [group(g)];
    }
    if (f.audience !== audience || !evaluate(f.visibleWhen, top)) return [];
    return [question(f, answers[f.id] as AnswerValue | undefined, (v) => onChange({ ...answers, [f.id]: v }), f.id, isMissing(f.id))];
  });

  if (nodes.length === 0) return null;
  return readOnly ? <dl className="space-y-3">{nodes}</dl> : <div className="space-y-5">{nodes}</div>;
}

/** True when a template asks this side anything at all. */
export function hasQuestions(definition: TemplateDefinition, audience: 'requester' | 'legal'): boolean {
  return (
    definition.fields.some((f) => !f.group && f.audience === audience) || definition.groups.some((g) => g.audience === audience)
  );
}
