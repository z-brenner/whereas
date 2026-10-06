import type { ProviderId, RequestStatus, SignatureStatus } from '../api';

export const STATUS: Record<RequestStatus, { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: 'bg-desk-deep text-ink-soft' },
  submitted: { label: 'New', tone: 'bg-[#fff3c4] text-[#5c4a00]' },
  in_review: { label: 'In review', tone: 'bg-[#dcecff] text-[#143f73]' },
  returned: { label: 'Returned', tone: 'bg-[#ffe3d1] text-[#7a3410]' },
  awaiting_signature: { label: 'Out for signature', tone: 'bg-[#ffdbe8] text-[#7a1f44]' },
  completed: { label: 'Completed', tone: 'bg-[#d5f0da] text-[#17512a]' },
  cancelled: { label: 'Cancelled', tone: 'bg-transparent text-muted ring-1 ring-inset ring-line' },
};

export const SIGNATURE: Record<SignatureStatus, string> = {
  none: 'Not sent',
  sent: 'Sent',
  viewed: 'Viewed',
  partially_signed: 'Partly signed',
  signed: 'Signed',
  declined: 'Declined',
  voided: 'Withdrawn',
  expired: 'Expired',
};

export const PROVIDER: Record<ProviderId, string> = {
  manual: 'Send it myself',
  docusign: 'DocuSign',
  docuseal: 'DocuSeal',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function shortDate(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${sameYear ? '' : `, ${d.getFullYear()}`}`;
}

export function dateTime(iso: string): string {
  const d = new Date(iso);
  return `${shortDate(iso)}, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} hr ago`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)} d ago`;
  return shortDate(iso);
}

export function slugify(label: string, taken: Iterable<string>): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^(\d)/, 'q_$1')
      .slice(0, 40) || 'question';
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}_${i}`)) return `${base}_${i}`;
}

export function download(bytes: Uint8Array | Blob, filename: string): void {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
