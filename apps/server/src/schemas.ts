import { z } from 'zod';

const scalar = z.union([z.string().max(20_000), z.number().finite(), z.boolean(), z.null()]);
const answerValue = z.union([scalar, z.array(z.string().max(500)).max(200)]);
const item = z.record(answerValue);
export const answersSchema = z.record(z.union([answerValue, z.array(item).max(200)]));

const condition = z.object({
  field: z.string().min(1),
  op: z.enum(['eq', 'neq', 'in', 'contains', 'gt', 'gte', 'lt', 'lte', 'empty', 'notEmpty']),
  value: answerValue.optional(),
});

type RuleInput = z.infer<typeof condition> | { all: RuleInput[] } | { any: RuleInput[] } | { not: RuleInput };
const rule: z.ZodType<RuleInput> = z.lazy(() =>
  z.union([
    condition,
    z.object({ all: z.array(rule).max(50) }).strict(),
    z.object({ any: z.array(rule).max(50) }).strict(),
    z.object({ not: rule }).strict(),
  ]),
);

const slug = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'Use lowercase letters, numbers and underscores.');
const pos = z.object({ p: z.number().int().min(0), o: z.number().int().min(0) });
const range = z.object({ start: pos, end: pos, quote: z.string().max(5000) });
const audience = z.enum(['requester', 'legal']);

const field = z.object({
  id: slug,
  label: z.string().max(300),
  help: z.string().max(1000).optional(),
  type: z.enum(['text', 'longtext', 'number', 'currency', 'date', 'select', 'multiselect', 'boolean', 'email']),
  required: z.boolean(),
  audience,
  options: z.array(z.object({ value: z.string().min(1).max(200), label: z.string().max(500) })).max(200).optional(),
  currency: z.string().length(3).optional(),
  defaultValue: answerValue.optional(),
  visibleWhen: rule.optional(),
  group: slug.optional(),
});

const group = z.object({
  id: slug,
  label: z.string().max(300),
  itemLabel: z.string().max(100),
  min: z.number().int().min(0).max(200).optional(),
  max: z.number().int().min(1).max(200).optional(),
  audience,
  visibleWhen: rule.optional(),
});

const base = { id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), range };
const anchor = z.discriminatedUnion('kind', [
  z.object({
    ...base,
    kind: z.literal('field'),
    field: slug,
    dateFormat: z.enum(['long', 'longDayFirst', 'short', 'iso']).optional(),
    textCase: z.enum(['none', 'upper', 'lower', 'title']).optional(),
  }),
  z.object({ ...base, kind: z.literal('conditional'), block: z.boolean(), rows: z.boolean().optional(), when: rule }),
  z.object({
    ...base,
    kind: z.literal('alternatives'),
    field: slug,
    variants: z.record(z.string().max(20_000)),
    otherwise: z.string().max(20_000).optional(),
  }),
  z.object({ ...base, kind: z.literal('repeat'), block: z.literal(true), rows: z.boolean().optional(), group: slug }),
  z.object({ ...base, kind: z.literal('signature'), signer: slug, part: z.enum(['signature', 'initials', 'date']) }),
]);

export const definitionSchema = z.object({
  schema: z.literal(1),
  fields: z.array(field).max(500),
  groups: z.array(group).max(50),
  anchors: z.array(anchor).max(2000),
  signers: z
    .array(
      z.object({
        id: slug,
        label: z.string().min(1).max(100),
        nameField: slug.optional(),
        emailField: slug.optional(),
        order: z.number().int().min(1).max(50),
      }),
    )
    .max(20),
  tasks: z.array(z.string().min(1).max(300)).max(50).optional(),
});
