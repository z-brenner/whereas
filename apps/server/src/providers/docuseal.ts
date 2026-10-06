import { expectOk, type Fetch, type SendInput, type SignatureProvider, type SignatureStatus, type StatusResult } from './types';

export interface DocuSealSettings {
  /** https://api.docuseal.com, or the /api address of a self-hosted install. */
  baseUrl: string;
  apiKey: string;
}

interface Submitter {
  status?: string;
  submission_id?: number;
  documents?: { url: string }[];
}

interface Submission {
  id?: number;
  status?: string;
  submitters?: Submitter[];
  combined_document_url?: string | null;
}

export function docusealStatus(s: Submission): SignatureStatus {
  if (s.status === 'completed') return 'signed';
  if (s.status === 'declined') return 'declined';
  if (s.status === 'expired') return 'expired';
  const submitters = s.submitters ?? [];
  if (submitters.some((x) => x.status === 'declined')) return 'declined';
  if (submitters.some((x) => x.status === 'completed')) return 'partially_signed';
  if (submitters.some((x) => x.status === 'opened')) return 'viewed';
  return 'sent';
}

export function docuseal(settings: DocuSealSettings, fetchImpl: Fetch = fetch): SignatureProvider {
  const base = settings.baseUrl.replace(/\/$/, '');
  const headers = { 'X-Auth-Token': settings.apiKey, 'Content-Type': 'application/json' };

  return {
    id: 'docuseal',
    tagStyle: 'docuseal',

    async send(input: SendInput) {
      const res = await expectOk(
        await fetchImpl(`${base}/submissions/docx`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            name: input.title,
            send_email: true,
            order: 'preserved',
            documents: [{ name: input.filename, file: Buffer.from(input.docx).toString('base64') }],
            submitters: [...input.signers]
              .sort((a, b) => a.role.order - b.role.order)
              .map((s) => ({ role: s.role.label, email: s.email, name: s.name })),
            ...(input.message ? { message: { subject: input.title, body: `${input.message}\n\n{{submitter.link}}` } } : {}),
          }),
        }),
        'DocuSeal',
      );
      const body = (await res.json()) as Submission | Submitter[];
      // The API answers with the submitters, or with the submission itself.
      const id = Array.isArray(body) ? body[0]?.submission_id : (body.id ?? body.submitters?.[0]?.submission_id);
      if (!id) throw new Error('DocuSeal accepted the document but did not return a submission id.');
      return { ref: String(id) };
    },

    async status(ref: string): Promise<StatusResult> {
      const res = await expectOk(await fetchImpl(`${base}/submissions/${ref}`, { headers }), 'DocuSeal');
      const submission = (await res.json()) as Submission;
      const status = docusealStatus(submission);
      if (status !== 'signed') return { status };
      const url =
        submission.combined_document_url ?? submission.submitters?.flatMap((s) => s.documents ?? [])[0]?.url;
      return {
        status,
        signedPdf: url
          ? async () => new Uint8Array(await (await expectOk(await fetchImpl(url), 'DocuSeal')).arrayBuffer())
          : undefined,
      };
    },

    async cancel(ref: string) {
      await expectOk(await fetchImpl(`${base}/submissions/${ref}`, { method: 'DELETE', headers }), 'DocuSeal');
    },
  };
}
