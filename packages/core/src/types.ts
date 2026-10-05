/**
 * The template definition is an overlay on an untouched DOCX. The DOCX is
 * never modified; everything Whereas knows about a template lives here.
 */

export const DEFINITION_SCHEMA = 1 as const;

/** A position inside the document: paragraph index and character offset. */
export interface Pos {
  /** Index of the paragraph in document order (see `listParagraphs`). */
  p: number;
  /** Character offset inside that paragraph's text. */
  o: number;
}

export interface Range {
  start: Pos;
  end: Pos;
  /** The text the range covered when it was created. Used to detect drift. */
  quote: string;
}

export type FieldType =
  | 'text'
  | 'longtext'
  | 'number'
  | 'currency'
  | 'date'
  | 'select'
  | 'multiselect'
  | 'boolean'
  | 'email';

export interface FieldOption {
  value: string;
  label: string;
}

export interface Field {
  /** Stable slug, unique in the template. Answers are keyed by it. */
  id: string;
  label: string;
  help?: string;
  type: FieldType;
  required: boolean;
  /** Who answers: the requester on intake, or legal during review. */
  audience: 'requester' | 'legal';
  options?: FieldOption[];
  /** ISO 4217 code for currency fields. */
  currency?: string;
  defaultValue?: AnswerValue;
  /** The question is only asked when this rule holds. */
  visibleWhen?: Rule;
  /** Set when the question belongs to a repeating group. */
  group?: string;
}

export interface Group {
  id: string;
  label: string;
  /** Label for one entry, e.g. "Deliverable". */
  itemLabel: string;
  min?: number;
  max?: number;
  audience: 'requester' | 'legal';
  visibleWhen?: Rule;
}

export type RuleOp =
  | 'eq'
  | 'neq'
  | 'in'
  | 'contains'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'empty'
  | 'notEmpty';

export interface Condition {
  field: string;
  op: RuleOp;
  value?: AnswerValue;
}

/** Conditions nest, so "A and (B or C)" is expressible. */
export type Rule = Condition | { all: Rule[] } | { any: Rule[] } | { not: Rule };

export type DateFormat = 'long' | 'longDayFirst' | 'short' | 'iso';
export type TextCase = 'none' | 'upper' | 'lower' | 'title';

interface AnchorBase {
  id: string;
  range: Range;
}

/** Replace the range with the answer to a question. */
export interface FieldAnchor extends AnchorBase {
  kind: 'field';
  field: string;
  dateFormat?: DateFormat;
  textCase?: TextCase;
}

/** Keep the range only when the rule holds. */
export interface ConditionalAnchor extends AnchorBase {
  kind: 'conditional';
  /** True when the range covers whole paragraphs or table rows. */
  block: boolean;
  /** With `block`, treat the range as the table rows it touches. */
  rows?: boolean;
  when: Rule;
}

/** Replace the range with wording chosen by the answer to a question. */
export interface AlternativesAnchor extends AnchorBase {
  kind: 'alternatives';
  field: string;
  variants: Record<string, string>;
  otherwise?: string;
}

/** Repeat whole paragraphs or table rows once per entry in a group. */
export interface RepeatAnchor extends AnchorBase {
  kind: 'repeat';
  block: true;
  /** Treat the range as the table rows it touches. */
  rows?: boolean;
  group: string;
}

export type SignaturePart = 'signature' | 'initials' | 'date';

/** Where a signer signs. Becomes a provider tag when sent for signature. */
export interface SignatureAnchor extends AnchorBase {
  kind: 'signature';
  signer: string;
  part: SignaturePart;
}

export type Anchor =
  | FieldAnchor
  | ConditionalAnchor
  | AlternativesAnchor
  | RepeatAnchor
  | SignatureAnchor;

export interface SignerRole {
  id: string;
  label: string;
  /** Questions that supply this signer's details, if asked on intake. */
  nameField?: string;
  emailField?: string;
  order: number;
}

export interface TemplateDefinition {
  schema: typeof DEFINITION_SCHEMA;
  fields: Field[];
  groups: Group[];
  anchors: Anchor[];
  signers: SignerRole[];
}

export type Scalar = string | number | boolean | null;
export type AnswerValue = Scalar | string[];
export type ItemAnswers = Record<string, AnswerValue>;
/** Answers keyed by field id; a group id maps to its list of entries. */
export type Answers = Record<string, AnswerValue | ItemAnswers[]>;

export function emptyDefinition(): TemplateDefinition {
  return { schema: DEFINITION_SCHEMA, fields: [], groups: [], anchors: [], signers: [] };
}
