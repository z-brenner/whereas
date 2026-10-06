import {
  cleanText,
  defaultAnswers,
  generateDocx,
  isItemList,
  missingAnswers,
  signatureTagFor,
  type AnswerValue,
  type Answers,
  type Field,
  type ItemAnswers,
  type TemplateDefinition,
} from '@whereas/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { HttpError, isLegal, type Env, type Services, type User } from '../context';
import { newId } from '../crypto';
import { now } from '../db';
import { docxToPdf, pdfAvailable, PdfUnavailableError } from '../pdf';
import {
  availableProviders,
  getProvider,
  ProviderError,
  readSignatureSettings,
  type ProviderId,
  type SignatureStatus,
} from '../providers';
import { answersSchema } from '../schemas';
import { requireLegal } from './auth';

export type RequestStatus =
  | 'draft'
  | 'submitted'
  | 'in_review'
  | 'returned'
  | 'awaiting_signature'
  | 'completed'
  | 'cancelled';

const OPEN: RequestStatus[] = ['draft', 'submitted', 'in_review', 'returned', 'awaiting_signature'];
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

interface RequestRow {
  id: string;
  number: number;
  title: string;
  template_id: string;
  template_version_id: string;
  requester_id: string;
  owner_id: string | null;
  status: RequestStatus;
  answers: string;
  signature_status: SignatureStatus;
  signature_provider: ProviderId | null;
  signature_ref: string | null;
  signers: string;
  created_at: string;
  submitted_at: string | null;
  last_activity_at: string;
  completed_at: string | null;
}

interface VersionRow {
  id: string;
  template_id: string;
  version: number;
  name: string;
  docx: string;
  definition: string;
}

export const displayId = (n: number): string => `REQ-${String(n).padStart(4, '0')}`;

function safeFilename(name: string): string {
  return name.replace(/[^\w .()-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'agreement';
}

function attachment(filename: string): string {
  return `attachment; filename="${safeFilename(filename)}"`;
}

function coerce(field: Field, value: unknown): AnswerValue {
  if (value === undefined || value === null || value === '') return null;
  switch (field.type) {
    case 'number':
    case 'currency': {
      const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
      return Number.isFinite(n) ? n : null;
    }
    case 'boolean':
      return value === true || value === 'true';
    case 'date':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
    case 'select': {
      const v = String(value);
      return field.options?.some((o) => o.value === v) ? v : null;
    }
    case 'multiselect': {
      const list = Array.isArray(value) ? value.map(String) : [String(value)];
      return list.filter((v) => field.options?.some((o) => o.value === v));
    }
    default:
      return cleanText(String(value));
  }
}

/**
 * Merges incoming answers into the stored ones, keeping only questions the
 * template defines and that this person is allowed to answer. Questions in
 * a repeating group follow the group's audience, not their own.
 */
export function mergeAnswers(def: TemplateDefinition, existing: Answers, incoming: Answers, legal: boolean): Answers {
  const out: Answers = { ...existing };
  for (const f of def.fields) {
    if (f.group || !Object.hasOwn(incoming, f.id)) continue;
    if (!legal && f.audience !== 'requester') continue;
    out[f.id] = coerce(f, incoming[f.id]);
  }
  for (const g of def.groups) {
    const list = Object.hasOwn(incoming, g.id) ? incoming[g.id] : undefined;
    if (!isItemList(list)) continue;
    if (!legal && g.audience !== 'requester') continue;
    const fields = def.fields.filter((f) => f.group === g.id);
    out[g.id] = list.slice(0, g.max ?? 200).map((item) => {
      const clean: ItemAnswers = {};
      for (const f of fields) clean[f.id] = coerce(f, Object.hasOwn(item, f.id) ? item[f.id] : undefined);
      return clean;
    });
  }
  return out;
}

export function requestRoutes(s: Services) {
  const app = new Hono<Env>();
  const { db } = s;

  /**
   * Signature steps wait on a provider, so two of them could interleave on
   * one request. Each runs alone per request and re-reads the row first.
   */
  const locks = new Map<string, Promise<unknown>>();
  const withLock = <T>(requestId: string, fn: () => Promise<T>): Promise<T> => {
    const run = (locks.get(requestId) ?? Promise.resolve()).then(fn, fn);
    const tail = run.catch(() => undefined);
    locks.set(requestId, tail);
    void tail.then(() => locks.get(requestId) === tail && locks.delete(requestId));
    return run;
  };

  const getRow = (id: string): RequestRow => {
    const row = db.prepare('SELECT * FROM requests WHERE id = ?').get(id) as RequestRow | undefined;
    if (!row) throw new HttpError(404, 'That request no longer exists.');
    return row;
  };
  const getVersion = (id: string): VersionRow =>
    db.prepare('SELECT * FROM template_versions WHERE id = ?').get(id) as VersionRow;

  /** Loads a request the current user is allowed to see. */
  const load = (id: string, user: User) => {
    const row = getRow(id);
    if (!isLegal(user) && row.requester_id !== user.id) {
      const assigned = db
        .prepare('SELECT 1 FROM tasks WHERE request_id = ? AND assignee_id = ?')
        .get(row.id, user.id);
      if (!assigned) throw new HttpError(404, 'That request no longer exists.');
    }
    const version = getVersion(row.template_version_id);
    return {
      row,
      version,
      def: JSON.parse(version.definition) as TemplateDefinition,
      answers: JSON.parse(row.answers) as Answers,
    };
  };

  const log = (requestId: string, actorId: string | null, type: string, data: Record<string, unknown> = {}) => {
    const t = now();
    db.prepare('INSERT INTO events (request_id, actor_id, type, data, at) VALUES (?, ?, ?, ?, ?)').run(
      requestId,
      actorId,
      type,
      JSON.stringify(data),
      t,
    );
    db.prepare('UPDATE requests SET last_activity_at = ? WHERE id = ?').run(t, requestId);
  };

  const userName = (id: string | null): string | null =>
    id ? ((db.prepare('SELECT name FROM users WHERE id = ?').get(id) as { name: string } | undefined)?.name ?? null) : null;

  // ---- lists -------------------------------------------------------------

  app.get('/requests', (c) => {
    const user = c.get('user');
    const view = z.enum(['todo', 'mine', 'all']).parse(c.req.query('view') ?? 'todo');
    if (view === 'all' && !isLegal(user)) throw new HttpError(403, 'Only the legal team can see every request.');

    const where: string[] = [];
    const params: unknown[] = [];
    if (view === 'mine') {
      where.push('r.requester_id = ?');
      params.push(user.id);
    } else if (view === 'todo') {
      // What is waiting on this person: requests they own, unassigned ones
      // if they are in legal, their own drafts and returns, and open tasks.
      const parts = [
        `(r.owner_id = ? AND r.status IN ('submitted', 'in_review', 'awaiting_signature'))`,
        `(r.requester_id = ? AND r.status IN ('draft', 'returned'))`,
        `(r.status IN (${OPEN.map(() => '?').join(', ')}) AND EXISTS (SELECT 1 FROM tasks t WHERE t.request_id = r.id AND t.assignee_id = ? AND t.done = 0))`,
      ];
      params.push(user.id, user.id, ...OPEN, user.id);
      if (isLegal(user)) parts.push(`(r.owner_id IS NULL AND r.status = 'submitted')`);
      where.push(`(${parts.join(' OR ')})`);
    }
    const rows = db
      .prepare(
        `SELECT r.*, ru.name AS requester_name, ou.name AS owner_name, v.name AS template_name, v.version AS template_version,
                (SELECT COUNT(*) FROM tasks t WHERE t.request_id = r.id) AS tasks_total,
                (SELECT COUNT(*) FROM tasks t WHERE t.request_id = r.id AND t.done = 1) AS tasks_done
         FROM requests r
         JOIN users ru ON ru.id = r.requester_id
         LEFT JOIN users ou ON ou.id = r.owner_id
         JOIN template_versions v ON v.id = r.template_version_id
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY r.last_activity_at DESC
         LIMIT 1000`,
      )
      .all(...params) as (RequestRow & {
      requester_name: string;
      owner_name: string | null;
      template_name: string;
      template_version: number;
      tasks_total: number;
      tasks_done: number;
    })[];
    return c.json(
      rows.map((r) => ({
        id: r.id,
        displayId: displayId(r.number),
        title: r.title,
        status: r.status,
        tasksDone: r.tasks_done,
        tasksTotal: r.tasks_total,
        requester: { id: r.requester_id, name: r.requester_name },
        owner: r.owner_id ? { id: r.owner_id, name: r.owner_name } : null,
        template: { id: r.template_id, name: r.template_name, version: r.template_version },
        requestedAt: r.submitted_at ?? r.created_at,
        lastActivityAt: r.last_activity_at,
        signatureStatus: r.signature_status,
      })),
    );
  });

  // ---- create and read ---------------------------------------------------

  app.post('/requests', async (c) => {
    const user = c.get('user');
    const body = z
      .object({ templateId: z.string(), title: z.string().min(1).max(200), answers: answersSchema.default({}) })
      .parse(await c.req.json());
    const template = db
      .prepare('SELECT id, archived, published_version_id FROM templates WHERE id = ?')
      .get(body.templateId) as { id: string; archived: number; published_version_id: string | null } | undefined;
    if (!template?.published_version_id || template.archived) {
      throw new HttpError(409, 'That template is not available for new requests.');
    }
    // The request keeps this exact version, even if the template changes later.
    const version = getVersion(template.published_version_id);
    const def = JSON.parse(version.definition) as TemplateDefinition;
    const answers = mergeAnswers(def, defaultAnswers(def), body.answers as Answers, isLegal(user));
    const id = newId();
    const t = now();
    db.transaction(() => {
      const { n } = db.prepare('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM requests').get() as { n: number };
      db.prepare(
        `INSERT INTO requests (id, number, title, template_id, template_version_id, requester_id, status, answers, created_at, last_activity_at)
         VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
      ).run(id, n, body.title, template.id, version.id, user.id, JSON.stringify(answers), t, t);
      log(id, user.id, 'created');
    })();
    return c.json({ id });
  });

  app.get('/requests/:id', async (c) => {
    const user = c.get('user');
    const { row, version, def, answers } = load(c.req.param('id'), user);
    const legal = isLegal(user);
    const mine = row.requester_id === user.id;
    const tasks = db
      .prepare(
        `SELECT t.id, t.title, t.done, t.due_date, t.assignee_id, u.name AS assignee_name
         FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id WHERE t.request_id = ? ORDER BY t.created_at, t.rowid`,
      )
      .all(row.id) as { id: string; title: string; done: number; due_date: string | null; assignee_id: string | null; assignee_name: string | null }[];
    const events = db
      .prepare(
        `SELECT e.id, e.type, e.data, e.at, e.actor_id, u.name AS actor_name
         FROM events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.request_id = ? ORDER BY e.id DESC`,
      )
      .all(row.id) as { id: number; type: string; data: string; at: string; actor_id: string | null; actor_name: string | null }[];
    const documents = db
      .prepare('SELECT id, kind, filename, created_at FROM documents WHERE request_id = ? ORDER BY created_at DESC')
      .all(row.id) as { id: string; kind: string; filename: string; created_at: string }[];
    const reviewable = row.status === 'submitted' || row.status === 'in_review';

    return c.json({
      id: row.id,
      displayId: displayId(row.number),
      title: row.title,
      status: row.status,
      signatureStatus: row.signature_status,
      signatureProvider: row.signature_provider,
      signers: JSON.parse(row.signers) as Record<string, { name: string; email: string }>,
      requester: { id: row.requester_id, name: userName(row.requester_id) },
      owner: row.owner_id ? { id: row.owner_id, name: userName(row.owner_id) } : null,
      template: { id: version.template_id, versionId: version.id, version: version.version, name: version.name },
      definition: def,
      answers,
      createdAt: row.created_at,
      requestedAt: row.submitted_at ?? row.created_at,
      lastActivityAt: row.last_activity_at,
      completedAt: row.completed_at,
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        done: !!t.done,
        dueDate: t.due_date,
        assignee: t.assignee_id ? { id: t.assignee_id, name: t.assignee_name } : null,
      })),
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        data: JSON.parse(e.data) as Record<string, unknown>,
        at: e.at,
        actor: e.actor_id ? { id: e.actor_id, name: e.actor_name } : null,
      })),
      // Requesters get the signed copy; working drafts stay with legal.
      documents: documents
        .filter((d) => legal || d.kind === 'signed')
        .map((d) => ({ id: d.id, kind: d.kind, filename: d.filename, createdAt: d.created_at })),
      missing: {
        requester: missingAnswers(def, answers, 'requester'),
        all: missingAnswers(def, answers),
      },
      can: {
        editAsRequester: mine && (row.status === 'draft' || row.status === 'returned'),
        // Someone in legal can answer legal's questions on their own draft too.
        editAsLegal: legal && (reviewable || (mine && (row.status === 'draft' || row.status === 'returned'))),
        submit: mine && (row.status === 'draft' || row.status === 'returned'),
        assign: legal && OPEN.includes(row.status),
        returnToRequester: legal && reviewable,
        send: legal && reviewable,
        uploadSigned: legal && (reviewable || row.status === 'awaiting_signature'),
        cancelSignature: legal && row.status === 'awaiting_signature',
        refreshSignature: legal && row.status === 'awaiting_signature' && row.signature_provider !== 'manual',
        download: legal,
        manageTasks: legal && OPEN.includes(row.status),
        cancel: (legal || mine) && OPEN.includes(row.status),
        comment: true,
      },
      providers: legal ? availableProviders(readSignatureSettings(db, s.box)) : [],
      pdfAvailable: await pdfAvailable(),
    });
  });

  // ---- edit --------------------------------------------------------------

  app.patch('/requests/:id', async (c) => {
    const user = c.get('user');
    const { row, def, answers } = load(c.req.param('id'), user);
    const body = z
      .object({
        title: z.string().min(1).max(200).optional(),
        answers: answersSchema.optional(),
        ownerId: z.string().nullable().optional(),
      })
      .parse(await c.req.json());
    const legal = isLegal(user);
    const asRequester = row.requester_id === user.id && (row.status === 'draft' || row.status === 'returned');
    const asLegal = legal && (row.status === 'submitted' || row.status === 'in_review' || asRequester);

    db.transaction(() => {
      if (body.answers || body.title) {
        if (!asRequester && !asLegal) throw new HttpError(409, 'This request can no longer be edited.');
        if (body.title && body.title !== row.title) {
          db.prepare('UPDATE requests SET title = ? WHERE id = ?').run(body.title, row.id);
        }
        if (body.answers) {
          const next = mergeAnswers(def, answers, body.answers as Answers, asLegal);
          if (JSON.stringify(next) !== row.answers) {
            db.prepare('UPDATE requests SET answers = ? WHERE id = ?').run(JSON.stringify(next), row.id);
            // Drafts change constantly; only log edits once legal can see them.
            if (row.status !== 'draft') log(row.id, user.id, 'answers_updated');
          }
        }
      }
      if (body.ownerId !== undefined && body.ownerId !== row.owner_id) {
        if (!legal) throw new HttpError(403, 'Only the legal team can assign requests.');
        if (!OPEN.includes(row.status)) throw new HttpError(409, 'This request is closed.');
        if (body.ownerId) {
          const owner = db.prepare('SELECT role, disabled FROM users WHERE id = ?').get(body.ownerId) as
            | { role: string; disabled: number }
            | undefined;
          if (!owner || owner.disabled || owner.role === 'requester') {
            throw new HttpError(422, 'Requests can only be assigned to someone on the legal team.');
          }
        }
        db.prepare('UPDATE requests SET owner_id = ? WHERE id = ?').run(body.ownerId, row.id);
        if (body.ownerId && row.status === 'submitted') {
          db.prepare("UPDATE requests SET status = 'in_review' WHERE id = ?").run(row.id);
        }
        // With no owner it goes back to the shared queue, or nobody would see it.
        if (!body.ownerId && row.status === 'in_review') {
          db.prepare("UPDATE requests SET status = 'submitted' WHERE id = ?").run(row.id);
        }
        log(row.id, user.id, 'assigned', { owner: userName(body.ownerId) });
      }
    })();
    return c.json({ ok: true });
  });

  app.post('/requests/:id/submit', (c) => {
    const user = c.get('user');
    const { row, def, answers } = load(c.req.param('id'), user);
    if (row.requester_id !== user.id) throw new HttpError(403, 'Only the requester can send this request to legal.');
    if (row.status !== 'draft' && row.status !== 'returned') throw new HttpError(409, 'This request was already sent.');
    const missing = missingAnswers(def, answers, 'requester');
    if (missing.length) throw new HttpError(422, 'Answer the required questions first.', { missing });
    db.transaction(() => {
      const first = row.submitted_at === null;
      db.prepare('UPDATE requests SET status = ?, submitted_at = COALESCE(submitted_at, ?) WHERE id = ?').run(
        row.owner_id ? 'in_review' : 'submitted',
        now(),
        row.id,
      );
      if (first) {
        for (const title of def.tasks ?? []) {
          db.prepare('INSERT INTO tasks (id, request_id, title, created_at) VALUES (?, ?, ?, ?)').run(newId(), row.id, title, now());
        }
      }
      log(row.id, user.id, first ? 'submitted' : 'resubmitted');
    })();
    return c.json({ ok: true });
  });

  app.post('/requests/:id/return', requireLegal, async (c) => {
    const user = c.get('user');
    const { row } = load(c.req.param('id'), user);
    const { note } = z.object({ note: z.string().min(1, 'Say what the requester needs to change.').max(2000) }).parse(await c.req.json());
    if (row.status !== 'submitted' && row.status !== 'in_review') throw new HttpError(409, 'This request cannot be returned now.');
    db.transaction(() => {
      db.prepare("UPDATE requests SET status = 'returned' WHERE id = ?").run(row.id);
      log(row.id, user.id, 'returned', { note });
    })();
    return c.json({ ok: true });
  });

  app.post('/requests/:id/cancel', (c) => withLock(c.req.param('id'), async () => {
    const user = c.get('user');
    const { row } = load(c.req.param('id'), user);
    if (!isLegal(user) && row.requester_id !== user.id) throw new HttpError(403, 'Only the requester or legal can cancel this.');
    if (!OPEN.includes(row.status)) throw new HttpError(409, 'This request is already closed.');
    let providerNote: string | undefined;
    if (row.status === 'awaiting_signature' && row.signature_provider && row.signature_ref) {
      try {
        await getProvider(row.signature_provider, readSignatureSettings(db, s.box), s.fetch).cancel(row.signature_ref);
      } catch (e) {
        // The request is still cancelled here; say that the envelope may be live.
        providerNote = `The signature request could not be withdrawn automatically: ${(e as Error).message}`;
      }
    }
    db.transaction(() => {
      db.prepare(
        `UPDATE requests SET status = 'cancelled', completed_at = ?,
           signature_status = CASE WHEN signature_status IN ('none', 'signed') THEN signature_status ELSE 'voided' END
         WHERE id = ?`,
      ).run(now(), row.id);
      log(row.id, user.id, 'cancelled', providerNote ? { note: providerNote } : {});
    })();
    return c.json({ ok: true, warning: providerNote });
  }));

  app.post('/requests/:id/comments', async (c) => {
    const user = c.get('user');
    const { row } = load(c.req.param('id'), user);
    const { text } = z.object({ text: z.string().min(1).max(5000) }).parse(await c.req.json());
    log(row.id, user.id, 'comment', { text });
    return c.json({ ok: true });
  });

  // ---- tasks -------------------------------------------------------------

  app.post('/requests/:id/tasks', requireLegal, async (c) => {
    const user = c.get('user');
    const { row } = load(c.req.param('id'), user);
    if (!OPEN.includes(row.status)) throw new HttpError(409, 'This request is closed.');
    const body = z
      .object({
        title: z.string().min(1).max(300),
        assigneeId: z.string().nullable().optional(),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      })
      .parse(await c.req.json());
    const id = newId();
    db.transaction(() => {
      db.prepare(
        'INSERT INTO tasks (id, request_id, title, assignee_id, due_date, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(id, row.id, body.title, body.assigneeId ?? null, body.dueDate ?? null, user.id, now());
      log(row.id, user.id, 'task_added', { title: body.title, assignee: userName(body.assigneeId ?? null) });
    })();
    return c.json({ id });
  });

  app.patch('/tasks/:id', async (c) => {
    const user = c.get('user');
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(c.req.param('id')) as
      | { id: string; request_id: string; title: string; assignee_id: string | null; done: number }
      | undefined;
    if (!task) throw new HttpError(404, 'That task no longer exists.');
    const { row } = load(task.request_id, user);
    const body = z
      .object({
        done: z.boolean().optional(),
        title: z.string().min(1).max(300).optional(),
        assigneeId: z.string().nullable().optional(),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      })
      .parse(await c.req.json());
    const legal = isLegal(user);
    const onlyDone = body.title === undefined && body.assigneeId === undefined && body.dueDate === undefined;
    if (!legal && !(onlyDone && task.assignee_id === user.id)) {
      throw new HttpError(403, 'You can only complete tasks assigned to you.');
    }
    if (!OPEN.includes(row.status)) throw new HttpError(409, 'This request is closed.');
    db.transaction(() => {
      if (body.title !== undefined) db.prepare('UPDATE tasks SET title = ? WHERE id = ?').run(body.title, task.id);
      if (body.assigneeId !== undefined) db.prepare('UPDATE tasks SET assignee_id = ? WHERE id = ?').run(body.assigneeId, task.id);
      if (body.dueDate !== undefined) db.prepare('UPDATE tasks SET due_date = ? WHERE id = ?').run(body.dueDate, task.id);
      if (body.done !== undefined && body.done !== !!task.done) {
        db.prepare('UPDATE tasks SET done = ?, done_at = ? WHERE id = ?').run(body.done ? 1 : 0, body.done ? now() : null, task.id);
        log(row.id, user.id, body.done ? 'task_done' : 'task_reopened', { title: task.title });
      }
    })();
    return c.json({ ok: true });
  });

  app.delete('/tasks/:id', requireLegal, (c) => {
    const task = db.prepare('SELECT id, request_id, title FROM tasks WHERE id = ?').get(c.req.param('id')) as
      | { id: string; request_id: string; title: string }
      | undefined;
    if (!task) throw new HttpError(404, 'That task no longer exists.');
    db.transaction(() => {
      db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
      log(task.request_id, c.get('user').id, 'task_removed', { title: task.title });
    })();
    return c.json({ ok: true });
  });

  // ---- documents ---------------------------------------------------------

  const build = (version: VersionRow, def: TemplateDefinition, answers: Answers, provider: ProviderId = 'manual') => {
    const missing = missingAnswers(def, answers);
    if (missing.length) throw new HttpError(422, 'Some required answers are still missing.', { missing });
    const style = provider === 'manual' ? 'line' : provider;
    return generateDocx(s.blobs.get(version.docx), def, answers, { signatureTag: signatureTagFor(style) });
  };

  app.get('/requests/:id/agreement', requireLegal, async (c) => {
    const { row, version, def, answers } = load(c.req.param('id'), c.get('user'));
    const format = z.enum(['docx', 'pdf']).parse(c.req.query('format') ?? 'docx');
    const docx = build(version, def, answers);
    const name = `${displayId(row.number)} ${row.title}`;
    if (format === 'docx') {
      return c.body(Buffer.from(docx), 200, { 'Content-Type': DOCX_TYPE, 'Content-Disposition': attachment(`${name}.docx`) });
    }
    try {
      const pdf = await docxToPdf(docx);
      return c.body(Buffer.from(pdf), 200, { 'Content-Type': 'application/pdf', 'Content-Disposition': attachment(`${name}.pdf`) });
    } catch (e) {
      if (e instanceof PdfUnavailableError) throw new HttpError(409, e.message);
      throw e;
    }
  });

  app.get('/documents/:id', (c) => {
    const user = c.get('user');
    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(c.req.param('id')) as
      | { id: string; request_id: string; kind: string; filename: string; blob: string; content_type: string }
      | undefined;
    if (!doc) throw new HttpError(404, 'That document no longer exists.');
    load(doc.request_id, user);
    if (!isLegal(user) && doc.kind !== 'signed') throw new HttpError(404, 'That document no longer exists.');
    return c.body(Buffer.from(s.blobs.get(doc.blob)), 200, {
      'Content-Type': doc.content_type,
      'Content-Disposition': attachment(doc.filename),
    });
  });

  const addDocument = (requestId: string, kind: string, filename: string, data: Uint8Array, type: string, by: string | null) => {
    db.prepare(
      'INSERT INTO documents (id, request_id, kind, filename, blob, content_type, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(newId(), requestId, kind, safeFilename(filename), s.blobs.put(data), type, by, now());
  };

  // ---- signature ---------------------------------------------------------

  app.post('/requests/:id/send', requireLegal, (c) => withLock(c.req.param('id'), async () => {
    const user = c.get('user');
    const { row, version, def, answers } = load(c.req.param('id'), user);
    const body = z
      .object({
        provider: z.enum(['manual', 'docuseal', 'docusign']),
        signers: z.record(z.object({ name: z.string().max(200), email: z.string().max(200) })).default({}),
        message: z.string().max(5000).optional(),
      })
      .parse(await c.req.json());
    if (row.status !== 'submitted' && row.status !== 'in_review') {
      throw new HttpError(409, 'This request is not ready to send for signature.');
    }
    const provider = getProvider(body.provider, readSignatureSettings(db, s.box), s.fetch);
    const signers = def.signers
      .filter((role) => def.anchors.some((a) => a.kind === 'signature' && a.signer === role.id))
      .map((role) => ({ role, name: body.signers[role.id]?.name.trim() ?? '', email: body.signers[role.id]?.email.trim() ?? '' }));
    if (body.provider !== 'manual') {
      if (signers.length === 0) {
        throw new HttpError(422, 'This template has no signature blocks, so there is nowhere to sign. Add one in the template, or send it manually.');
      }
      for (const sg of signers) {
        if (!sg.name || !z.string().email().safeParse(sg.email).success) {
          throw new HttpError(422, `Add a name and a valid email address for ${sg.role.label}.`);
        }
      }
    }
    const docx = build(version, def, answers, body.provider);
    const filename = `${displayId(row.number)} ${row.title}.docx`;
    let ref: string;
    try {
      ({ ref } = await provider.send({ title: row.title, filename, docx, signers, message: body.message }));
    } catch (e) {
      if (e instanceof ProviderError) throw new HttpError(502, e.message);
      throw new HttpError(502, `The document was not sent. ${(e as Error).message}`);
    }
    const saved = Object.fromEntries(signers.map((sg) => [sg.role.id, { name: sg.name, email: sg.email }]));
    db.transaction(() => {
      addDocument(row.id, 'sent', filename, docx, DOCX_TYPE, user.id);
      db.prepare(
        `UPDATE requests SET status = 'awaiting_signature', signature_status = 'sent', signature_provider = ?,
           signature_ref = ?, signers = ?, owner_id = COALESCE(owner_id, ?) WHERE id = ?`,
      ).run(body.provider, ref, JSON.stringify(saved), user.id, row.id);
      log(row.id, user.id, 'sent_for_signature', { provider: body.provider });
    })();
    return c.json({ ok: true });
  }));

  /** Applies a new provider status. Returns true when something changed. */
  const applySignature = async (
    row: RequestRow,
    status: SignatureStatus,
    signedPdf: (() => Promise<Uint8Array>) | undefined,
    actorId: string | null,
  ): Promise<boolean> => {
    if (status === row.signature_status) return false;
    const pdf = status === 'signed' && signedPdf ? await signedPdf() : null;
    return db.transaction(() => {
      // The request may have been cancelled or closed while the provider answered.
      const current = getRow(row.id);
      if (current.status !== 'awaiting_signature' || current.signature_ref !== row.signature_ref) return false;
      if (status === 'signed') {
        if (pdf) addDocument(row.id, 'signed', `${displayId(row.number)} ${row.title} (signed).pdf`, pdf, 'application/pdf', actorId);
        db.prepare("UPDATE requests SET signature_status = 'signed', status = 'completed', completed_at = ? WHERE id = ?").run(now(), row.id);
        log(row.id, actorId, 'signed');
      } else if (status === 'declined' || status === 'voided' || status === 'expired') {
        // Signing stopped, so the request goes back to its owner.
        db.prepare("UPDATE requests SET signature_status = ?, status = 'in_review' WHERE id = ?").run(status, row.id);
        log(row.id, actorId, 'signature_stopped', { status });
      } else {
        db.prepare('UPDATE requests SET signature_status = ? WHERE id = ?').run(status, row.id);
        log(row.id, actorId, 'signature_progress', { status });
      }
      return true;
    })();
  };

  const sync = (id: string, actorId: string | null): Promise<boolean> => withLock(id, async () => {
    const row = getRow(id);
    if (row.status !== 'awaiting_signature' || !row.signature_provider || !row.signature_ref) return false;
    if (row.signature_provider === 'manual') return false;
    const provider = getProvider(row.signature_provider, readSignatureSettings(db, s.box), s.fetch);
    const result = await provider.status(row.signature_ref);
    return applySignature(row, result.status, result.signedPdf, actorId);
  });

  app.post('/requests/:id/signature/refresh', requireLegal, async (c) => {
    const { row } = load(c.req.param('id'), c.get('user'));
    try {
      return c.json({ changed: await sync(row.id, null) });
    } catch (e) {
      throw new HttpError(502, `Could not check the signature status. ${(e as Error).message}`);
    }
  });

  app.post('/requests/:id/signature/cancel', requireLegal, (c) => withLock(c.req.param('id'), async () => {
    const user = c.get('user');
    const { row } = load(c.req.param('id'), user);
    if (row.status !== 'awaiting_signature') throw new HttpError(409, 'This request is not out for signature.');
    if (row.signature_provider && row.signature_provider !== 'manual' && row.signature_ref) {
      try {
        await getProvider(row.signature_provider, readSignatureSettings(db, s.box), s.fetch).cancel(row.signature_ref);
      } catch (e) {
        throw new HttpError(502, `The signature request was not withdrawn. ${(e as Error).message}`);
      }
    }
    await applySignature(row, 'voided', undefined, user.id);
    return c.json({ ok: true });
  }));

  // A signed copy from anywhere closes the request: wet ink, or a tool Whereas does not talk to.
  app.post('/requests/:id/signed', requireLegal, async (c) => {
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.length === 0) throw new HttpError(400, 'Choose the signed document to upload.');
    return withLock(c.req.param('id'), async () => {
    const user = c.get('user');
    const { row } = load(c.req.param('id'), user);
    if (!['submitted', 'in_review', 'awaiting_signature'].includes(row.status)) {
      throw new HttpError(409, 'A signed copy cannot be added to this request now.');
    }
    // A copy signed elsewhere replaces the provider's envelope, so withdraw it.
    let warning: string | undefined;
    if (row.status === 'awaiting_signature' && row.signature_provider && row.signature_provider !== 'manual' && row.signature_ref) {
      try {
        await getProvider(row.signature_provider, readSignatureSettings(db, s.box), s.fetch).cancel(row.signature_ref);
      } catch (e) {
        warning = `The request sent through the provider could not be withdrawn automatically: ${(e as Error).message}`;
      }
    }
    const filename = c.req.query('filename') ?? `${displayId(row.number)} ${row.title} (signed).pdf`;
    const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
    db.transaction(() => {
      addDocument(row.id, 'signed', filename, bytes, isPdf ? 'application/pdf' : 'application/octet-stream', user.id);
      db.prepare(
        `UPDATE requests SET signature_status = 'signed', status = 'completed', completed_at = ?,
           signature_provider = COALESCE(signature_provider, 'manual'), owner_id = COALESCE(owner_id, ?) WHERE id = ?`,
      ).run(now(), user.id, row.id);
      log(row.id, user.id, 'signed', { uploaded: true, ...(warning ? { note: warning } : {}) });
    })();
    return c.json({ ok: true, warning });
    });
  });

  /** Checks every request that is out with a provider. Run on a timer. */
  const syncAll = async (): Promise<void> => {
    const rows = db
      .prepare("SELECT * FROM requests WHERE status = 'awaiting_signature' AND signature_provider IN ('docuseal', 'docusign')")
      .all() as RequestRow[];
    for (const row of rows) {
      try {
        await sync(row.id, null);
      } catch (e) {
        console.error(`Signature check failed for ${displayId(row.number)}: ${(e as Error).message}`);
      }
    }
  };

  return { app, syncAll };
}
