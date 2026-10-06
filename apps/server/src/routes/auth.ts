import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';
import { HttpError, isLegal, type Env, type Role, type Services, type User } from '../context';
import { hashPassword, newId, newToken, sha256, verifyPassword } from '../crypto';
import { now } from '../db';
import { seedSampleTemplate } from '../seed';

const COOKIE = 'whereas_session';
const SESSION_DAYS = 14;

const password = z.string().min(10, 'Use at least 10 characters.').max(200);
const credentials = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

/**
 * Slows down password guessing: ten tries per quarter hour. The count is per
 * network address and account together, so a stranger hammering an account
 * cannot lock its owner out from elsewhere.
 */
const attempts = new Map<string, { count: number; reset: number }>();
function throttle(key: string): void {
  const t = Date.now();
  if (attempts.size > 10_000) {
    for (const [k, v] of attempts) if (v.reset < t) attempts.delete(k);
  }
  const entry = attempts.get(key);
  if (!entry || entry.reset < t) {
    attempts.set(key, { count: 1, reset: t + 15 * 60_000 });
    return;
  }
  if (++entry.count > 10) throw new HttpError(429, 'Too many sign-in attempts. Try again in 15 minutes.');
}

export function authenticate(s: Services) {
  return createMiddleware<Env>(async (c, next) => {
    const token = getCookie(c, COOKIE);
    const row =
      token &&
      (s.db
        .prepare(
          `SELECT u.id, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0`,
        )
        .get(sha256(token), now()) as User | undefined);
    if (!row) throw new HttpError(401, 'Sign in to continue.');
    c.set('user', row);
    await next();
  });
}

export const requireLegal = createMiddleware<Env>(async (c, next) => {
  if (!isLegal(c.get('user'))) throw new HttpError(403, 'Only the legal team can do this.');
  await next();
});

export const requireAdmin = createMiddleware<Env>(async (c, next) => {
  if (c.get('user').role !== 'admin') throw new HttpError(403, 'Only an admin can do this.');
  await next();
});

export function authRoutes(s: Services) {
  const app = new Hono<Env>();
  const secure = s.config.baseUrl.startsWith('https://');

  function startSession(c: Parameters<typeof setCookie>[0], userId: string): void {
    const token = newToken();
    const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
    s.db
      .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(sha256(token), userId, now(), expires.toISOString());
    setCookie(c, COOKIE, token, { httpOnly: true, sameSite: 'Lax', secure, path: '/', expires });
  }

  const userCount = () => (s.db.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n;

  app.get('/status', (c) => c.json({ needsSetup: userCount() === 0 }));

  // The first account becomes the admin. After that this route is closed.
  app.post('/setup', async (c) => {
    const body = z
      .object({ name: z.string().min(1).max(200), email: z.string().email().max(200), password, sample: z.boolean().optional() })
      .parse(await c.req.json());
    const id = newId();
    const created = s.db.transaction(() => {
      if (userCount() > 0) return false;
      s.db
        .prepare('INSERT INTO users (id, email, name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, body.email, body.name, 'admin', hashPassword(body.password), now());
      return true;
    })();
    if (!created) throw new HttpError(409, 'Whereas is already set up. Sign in instead.');
    if (body.sample !== false) seedSampleTemplate(s, id);
    startSession(c, id);
    return c.json({ ok: true });
  });

  app.post('/login', async (c) => {
    const body = credentials.parse(await c.req.json());
    const address = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress ?? 'local';
    const key = `${address} ${body.email.toLowerCase()}`;
    throttle(key);
    const row = s.db.prepare('SELECT id, password_hash, disabled FROM users WHERE email = ?').get(body.email) as
      | { id: string; password_hash: string; disabled: number }
      | undefined;
    if (!row || row.disabled || !verifyPassword(body.password, row.password_hash)) {
      throw new HttpError(401, 'That email and password do not match.');
    }
    attempts.delete(key);
    startSession(c, row.id);
    return c.json({ ok: true });
  });

  app.post('/logout', (c) => {
    const token = getCookie(c, COOKIE);
    if (token) s.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    deleteCookie(c, COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  return app;
}

export function userRoutes(s: Services) {
  const app = new Hono<Env>();

  app.get('/me', (c) => c.json(c.get('user')));

  app.get('/users', (c) => {
    const rows = s.db.prepare('SELECT id, email, name, role, disabled FROM users ORDER BY name').all() as (User & {
      disabled: number;
    })[];
    const admin = c.get('user').role === 'admin';
    // Everyone can see names for pickers; only admins see disabled accounts.
    return c.json(rows.filter((r) => admin || !r.disabled).map((r) => ({ ...r, disabled: !!r.disabled })));
  });

  app.post('/users', requireAdmin, async (c) => {
    const body = z
      .object({
        name: z.string().min(1).max(200),
        email: z.string().email().max(200),
        role: z.enum(['admin', 'legal', 'requester']),
        password,
      })
      .parse(await c.req.json());
    if (s.db.prepare('SELECT 1 FROM users WHERE email = ?').get(body.email)) {
      throw new HttpError(409, 'Someone already has that email address.');
    }
    const id = newId();
    s.db
      .prepare('INSERT INTO users (id, email, name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, body.email, body.name, body.role, hashPassword(body.password), now());
    return c.json({ id });
  });

  app.patch('/users/:id', requireAdmin, async (c) => {
    const id = c.req.param('id');
    const body = z
      .object({
        name: z.string().min(1).max(200).optional(),
        role: z.enum(['admin', 'legal', 'requester']).optional(),
        disabled: z.boolean().optional(),
        password: password.optional(),
      })
      .parse(await c.req.json());
    const target = s.db.prepare('SELECT id, role, disabled FROM users WHERE id = ?').get(id) as
      | { id: string; role: Role; disabled: number }
      | undefined;
    if (!target) throw new HttpError(404, 'That person no longer exists.');
    const losesAdmin = target.role === 'admin' && ((body.role && body.role !== 'admin') || body.disabled === true);
    if (losesAdmin) {
      const others = s.db
        .prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND disabled = 0 AND id != ?")
        .get(id) as { n: number };
      if (others.n === 0) throw new HttpError(409, 'Whereas needs at least one admin.');
    }
    if (body.name) s.db.prepare('UPDATE users SET name = ? WHERE id = ?').run(body.name, id);
    if (body.role) s.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(body.role, id);
    if (body.password) s.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(body.password), id);
    if (body.disabled !== undefined) {
      s.db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(body.disabled ? 1 : 0, id);
    }
    // A changed password or a disabled account ends that person's sessions.
    if (body.password || body.disabled) s.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    return c.json({ ok: true });
  });

  return app;
}
