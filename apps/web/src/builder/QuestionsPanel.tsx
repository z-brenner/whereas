import type { Field, FieldType, TemplateDefinition } from '@whereas/core';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, Trash2, X } from 'lucide-react';
import { RuleBuilder } from '../form/RuleBuilder';
import { slugify } from '../lib/format';
import { Button, Checkbox, cx, Input, Label, Select, Textarea } from '../ui';
import { newField, placements, removeField, updateField } from './actions';

export const TYPE_LABEL: Record<FieldType, string> = {
  text: 'Short text',
  longtext: 'Long text',
  number: 'Number',
  currency: 'Amount of money',
  date: 'Date',
  select: 'Choose one',
  multiselect: 'Choose several',
  boolean: 'Yes or no',
  email: 'Email address',
};

interface Props {
  definition: TemplateDefinition;
  onChange: (next: TemplateDefinition) => void;
  openId: string | null;
  setOpenId: (id: string | null) => void;
}

function FieldEditor({ field, definition, onChange }: { field: Field; definition: TemplateDefinition; onChange: (next: TemplateDefinition) => void }) {
  const set = (patch: Partial<Field>) => onChange(updateField(definition, field.id, patch));
  const options = field.options ?? [];
  const hasOptions = field.type === 'select' || field.type === 'multiselect';
  // A question can depend on others at its own level, plus top-level ones.
  const others = definition.fields.filter((f) => f.id !== field.id && (!f.group || f.group === field.group));
  const placed = placements(definition, field.id);

  return (
    <div className="space-y-3.5 border-t border-line-soft px-3 pt-3 pb-4">
      <Label label="Question">
        {(id) => <Input id={id} value={field.label} onChange={(e) => set({ label: e.target.value })} />}
      </Label>
      <Label label="Answer type">
        {(id) => (
          <Select
            id={id}
            value={field.type}
            onChange={(e) => {
              const type = e.target.value as FieldType;
              const needs = type === 'select' || type === 'multiselect';
              set({
                type,
                defaultValue: undefined,
                options: needs ? (options.length ? options : [{ value: 'option_1', label: 'Option 1' }]) : undefined,
                currency: type === 'currency' ? (field.currency ?? 'USD') : undefined,
              });
            }}
          >
            {Object.entries(TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        )}
      </Label>
      {hasOptions && (
        <div className="space-y-1.5">
          <div className="text-[13px] font-medium">Options</div>
          {options.map((o, i) => (
            <div key={o.value} className="flex gap-1.5">
              <Input aria-label={`Option ${i + 1}`} value={o.label} onChange={(e) => set({ options: options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
              <button type="button" aria-label={`Remove option ${o.label}`} disabled={options.length <= 1} className="rounded p-1.5 text-muted hover:bg-desk-deep hover:text-wax disabled:opacity-30" onClick={() => set({ options: options.filter((_, j) => j !== i) })}>
                <X size={15} />
              </button>
            </div>
          ))}
          <Button size="sm" onClick={() => set({ options: [...options, { value: slugify(`option ${options.length + 1}`, options.map((o) => o.value)), label: `Option ${options.length + 1}` }] })}>
            <Plus size={14} /> Add option
          </Button>
        </div>
      )}
      {field.type === 'currency' && (
        <Label label="Currency">
          {(id) => (
            <Select id={id} value={field.currency ?? 'USD'} onChange={(e) => set({ currency: e.target.value })}>
              {['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'].map((c) => <option key={c}>{c}</option>)}
            </Select>
          )}
        </Label>
      )}
      <Label label="Help text" hint="Shown under the question.">
        {(id) => <Textarea id={id} rows={2} value={field.help ?? ''} onChange={(e) => set({ help: e.target.value || undefined })} />}
      </Label>
      {!field.group && (
        <Label label="Who answers">
          {(id) => (
            <Select id={id} value={field.audience} onChange={(e) => set({ audience: e.target.value as Field['audience'] })}>
              <option value="requester">The requester</option>
              <option value="legal">Legal, during review</option>
            </Select>
          )}
        </Label>
      )}
      <Checkbox checked={field.required} onChange={(required) => set({ required })}>An answer is required</Checkbox>
      <Checkbox checked={!!field.visibleWhen} onChange={(on) => set({ visibleWhen: on ? { all: [] } : undefined })}>
        Only ask this in some cases
      </Checkbox>
      {field.visibleWhen && (
        <div className="rounded-md bg-desk/60 p-2.5">
          <RuleBuilder rule={field.visibleWhen} fields={others} onChange={(visibleWhen) => set({ visibleWhen })} />
        </div>
      )}
      <div className="flex items-center justify-between pt-1">
        <span className="text-[13px] text-muted">
          {placed === 0 ? 'Not placed in the document yet' : `Placed ${placed === 1 ? 'once' : `${placed} times`} in the document`}
        </span>
        <Button
          size="sm"
          variant="danger"
          onClick={() => {
            if (placed === 0 || window.confirm(`Delete "${field.label}"? Its ${placed === 1 ? 'mark' : `${placed} marks`} in the document will be removed too.`)) {
              onChange(removeField(definition, field.id));
            }
          }}
        >
          <Trash2 size={14} /> Delete
        </Button>
      </div>
    </div>
  );
}

export function QuestionsPanel({ definition, onChange, openId, setOpenId }: Props) {
  const move = (index: number, by: number) => {
    const fields = [...definition.fields];
    const [f] = fields.splice(index, 1);
    fields.splice(index + by, 0, f!);
    onChange({ ...definition, fields });
  };
  const add = () => {
    const field = newField(definition, 'New question', { type: 'text' });
    onChange({ ...definition, fields: [...definition.fields, field] });
    setOpenId(field.id);
  };

  return (
    <div>
      {definition.fields.length === 0 && (
        <p className="px-4 py-6 text-sm leading-relaxed text-muted">
          No questions yet. Select a placeholder in the document and choose Question, or add one here.
        </p>
      )}
      <ul>
        {definition.fields.map((f, i) => {
          const open = openId === f.id;
          const group = f.group && definition.groups.find((g) => g.id === f.group);
          return (
            <li key={f.id} className={cx('border-b border-line-soft', open && 'bg-desk/40')}>
              <div className="group flex items-center gap-1 pr-2">
                <button className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left" aria-expanded={open} onClick={() => setOpenId(open ? null : f.id)}>
                  {open ? <ChevronDown size={15} className="shrink-0 text-muted" /> : <ChevronRight size={15} className="shrink-0 text-muted" />}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{f.label || 'Untitled question'}</span>
                    <span className="block truncate text-[13px] text-muted">
                      {[TYPE_LABEL[f.type], group ? `repeats in ${group.label}` : f.audience === 'legal' && 'for legal', !f.required && 'optional', f.visibleWhen && 'conditional']
                        .filter(Boolean)
                        .join(', ')}
                    </span>
                  </span>
                </button>
                <button aria-label={`Move ${f.label} up`} disabled={i === 0} className="rounded p-1 text-muted opacity-0 group-hover:opacity-100 hover:bg-desk-deep focus-visible:opacity-100 disabled:invisible" onClick={() => move(i, -1)}>
                  <ArrowUp size={14} />
                </button>
                <button aria-label={`Move ${f.label} down`} disabled={i === definition.fields.length - 1} className="rounded p-1 text-muted opacity-0 group-hover:opacity-100 hover:bg-desk-deep focus-visible:opacity-100 disabled:invisible" onClick={() => move(i, 1)}>
                  <ArrowDown size={14} />
                </button>
              </div>
              {open && <FieldEditor field={f} definition={definition} onChange={onChange} />}
            </li>
          );
        })}
      </ul>
      <div className="p-3">
        <Button size="sm" onClick={add}><Plus size={14} /> Add question</Button>
      </div>
    </div>
  );
}

export function SignersPanel({ definition, onChange }: { definition: TemplateDefinition; onChange: (next: TemplateDefinition) => void }) {
  const signers = [...definition.signers].sort((a, b) => a.order - b.order);
  const text = definition.fields.filter((f) => !f.group && (f.type === 'text' || f.type === 'email'));
  const set = (id: string, patch: Partial<(typeof signers)[number]>) =>
    onChange({ ...definition, signers: definition.signers.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  return (
    <div className="space-y-3 p-3">
      <p className="text-[13px] leading-relaxed text-muted">
        Signers sign in this order. To mark where each one signs, select the signature line in the document and choose Signature.
      </p>
      {signers.map((s, i) => {
        const used = definition.anchors.filter((a) => a.kind === 'signature' && a.signer === s.id).length;
        return (
          <div key={s.id} className="space-y-2.5 rounded-md bg-desk/60 p-3 ring-1 ring-inset ring-line-soft">
            <div className="flex items-center gap-1.5">
              <span className="w-4 text-[13px] tabular-nums text-muted">{i + 1}</span>
              <Input aria-label="Signer name" value={s.label} onChange={(e) => set(s.id, { label: e.target.value })} />
              <button
                aria-label={`Remove signer ${s.label}`}
                className="rounded p-1.5 text-muted hover:bg-desk-deep hover:text-wax"
                onClick={() => {
                  if (used && !window.confirm(`Remove ${s.label}? Their ${used} signature mark${used === 1 ? '' : 's'} will be removed too.`)) return;
                  onChange({
                    ...definition,
                    signers: definition.signers.filter((x) => x.id !== s.id),
                    anchors: definition.anchors.filter((a) => !(a.kind === 'signature' && a.signer === s.id)),
                  });
                }}
              >
                <Trash2 size={15} />
              </button>
            </div>
            <Label label="Name comes from" hint="Prefills the signer when sending.">
              {(id) => (
                <Select id={id} value={s.nameField ?? ''} onChange={(e) => set(s.id, { nameField: e.target.value || undefined })}>
                  <option value="">Entered when sending</option>
                  {text.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                </Select>
              )}
            </Label>
            <Label label="Email comes from">
              {(id) => (
                <Select id={id} value={s.emailField ?? ''} onChange={(e) => set(s.id, { emailField: e.target.value || undefined })}>
                  <option value="">Entered when sending</option>
                  {text.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                </Select>
              )}
            </Label>
            <p className="text-[13px] text-muted">{used ? `Signs in ${used} place${used === 1 ? '' : 's'}` : 'Not placed in the document yet'}</p>
          </div>
        );
      })}
      <Button
        size="sm"
        onClick={() => {
          const label = signers.length === 0 ? 'Company' : signers.length === 1 ? 'Counterparty' : `Signer ${signers.length + 1}`;
          const id = slugify(label, [...definition.signers.map((s) => s.id), ...definition.fields.map((f) => f.id)]);
          onChange({ ...definition, signers: [...definition.signers, { id, label, order: Math.max(0, ...signers.map((s) => s.order)) + 1 }] });
        }}
      >
        <Plus size={14} /> Add signer
      </Button>
    </div>
  );
}

export function TasksPanel({ definition, onChange }: { definition: TemplateDefinition; onChange: (next: TemplateDefinition) => void }) {
  const tasks = definition.tasks ?? [];
  const set = (next: string[]) => onChange({ ...definition, tasks: next });
  return (
    <div className="space-y-2 p-3">
      <p className="text-[13px] leading-relaxed text-muted">These tasks are added to every request made from this template, for approvals and checks that always apply.</p>
      {tasks.map((t, i) => (
        <div key={i} className="flex gap-1.5">
          <Input aria-label={`Task ${i + 1}`} value={t} onChange={(e) => set(tasks.map((x, j) => (j === i ? e.target.value : x)))} />
          <button aria-label={`Remove task ${t}`} className="rounded p-1.5 text-muted hover:bg-desk-deep hover:text-wax" onClick={() => set(tasks.filter((_, j) => j !== i))}>
            <X size={15} />
          </button>
        </div>
      ))}
      <Button size="sm" onClick={() => set([...tasks, 'New task'])}><Plus size={14} /> Add task</Button>
    </div>
  );
}
