import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

/** A random, URL-safe id. */
export function newId(length = 16): string {
  const bytes = randomBytes(length);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % 32];
  return out;
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(actual, expected);
}

/**
 * Encrypts provider credentials before they go into the database. The key
 * sits in its own file so a copy of the database alone does not expose them.
 */
export class SecretBox {
  private key: Buffer;

  constructor(dataDir: string) {
    const path = join(dataDir, 'secret.key');
    if (!existsSync(path)) {
      writeFileSync(path, randomBytes(32).toString('base64'), { mode: 0o600 });
      chmodSync(path, 0o600);
    }
    this.key = Buffer.from(readFileSync(path, 'utf8').trim(), 'base64');
    if (this.key.length !== 32) throw new Error(`${path} is not a valid key file.`);
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join('.');
  }

  open(sealed: string): string {
    const [version, iv, tag, body] = sealed.split('.');
    if (version !== 'v1' || !iv || !tag || !body) throw new Error('Stored secret is unreadable.');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8');
  }
}
