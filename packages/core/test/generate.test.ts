import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MissingAnswersError,
  generateDocx,
  listParagraphs,
  paragraphText,
  previewDocx,
  readDocx,
  renderDocx,
  sampleAnswers,
  sampleDefinition,
  signatureTagFor,
  validateDefinition,
  type Answers,
  type RenderBlock,
} from '../src';

const FIXTURES = join(__dirname, '../../../fixtures');
const variants = ['services-agreement.docx', 'services-agreement.libreoffice.docx'];

function textOf(bytes: Uint8Array): string[] {
  return listParagraphs(readDocx(bytes).document).map(paragraphText);
}

function labels(blocks: RenderBlock[]): string[] {
  return blocks.flatMap((b) => (b.type === 'p' && b.label ? [`${b.label.text} ${b.text.slice(0, 12)}`] : []));
}

describe.each(variants)('generation from %s', (file) => {
  const template = new Uint8Array(readFileSync(join(FIXTURES, file)));
  const def = sampleDefinition(readDocx(template));

  it('has a valid sample definition', () => {
    expect(validateDefinition(readDocx(template), def)).toEqual([]);
  });

  it('fills fields, including a placeholder split across runs', () => {
    const text = textOf(generateDocx(template, def, sampleAnswers)).join('\n');
    expect(text).toContain('entered into as of November 1, 2026 between');
    expect(text).toContain('and Northwind Analytics LLC, a California limited liability company (“Provider”)');
    expect(text).toContain('pay Provider $48,500.00 within 45 days');
    expect(text).toContain('continues for two (2) years unless');
    expect(text).toContain('laws of the State of California,');
    expect(text).toContain('NORTHWIND ANALYTICS LLC');
    expect(text).not.toMatch(/\[[A-Z ]+\]/);
  });

  it('removes a clause whose condition is false and keeps one that is true', () => {
    const text = textOf(generateDocx(template, def, sampleAnswers)).join('\n');
    expect(text).not.toContain('Expenses.');
    expect(text).toContain('Data Protection.');
    expect(text).toContain('in line with the Data Processing Addendum');
  });

  it('evaluates nested and/or conditions', () => {
    const answers: Answers = { ...sampleAnswers, data_categories: ['contact'] };
    const text = textOf(generateDocx(template, def, answers)).join('\n');
    expect(text).toContain('documented instructions.');
    expect(text).not.toContain('Data Processing Addendum');
  });

  it('repeats a table row once per entry', () => {
    const text = textOf(generateDocx(template, def, sampleAnswers));
    const i = text.indexOf('Discovery report');
    expect(text.slice(i, i + 6)).toEqual([
      'Discovery report', '12/15/2026', '$12,000.00',
      'Pilot dashboard', '02/01/2027', '$36,500.00',
    ]);
  });

  it('renumbers the clauses that remain', () => {
    const all = renderDocx(previewDocx(readDocx(template), def, { ...sampleAnswers, expenses_reimbursed: true }));
    const some = renderDocx(previewDocx(readDocx(template), def, { ...sampleAnswers, personal_data: false, data_categories: [] }));
    expect(labels(all.blocks).map((l) => l.split(' ')[0])).toEqual(['1.', '2.', '3.', '4.', '5.', '6.', '7.']);
    const kept = labels(some.blocks);
    expect(kept.map((l) => l.split(' ')[0])).toEqual(['1.', '2.', '3.', '4.', '5.']);
    expect(kept[3]).toContain('Term.');
  });

  it('refuses to produce a final document with required answers missing', () => {
    const { counterparty_name: _omit, ...partial } = sampleAnswers;
    expect(() => generateDocx(template, def, partial)).toThrow(MissingAnswersError);
  });

  it('does not ask for answers to hidden questions', () => {
    const answers: Answers = { ...sampleAnswers, personal_data: false };
    delete answers.data_categories;
    expect(() => generateDocx(template, def, answers)).not.toThrow();
  });

  it('ignores a stale answer to a question that is no longer asked', () => {
    // "health" was ticked, then the requester said no personal data is involved.
    const answers: Answers = { ...sampleAnswers, personal_data: false, data_categories: ['health'] };
    const def2 = {
      ...def,
      anchors: def.anchors.map((a) =>
        a.id === 'c_dpa' ? { ...a, when: { field: 'data_categories', op: 'contains' as const, value: 'health' } } : a,
      ),
    };
    const withData = textOf(generateDocx(template, def2, { ...answers, personal_data: true })).join('\n');
    expect(withData).toContain('Data Processing Addendum');
    const kept = def2.anchors.filter((a) => a.id !== 'c_data');
    const text = textOf(generateDocx(template, { ...def2, anchors: kept }, answers)).join('\n');
    expect(text).toContain('Data Protection.');
    expect(text).not.toContain('Data Processing Addendum');
  });

  it('writes provider signature tags and leaves no working markers behind', () => {
    const out = generateDocx(template, def, sampleAnswers, { signatureTag: signatureTagFor('docuseal') });
    const text = textOf(out).join('\n');
    expect(text).toContain('By: {{Signature;role=Company;type=signature}}');
    expect(text).toContain('Date: {{Date;role=Provider;type=date}}');
    const xml = new TextDecoder().decode(readDocx(out).files['word/document.xml']);
    expect(xml).not.toContain('wa-');
  });

  it('hides DocuSign anchors in white text', () => {
    const out = generateDocx(template, def, sampleAnswers, { signatureTag: signatureTagFor('docusign') });
    const xml = new TextDecoder().decode(readDocx(out).files['word/document.xml']);
    expect(xml).toMatch(/<w:color w:val="FFFFFF"\/>.*?\/wa_signature_1\//s);
  });

  it('does not change the template it reads from', () => {
    const before = Buffer.from(template).toString('base64');
    generateDocx(template, def, sampleAnswers);
    previewDocx(readDocx(template), def, {});
    expect(Buffer.from(template).toString('base64')).toBe(before);
  });

  it('shows labelled placeholders in a preview with nothing answered', () => {
    const doc = renderDocx(previewDocx(readDocx(template), def, {}));
    const spans = doc.blocks.flatMap((b) => (b.type === 'p' ? b.spans : []));
    const empty = spans.filter((s) => s.empty).map((s) => s.text);
    expect(empty).toContain('[Counterparty legal name]');
    expect(empty).toContain('[Effective date]');
  });

  it('produces a document LibreOffice can open and convert', () => {
    const dir = mkdtempSync(join(tmpdir(), 'whereas-'));
    const path = join(dir, 'out.docx');
    writeFileSync(path, generateDocx(template, def, sampleAnswers));
    execFileSync('soffice', ['--headless', '--convert-to', 'txt:Text', '--outdir', dir, path], { stdio: 'ignore' });
    const txt = readFileSync(join(dir, 'out.txt'), 'utf8');
    expect(txt).toContain('Northwind Analytics LLC');
    expect(txt).toContain('Pilot dashboard');
  }, 120_000);
});

describe('validation', () => {
  const template = new Uint8Array(readFileSync(join(FIXTURES, variants[0]!)));
  const docx = readDocx(template);
  const def = sampleDefinition(docx);

  it('rejects overlapping replacements', () => {
    const cp = def.anchors.find((a) => a.id === 'a_cp')!;
    const clash = {
      ...cp,
      id: 'clash',
      range: { ...cp.range, start: { ...cp.range.start, o: cp.range.start.o + 3 }, quote: cp.range.quote.slice(3) },
    };
    const problems = validateDefinition(docx, { ...def, anchors: [...def.anchors, clash] });
    expect(problems.some((p) => p.message.includes('overlap'))).toBe(true);
  });

  it('rejects a repeating question placed outside its block', () => {
    const law = def.anchors.find((a) => a.id === 'a_law')!;
    const moved = { ...law, id: 'moved', field: 'deliverable' };
    const anchors = def.anchors.filter((a) => a.id !== 'a_law');
    const problems = validateDefinition(docx, { ...def, anchors: [...anchors, moved as typeof law] });
    expect(problems.some((p) => p.message.includes('repeating block'))).toBe(true);
  });

  it('detects text that no longer matches', () => {
    const cp = def.anchors.find((a) => a.id === 'a_cp')!;
    const stale = { ...cp, range: { ...cp.range, quote: '[SOMETHING ELSE]' } };
    const problems = validateDefinition(docx, { ...def, anchors: def.anchors.map((a) => (a.id === 'a_cp' ? stale : a)) });
    expect(problems.some((p) => p.message.includes('no longer matches'))).toBe(true);
  });
});

describe('hostile and awkward input', () => {
  const template = new Uint8Array(readFileSync(join(FIXTURES, variants[0]!)));
  const docx = readDocx(template);
  const def = sampleDefinition(docx);

  it('keeps the document readable when an answer carries control characters', () => {
    const answers: Answers = { ...sampleAnswers, counterparty_name: 'North\u000Bwind\u0001 \uD800LLC\r\nInc' };
    const out = generateDocx(template, def, answers);
    const text = textOf(out).join('|');
    expect(text).toContain('North\nwind LLC\nInc');
    const xml = new TextDecoder().decode(readDocx(out).files['word/document.xml']);
    // eslint-disable-next-line no-control-regex
    expect(xml).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
  });

  it('treats answers named like built-in properties as ordinary answers', () => {
    const law = def.anchors.find((a) => a.id === 'a_law')!;
    const odd = {
      ...def,
      fields: [...def.fields, { id: 'constructor', label: 'Constructor', type: 'text' as const, required: true, audience: 'requester' as const }],
      anchors: def.anchors.map((a) => (a.id === 'a_law' ? { ...law, field: 'constructor' } : a)),
    };
    expect(() => generateDocx(template, odd, sampleAnswers)).toThrow(MissingAnswersError);
    const text = textOf(generateDocx(template, odd, { ...sampleAnswers, constructor: 'Ohio' } as Answers)).join('\n');
    expect(text).toContain('laws of Ohio,');
    const termAnswer = { ...sampleAnswers, term_length: 'constructor' } as Answers;
    expect(() => generateDocx(template, def, termAnswer)).not.toThrow();
  });

  it('rejects duplicate, malformed and out-of-range marks', () => {
    const cp = def.anchors.find((a) => a.id === 'a_cp')!;
    const messages = (anchors: typeof def.anchors) => validateDefinition(docx, { ...def, anchors }).map((p) => p.message).join('|');
    expect(messages([...def.anchors, { ...cp }])).toContain('share the same id');
    expect(messages([...def.anchors.filter((a) => a.id !== 'a_cp'), { ...cp, id: 'has space' }])).toContain('invalid id');
    const outside = { ...cp, id: 'far', range: { start: { p: cp.range.start.p, o: 9000 }, end: { p: cp.range.start.p, o: 9000 }, quote: '' } };
    expect(messages([...def.anchors, outside])).toContain('outside its paragraph');
  });

  it('removes an insertion point along with the words around it', () => {
    const dpa = def.anchors.find((a) => a.id === 'c_dpa')!;
    const point = { p: dpa.range.start.p, o: dpa.range.start.o + 4 };
    const insert = { id: 'ins', kind: 'field' as const, field: 'counterparty_name', range: { start: point, end: point, quote: '' } };
    const withInsert = { ...def, anchors: [...def.anchors, insert] };
    expect(validateDefinition(docx, withInsert)).toEqual([]);
    const hidden = textOf(generateDocx(template, withInsert, { ...sampleAnswers, data_categories: ['contact'] })).join('\n');
    expect(hidden).toContain('documented instructions.');
    const shown = textOf(generateDocx(template, withInsert, sampleAnswers)).join('\n');
    expect(shown).toContain('instructions andNorthwind Analytics LLC in line with');
  });

  it('refuses an archive that expands far beyond a real document', async () => {
    const { zipSync } = await import('fflate');
    const bomb = zipSync({ 'word/document.xml': new Uint8Array(70 * 1024 * 1024) }, { level: 9 });
    expect(bomb.length).toBeLessThan(1024 * 1024);
    expect(() => readDocx(bomb)).toThrow('too large');
  });
});
