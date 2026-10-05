import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createApp, createServices } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const services = createServices(config);
const { app, syncSignatures } = createApp(services);

if (existsSync(join(config.webDir, 'index.html'))) {
  const root = relative(process.cwd(), config.webDir) || '.';
  const index = readFileSync(join(config.webDir, 'index.html'), 'utf8');
  app.use('/assets/*', serveStatic({ root, onFound: (_p, c) => c.header('Cache-Control', 'public, max-age=31536000, immutable') }));
  app.use('*', serveStatic({ root }));
  // Any other address is a page inside the app.
  app.get('*', (c) => c.html(index));
}

// Providers are polled, so Whereas works behind a firewall with no inbound webhooks.
const timer = setInterval(() => void syncSignatures(), 5 * 60_000);
timer.unref();

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Whereas is running at http://localhost:${info.port}`);
  console.log(`Data is stored in ${config.dataDir}`);
});

const stop = () => {
  server.close(() => {
    services.db.close();
    process.exit(0);
  });
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
