import type { Context } from 'hono';
import type { BlobStore } from './blobs';
import type { Config } from './config';
import type { SecretBox } from './crypto';
import type { DB } from './db';
import type { Fetch } from './providers';

export type Role = 'admin' | 'legal' | 'requester';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface Services {
  config: Config;
  db: DB;
  blobs: BlobStore;
  box: SecretBox;
  /** Swapped out in tests so providers never touch the network. */
  fetch: Fetch;
}

export type Env = { Variables: { user: User } };
export type Ctx = Context<Env>;

/** An error whose message is safe and useful to show to the person using the app. */
export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 502,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const isLegal = (u: User): boolean => u.role === 'legal' || u.role === 'admin';
