import { existsSync, readFileSync } from 'node:fs';
import { readDocx, sampleDefinition } from '@whereas/core';
import type { Services } from './context';
import { newId } from './crypto';
import { now } from './db';

function sampleBytes(): Uint8Array | null {
  const candidates = [
    new URL('./assets/services-agreement.docx', import.meta.url),
    new URL('../../../fixtures/services-agreement.docx', import.meta.url),
  ];
  for (const url of candidates) if (existsSync(url)) return new Uint8Array(readFileSync(url));
  return null;
}

/** Gives a new install one published template to try a request against. */
export function seedSampleTemplate(s: Services, userId: string): void {
  const bytes = sampleBytes();
  if (!bytes) return;
  const definition = JSON.stringify(sampleDefinition(readDocx(bytes)));
  const blob = s.blobs.put(bytes);
  const id = newId();
  const versionId = newId();
  const t = now();
  const name = 'Master Services Agreement (sample)';
  s.db.transaction(() => {
    s.db
      .prepare(
        `INSERT INTO templates (id, name, description, draft_docx, draft_definition, draft_dirty, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      )
      .run(id, name, 'A worked example. Edit it, or archive it once you have your own.', blob, definition, userId, t, t);
    s.db
      .prepare(
        `INSERT INTO template_versions (id, template_id, version, name, docx, definition, published_by, published_at)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?)`,
      )
      .run(versionId, id, name, blob, definition, userId, t);
    s.db.prepare('UPDATE templates SET published_version_id = ? WHERE id = ?').run(versionId, id);
  })();
}
