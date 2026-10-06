import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listParagraphs, paragraphText, readDocx, sampleAnswers } from '@whereas/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp, createServices } from '../src/app';

const FIXTURE = new Uint8Array(readFileSync(join(__dirname, '../../../fixtures/services-agreement.docx')));

/** Stands in for DocuSeal so no test touches the network. */
const seal = { calls: [] as { url: string; method: string; body: any }[], status: 'pending', submitters: 'sent' };
const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  const method = init?.method ?? 'GET';
  seal.calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
  const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (url.endsWith('/submissions/docx')) return json([{ id: 1, submission_id: 77, status: 'sent' }]);
  if (url.endsWith('/submissions/77') && method === 'GET') {
    return json({ id: 77, status: seal.status, submitters: [{ status: seal.submitters }], combined_document_url: 'https://seal.test/signed.pdf' });
  }
  if (url.endsWith('/submissions/77') && method === 'DELETE') return json({ archived_at: 'now' });
  if (url === 'https://seal.test/signed.pdf') return new Response(new TextEncoder().encode('%PDF-1.7 signed'));
  return new Response('not found', { status: 404 });
};

const services = createServices(
  { dataDir: mkdtempSync(join(tmpdir(), 'whereas-test-')), port: 0, baseUrl: 'http://localhost', webDir: '/nonexistent' },
  fakeFetch,
);
const { app, syncSignatures } = createApp(services);

class Client {
  cookie = '';
  async call(method: string, path: string, body?: unknown, raw?: Uint8Array) {
    const res = await app.request(`/api${path}`, {
      method,
      headers: {
        'X-Whereas': '1',
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(raw ? { 'Content-Type': 'application/octet-stream' } : body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: raw ?? (body ? JSON.stringify(body) : undefined),
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0]!;
    return res;
  }
  async json(method: string, path: string, body?: unknown) {
    const res = await this.call(method, path, body);
    return { status: res.status, body: (await res.json()) as any };
  }
}

const admin = new Client();
const requester = new Client();
const outsider = new Client();
let templateId = '';
let requestId = '';

const requesterAnswers = Object.fromEntries(
  Object.entries(sampleAnswers).filter(([k]) => !['governing_law', 'company_signer_name'].includes(k)),
);

beforeAll(async () => {
  const setup = await admin.json('POST', '/auth/setup', { name: 'Morgan Reyes', email: 'morgan@acme.test', password: 'correct horse battery' });
  expect(setup.status).toBe(200);
  for (const [name, email] of [['Sam Ortiz', 'sam@acme.test'], ['Pat Lee', 'pat@acme.test']]) {
    const res = await admin.json('POST', '/users', { name, email, role: 'requester', password: 'correct horse battery' });
    expect(res.status).toBe(200);
  }
  await requester.json('POST', '/auth/login', { email: 'sam@acme.test', password: 'correct horse battery' });
  await outsider.json('POST', '/auth/login', { email: 'pat@acme.test', password: 'correct horse battery' });
});

describe('access', () => {
  it('closes setup once an admin exists', async () => {
    const res = await new Client().json('POST', '/auth/setup', { name: 'X', email: 'x@x.test', password: 'correct horse battery' });
    expect(res.status).toBe(409);
  });

  it('rejects requests without a session, and changes without the app header', async () => {
    expect((await new Client().json('GET', '/requests')).status).toBe(401);
    const forged = await app.request('/api/auth/logout', { method: 'POST', headers: { Cookie: admin.cookie } });
    expect(forged.status).toBe(403);
  });

  it('keeps template editing and settings away from requesters', async () => {
    expect((await requester.call('POST', '/templates?name=Mine', undefined, FIXTURE)).status).toBe(403);
    expect((await requester.json('GET', '/settings/signature')).status).toBe(403);
    expect((await requester.json('GET', '/requests?view=all')).status).toBe(403);
  });

  it('refuses a wrong password', async () => {
    const res = await new Client().json('POST', '/auth/login', { email: 'sam@acme.test', password: 'wrong password!' });
    expect(res.status).toBe(401);
  });
});

describe('templates', () => {
  it('seeds a published sample on setup', async () => {
    const list = await requester.json('GET', '/templates');
    expect(list.body).toHaveLength(1);
    expect(list.body[0].version).toBe(1);
    templateId = list.body[0].id;
  });

  it('rejects a file that is not a Word document', async () => {
    const res = await admin.call('POST', '/templates?name=Bad', undefined, new TextEncoder().encode('hello'));
    expect(res.status).toBe(422);
  });

  it('saves a draft with problems but will not publish it', async () => {
    const created = await (await admin.call('POST', '/templates?name=NDA', undefined, FIXTURE)).json() as any;
    const detail = await admin.json('GET', `/templates/${created.id}`);
    const definition = {
      ...detail.body.definition,
      anchors: [{ id: 'a1', kind: 'field', field: 'ghost', range: { start: { p: 1, o: 0 }, end: { p: 1, o: 4 }, quote: 'This' } }],
    };
    const saved = await admin.json('PUT', `/templates/${created.id}`, { name: 'NDA', description: '', definition });
    expect(saved.body.problems.length).toBeGreaterThan(0);
    expect((await admin.json('POST', `/templates/${created.id}/publish`)).status).toBe(422);
    // Never published and unused, so it can be deleted outright.
    expect((await admin.json('DELETE', `/templates/${created.id}`)).status).toBe(200);
  });

  it('carries fields over when the document is replaced', async () => {
    const res = await (await admin.call('POST', `/templates/${templateId}/document`, undefined, FIXTURE)).json() as any;
    expect(res.lost).toEqual([]);
    const published = await admin.json('POST', `/templates/${templateId}/publish`);
    expect(published.body.version).toBe(2);
  });

  it('detects two people editing the same template', async () => {
    const detail = await admin.json('GET', `/templates/${templateId}`);
    const stale = await admin.json('PUT', `/templates/${templateId}`, {
      name: detail.body.name, description: '', definition: detail.body.definition, baseUpdatedAt: '2000-01-01T00:00:00.000Z',
    });
    expect(stale.status).toBe(409);
  });
});

describe('a request, start to finish', () => {
  it('starts as a draft that only the requester and legal can see', async () => {
    const created = await requester.json('POST', '/requests', { templateId, title: 'Northwind MSA', answers: { counterparty_name: 'Northwind Analytics LLC', governing_law: 'Delaware' } });
    expect(created.status).toBe(200);
    requestId = created.body.id;
    const detail = await requester.json('GET', `/requests/${requestId}`);
    expect(detail.body.displayId).toBe('REQ-0001');
    expect(detail.body.status).toBe('draft');
    // A requester cannot set an answer that belongs to legal; the default stands.
    expect(detail.body.answers.governing_law).toBe('California');
    expect((await outsider.json('GET', `/requests/${requestId}`)).status).toBe(404);
  });

  it('will not submit with required answers missing', async () => {
    const res = await requester.json('POST', `/requests/${requestId}/submit`);
    expect(res.status).toBe(422);
    expect(res.body.details.missing.length).toBeGreaterThan(0);
  });

  it('submits once answered, and adds the template tasks', async () => {
    await requester.json('PATCH', `/requests/${requestId}`, { answers: requesterAnswers });
    expect((await requester.json('POST', `/requests/${requestId}/submit`)).status).toBe(200);
    const detail = await admin.json('GET', `/requests/${requestId}`);
    expect(detail.body.status).toBe('submitted');
    expect(detail.body.tasks).toHaveLength(2);
    expect((await requester.json('PATCH', `/requests/${requestId}`, { answers: { fee_amount: 1 } })).status).toBe(409);
  });

  it('shows up in the right lists', async () => {
    const todo = await admin.json('GET', '/requests?view=todo');
    expect(todo.body.map((r: any) => r.displayId)).toEqual(['REQ-0001']);
    const row = todo.body[0];
    expect(row).toMatchObject({ title: 'Northwind MSA', status: 'submitted', tasksDone: 0, tasksTotal: 2, owner: null, signatureStatus: 'none' });
    expect(row.requester.name).toBe('Sam Ortiz');
    expect(row.template.name).toContain('Master Services Agreement');
    expect((await requester.json('GET', '/requests?view=mine')).body).toHaveLength(1);
    expect((await requester.json('GET', '/requests?view=todo')).body).toHaveLength(0);
    expect((await outsider.json('GET', '/requests?view=mine')).body).toHaveLength(0);
  });

  it('can be returned to the requester and sent back', async () => {
    const me = (await admin.json('GET', '/me')).body.id;
    await admin.json('PATCH', `/requests/${requestId}`, { ownerId: me });
    expect((await admin.json('GET', `/requests/${requestId}`)).body.status).toBe('in_review');
    await admin.json('POST', `/requests/${requestId}/return`, { note: 'Confirm the fee.' });
    expect((await requester.json('GET', '/requests?view=todo')).body).toHaveLength(1);
    await requester.json('PATCH', `/requests/${requestId}`, { answers: { fee_amount: '48,500' } });
    await requester.json('POST', `/requests/${requestId}/submit`);
    const detail = await admin.json('GET', `/requests/${requestId}`);
    expect(detail.body.status).toBe('in_review');
    expect(detail.body.answers.fee_amount).toBe(48500);
    expect(detail.body.tasks).toHaveLength(2);
  });

  it('will not generate or send until legal has answered its questions', async () => {
    expect((await admin.call('GET', `/requests/${requestId}/agreement`)).status).toBe(422);
    const send = await admin.json('POST', `/requests/${requestId}/send`, { provider: 'manual' });
    expect(send.status).toBe(422);
  });

  it('generates the agreement as Word and as PDF', async () => {
    await admin.json('PATCH', `/requests/${requestId}`, { answers: { company_signer_name: 'Morgan Reyes' } });
    const docx = await admin.call('GET', `/requests/${requestId}/agreement?format=docx`);
    expect(docx.status).toBe(200);
    const text = listParagraphs(readDocx(new Uint8Array(await docx.arrayBuffer())).document).map(paragraphText).join('\n');
    expect(text).toContain('Northwind Analytics LLC');
    expect(text).toContain('By: ______________________________');
    expect((await requester.call('GET', `/requests/${requestId}/agreement`)).status).toBe(403);
    const pdf = await admin.call('GET', `/requests/${requestId}/agreement?format=pdf`);
    expect(pdf.status).toBe(200);
    expect(new TextDecoder().decode((await pdf.arrayBuffer()).slice(0, 5))).toBe('%PDF-');
  }, 120_000);

  it('lets an assignee complete their task', async () => {
    const detail = await admin.json('GET', `/requests/${requestId}`);
    const users = (await admin.json('GET', '/users')).body;
    const pat = users.find((u: any) => u.email === 'pat@acme.test');
    const task = detail.body.tasks[0];
    expect((await outsider.json('PATCH', `/tasks/${task.id}`, { done: true })).status).toBe(404);
    await admin.json('PATCH', `/tasks/${task.id}`, { assigneeId: pat.id });
    expect((await outsider.json('GET', '/requests?view=todo')).body).toHaveLength(1);
    expect((await outsider.json('PATCH', `/tasks/${task.id}`, { done: true })).status).toBe(200);
    expect((await outsider.json('PATCH', `/tasks/${task.id}`, { title: 'Renamed' })).status).toBe(403);
    const list = await admin.json('GET', '/requests?view=all');
    expect(list.body[0]).toMatchObject({ tasksDone: 1, tasksTotal: 2 });
  });

  it('needs a provider to be set up before using it', async () => {
    const res = await admin.json('POST', `/requests/${requestId}/send`, { provider: 'docuseal', signers: {} });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('not set up');
  });

  it('stores provider credentials without ever returning them', async () => {
    const saved = await admin.json('PUT', '/settings/signature', { docuseal: { baseUrl: 'https://seal.test/api', apiKey: 'secret-key-123' } });
    expect(saved.body.docuseal).toEqual({ baseUrl: 'https://seal.test/api', hasSecret: true });
    const raw = services.db.prepare("SELECT value FROM settings WHERE key = 'signature'").get() as { value: string };
    expect(raw.value).not.toContain('secret-key-123');
    expect(JSON.stringify((await admin.json('GET', '/settings/signature')).body)).not.toContain('secret-key-123');
  });

  it('sends for signature with the signers and tags the provider expects', async () => {
    const bad = await admin.json('POST', `/requests/${requestId}/send`, { provider: 'docuseal', signers: { company: { name: 'Morgan Reyes', email: 'morgan@acme.test' } } });
    expect(bad.status).toBe(422);
    const res = await admin.json('POST', `/requests/${requestId}/send`, {
      provider: 'docuseal',
      signers: { company: { name: 'Morgan Reyes', email: 'morgan@acme.test' }, provider: { name: 'Dana Whitfield', email: 'dana@northwind.example' } },
    });
    expect(res.status).toBe(200);
    const call = seal.calls.find((c) => c.url.endsWith('/submissions/docx'))!;
    expect(call.body.submitters).toEqual([
      { role: 'Company', email: 'morgan@acme.test', name: 'Morgan Reyes' },
      { role: 'Provider', email: 'dana@northwind.example', name: 'Dana Whitfield' },
    ]);
    const sent = readDocx(new Uint8Array(Buffer.from(call.body.documents[0].file, 'base64')));
    const text = listParagraphs(sent.document).map(paragraphText).join('\n');
    expect(text).toContain('{{Signature;role=Provider;type=signature}}');
    const detail = await admin.json('GET', `/requests/${requestId}`);
    expect(detail.body).toMatchObject({ status: 'awaiting_signature', signatureStatus: 'sent', signatureProvider: 'docuseal' });
    expect((await admin.json('PATCH', `/requests/${requestId}`, { answers: { fee_amount: 2 } })).status).toBe(409);
  });

  it('follows signing progress and files the signed copy', async () => {
    seal.submitters = 'opened';
    await syncSignatures();
    expect((await admin.json('GET', `/requests/${requestId}`)).body.signatureStatus).toBe('viewed');
    seal.status = 'completed';
    seal.submitters = 'completed';
    await syncSignatures();
    const detail = await admin.json('GET', `/requests/${requestId}`);
    expect(detail.body).toMatchObject({ status: 'completed', signatureStatus: 'signed' });
    const signed = detail.body.documents.find((d: any) => d.kind === 'signed');
    expect(signed.filename).toContain('(signed).pdf');
    // The requester can fetch the signed copy, but not the working draft.
    const mine = await requester.json('GET', `/requests/${requestId}`);
    expect(mine.body.documents.map((d: any) => d.kind)).toEqual(['signed']);
    expect((await requester.call('GET', `/documents/${signed.id}`)).status).toBe(200);
    const draft = detail.body.documents.find((d: any) => d.kind === 'sent');
    expect((await requester.call('GET', `/documents/${draft.id}`)).status).toBe(404);
    expect((await outsider.call('GET', `/documents/${signed.id}`)).status).toBe(200); // task assignee
  });

  it('records every step in the activity log', async () => {
    const detail = await admin.json('GET', `/requests/${requestId}`);
    const types = detail.body.events.map((e: any) => e.type).reverse();
    expect(types).toEqual(expect.arrayContaining(['created', 'submitted', 'assigned', 'returned', 'resubmitted', 'sent_for_signature', 'signature_progress', 'signed']));
    expect(types[0]).toBe('created');
  });
});

describe('manual signing and cancelling', () => {
  it('closes a request when a signed copy is uploaded', async () => {
    const created = await admin.json('POST', '/requests', { templateId, title: 'Paper MSA', answers: { ...sampleAnswers } });
    const id = created.body.id;
    await admin.json('POST', `/requests/${id}/submit`);
    expect((await admin.json('POST', `/requests/${id}/send`, { provider: 'manual' })).status).toBe(200);
    const res = await admin.call('POST', `/requests/${id}/signed?filename=scan.pdf`, undefined, new TextEncoder().encode('%PDF-1.4 scan'));
    expect(res.status).toBe(200);
    const detail = await admin.json('GET', `/requests/${id}`);
    expect(detail.body).toMatchObject({ status: 'completed', signatureStatus: 'signed', displayId: 'REQ-0002' });
  });

  it('pins a request to the template version it started on', async () => {
    const detail = await admin.json('GET', `/requests/${requestId}`);
    expect(detail.body.template.version).toBe(2);
    await admin.json('POST', `/templates/${templateId}/publish`);
    expect((await admin.json('GET', `/requests/${requestId}`)).body.template.version).toBe(2);
    expect((await admin.json('GET', '/templates')).body[0].version).toBe(3);
  });

  it('withdraws the provider request when cancelled', async () => {
    seal.status = 'pending';
    seal.submitters = 'sent';
    const created = await admin.json('POST', '/requests', { templateId, title: 'Abandoned', answers: { ...sampleAnswers } });
    const id = created.body.id;
    await admin.json('POST', `/requests/${id}/submit`);
    await admin.json('POST', `/requests/${id}/send`, {
      provider: 'docuseal',
      signers: { company: { name: 'M', email: 'm@acme.test' }, provider: { name: 'D', email: 'd@northwind.example' } },
    });
    expect((await admin.json('POST', `/requests/${id}/cancel`)).status).toBe(200);
    expect(seal.calls.some((c) => c.method === 'DELETE')).toBe(true);
    const detail = await admin.json('GET', `/requests/${id}`);
    expect(detail.body).toMatchObject({ status: 'cancelled', signatureStatus: 'voided' });
    expect((await admin.json('POST', `/requests/${id}/cancel`)).status).toBe(409);
  });

  it('keeps the last admin from being removed', async () => {
    const me = (await admin.json('GET', '/me')).body.id;
    expect((await admin.json('PATCH', `/users/${me}`, { role: 'legal' })).status).toBe(409);
  });
});

describe('hardening', () => {
  it('refuses oversized bodies before reading them', async () => {
    const big = new Uint8Array(3 * 1024 * 1024);
    const res = await app.request('/api/auth/login', { method: 'POST', headers: { 'X-Whereas': '1', 'Content-Type': 'application/json', 'Content-Length': String(big.length) }, body: big });
    expect(res.status).toBe(413);
  });

  it('rejects marks with unsafe ids', async () => {
    const detail = await admin.json('GET', `/templates/${templateId}`);
    const anchors = detail.body.definition.anchors.map((a: any, i: number) => (i === 0 ? { ...a, id: 'has space' } : a));
    const res = await admin.json('PUT', `/templates/${templateId}`, { name: 'x', description: '', definition: { ...detail.body.definition, anchors } });
    expect(res.status).toBe(400);
  });

  it('strips control characters from answers', async () => {
    const created = await admin.json('POST', '/requests', { templateId, title: 'Pasted', answers: { counterparty_name: 'Acme\u000BCo\u0001' } });
    const detail = await admin.json('GET', `/requests/${created.body.id}`);
    expect(detail.body.answers.counterparty_name).toBe('Acme\nCo');
  });

  it('returns an unassigned request to the shared queue', async () => {
    const me = (await admin.json('GET', '/me')).body.id;
    const created = await admin.json('POST', '/requests', { templateId, title: 'Queue', answers: { ...sampleAnswers } });
    const id = created.body.id;
    await admin.json('POST', `/requests/${id}/submit`);
    await admin.json('PATCH', `/requests/${id}`, { ownerId: me });
    await admin.json('PATCH', `/requests/${id}`, { ownerId: null });
    expect((await admin.json('GET', `/requests/${id}`)).body.status).toBe('submitted');
    expect((await admin.json('GET', '/requests?view=todo')).body.some((r: any) => r.id === id)).toBe(true);
  });

  it('sends once when two people press send together, and ignores a late status after cancelling', async () => {
    seal.status = 'pending';
    seal.submitters = 'sent';
    const created = await admin.json('POST', '/requests', { templateId, title: 'Race', answers: { ...sampleAnswers } });
    const id = created.body.id;
    await admin.json('POST', `/requests/${id}/submit`);
    const signers = { company: { name: 'M', email: 'm@acme.test' }, provider: { name: 'D', email: 'd@northwind.example' } };
    const before = seal.calls.filter((c) => c.url.endsWith('/submissions/docx')).length;
    const [a, b] = await Promise.all([
      admin.json('POST', `/requests/${id}/send`, { provider: 'docuseal', signers }),
      admin.json('POST', `/requests/${id}/send`, { provider: 'docuseal', signers }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(seal.calls.filter((c) => c.url.endsWith('/submissions/docx')).length).toBe(before + 1);

    // A status check and a cancel overlap; the cancel must stand.
    seal.submitters = 'opened';
    const [, cancelled] = await Promise.all([syncSignatures(), admin.json('POST', `/requests/${id}/cancel`)]);
    expect(cancelled.status).toBe(200);
    await syncSignatures();
    expect((await admin.json('GET', `/requests/${id}`)).body).toMatchObject({ status: 'cancelled', signatureStatus: 'voided' });
  });

  it('withdraws the provider request when a signed copy is uploaded instead', async () => {
    seal.status = 'pending';
    seal.submitters = 'sent';
    const created = await admin.json('POST', '/requests', { templateId, title: 'Wet ink', answers: { ...sampleAnswers } });
    const id = created.body.id;
    await admin.json('POST', `/requests/${id}/submit`);
    await admin.json('POST', `/requests/${id}/send`, { provider: 'docuseal', signers: { company: { name: 'M', email: 'm@acme.test' }, provider: { name: 'D', email: 'd@northwind.example' } } });
    const deletes = seal.calls.filter((c) => c.method === 'DELETE').length;
    const res = await admin.call('POST', `/requests/${id}/signed`, undefined, new TextEncoder().encode('%PDF-1.4'));
    expect(res.status).toBe(200);
    expect(seal.calls.filter((c) => c.method === 'DELETE').length).toBe(deletes + 1);
  });
});
