import { createSign } from 'node:crypto';
import { docusignAnchor } from '@whereas/core';
import { expectOk, type Fetch, type SendInput, type SignatureProvider, type SignatureStatus } from './types';

export interface DocuSignSettings {
  environment: 'demo' | 'production';
  integrationKey: string;
  /** The API user's GUID, who must have granted consent to the integration. */
  userId: string;
  accountId: string;
  /** RSA private key in PEM form. */
  privateKey: string;
}

const b64url = (data: string | Buffer): string => Buffer.from(data).toString('base64url');

export function docusignStatus(status: string | undefined): SignatureStatus {
  switch (status) {
    case 'completed':
      return 'signed';
    case 'declined':
      return 'declined';
    case 'voided':
      return 'voided';
    case 'delivered':
      return 'viewed';
    default:
      return 'sent';
  }
}

export function docusign(settings: DocuSignSettings, fetchImpl: Fetch = fetch): SignatureProvider {
  const authHost = settings.environment === 'production' ? 'account.docusign.com' : 'account-d.docusign.com';
  let cached: { token: string; base: string; expires: number } | null = null;

  async function session(): Promise<{ token: string; base: string }> {
    if (cached && cached.expires > Date.now() + 60_000) return cached;
    const iat = Math.floor(Date.now() / 1000);
    const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(
      JSON.stringify({
        iss: settings.integrationKey,
        sub: settings.userId,
        aud: authHost,
        iat,
        exp: iat + 3600,
        scope: 'signature impersonation',
      }),
    )}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(settings.privateKey);
    const tokenRes = await expectOk(
      await fetchImpl(`https://${authHost}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: `${unsigned}.${b64url(signature)}`,
        }),
      }),
      'DocuSign',
    );
    const { access_token, expires_in } = (await tokenRes.json()) as { access_token: string; expires_in: number };
    const infoRes = await expectOk(
      await fetchImpl(`https://${authHost}/oauth/userinfo`, { headers: { Authorization: `Bearer ${access_token}` } }),
      'DocuSign',
    );
    const info = (await infoRes.json()) as { accounts?: { account_id: string; base_uri: string }[] };
    const account = info.accounts?.find((a) => a.account_id === settings.accountId);
    if (!account) throw new Error('The DocuSign user does not belong to the configured account.');
    cached = {
      token: access_token,
      base: `${account.base_uri}/restapi/v2.1/accounts/${settings.accountId}`,
      expires: Date.now() + expires_in * 1000,
    };
    return cached;
  }

  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    const { token, base } = await session();
    return expectOk(
      await fetchImpl(`${base}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      }),
      'DocuSign',
    );
  }

  const tab = (anchorString: string) => ({
    anchorString,
    anchorUnits: 'pixels',
    anchorXOffset: '0',
    anchorYOffset: '0',
    // A signer whose tag sits in a removed clause must not block sending.
    anchorIgnoreIfNotPresent: 'true',
  });

  return {
    id: 'docusign',
    tagStyle: 'docusign',

    async send(input: SendInput) {
      const res = await call('/envelopes', {
        method: 'POST',
        body: JSON.stringify({
          emailSubject: input.title.slice(0, 100),
          emailBlurb: input.message ?? '',
          status: 'sent',
          documents: [
            {
              documentId: '1',
              name: input.filename,
              fileExtension: 'docx',
              documentBase64: Buffer.from(input.docx).toString('base64'),
            },
          ],
          recipients: {
            signers: input.signers.map((s) => ({
              recipientId: String(s.role.order),
              routingOrder: String(s.role.order),
              name: s.name,
              email: s.email,
              tabs: {
                signHereTabs: [tab(docusignAnchor(s.role, 'signature'))],
                initialHereTabs: [tab(docusignAnchor(s.role, 'initials'))],
                dateSignedTabs: [tab(docusignAnchor(s.role, 'date'))],
              },
            })),
          },
        }),
      });
      const { envelopeId } = (await res.json()) as { envelopeId?: string };
      if (!envelopeId) throw new Error('DocuSign accepted the document but did not return an envelope id.');
      return { ref: envelopeId };
    },

    async status(ref: string) {
      const res = await call(`/envelopes/${ref}`);
      const status = docusignStatus(((await res.json()) as { status?: string }).status);
      if (status !== 'signed') return { status };
      return {
        status,
        signedPdf: async () =>
          new Uint8Array(
            await (await call(`/envelopes/${ref}/documents/combined`, { headers: { Accept: 'application/pdf' } })).arrayBuffer(),
          ),
      };
    },

    async cancel(ref: string) {
      await call(`/envelopes/${ref}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'voided', voidedReason: 'Cancelled in Whereas' }),
      });
    },
  };
}
