import type { Anchor, DateFormat, Field, SignaturePart, TemplateDefinition, TextCase } from '@whereas/core';
import { Trash2 } from 'lucide-react';
import { RuleBuilder } from '../form/RuleBuilder';
import { Button, Input, Label, Select, Textarea } from '../ui';
import { KIND_LABEL, removeAnchor, updateAnchor } from './actions';

interface Props {
  anchor: Anchor;
  definition: TemplateDefinition;
  onChange: (next: TemplateDefinition) => void;
  onEditField: (fieldId: string) => void;
  onShowSigners: () => void;
  onRemoved: () => void;
}

const DOT: Record<Anchor['kind'], string> = {
  field: 'bg-mark-field',
  conditional: 'bg-mark-conditional',
  alternatives: 'bg-mark-alternatives',
  repeat: 'bg-mark-repeat',
  signature: 'bg-mark-signature',
};

export function KindDot({ kind }: { kind: Anchor['kind'] }) {
  return <span className={`inline-block size-3 shrink-0 rounded-sm ring-1 ring-inset ring-black/10 ${DOT[kind]}`} />;
}

export function Inspector({ anchor, definition, onChange, onEditField, onShowSigners, onRemoved }: Props) {
  const set = (patch: Partial<Anchor>) => onChange(updateAnchor(definition, anchor.id, patch));
  const repeat = definition.anchors.find(
    (a) => a.kind === 'repeat' && a.id !== anchor.id && a.range.start.p <= anchor.range.start.p && anchor.range.end.p <= a.range.end.p,
  ) as Extract<Anchor, { kind: 'repeat' }> | undefined;
  // Inside a repeating block, that block's questions are available too.
  const reachable = definition.fields.filter((f) => !f.group || f.group === repeat?.group);
  const field: Field | undefined = 'field' in anchor ? definition.fields.find((f) => f.id === anchor.field) : undefined;

  return (
    <div className="space-y-4 p-4">
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold"><KindDot kind={anchor.kind} /> {KIND_LABEL[anchor.kind]}</div>
        <p className="mt-1.5 line-clamp-3 border-l-2 border-line pl-2.5 font-serif text-[13px] text-ink-soft">{anchor.range.quote}</p>
      </div>

      {anchor.kind === 'field' && (
        <>
          <Label label="Filled in with the answer to">
            {(id) => (
              <Select id={id} value={anchor.field} onChange={(e) => set({ field: e.target.value })}>
                {!field && <option value={anchor.field}>Deleted question</option>}
                {reachable.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </Select>
            )}
          </Label>
          {field && <Button size="sm" onClick={() => onEditField(field.id)}>Edit this question</Button>}
          {field?.type === 'date' && (
            <Label label="Date format">
              {(id) => (
                <Select id={id} value={anchor.dateFormat ?? 'long'} onChange={(e) => set({ dateFormat: e.target.value as DateFormat })}>
                  <option value="long">November 1, 2026</option>
                  <option value="longDayFirst">1 November 2026</option>
                  <option value="short">11/01/2026</option>
                  <option value="iso">2026-11-01</option>
                </Select>
              )}
            </Label>
          )}
          {field && ['text', 'longtext', 'select'].includes(field.type) && (
            <Label label="Capitals">
              {(id) => (
                <Select id={id} value={anchor.textCase ?? 'none'} onChange={(e) => set({ textCase: e.target.value as TextCase })}>
                  <option value="none">As answered</option>
                  <option value="upper">ALL CAPITALS</option>
                  <option value="title">Each Word Capitalised</option>
                  <option value="lower">all lowercase</option>
                </Select>
              )}
            </Label>
          )}
        </>
      )}

      {anchor.kind === 'conditional' && (
        <>
          <p className="text-[13px] leading-relaxed text-muted">
            {anchor.block ? 'This whole block is kept only when the rule holds. Numbering after it adjusts by itself.' : 'These words are kept only when the rule holds.'}
          </p>
          <RuleBuilder rule={anchor.when} fields={reachable} onChange={(when) => set({ when })} />
        </>
      )}

      {anchor.kind === 'alternatives' && (
        <>
          <Label label="Wording depends on">
            {(id) => (
              <Select id={id} value={anchor.field} onChange={(e) => set({ field: e.target.value, variants: {} })}>
                {!field && <option value={anchor.field}>Deleted question</option>}
                {reachable.filter((f) => f.type === 'select' || f.type === 'boolean').map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </Select>
            )}
          </Label>
          {field && <Button size="sm" onClick={() => onEditField(field.id)}>Edit options</Button>}
          {(field?.type === 'boolean' ? [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] : (field?.options ?? [])).map((o) => (
            <Label key={o.value} label={`When the answer is “${o.label}”`}>
              {(id) => <Textarea id={id} rows={2} value={anchor.variants[o.value] ?? ''} onChange={(e) => set({ variants: { ...anchor.variants, [o.value]: e.target.value } })} />}
            </Label>
          ))}
        </>
      )}

      {anchor.kind === 'repeat' && (() => {
        const group = definition.groups.find((g) => g.id === anchor.group);
        if (!group) return <p className="text-sm text-wax">This block lost its group. Remove it and mark it again.</p>;
        const setGroup = (patch: Partial<typeof group>) => onChange({ ...definition, groups: definition.groups.map((g) => (g.id === group.id ? { ...g, ...patch } : g)) });
        const inside = definition.fields.filter((f) => f.group === group.id);
        return (
          <>
            <p className="text-[13px] leading-relaxed text-muted">
              This {anchor.rows ? 'table row' : 'block'} repeats once per entry. Questions you place inside it are asked for each entry.
            </p>
            <Label label="Name of the list">{(id) => <Input id={id} value={group.label} onChange={(e) => setGroup({ label: e.target.value })} />}</Label>
            <Label label="One entry is called" hint="Used on the Add button.">{(id) => <Input id={id} value={group.itemLabel} onChange={(e) => setGroup({ itemLabel: e.target.value })} />}</Label>
            <Label label="Fewest entries allowed">
              {(id) => <Input id={id} type="number" min={0} max={50} value={group.min ?? 0} onChange={(e) => setGroup({ min: Math.max(0, Number(e.target.value) || 0) })} />}
            </Label>
            <Label label="Who answers">
              {(id) => (
                <Select id={id} value={group.audience} onChange={(e) => setGroup({ audience: e.target.value as 'requester' | 'legal' })}>
                  <option value="requester">The requester</option>
                  <option value="legal">Legal, during review</option>
                </Select>
              )}
            </Label>
            <p className="text-[13px] text-muted">
              {inside.length ? `Asked per entry: ${inside.map((f) => f.label).join(', ')}` : 'No questions inside yet. Select a placeholder within this block and choose Question.'}
            </p>
          </>
        );
      })()}

      {anchor.kind === 'signature' && (
        <>
          <Label label="Who signs here">
            {(id) => (
              <Select id={id} value={anchor.signer} onChange={(e) => set({ signer: e.target.value })}>
                {definition.signers.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </Select>
            )}
          </Label>
          <Label label="What goes here">
            {(id) => (
              <Select id={id} value={anchor.part} onChange={(e) => set({ part: e.target.value as SignaturePart })}>
                <option value="signature">Signature</option>
                <option value="initials">Initials</option>
                <option value="date">Date signed</option>
              </Select>
            )}
          </Label>
          <Button size="sm" onClick={onShowSigners}>Manage signers</Button>
        </>
      )}

      <div className="border-t border-line-soft pt-3">
        <Button size="sm" variant="danger" onClick={() => { onChange(removeAnchor(definition, anchor.id)); onRemoved(); }}>
          <Trash2 size={14} /> Remove this mark
        </Button>
      </div>
    </div>
  );
}
