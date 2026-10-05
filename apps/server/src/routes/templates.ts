import { DocxError, emptyDefinition, readDocx, reanchor, validateDefinition, type TemplateDefinition } from '@whereas/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { HttpError, isLegal, type Ctx, type Env, type Services } from '../context';
import { newId } from '../crypto';
import { now } from '../db';
import { definitionSchema } from '../schemas';
import { requireLegal } from './auth';

const MAX_DOCX = 20 * 1024 * 1024;
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

interface TemplateRow {
  id: string;
  name: string;
  description: string;
  archived: number;
  draft_docx: string;
  draft_definition: string;
  draft_dirty: number;
  published_version_id: string | null;
  updated_at: string;
}

interface VersionRow {
  id: string;
  template_id: string;
  version: number;
  name: string;
  docx: string;
  definition: string;
  published_at: string;
}

async function readUpload(c: Ctx): Promise<Uint8Array> {
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.length === 0) throw new HttpError(400, 'Choose a Word document to upload.');
  if (bytes.length > MAX_DOCX) throw new HttpError(413, 'That document is larger than 20 MB.');
  return bytes;
}

function parseDocx(bytes: Uint8Array) {
  try {
    return readDocx(bytes);
  } catch (e) {
    if (e instanceof DocxError) throw new HttpError(422, e.message);
    throw new HttpError(422, 'That file could not be read as a Word document.');
  }
}

export function templateRoutes(s: Services) {
  const app = new Hono<Env>();

  const getTemplate = (id: string): TemplateRow => {
    const row = s.db.prepare('SELECT * FROM templates WHERE id = ?').get(id) as TemplateRow | undefined;
    if (!row) throw new HttpError(404, 'That template no longer exists.');
    return row;
  };
  const getVersion = (id: string): VersionRow => {
    const row = s.db.prepare('SELECT * FROM template_versions WHERE id = ?').get(id) as VersionRow | undefined;
    if (!row) throw new HttpError(404, 'That template version no longer exists.');
    return row;
  };

  app.get('/templates', (c) => {
    const legal = isLegal(c.get('user'));
    const rows = s.db
      .prepare(
        `SELECT t.*, v.version AS version, v.definition AS published_definition,
                (SELECT COUNT(*) FROM requests r WHERE r.template_id = t.id) AS request_count
         FROM templates t LEFT JOIN template_versions v ON v.id = t.published_version_id
         ORDER BY t.archived, t.name COLLATE NOCASE`,
      )
      .all() as (TemplateRow & { version: number | null; published_definition: string | null; request_count: number })[];
    return c.json(
      rows
        // Requesters only ever see what they can request.
        .filter((r) => legal || (r.published_version_id && !r.archived))
        .map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          archived: !!r.archived,
          publishedVersionId: r.published_version_id,
          version: r.version,
          hasUnpublishedChanges: legal ? !!r.draft_dirty : undefined,
          questionCount: (JSON.parse(r.published_definition ?? r.draft_definition) as TemplateDefinition).fields.length,
          requestCount: legal ? r.request_count : undefined,
          updatedAt: r.updated_at,
        })),
    );
  });

  app.post('/templates', requireLegal, async (c) => {
    const name = z.string().min(1).max(200).parse(c.req.query('name'));
    const bytes = await readUpload(c);
    parseDocx(bytes);
    const id = newId();
    const t = now();
    s.db
      .prepare(
        `INSERT INTO templates (id, name, draft_docx, draft_definition, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, name, s.blobs.put(bytes), JSON.stringify(emptyDefinition()), c.get('user').id, t, t);
    return c.json({ id });
  });

  app.get('/templates/:id', requireLegal, (c) => {
    const row = getTemplate(c.req.param('id'));
    const definition = JSON.parse(row.draft_definition) as TemplateDefinition;
    const version = row.published_version_id ? getVersion(row.published_version_id) : null;
    return c.json({
      id: row.id,
      name: row.name,
      description: row.description,
      archived: !!row.archived,
      definition,
      problems: validateDefinition(parseDocx(s.blobs.get(row.draft_docx)), definition),
      hasUnpublishedChanges: !!row.draft_dirty,
      published: version && { id: version.id, version: version.version, publishedAt: version.published_at },
      updatedAt: row.updated_at,
    });
  });

  app.get('/templates/:id/document', requireLegal, (c) => {
    const row = getTemplate(c.req.param('id'));
    return c.body(Buffer.from(s.blobs.get(row.draft_docx)), 200, { 'Content-Type': DOCX_TYPE, 'Cache-Control': 'no-store' });
  });

  app.put('/templates/:id', requireLegal, async (c) => {
    const row = getTemplate(c.req.param('id'));
    const body = z
      .object({
        name: z.string().min(1).max(200),
        description: z.string().max(2000),
        definition: definitionSchema,
        /** The `updatedAt` the editor loaded, to catch two people editing at once. */
        baseUpdatedAt: z.string().optional(),
      })
      .parse(await c.req.json());
    if (body.baseUpdatedAt && body.baseUpdatedAt !== row.updated_at) {
      throw new HttpError(409, 'Someone else changed this template while you were editing. Reload to see their version.');
    }
    const definition = body.definition as TemplateDefinition;
    const problems = validateDefinition(parseDocx(s.blobs.get(row.draft_docx)), definition);
    const t = now();
    s.db
      .prepare('UPDATE templates SET name = ?, description = ?, draft_definition = ?, draft_dirty = 1, updated_at = ? WHERE id = ?')
      .run(body.name, body.description, JSON.stringify(definition), t, row.id);
    return c.json({ problems, updatedAt: t });
  });

  // Replace the Word document and carry the existing fields over by their text.
  app.post('/templates/:id/document', requireLegal, async (c) => {
    const row = getTemplate(c.req.param('id'));
    const bytes = await readUpload(c);
    const next = parseDocx(bytes);
    const result = reanchor(parseDocx(s.blobs.get(row.draft_docx)), next, JSON.parse(row.draft_definition));
    const t = now();
    s.db
      .prepare('UPDATE templates SET draft_docx = ?, draft_definition = ?, draft_dirty = 1, updated_at = ? WHERE id = ?')
      .run(s.blobs.put(bytes), JSON.stringify(result.definition), t, row.id);
    return c.json({ lost: result.lost.map((a) => ({ id: a.id, kind: a.kind, quote: a.range.quote })), updatedAt: t });
  });

  app.post('/templates/:id/publish', requireLegal, (c) => {
    const row = getTemplate(c.req.param('id'));
    const definition = JSON.parse(row.draft_definition) as TemplateDefinition;
    const problems = validateDefinition(parseDocx(s.blobs.get(row.draft_docx)), definition);
    if (problems.length) throw new HttpError(422, 'Fix the problems listed before publishing.', { problems });
    const versionId = newId();
    const t = now();
    const version = s.db.transaction(() => {
      const { n } = s.db
        .prepare('SELECT COALESCE(MAX(version), 0) + 1 AS n FROM template_versions WHERE template_id = ?')
        .get(row.id) as { n: number };
      s.db
        .prepare(
          `INSERT INTO template_versions (id, template_id, version, name, docx, definition, published_by, published_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(versionId, row.id, n, row.name, row.draft_docx, row.draft_definition, c.get('user').id, t);
      s.db
        .prepare('UPDATE templates SET published_version_id = ?, draft_dirty = 0, updated_at = ? WHERE id = ?')
        .run(versionId, t, row.id);
      return n;
    })();
    return c.json({ id: versionId, version, updatedAt: t });
  });

  app.post('/templates/:id/archive', requireLegal, async (c) => {
    const row = getTemplate(c.req.param('id'));
    const { archived } = z.object({ archived: z.boolean() }).parse(await c.req.json());
    s.db.prepare('UPDATE templates SET archived = ?, updated_at = ? WHERE id = ?').run(archived ? 1 : 0, now(), row.id);
    return c.json({ ok: true });
  });

  app.delete('/templates/:id', requireLegal, (c) => {
    const row = getTemplate(c.req.param('id'));
    const used = s.db.prepare('SELECT COUNT(*) n FROM requests WHERE template_id = ?').get(row.id) as { n: number };
    if (used.n > 0) throw new HttpError(409, 'Requests use this template, so it can be archived but not deleted.');
    s.db.transaction(() => {
      s.db.prepare('UPDATE templates SET published_version_id = NULL WHERE id = ?').run(row.id);
      s.db.prepare('DELETE FROM template_versions WHERE template_id = ?').run(row.id);
      s.db.prepare('DELETE FROM templates WHERE id = ?').run(row.id);
    })();
    return c.json({ ok: true });
  });

  // Published versions are what requests are built on, so anyone signed in can read them.
  app.get('/template-versions/:id', (c) => {
    const v = getVersion(c.req.param('id'));
    return c.json({
      id: v.id,
      templateId: v.template_id,
      version: v.version,
      name: v.name,
      definition: JSON.parse(v.definition) as TemplateDefinition,
    });
  });

  app.get('/template-versions/:id/document', (c) => {
    const v = getVersion(c.req.param('id'));
    // A version never changes, so the browser may keep it.
    return c.body(Buffer.from(s.blobs.get(v.docx)), 200, {
      'Content-Type': DOCX_TYPE,
      'Cache-Control': 'private, max-age=31536000, immutable',
    });
  });

  return app;
}
