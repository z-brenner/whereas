import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { ZodError } from 'zod';
import { BlobStore } from './blobs';
import type { Config } from './config';
import { HttpError, type Env, type Services } from './context';
import { SecretBox } from './crypto';
import { openDb } from './db';
import type { Fetch } from './providers';
import { authenticate, authRoutes, userRoutes } from './routes/auth';
import { requestRoutes } from './routes/requests';
import { settingsRoutes } from './routes/settings';
import { templateRoutes } from './routes/templates';

export function createServices(config: Config, fetchImpl: Fetch = fetch): Services {
  return {
    config,
    db: openDb(config.dataDir),
    blobs: new BlobStore(config.dataDir),
    box: new SecretBox(config.dataDir),
    fetch: fetchImpl,
  };
}

const tooLarge = (limit: string) => () => {
  throw new HttpError(413, `That upload is larger than ${limit}.`);
};

export function createApp(s: Services) {
  const api = new Hono<Env>();

  // A custom header cannot be sent cross-site without permission this server
  // never gives, so requiring it on every change blocks forged requests.
  api.use('*', async (c, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && c.req.header('X-Whereas') !== '1') {
      throw new HttpError(403, 'This request did not come from the Whereas app.');
    }
    await next();
    c.header('Cache-Control', c.res.headers.get('Cache-Control') ?? 'no-store');
  });

  // Bodies are refused by size before they are read, signed in or not.
  const small = bodyLimit({ maxSize: 2 * 1024 * 1024, onError: tooLarge('2 MB') });
  const template = bodyLimit({ maxSize: 20 * 1024 * 1024, onError: tooLarge('20 MB') });
  const signed = bodyLimit({ maxSize: 50 * 1024 * 1024, onError: tooLarge('50 MB') });
  api.use('*', (c, next) => {
    const path = c.req.path;
    if (c.req.method === 'POST' && /\/templates(\/[^/]+\/document)?$/.test(path)) return template(c, next);
    if (c.req.method === 'POST' && /\/requests\/[^/]+\/signed$/.test(path)) return signed(c, next);
    return small(c, next);
  });

  api.route('/auth', authRoutes(s));

  const requests = requestRoutes(s);
  const authed = new Hono<Env>();
  authed.use('*', authenticate(s));
  authed.route('/', userRoutes(s));
  authed.route('/', templateRoutes(s));
  authed.route('/', requests.app);
  authed.route('/', settingsRoutes(s));
  api.route('/', authed);

  api.notFound((c) => c.json({ error: 'Not found.' }, 404));

  const app = new Hono<Env>();
  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'same-origin');
    c.header('X-Frame-Options', 'DENY');
    c.header(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
  });
  app.route('/api', api);

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message, details: err.details }, err.status);
    if (err instanceof ZodError) {
      const first = err.issues[0];
      const where = first?.path.length ? `${first.path.join('.')}: ` : '';
      return c.json({ error: `${where}${first?.message ?? 'Invalid input.'}`, details: err.issues }, 400);
    }
    if (err instanceof SyntaxError) return c.json({ error: 'The request body was not valid JSON.' }, 400);
    console.error(err);
    return c.json({ error: 'Something went wrong on the server. Nothing was changed.' }, 500);
  });

  return { app, syncSignatures: requests.syncAll };
}
