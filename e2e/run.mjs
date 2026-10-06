// End-to-end check of the Stage 1 flow against a running server.
// Usage: BASE_URL=http://localhost:3210 node e2e/run.mjs [screenshot-dir]
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const SHOTS = process.argv[2] ?? 'e2e/screenshots';
mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1480, height: 920 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// A 401 before sign-in and a 422 on an incomplete submit are part of the flow.
const expected = /status of (401|422)/;
page.on('console', (m) => m.type() === 'error' && !expected.test(m.text()) && errors.push(m.text()));
const shot = (name) => page.screenshot({ path: join(SHOTS, `${name}.png`) });

/** Selects the first occurrence of `text` in the document and releases the mouse. */
async function selectInDocument(text) {
  await page.evaluate((needle) => {
    const spans = [...document.querySelectorAll('.doc-page [data-o]')];
    const span = spans.find((s) => s.textContent.includes(needle));
    if (!span) throw new Error(`"${needle}" is not in the document`);
    const node = span.firstChild;
    const at = node.textContent.indexOf(needle);
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + needle.length);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    span.scrollIntoView({ block: 'center' });
    document.querySelector('.doc-page').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, text);
}

// 1. First run: create the admin.
await page.goto(BASE);
await page.waitForURL('**/setup');
await shot('01-setup');
await page.getByLabel('Your name').fill('Morgan Reyes');
await page.getByLabel('Email').fill('morgan@acme.test');
await page.getByLabel('Password').fill('correct horse battery');
await page.getByRole('button', { name: 'Create admin account' }).click();
await page.waitForURL('**/requests');
await page.getByText('Nothing is waiting on you').waitFor();
await shot('02-requests-empty');

// 2. The sample template opens in the builder with its marks.
await page.getByRole('link', { name: 'Templates' }).click();
await page.getByRole('link', { name: /Master Services Agreement/ }).click();
await page.locator('.mark-field').first().waitFor();
assert.ok((await page.locator('.mark-field').count()) >= 8, 'sample marks are drawn');
await shot('03-builder');
await page.locator('.mark-alternatives').first().click();
await page.getByText('Wording depends on').waitFor();
await shot('04-builder-wording');
await page.locator('tr.block-repeat').first().click();
await page.getByLabel('Name of the list').waitFor();
await page.locator('p.block-conditional').first().click();
await page.getByText('This whole block is kept only when').waitFor();
await shot('05-builder-condition');
await page.getByRole('button', { name: 'Try it' }).click();
await page.getByText('Answer as a requester would').waitFor();
await page.getByLabel('Counterparty legal name').fill('Northwind Analytics LLC');
await page.locator('.mark-filled', { hasText: 'Northwind Analytics LLC' }).first().waitFor();
await shot('06-builder-try');

// 3. Build a template from a bare document by selecting text.
await page.getByRole('link', { name: 'Back to templates' }).click();
await page.getByRole('button', { name: 'New template' }).click();
await page.getByLabel('Word document').setInputFiles('fixtures/services-agreement.docx');
await page.getByLabel('Template name').fill('Services agreement (built by hand)');
await page.getByRole('button', { name: 'Upload and set up' }).click();
await page.waitForURL('**/templates/*');
await page.locator('.doc-page').waitFor();
assert.equal(await page.locator('.mark').count(), 0, 'a new template starts unmarked');

await selectInDocument('[EFFECTIVE DATE]');
await page.getByRole('toolbar', { name: 'Mark the selected text' }).waitFor();
await shot('07-selection-toolbar');
await page.getByRole('toolbar').getByRole('button', { name: 'Question' }).click();
await page.getByText('Filled in with the answer to').waitFor();
assert.equal(await page.getByLabel('Date format').count(), 1, 'the question was guessed to be a date');

await selectInDocument('[FEE AMOUNT]');
await page.getByRole('toolbar').getByRole('button', { name: 'Question' }).click();
await selectInDocument('Expenses. Company will reimburse reasonable pre-approved travel expenses at cost.');
await page.getByRole('toolbar').getByRole('button', { name: 'Condition' }).click();
await page.getByText('This whole block is kept only when').waitFor();
await page.getByRole('button', { name: 'Add condition' }).click();
await page.getByRole('combobox', { name: 'Question', exact: true }).selectOption({ label: 'Fee amount' });
await page.getByLabel('Comparison').selectOption({ label: 'is more than' });
await page.getByLabel('Value').fill('10000');
await selectInDocument('[COMPANY SIGNATURE]');
await page.getByRole('toolbar').getByRole('button', { name: 'Signature' }).click();
await page.getByText('Who signs here').waitFor();
await selectInDocument('[DELIVERABLE]');
await page.getByRole('toolbar').getByRole('button', { name: 'Repeat' }).click();
await page.getByLabel('Name of the list').fill('Deliverables');
await page.getByLabel('One entry is called').fill('Deliverable');
await selectInDocument('[DELIVERABLE]');
await page.getByRole('toolbar').getByRole('button', { name: 'Question' }).click();
await page.getByText(/Draft saved/).waitFor();
await shot('08-built-by-hand');
assert.equal(await page.getByRole('button', { name: /to fix/ }).count(), 0, 'the hand-built template has no problems');
await page.getByRole('button', { name: 'Publish', exact: true }).click();
await page.getByText('Published as version 1').waitFor();

// The hand-built template behaves: the clause follows the fee.
await page.getByRole('button', { name: 'Try it' }).click();
await page.getByLabel('Fee amount').fill('5000');
await page.locator('.mark-filled', { hasText: '$5,000.00' }).waitFor();
assert.equal(await page.locator('.doc-page', { hasText: 'Expenses. Company will reimburse' }).count(), 0, 'clause hidden under the threshold');
await page.getByLabel('Fee amount').fill('25000');
await page.locator('.doc-page', { hasText: 'Expenses. Company will reimburse' }).waitFor();
await page.getByRole('button', { name: 'Add deliverable' }).click();
await page.getByRole('button', { name: 'Add deliverable' }).click();
await page.getByLabel(/^Deliverable\*?$/).nth(1).fill('Second milestone');
await page.locator('.mark-filled', { hasText: 'Second milestone' }).waitFor();
await shot('09-built-by-hand-try');

// 4. Request an agreement from the sample.
await page.getByRole('link', { name: 'Back to templates' }).click();
await page.getByRole('link', { name: 'Requests' }).click();
await page.getByRole('button', { name: 'New request' }).click();
await page.getByText('Master Services Agreement (sample)').click();
await page.getByLabel('Name this request').fill('Northwind analytics pilot');
await shot('10-new-request');
await page.getByRole('button', { name: 'Start request' }).click();
await page.waitForURL('**/requests/*');
await page.locator('.doc-page').waitFor();

await page.getByRole('button', { name: 'Send to legal' }).click();
await page.getByText('This answer is required.').first().waitFor();
await shot('11-request-missing');

await page.getByLabel('Counterparty legal name').fill('Northwind Analytics LLC');
await page.getByLabel('Counterparty entity type').selectOption({ label: 'California limited liability company' });
await page.getByLabel('Effective date').fill('2026-11-01');
await page.getByLabel('Total fees').fill('48500');
await page.getByText('Two years', { exact: true }).click();
const yes = page.locator('[data-question="personal_data"]').getByText('Yes', { exact: true });
await yes.click();
await page.getByLabel('Health information').check();
await page.getByRole('button', { name: 'Add deliverable' }).click();
await page.getByLabel(/^Deliverable\*?$/).fill('Discovery report');
await page.getByLabel('Due date').fill('2026-12-15');
await page.getByLabel(/^Fee\*?$/).fill('12000');
await page.getByLabel('Who signs for the counterparty?').fill('Dana Whitfield');
await page.getByLabel('Their email address').fill('dana@northwind.example');
await page.getByLabel('Who signs for us?').fill('Morgan Reyes');
await page.locator('.doc-page', { hasText: 'in line with the Data Processing Addendum' }).waitFor();
await page.locator('.doc-page', { hasText: 'two (2) years' }).waitFor();
await page.getByText('Saved', { exact: true }).waitFor();
await shot('12-request-filled');

await page.getByRole('button', { name: 'Send to legal' }).click();
await page.getByText('Sent to legal').waitFor();
await page.getByRole('button', { name: 'Assign to me' }).click();
await page.getByText('In review').waitFor();
await page.getByLabel('New task').fill('Finance sign-off');
await page.getByRole('button', { name: 'Add task' }).click();
await page.getByText('Finance sign-off').first().waitFor();
await page.getByRole('checkbox', { name: 'Confirm budget owner approval' }).click();
await page.getByText('Tasks (1 of 3)').waitFor();
await shot('13-request-review');

await page.getByRole('button', { name: 'Send for signature' }).click();
await page.getByText('How will it be signed?').waitFor();
await shot('14-send-dialog');
await page.getByRole('button', { name: 'Mark as out for signature' }).click();
await page.getByText('Out for signature').first().waitFor();

const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Word' }).click()]);
assert.match(download.suggestedFilename(), /^REQ-0001 Northwind analytics pilot\.docx$/);

await page.locator('input[type=file]').setInputFiles({ name: 'signed.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 signed') });
await page.getByText('Completed').first().waitFor();
await page.getByText('Signed agreement').waitFor();
await shot('15-request-completed');

// 5. The list shows every column the brief asked for.
await page.getByRole('link', { name: 'Back to requests' }).click();
await page.getByRole('tab', { name: 'All requests' }).click();
const row = page.getByRole('row', { name: /REQ-0001/ });
await row.waitFor();
for (const cell of ['Northwind analytics pilot', 'Completed', '1 of 3', 'Morgan Reyes', 'Master Services Agreement (sample)', 'Signed']) {
  await row.getByText(cell, { exact: false }).first().waitFor();
}
for (const header of ['ID', 'Name', 'Status', 'Tasks', 'Requester', 'Owner', 'Template', 'Requested', 'Last activity', 'Signature']) {
  await page.getByRole('columnheader', { name: header, exact: true }).waitFor();
}
await shot('16-requests-list');

await page.getByRole('link', { name: 'Settings' }).click();
await page.getByText('Requesters ask for agreements').waitFor();
await shot('17-settings');

await browser.close();
assert.deepEqual(errors, [], 'no browser errors');
console.log('End-to-end flow passed.');
