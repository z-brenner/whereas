import { resolve } from 'node:path';

export interface Config {
  dataDir: string;
  port: number;
  /** Public address of this install, used for cookies and provider callbacks. */
  baseUrl: string;
  /** Folder of the built web app, served when present. */
  webDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 3000);
  return {
    dataDir: resolve(env.WHEREAS_DATA_DIR ?? './data'),
    port,
    baseUrl: (env.WHEREAS_BASE_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
    webDir: resolve(env.WHEREAS_WEB_DIR ?? new URL('../../web/dist', import.meta.url).pathname),
  };
}
