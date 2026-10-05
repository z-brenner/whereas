import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { docusealStatus } from '../src/providers/docuseal';
import { docusign, docusignStatus } from '../src/providers/docusign';

describe('DocuSeal status mapping', () => {
  it('reads progress from the submitters while the submission is pending', () => {
    expect(docusealStatus({ status: 'pending', submitters: [{ status: 'sent' }, { status: 'awaiting' }] })).toBe('sent');
    expect(docusealStatus({ status: 'pending', submitters: [{ status: 'opened' }] })).toBe('viewed');
    expect(docusealStatus({ status: 'pending', submitters: [{ status: 'completed' }, { status: 'sent' }] })).toBe('partially_signed');
    expect(docusealStatus({ status: 'completed' })).toBe('signed');
    expect(docusealStatus({ status: 'declined' })).toBe('declined');
  });
});

describe('DocuSign', () => {
  it('maps envelope statuses', () => {
    expect(docusignStatus('sent')).toBe('sent');
    expect(docusignStatus('delivered')).toBe('viewed');
    expect(docusignStatus('completed')).toBe('signed');
    expect(docusignStatus('voided')).toBe('voided');
  });

  it('signs in with a JWT, then sends an envelope with anchor tabs per signer', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const calls: { url: string; init?: RequestInit }[] = [];
    const fake: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      const json = (d: unknown) => new Response(JSON.stringify(d), { status: 200 });
      if (url.endsWith('/oauth/token')) return json({ access_token: 'tok', expires_in: 3600 });
      if (url.endsWith('/oauth/userinfo')) return json({ accounts: [{ account_id: 'acct', base_uri: 'https://demo.docusign.net' }] });
      if (url.endsWith('/envelopes')) return json({ envelopeId: 'env-1' });
      return new Response('no', { status: 404 });
    };
    const provider = docusign(
      { environment: 'demo', integrationKey: 'ik', userId: 'uid', accountId: 'acct', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string },
      fake,
    );
    const { ref } = await provider.send({
      title: 'MSA',
      filename: 'msa.docx',
      docx: new Uint8Array([1, 2, 3]),
      signers: [
        { role: { id: 'company', label: 'Company', order: 1 }, name: 'A', email: 'a@x.test' },
        { role: { id: 'provider', label: 'Provider', order: 2 }, name: 'B', email: 'b@y.test' },
      ],
    });
    expect(ref).toBe('env-1');

    const token = calls.find((c) => c.url === 'https://account-d.docusign.com/oauth/token')!;
    const assertion = new URLSearchParams(String(token.init!.body)).get('assertion')!;
    const claims = JSON.parse(Buffer.from(assertion.split('.')[1]!, 'base64url').toString());
    expect(claims).toMatchObject({ iss: 'ik', sub: 'uid', aud: 'account-d.docusign.com', scope: 'signature impersonation' });

    const envelope = calls.find((c) => c.url === 'https://demo.docusign.net/restapi/v2.1/accounts/acct/envelopes')!;
    const body = JSON.parse(String(envelope.init!.body));
    expect(body.status).toBe('sent');
    expect(body.documents[0]).toMatchObject({ fileExtension: 'docx', documentBase64: 'AQID' });
    expect(body.recipients.signers[1]).toMatchObject({ routingOrder: '2', email: 'b@y.test' });
    expect(body.recipients.signers[1].tabs.signHereTabs[0].anchorString).toBe('/wa_signature_2/');
    expect(body.recipients.signers[0].tabs.dateSignedTabs[0].anchorString).toBe('/wa_date_1/');
  });
});
