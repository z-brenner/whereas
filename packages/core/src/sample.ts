import type { Docx } from './docx';
import { blockRange, findText } from './locate';
import type { Range, TemplateDefinition } from './types';

/**
 * A complete definition for fixtures/services-agreement.docx. It exercises
 * every anchor kind and doubles as the demo template on a fresh install.
 */
export function sampleDefinition(docx: Docx): TemplateDefinition {
  const at = (quote: string, nth = 0): Range => {
    const r = findText(docx, quote, nth);
    if (!r) throw new Error(`Sample text not found: ${quote}`);
    return r;
  };
  const para = (quote: string) => {
    const p = at(quote).start.p;
    return blockRange(docx, p, p);
  };
  const row = (quote: string) => {
    const p = at(quote).start.p;
    return blockRange(docx, p, p, true);
  };

  return {
    schema: 1,
    fields: [
      { id: 'counterparty_name', label: 'Counterparty legal name', type: 'text', required: true, audience: 'requester' },
      {
        id: 'entity_type',
        label: 'Counterparty entity type',
        type: 'select',
        required: true,
        audience: 'requester',
        options: [
          { value: 'de_corp', label: 'Delaware corporation' },
          { value: 'ca_llc', label: 'California limited liability company' },
          { value: 'individual', label: 'sole proprietor' },
        ],
      },
      { id: 'effective_date', label: 'Effective date', type: 'date', required: true, audience: 'requester' },
      { id: 'fee_amount', label: 'Total fees', type: 'currency', currency: 'USD', required: true, audience: 'requester' },
      {
        id: 'payment_terms',
        label: 'Payment terms',
        type: 'select',
        required: true,
        audience: 'requester',
        defaultValue: '30',
        options: [
          { value: '30', label: '30' },
          { value: '45', label: '45' },
          { value: '60', label: '60' },
        ],
      },
      {
        id: 'term_length',
        label: 'How long will the engagement run?',
        type: 'select',
        required: true,
        audience: 'requester',
        options: [
          { value: '1y', label: 'One year' },
          { value: '2y', label: 'Two years' },
          { value: 'project', label: 'Until the work is done' },
        ],
      },
      {
        id: 'expenses_reimbursed',
        label: 'Will we reimburse travel expenses?',
        type: 'boolean',
        required: false,
        audience: 'requester',
        defaultValue: false,
      },
      {
        id: 'personal_data',
        label: 'Will the provider handle personal data?',
        help: 'Customer, employee or member information of any kind.',
        type: 'boolean',
        required: true,
        audience: 'requester',
      },
      {
        id: 'data_categories',
        label: 'What kinds of personal data?',
        type: 'multiselect',
        required: true,
        audience: 'requester',
        visibleWhen: { field: 'personal_data', op: 'eq', value: true },
        options: [
          { value: 'contact', label: 'Contact details' },
          { value: 'financial', label: 'Financial information' },
          { value: 'health', label: 'Health information' },
        ],
      },
      { id: 'deliverable', label: 'Deliverable', type: 'text', required: true, audience: 'requester', group: 'deliverables' },
      { id: 'due_date', label: 'Due date', type: 'date', required: true, audience: 'requester', group: 'deliverables' },
      { id: 'deliverable_fee', label: 'Fee', type: 'currency', currency: 'USD', required: false, audience: 'requester', group: 'deliverables' },
      { id: 'provider_signer_name', label: 'Who signs for the counterparty?', type: 'text', required: true, audience: 'requester' },
      { id: 'provider_signer_email', label: 'Their email address', type: 'email', required: true, audience: 'requester' },
      {
        id: 'governing_law',
        label: 'Governing law',
        type: 'select',
        required: true,
        audience: 'legal',
        defaultValue: 'California',
        options: [
          { value: 'California', label: 'the State of California' },
          { value: 'Delaware', label: 'the State of Delaware' },
          { value: 'New York', label: 'the State of New York' },
        ],
      },
      { id: 'company_signer_name', label: 'Who signs for us?', type: 'text', required: true, audience: 'legal' },
    ],
    groups: [
      { id: 'deliverables', label: 'Deliverables', itemLabel: 'Deliverable', min: 1, audience: 'requester' },
    ],
    tasks: ['Confirm budget owner approval', 'Check counterparty entity details'],
    signers: [
      { id: 'company', label: 'Company', order: 1, nameField: 'company_signer_name' },
      { id: 'provider', label: 'Provider', order: 2, nameField: 'provider_signer_name', emailField: 'provider_signer_email' },
    ],
    anchors: [
      { id: 'a_date', kind: 'field', field: 'effective_date', range: at('[EFFECTIVE DATE]'), dateFormat: 'long' },
      { id: 'a_cp', kind: 'field', field: 'counterparty_name', range: at('[COUNTERPARTY NAME]') },
      { id: 'a_entity', kind: 'field', field: 'entity_type', range: at('[ENTITY TYPE]') },
      { id: 'a_fee', kind: 'field', field: 'fee_amount', range: at('[FEE AMOUNT]') },
      { id: 'a_terms', kind: 'field', field: 'payment_terms', range: at('[PAYMENT TERMS]') },
      {
        id: 'a_term',
        kind: 'alternatives',
        field: 'term_length',
        range: at('[TERM]'),
        variants: { '1y': 'one (1) year', '2y': 'two (2) years', project: 'as long as any statement of work remains open' },
      },
      { id: 'a_law', kind: 'field', field: 'governing_law', range: at('[GOVERNING LAW]') },
      {
        id: 'c_expenses',
        kind: 'conditional',
        block: true,
        range: para('Expenses. Company will reimburse'),
        when: { field: 'expenses_reimbursed', op: 'eq', value: true },
      },
      {
        id: 'c_data',
        kind: 'conditional',
        block: true,
        range: para('Data Protection. Provider will process'),
        when: { field: 'personal_data', op: 'eq', value: true },
      },
      {
        id: 'c_dpa',
        kind: 'conditional',
        block: false,
        range: at(' and in line with the Data Processing Addendum'),
        when: {
          all: [
            { field: 'personal_data', op: 'eq', value: true },
            { any: [{ field: 'data_categories', op: 'contains', value: 'health' }, { field: 'data_categories', op: 'contains', value: 'financial' }] },
          ],
        },
      },
      { id: 'r_deliv', kind: 'repeat', block: true, rows: true, group: 'deliverables', range: row('[DELIVERABLE]') },
      { id: 'a_deliv', kind: 'field', field: 'deliverable', range: at('[DELIVERABLE]') },
      { id: 'a_due', kind: 'field', field: 'due_date', range: at('[DUE DATE]'), dateFormat: 'short' },
      { id: 'a_dfee', kind: 'field', field: 'deliverable_fee', range: at('[DELIVERABLE FEE]') },
      { id: 'a_cp2', kind: 'field', field: 'counterparty_name', range: at('[COUNTERPARTY NAME]', 1), textCase: 'upper' },
      { id: 's_co', kind: 'signature', signer: 'company', part: 'signature', range: at('[COMPANY SIGNATURE]') },
      { id: 's_pr', kind: 'signature', signer: 'provider', part: 'signature', range: at('[PROVIDER SIGNATURE]') },
      { id: 'a_cos', kind: 'field', field: 'company_signer_name', range: at('[COMPANY SIGNER]') },
      { id: 'a_prs', kind: 'field', field: 'provider_signer_name', range: at('[PROVIDER SIGNER]') },
      { id: 's_cod', kind: 'signature', signer: 'company', part: 'date', range: at('[COMPANY DATE]') },
      { id: 's_prd', kind: 'signature', signer: 'provider', part: 'date', range: at('[PROVIDER DATE]') },
    ],
  };
}

export const sampleAnswers = {
  counterparty_name: 'Northwind Analytics LLC',
  entity_type: 'ca_llc',
  effective_date: '2026-11-01',
  fee_amount: 48500,
  payment_terms: '45',
  term_length: '2y',
  expenses_reimbursed: false,
  personal_data: true,
  data_categories: ['contact', 'health'],
  deliverables: [
    { deliverable: 'Discovery report', due_date: '2026-12-15', deliverable_fee: 12000 },
    { deliverable: 'Pilot dashboard', due_date: '2027-02-01', deliverable_fee: 36500 },
  ],
  provider_signer_name: 'Dana Whitfield',
  provider_signer_email: 'dana@northwind.example',
  governing_law: 'California',
  company_signer_name: 'Morgan Reyes',
};
