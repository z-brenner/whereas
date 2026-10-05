import type { SignatureTagStyle, SignerRole } from '@whereas/core';

export type SignatureStatus =
  | 'none'
  | 'sent'
  | 'viewed'
  | 'partially_signed'
  | 'signed'
  | 'declined'
  | 'voided'
  | 'expired';

export type ProviderId = 'manual' | 'docuseal' | 'docusign';

export interface SignerInput {
  role: SignerRole;
  name: string;
  email: string;
}

export interface SendInput {
  title: string;
  filename: string;
  docx: Uint8Array;
  signers: SignerInput[];
  message?: string;
}

export interface StatusResult {
  status: SignatureStatus;
  /** Present once every signer has signed. */
  signedPdf?: () => Promise<Uint8Array>;
}

export interface SignatureProvider {
  id: ProviderId;
  /** How this provider finds signature positions in the document. */
  tagStyle: SignatureTagStyle;
  send(input: SendInput): Promise<{ ref: string }>;
  status(ref: string): Promise<StatusResult>;
  cancel(ref: string): Promise<void>;
}

export type Fetch = typeof fetch;

export class ProviderError extends Error {}

export async function expectOk(res: Response, provider: string): Promise<Response> {
  if (res.ok) return res;
  const body = (await res.text().catch(() => '')).slice(0, 400);
  throw new ProviderError(`${provider} refused the request (${res.status}). ${body}`.trim());
}
