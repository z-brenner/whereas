import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type DB = Database.Database;

/** Migrations only ever get appended. Each runs once, in a transaction. */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'legal', 'requester')),
    password_hash TEXT NOT NULL,
    disabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    archived INTEGER NOT NULL DEFAULT 0,
    draft_docx TEXT NOT NULL,
    draft_definition TEXT NOT NULL,
    draft_dirty INTEGER NOT NULL DEFAULT 1,
    published_version_id TEXT,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE template_versions (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL REFERENCES templates(id),
    version INTEGER NOT NULL,
    name TEXT NOT NULL,
    docx TEXT NOT NULL,
    definition TEXT NOT NULL,
    published_by TEXT NOT NULL REFERENCES users(id),
    published_at TEXT NOT NULL,
    UNIQUE (template_id, version)
  );
  CREATE TABLE requests (
    id TEXT PRIMARY KEY,
    number INTEGER NOT NULL UNIQUE,
    title TEXT NOT NULL,
    template_id TEXT NOT NULL REFERENCES templates(id),
    template_version_id TEXT NOT NULL REFERENCES template_versions(id),
    requester_id TEXT NOT NULL REFERENCES users(id),
    owner_id TEXT REFERENCES users(id),
    status TEXT NOT NULL,
    answers TEXT NOT NULL DEFAULT '{}',
    signature_status TEXT NOT NULL DEFAULT 'none',
    signature_provider TEXT,
    signature_ref TEXT,
    signers TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    submitted_at TEXT,
    last_activity_at TEXT NOT NULL,
    completed_at TEXT
  );
  CREATE INDEX requests_requester ON requests(requester_id);
  CREATE INDEX requests_owner ON requests(owner_id);
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL REFERENCES requests(id),
    title TEXT NOT NULL,
    assignee_id TEXT REFERENCES users(id),
    done INTEGER NOT NULL DEFAULT 0,
    due_date TEXT,
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL,
    done_at TEXT
  );
  CREATE INDEX tasks_request ON tasks(request_id);
  CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL REFERENCES requests(id),
    actor_id TEXT REFERENCES users(id),
    type TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    at TEXT NOT NULL
  );
  CREATE INDEX events_request ON events(request_id);
  CREATE TABLE documents (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL REFERENCES requests(id),
    kind TEXT NOT NULL,
    filename TEXT NOT NULL,
    blob TEXT NOT NULL,
    content_type TEXT NOT NULL,
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL
  );
  CREATE INDEX documents_request ON documents(request_id);
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];

export function openDb(dataDir: string): DB {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, 'whereas.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i]!);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
  return db;
}

export const now = (): string => new Date().toISOString();
