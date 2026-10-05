import { Hono } from 'hono';
import { z } from 'zod';
import type { Env, Services } from '../context';
import { pdfAvailable } from '../pdf';
import { readSignatureSettings, writeSignatureSettings, type SignatureSettings } from '../providers';
import { requireAdmin } from './auth';

const input = z.object({
  docuseal: z
    .object({ baseUrl: z.string().url().max(500), apiKey: z.string().max(500).optional() })
    .nullable()
    .optional(),
  docusign: z
    .object({
      environment: z.enum(['demo', 'production']),
      integrationKey: z.string().min(1).max(200),
      userId: z.string().min(1).max(200),
      accountId: z.string().min(1).max(200),
      privateKey: z.string().max(10_000).optional(),
    })
    .nullable()
    .optional(),
});

export function settingsRoutes(s: Services) {
  const app = new Hono<Env>();

  // Secrets are write-only: the page learns whether one is stored, never its value.
  const view = (settings: SignatureSettings) => ({
    docuseal: settings.docuseal ? { baseUrl: settings.docuseal.baseUrl, hasSecret: true } : null,
    docusign: settings.docusign
      ? {
          environment: settings.docusign.environment,
          integrationKey: settings.docusign.integrationKey,
          userId: settings.docusign.userId,
          accountId: settings.docusign.accountId,
          hasSecret: true,
        }
      : null,
  });

  app.get('/settings/signature', requireAdmin, (c) => c.json(view(readSignatureSettings(s.db, s.box))));

  app.put('/settings/signature', requireAdmin, async (c) => {
    const body = input.parse(await c.req.json());
    const current = readSignatureSettings(s.db, s.box);
    const next: SignatureSettings = { ...current };
    if (body.docuseal === null) delete next.docuseal;
    else if (body.docuseal) {
      const apiKey = body.docuseal.apiKey || current.docuseal?.apiKey;
      if (!apiKey) return c.json({ error: 'Enter the DocuSeal API key.' }, 422);
      next.docuseal = { baseUrl: body.docuseal.baseUrl, apiKey };
    }
    if (body.docusign === null) delete next.docusign;
    else if (body.docusign) {
      const privateKey = body.docusign.privateKey || current.docusign?.privateKey;
      if (!privateKey) return c.json({ error: 'Paste the DocuSign RSA private key.' }, 422);
      next.docusign = { ...body.docusign, privateKey };
    }
    writeSignatureSettings(s.db, s.box, next);
    return c.json(view(next));
  });

  app.get('/settings/system', async (c) => c.json({ pdfAvailable: await pdfAvailable() }));

  return app;
}
