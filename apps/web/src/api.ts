import type { Answers, MissingAnswer, Problem, TemplateDefinition } from '@whereas/core';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function request(method: string, path: string, body?: unknown, raw?: Blob | ArrayBuffer): Promise<Response> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      'X-Whereas': '1',
      ...(raw ? { 'Content-Type': 'application/octet-stream' } : body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; details?: unknown };
    throw new ApiError(data.error ?? `The server answered with an error (${res.status}).`, res.status, data.details);
  }
  return res;
}

export const api = {
  get: async <T>(path: string): Promise<T> => (await request('GET', path)).json() as Promise<T>,
  post: async <T = { ok: true }>(path: string, body?: unknown): Promise<T> =>
    (await request('POST', path, body ?? {})).json() as Promise<T>,
  put: async <T>(path: string, body: unknown): Promise<T> => (await request('PUT', path, body)).json() as Promise<T>,
  patch: async <T = { ok: true }>(path: string, body: unknown): Promise<T> =>
    (await request('PATCH', path, body)).json() as Promise<T>,
  del: async <T = { ok: true }>(path: string): Promise<T> => (await request('DELETE', path)).json() as Promise<T>,
  upload: async <T>(path: string, file: Blob): Promise<T> => (await request('POST', path, undefined, file)).json() as Promise<T>,
  bytes: async (path: string): Promise<Uint8Array> => new Uint8Array(await (await request('GET', path)).arrayBuffer()),
};

export type Role = 'admin' | 'legal' | 'requester';
export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  disabled?: boolean;
}
export interface Person {
  id: string;
  name: string | null;
}

export type RequestStatus = 'draft' | 'submitted' | 'in_review' | 'returned' | 'awaiting_signature' | 'completed' | 'cancelled';
export type SignatureStatus = 'none' | 'sent' | 'viewed' | 'partially_signed' | 'signed' | 'declined' | 'voided' | 'expired';
export type ProviderId = 'manual' | 'docuseal' | 'docusign';

export interface RequestRow {
  id: string;
  displayId: string;
  title: string;
  status: RequestStatus;
  tasksDone: number;
  tasksTotal: number;
  requester: Person;
  owner: Person | null;
  template: { id: string; name: string; version: number };
  requestedAt: string;
  lastActivityAt: string;
  signatureStatus: SignatureStatus;
}

export interface Task {
  id: string;
  title: string;
  done: boolean;
  dueDate: string | null;
  assignee: Person | null;
}

export interface RequestEvent {
  id: number;
  type: string;
  data: Record<string, unknown>;
  at: string;
  actor: Person | null;
}

export interface RequestDetail {
  id: string;
  displayId: string;
  title: string;
  status: RequestStatus;
  signatureStatus: SignatureStatus;
  signatureProvider: ProviderId | null;
  signers: Record<string, { name: string; email: string }>;
  requester: Person;
  owner: Person | null;
  template: { id: string; versionId: string; version: number; name: string };
  definition: TemplateDefinition;
  answers: Answers;
  createdAt: string;
  requestedAt: string;
  lastActivityAt: string;
  completedAt: string | null;
  tasks: Task[];
  events: RequestEvent[];
  documents: { id: string; kind: string; filename: string; createdAt: string }[];
  missing: { requester: MissingAnswer[]; all: MissingAnswer[] };
  can: Record<
    | 'editAsRequester' | 'editAsLegal' | 'submit' | 'assign' | 'returnToRequester' | 'send' | 'uploadSigned'
    | 'cancelSignature' | 'refreshSignature' | 'download' | 'manageTasks' | 'cancel' | 'comment',
    boolean
  >;
  providers: ProviderId[];
  pdfAvailable: boolean;
}

export interface TemplateRow {
  id: string;
  name: string;
  description: string;
  archived: boolean;
  publishedVersionId: string | null;
  version: number | null;
  hasUnpublishedChanges?: boolean;
  questionCount: number;
  requestCount?: number;
  updatedAt: string;
}

export interface TemplateDetail {
  id: string;
  name: string;
  description: string;
  archived: boolean;
  definition: TemplateDefinition;
  problems: Problem[];
  hasUnpublishedChanges: boolean;
  published: { id: string; version: number; publishedAt: string } | null;
  updatedAt: string;
}
