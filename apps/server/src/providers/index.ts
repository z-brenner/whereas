import { HttpError } from '../context';
import type { SecretBox } from '../crypto';
import type { DB } from '../db';
import { docuseal, type DocuSealSettings } from './docuseal';
import { docusign, type DocuSignSettings } from './docusign';
import type { Fetch, ProviderId, SignatureProvider } from './types';

export * from './types';

export interface SignatureSettings {
  docuseal?: DocuSealSettings;
  docusign?: DocuSignSettings;
}

const KEY = 'signature';
const NAMES: Record<ProviderId, string> = { manual: 'Manual signing', docuseal: 'DocuSeal', docusign: 'DocuSign' };

export function readSignatureSettings(db: DB, box: SecretBox): SignatureSettings {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as { value: string } | undefined;
  return row ? (JSON.parse(box.open(row.value)) as SignatureSettings) : {};
}

export function writeSignatureSettings(db: DB, box: SecretBox, settings: SignatureSettings): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    KEY,
    box.seal(JSON.stringify(settings)),
  );
}

/**
 * "Manual" is always there: download the agreement, send it however you
 * like, and upload the signed copy.
 */
export const manual: SignatureProvider = {
  id: 'manual',
  tagStyle: 'line',
  async send() {
    return { ref: 'manual' };
  },
  async status() {
    return { status: 'sent' };
  },
  async cancel() {},
};

export function availableProviders(settings: SignatureSettings): ProviderId[] {
  const out: ProviderId[] = [];
  if (settings.docusign) out.push('docusign');
  if (settings.docuseal) out.push('docuseal');
  out.push('manual');
  return out;
}

export function getProvider(id: ProviderId, settings: SignatureSettings, fetchImpl: Fetch = fetch): SignatureProvider {
  if (id === 'manual') return manual;
  if (id === 'docuseal' && settings.docuseal) return docuseal(settings.docuseal, fetchImpl);
  if (id === 'docusign' && settings.docusign) return docusign(settings.docusign, fetchImpl);
  throw new HttpError(409, `${NAMES[id]} is not set up. An admin can add it under Settings.`);
}
