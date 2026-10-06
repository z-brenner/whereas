import { blockRange, isInTable, listParagraphs, type Anchor, type Docx, type Field, type FieldType, type Range, type TemplateDefinition } from '@whereas/core';
import type { DocSelection } from '../doc/DocView';
import { slugify } from '../lib/format';

export type AnchorKind = Anchor['kind'];

export const KIND_LABEL: Record<AnchorKind, string> = {
  field: 'Question',
  conditional: 'Condition',
  alternatives: 'Wording',
  repeat: 'Repeat',
  signature: 'Signature',
};

const newId = (): string => `a_${Math.random().toString(36).slice(2, 10)}`;

/** "[COUNTERPARTY NAME]" becomes "Counterparty name". */
export function labelFromText(text: string): string {
  const clean = text.replace(/[[\]{}<>_*]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return 'New question';
  const lower = clean === clean.toUpperCase() ? clean.toLowerCase() : clean;
  return (lower.charAt(0).toUpperCase() + lower.slice(1)).slice(0, 80);
}

function guessType(label: string): FieldType {
  const l = label.toLowerCase();
  if (/\b(date|day|deadline|effective|expir)/.test(l)) return 'date';
  if (/\b(fee|fees|price|amount|cost|rate|salary|budget|cap)\b/.test(l)) return 'currency';
  if (/\b(e-?mail)\b/.test(l)) return 'email';
  if (/\b(number|count|quantity|days|months|years|percent)\b/.test(l)) return 'number';
  return 'text';
}

export function newField(def: TemplateDefinition, label: string, patch: Partial<Field> = {}): Field {
  const type = patch.type ?? guessType(label);
  return {
    id: slugify(label, [...def.fields.map((f) => f.id), ...def.groups.map((g) => g.id), ...def.signers.map((s) => s.id)]),
    label,
    type,
    required: true,
    audience: 'requester',
    ...(type === 'currency' ? { currency: 'USD' } : {}),
    ...patch,
  };
}

function ranges(docx: Docx, sel: DocSelection, block: boolean, preferRows: boolean): { range: Range; rows: boolean } {
  if (!block) return { range: { start: sel.start, end: sel.end, quote: sel.text }, rows: false };
  const paragraphs = listParagraphs(docx.document);
  const rows = preferRows && isInTable(paragraphs, sel.start.p) && isInTable(paragraphs, sel.end.p);
  try {
    return { range: blockRange(docx, sel.start.p, sel.end.p, rows), rows };
  } catch {
    return { range: blockRange(docx, sel.start.p, sel.end.p, false), rows: false };
  }
}

/** Which kinds of anchor a selection can become. */
export function allowed(sel: DocSelection): Record<AnchorKind, boolean> {
  const inline = sel.start.p === sel.end.p;
  return { field: inline, alternatives: inline, signature: inline, conditional: true, repeat: true };
}

export interface Added {
  definition: TemplateDefinition;
  anchorId: string;
}

export function addAnchor(def: TemplateDefinition, docx: Docx, sel: DocSelection, kind: AnchorKind): Added {
  const id = newId();
  const inline = sel.start.p === sel.end.p;
  const inRepeat = def.anchors.find(
    (a) => a.kind === 'repeat' && a.range.start.p <= sel.start.p && sel.end.p <= a.range.end.p,
  ) as Extract<Anchor, { kind: 'repeat' }> | undefined;

  switch (kind) {
    case 'field': {
      const label = labelFromText(sel.text);
      // Reuse a question with the same label, so "[NAME]" twice asks once.
      let field = def.fields.find((f) => f.label.toLowerCase() === label.toLowerCase() && (f.group ?? null) === (inRepeat?.group ?? null));
      let fields = def.fields;
      if (!field) {
        field = newField(def, label, inRepeat ? { group: inRepeat.group } : {});
        fields = [...fields, field];
      }
      const { range } = ranges(docx, sel, false, false);
      return { anchorId: id, definition: { ...def, fields, anchors: [...def.anchors, { id, kind: 'field', field: field.id, range }] } };
    }
    case 'alternatives': {
      const { range } = ranges(docx, sel, false, false);
      let field = def.fields.find((f) => f.type === 'select' && !f.group);
      let fields = def.fields;
      if (!field) {
        field = newField(def, 'Which wording applies?', {
          type: 'select',
          options: [{ value: 'standard', label: 'Standard' }, { value: 'alternative', label: 'Alternative' }],
        });
        fields = [...fields, field];
      }
      const first = field.options?.[0]?.value ?? 'standard';
      return {
        anchorId: id,
        definition: { ...def, fields, anchors: [...def.anchors, { id, kind: 'alternatives', field: field.id, range, variants: { [first]: sel.text } }] },
      };
    }
    case 'signature': {
      const { range } = ranges(docx, sel, false, false);
      let signers = def.signers;
      let signer = signers[0];
      if (!signer) {
        signer = { id: 'company', label: 'Company', order: 1 };
        signers = [signer, { id: 'counterparty', label: 'Counterparty', order: 2 }];
      }
      const part = /date/i.test(sel.text) ? 'date' : /initial/i.test(sel.text) ? 'initials' : 'signature';
      // A second mark on the same line is probably the other party's.
      const usedFor = (s: string) => def.anchors.some((a) => a.kind === 'signature' && a.signer === s && a.part === part);
      signer = signers.find((s) => !usedFor(s.id)) ?? signer;
      return { anchorId: id, definition: { ...def, signers, anchors: [...def.anchors, { id, kind: 'signature', signer: signer.id, part, range }] } };
    }
    case 'conditional': {
      const block = !inline || sel.whole;
      const { range, rows } = ranges(docx, sel, block, !inline);
      return {
        anchorId: id,
        definition: { ...def, anchors: [...def.anchors, { id, kind: 'conditional', block, ...(rows ? { rows } : {}), range, when: { all: [] } }] },
      };
    }
    case 'repeat': {
      const { range, rows } = ranges(docx, sel, true, true);
      const groupId = slugify('items', [...def.fields.map((f) => f.id), ...def.groups.map((g) => g.id)]);
      const group = { id: groupId, label: 'Items', itemLabel: 'Item', min: 1, audience: 'requester' as const };
      // Questions already placed inside the block now belong to the group.
      const inside = new Set(
        def.anchors
          .filter((a) => (a.kind === 'field' || a.kind === 'alternatives') && a.range.start.p >= range.start.p && a.range.end.p <= range.end.p)
          .map((a) => (a as { field: string }).field),
      );
      const outside = new Set(
        def.anchors
          .filter((a) => (a.kind === 'field' || a.kind === 'alternatives') && !(a.range.start.p >= range.start.p && a.range.end.p <= range.end.p))
          .map((a) => (a as { field: string }).field),
      );
      const fields = def.fields.map((f) => (inside.has(f.id) && !outside.has(f.id) && !f.group ? { ...f, group: groupId } : f));
      return {
        anchorId: id,
        definition: { ...def, fields, groups: [...def.groups, group], anchors: [...def.anchors, { id, kind: 'repeat', block: true, ...(rows ? { rows } : {}), group: groupId, range }] },
      };
    }
  }
}

export function removeAnchor(def: TemplateDefinition, anchorId: string): TemplateDefinition {
  const anchor = def.anchors.find((a) => a.id === anchorId);
  let next = { ...def, anchors: def.anchors.filter((a) => a.id !== anchorId) };
  if (anchor?.kind === 'repeat') {
    // Without its block a group cannot be asked; its questions become ordinary ones.
    next = {
      ...next,
      groups: next.groups.filter((g) => g.id !== anchor.group),
      fields: next.fields.map((f) => (f.group === anchor.group ? { ...f, group: undefined } : f)),
    };
  }
  return next;
}

export function removeField(def: TemplateDefinition, fieldId: string): TemplateDefinition {
  return {
    ...def,
    fields: def.fields.filter((f) => f.id !== fieldId),
    anchors: def.anchors.filter((a) => !((a.kind === 'field' || a.kind === 'alternatives') && a.field === fieldId)),
    signers: def.signers.map((s) => ({
      ...s,
      nameField: s.nameField === fieldId ? undefined : s.nameField,
      emailField: s.emailField === fieldId ? undefined : s.emailField,
    })),
  };
}

export function updateAnchor(def: TemplateDefinition, anchorId: string, patch: Partial<Anchor>): TemplateDefinition {
  return { ...def, anchors: def.anchors.map((a) => (a.id === anchorId ? ({ ...a, ...patch } as Anchor) : a)) };
}

export function updateField(def: TemplateDefinition, fieldId: string, patch: Partial<Field>): TemplateDefinition {
  return { ...def, fields: def.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)) };
}

export function placements(def: TemplateDefinition, fieldId: string): number {
  return def.anchors.filter((a) => (a.kind === 'field' || a.kind === 'alternatives') && a.field === fieldId).length;
}
