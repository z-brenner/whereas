import { useQuery, useQueryClient } from '@tanstack/react-query';
import { previewDocx, renderDocx, type Answers, type MissingAnswer } from '@whereas/core';
import { ArrowLeft, Check, Download, FileSignature, Plus, RefreshCw, Trash2, Undo2, Upload } from 'lucide-react';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, type ProviderId, type RequestDetail, type RequestEvent, type User } from '../api';
import { DocView } from '../doc/DocView';
import { useDocx } from '../doc/useDocx';
import { AnswerForm, hasQuestions } from '../form/AnswerForm';
import { isLegal, useUser } from '../Layout';
import { ago, dateTime, download, PROVIDER, shortDate, SIGNATURE } from '../lib/format';
import { Button, Checkbox, cx, ErrorNote, Input, Label, Modal, Select, Spinner, Textarea, useToast } from '../ui';
import { StatusPill } from './Requests';

function sentence(e: RequestEvent): string {
  const d = e.data as Record<string, string | boolean | undefined>;
  switch (e.type) {
    case 'created': return 'started this request';
    case 'submitted': return 'sent this request to legal';
    case 'resubmitted': return 'sent this back to legal';
    case 'assigned': return d.owner ? `assigned this to ${d.owner}` : 'removed the owner';
    case 'returned': return 'returned this to the requester';
    case 'answers_updated': return 'changed the answers';
    case 'task_added': return `added the task “${d.title}”${d.assignee ? ` for ${d.assignee}` : ''}`;
    case 'task_done': return `completed “${d.title}”`;
    case 'task_reopened': return `reopened “${d.title}”`;
    case 'task_removed': return `removed the task “${d.title}”`;
    case 'comment': return 'commented';
    case 'sent_for_signature': return d.provider === 'manual' ? 'marked this as out for signature' : `sent this for signature with ${PROVIDER[d.provider as ProviderId]}`;
    case 'signature_progress': return `Signature status changed to ${SIGNATURE[d.status as keyof typeof SIGNATURE].toLowerCase()}`;
    case 'signature_stopped': return `Signing stopped: ${SIGNATURE[d.status as keyof typeof SIGNATURE].toLowerCase()}`;
    case 'signed': return d.uploaded ? 'added the signed copy' : 'Everyone has signed';
    case 'cancelled': return 'cancelled this request';
    default: return e.type.replace(/_/g, ' ');
  }
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="border-b border-line-soft px-5 py-4 last:border-0">
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function SendDialog({ detail, users, open, onClose, onSent, flush }: { detail: RequestDetail; users: User[]; open: boolean; onClose: () => void; onSent: () => void; flush: () => Promise<void> }) {
  const def = detail.definition;
  const roles = useMemo(
    () => def.signers.filter((r) => def.anchors.some((a) => a.kind === 'signature' && a.signer === r.id)).sort((a, b) => a.order - b.order),
    [def],
  );
  const [provider, setProvider] = useState<ProviderId>(detail.providers[0] ?? 'manual');
  const [signers, setSigners] = useState<Record<string, { name: string; email: string }>>({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    setProvider(detail.providers[0] ?? 'manual');
    setSigners(
      Object.fromEntries(
        roles.map((r) => {
          const name = detail.signers[r.id]?.name || String((r.nameField && detail.answers[r.nameField]) ?? '');
          const known = users.find((u) => u.name.toLowerCase() === name.toLowerCase());
          const email = detail.signers[r.id]?.email || String((r.emailField && detail.answers[r.emailField]) ?? '') || known?.email || '';
          return [r.id, { name, email }];
        }),
      ),
    );
  }, [open, detail, roles, users]);

  const send = async () => {
    setBusy(true);
    setError('');
    try {
      await flush();
      await api.post(`/requests/${detail.id}/send`, { provider, signers, message: message.trim() || undefined });
      onSent();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The document was not sent.');
    } finally {
      setBusy(false);
    }
  };

  const manual = provider === 'manual';
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Send for signature"
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={send}>
            {manual ? 'Mark as out for signature' : `Send with ${PROVIDER[provider]}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Label label="How will it be signed?">
          {(id) => (
            <Select id={id} value={provider} onChange={(e) => setProvider(e.target.value as ProviderId)}>
              {detail.providers.map((p) => <option key={p} value={p}>{PROVIDER[p]}</option>)}
            </Select>
          )}
        </Label>
        {manual ? (
          <p className="rounded-md bg-desk px-3 py-2.5 text-[13px] leading-relaxed text-ink-soft">
            Download the agreement and send it however you like. When it comes back signed, add the signed copy here and the request closes.
          </p>
        ) : roles.length === 0 ? (
          <ErrorNote>This template has no signature blocks, so {PROVIDER[provider]} would have nowhere to place a signature. Add one in the template, or send it yourself.</ErrorNote>
        ) : (
          <>
            <div className="space-y-3">
              {roles.map((r, i) => (
                <fieldset key={r.id} className="grid grid-cols-2 gap-2">
                  <legend className="col-span-2 mb-1 text-[13px] font-medium">{r.label} <span className="font-normal text-muted">signs {roles.length > 1 ? (i === 0 ? 'first' : i === roles.length - 1 ? 'last' : 'next') : ''}</span></legend>
                  <Input aria-label={`${r.label} name`} placeholder="Full name" value={signers[r.id]?.name ?? ''} onChange={(e) => setSigners({ ...signers, [r.id]: { name: e.target.value, email: signers[r.id]?.email ?? '' } })} />
                  <Input aria-label={`${r.label} email`} type="email" placeholder="Email" value={signers[r.id]?.email ?? ''} onChange={(e) => setSigners({ ...signers, [r.id]: { email: e.target.value, name: signers[r.id]?.name ?? '' } })} />
                </fieldset>
              ))}
            </div>
            <Label label="Message to signers" hint="Optional.">
              {(id) => <Textarea id={id} value={message} onChange={(e) => setMessage(e.target.value)} />}
            </Label>
          </>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Modal>
  );
}

export function RequestPage() {
  const { id = '' } = useParams();
  const user = useUser();
  const legal = isLegal(user);
  const toast = useToast();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['request', id], queryFn: () => api.get<RequestDetail>(`/requests/${id}`), refetchInterval: 30_000 });
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<User[]>('/users'), staleTime: 60_000 });
  const detail = query.data;
  const source = useDocx(detail ? `/template-versions/${detail.template.versionId}/document` : null, detail?.template.versionId);

  const [answers, setAnswers] = useState<Answers | null>(null);
  const [title, setTitle] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [flagged, setFlagged] = useState<MissingAnswer[]>([]);
  const [focus, setFocus] = useState<{ field: string; at: number } | null>(null);
  const [sending, setSending] = useState(false);
  const [returning, setReturning] = useState(false);
  const [note, setNote] = useState('');
  const [comment, setComment] = useState('');
  const [newTask, setNewTask] = useState('');
  const pending = useRef<Answers | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const upload = useRef<HTMLInputElement>(null);

  // Local answers start from the server and are reset when the request moves on.
  const stamp = detail ? `${detail.id}:${detail.status}` : '';
  useEffect(() => {
    if (!detail) return;
    setAnswers(detail.answers);
    setTitle(detail.title);
    pending.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['request', id] });
    void qc.invalidateQueries({ queryKey: ['requests'] });
  }, [qc, id]);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const body = pending.current;
    if (!body) return;
    pending.current = null;
    setSaveState('saving');
    try {
      await api.patch(`/requests/${id}`, { answers: body });
      setSaveState('saved');
    } catch (err) {
      pending.current = body;
      setSaveState('error');
      throw err;
    }
  }, [id]);

  const change = (next: Answers) => {
    setAnswers(next);
    pending.current = next;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush().then(refresh).catch(() => {}), 700);
  };

  // Do not lose the last edits when leaving the page.
  useEffect(() => () => void flush().catch(() => {}), [flush]);

  const deferred = useDeferredValue(answers);
  const preview = useMemo(() => {
    if (!source.data || !detail || !deferred) return null;
    try {
      return renderDocx(previewDocx(source.data, detail.definition, deferred));
    } catch (e) {
      console.error(e);
      return null;
    }
  }, [source.data, detail, deferred]);

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    try {
      await flush();
      await fn();
      if (done) toast(done);
      refresh();
    } catch (err) {
      if (err instanceof ApiError && (err.details as { missing?: MissingAnswer[] } | undefined)?.missing) {
        const missing = (err.details as { missing: MissingAnswer[] }).missing;
        setFlagged(missing);
        if (missing[0]) setFocus({ field: missing[0].field, at: Date.now() });
      }
      toast(err instanceof Error ? err.message : 'That did not work.', 'error');
    }
  };

  if (query.error) return <div className="p-8"><ErrorNote>{(query.error as Error).message}</ErrorNote></div>;
  if (!detail || !answers) return <Spinner />;

  const { can } = detail;
  const def = detail.definition;
  const editable = can.editAsRequester || can.editAsLegal;
  const legalTeam = (users.data ?? []).filter((u) => u.role !== 'requester' && !u.disabled);
  const returnedNote = detail.status === 'returned' ? (detail.events.find((e) => e.type === 'returned')?.data.note as string | undefined) : undefined;
  const anchorField = (anchorId: string) => {
    const a = def.anchors.find((x) => x.id === anchorId);
    return a && (a.kind === 'field' || a.kind === 'alternatives') ? a.field : null;
  };
  const getAgreement = (format: 'docx' | 'pdf') =>
    act(async () => download(await api.bytes(`/requests/${id}/agreement?format=${format}`), `${detail.displayId} ${detail.title}.${format}`));

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-desk px-6 py-3">
        <Link to="/requests" aria-label="Back to requests" className="rounded p-1 text-muted hover:bg-desk-deep hover:text-ink"><ArrowLeft size={18} /></Link>
        <span className="text-sm tabular-nums text-muted">{detail.displayId}</span>
        {editable ? (
          <input
            aria-label="Request name"
            className="min-w-40 flex-1 truncate rounded bg-transparent px-1 font-serif text-xl hover:bg-desk-deep focus:bg-paper"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title !== detail.title && act(() => api.patch(`/requests/${id}`, { title: title.trim() }))}
          />
        ) : (
          <h1 className="min-w-0 flex-1 truncate font-serif text-xl">{detail.title}</h1>
        )}
        <StatusPill status={detail.status} />
        {editable && (
          <span className={cx('w-16 text-[13px]', saveState === 'error' ? 'text-wax' : 'text-muted')} aria-live="polite">
            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Not saved' : ''}
          </span>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {can.assign && !detail.owner && legal && (
            <Button onClick={() => act(() => api.patch(`/requests/${id}`, { ownerId: user.id }), 'Assigned to you')}>Assign to me</Button>
          )}
          {can.returnToRequester && <Button onClick={() => setReturning(true)}><Undo2 size={15} /> Return</Button>}
          {can.download && detail.status !== 'cancelled' && (
            <>
              <Button onClick={() => getAgreement('docx')}><Download size={15} /> Word</Button>
              {detail.pdfAvailable && <Button onClick={() => getAgreement('pdf')}><Download size={15} /> PDF</Button>}
            </>
          )}
          {can.refreshSignature && (
            <Button onClick={() => act(async () => { const r = await api.post<{ changed: boolean }>(`/requests/${id}/signature/refresh`); toast(r.changed ? 'Signature status updated' : 'No change yet'); })}>
              <RefreshCw size={15} /> Check status
            </Button>
          )}
          {can.cancelSignature && (
            <Button onClick={() => window.confirm('Withdraw this from signature? Signers will no longer be able to sign it.') && act(() => api.post(`/requests/${id}/signature/cancel`), 'Withdrawn from signature')}>
              Withdraw
            </Button>
          )}
          {can.uploadSigned && (
            <>
              <input
                ref={upload}
                type="file"
                className="hidden"
                accept=".pdf,application/pdf"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void act(() => api.upload(`/requests/${id}/signed?filename=${encodeURIComponent(file.name)}`, file), 'Signed copy added. Request completed.');
                }}
              />
              <Button onClick={() => upload.current?.click()}><Upload size={15} /> Add signed copy</Button>
            </>
          )}
          {can.send && <Button variant="primary" onClick={() => setSending(true)}><FileSignature size={15} /> Send for signature</Button>}
          {can.submit && (
            <Button variant="primary" onClick={() => act(() => api.post(`/requests/${id}/submit`), 'Sent to legal')}>Send to legal</Button>
          )}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)] xl:grid-cols-[minmax(300px,380px)_minmax(0,1fr)_300px]">
        <div className="min-h-0 overflow-y-auto border-r border-line bg-paper">
          {returnedNote && (
            <div className="border-b border-line-soft bg-[#fff4ea] px-5 py-3 text-sm">
              <div className="font-medium">Legal sent this back</div>
              <p className="mt-0.5 whitespace-pre-wrap text-ink-soft">{returnedNote}</p>
            </div>
          )}
          <Section title={legal ? 'From the requester' : 'Your answers'}>
            {hasQuestions(def, 'requester') ? (
              <AnswerForm definition={def} answers={answers} onChange={change} audience="requester" readOnly={!editable} missing={flagged} focus={focus} />
            ) : (
              <p className="text-sm text-muted">This template asks the requester nothing.</p>
            )}
          </Section>
          {legal && hasQuestions(def, 'legal') && (
            <Section title="For legal">
              <AnswerForm definition={def} answers={answers} onChange={change} audience="legal" readOnly={!can.editAsLegal} missing={flagged} focus={focus} />
            </Section>
          )}
        </div>

        <div className="min-h-0 overflow-y-auto px-6 py-6">
          {source.isLoading || !preview ? <Spinner label="Preparing the document" /> : (
            <DocView doc={preview} onFillClick={editable ? (a) => { const f = anchorField(a); if (f) setFocus({ field: f, at: Date.now() }); } : undefined} />
          )}
        </div>

        <aside className="min-h-0 overflow-y-auto border-l border-line bg-paper lg:col-span-2 xl:col-span-1" aria-label="Request details">
          <Section title="Details">
            <dl className="grid grid-cols-[88px_1fr] gap-x-2 gap-y-2 text-sm">
              <dt className="text-muted">Owner</dt>
              <dd>
                {can.assign ? (
                  <Select aria-label="Owner" className="!h-8" value={detail.owner?.id ?? ''} onChange={(e) => act(() => api.patch(`/requests/${id}`, { ownerId: e.target.value || null }))}>
                    <option value="">Unassigned</option>
                    {legalTeam.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </Select>
                ) : (detail.owner?.name ?? <span className="text-muted">Unassigned</span>)}
              </dd>
              <dt className="text-muted">Requester</dt><dd>{detail.requester.name}</dd>
              <dt className="text-muted">Template</dt><dd>{detail.template.name} <span className="text-muted">v{detail.template.version}</span></dd>
              <dt className="text-muted">Requested</dt><dd>{shortDate(detail.requestedAt)}</dd>
              <dt className="text-muted">Last activity</dt><dd>{ago(detail.lastActivityAt)}</dd>
              <dt className="text-muted">Signature</dt>
              <dd>
                {SIGNATURE[detail.signatureStatus]}
                {detail.signatureProvider && detail.signatureStatus !== 'none' && <span className="text-muted"> via {detail.signatureProvider === 'manual' ? 'manual send' : PROVIDER[detail.signatureProvider]}</span>}
              </dd>
            </dl>
          </Section>

          <Section title={`Tasks${detail.tasks.length ? ` (${detail.tasks.filter((t) => t.done).length} of ${detail.tasks.length})` : ''}`}>
            {detail.tasks.length === 0 && !can.manageTasks && <p className="text-sm text-muted">No tasks.</p>}
            <ul className="space-y-1.5">
              {detail.tasks.map((t) => {
                const mayToggle = (legal || t.assignee?.id === user.id) && detail.status !== 'completed' && detail.status !== 'cancelled';
                return (
                  <li key={t.id} className="group flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <Checkbox checked={t.done} disabled={!mayToggle} onChange={(done) => act(() => api.patch(`/tasks/${t.id}`, { done }))}>
                        <span className={cx(t.done && 'text-muted line-through')}>{t.title}</span>
                      </Checkbox>
                      {can.manageTasks ? (
                        <select
                          aria-label={`Assignee for ${t.title}`}
                          className="ml-6 max-w-[180px] truncate bg-transparent text-[13px] text-muted hover:text-ink"
                          value={t.assignee?.id ?? ''}
                          onChange={(e) => act(() => api.patch(`/tasks/${t.id}`, { assigneeId: e.target.value || null }))}
                        >
                          <option value="">No assignee</option>
                          {(users.data ?? []).filter((u) => !u.disabled).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                        </select>
                      ) : t.assignee && <div className="ml-6 text-[13px] text-muted">{t.assignee.name}</div>}
                    </div>
                    {can.manageTasks && (
                      <button aria-label={`Remove task ${t.title}`} className="rounded p-1 text-muted opacity-0 group-hover:opacity-100 hover:text-wax focus-visible:opacity-100" onClick={() => act(() => api.del(`/tasks/${t.id}`))}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {can.manageTasks && (
              <form
                className="mt-2.5 flex gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newTask.trim()) return;
                  void act(() => api.post(`/requests/${id}/tasks`, { title: newTask.trim() }));
                  setNewTask('');
                }}
              >
                <Input aria-label="New task" placeholder="Add a task" className="!h-8" value={newTask} onChange={(e) => setNewTask(e.target.value)} />
                <Button size="md" className="!h-8 !px-2" type="submit" aria-label="Add task"><Plus size={15} /></Button>
              </form>
            )}
          </Section>

          {detail.documents.length > 0 && (
            <Section title="Documents">
              <ul className="space-y-1.5 text-sm">
                {detail.documents.map((d) => (
                  <li key={d.id}>
                    <button className="flex w-full items-start gap-2 rounded text-left hover:underline" onClick={() => act(async () => download(await api.bytes(`/documents/${d.id}`), d.filename))}>
                      {d.kind === 'signed' ? <Check size={15} className="mt-0.5 shrink-0 text-[#17512a]" /> : <Download size={15} className="mt-0.5 shrink-0 text-muted" />}
                      <span className="min-w-0">
                        <span className="block truncate">{d.kind === 'signed' ? 'Signed agreement' : 'Sent for signature'}</span>
                        <span className="block text-[13px] text-muted">{dateTime(d.createdAt)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Activity">
            <form
              className="mb-3 space-y-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (!comment.trim()) return;
                void act(() => api.post(`/requests/${id}/comments`, { text: comment.trim() }));
                setComment('');
              }}
            >
              <Textarea aria-label="Comment" rows={2} placeholder="Leave a comment" value={comment} onChange={(e) => setComment(e.target.value)} />
              {comment.trim() && <Button size="sm" type="submit">Post comment</Button>}
            </form>
            <ol className="space-y-3">
              {detail.events.map((e) => (
                <li key={e.id} className="text-[13px] leading-snug">
                  <p>
                    {e.actor && <span className="font-medium">{e.actor.name} </span>}
                    <span className="text-ink-soft">{sentence(e)}</span>
                  </p>
                  {(e.type === 'comment' || !!e.data.note) && (
                    <p className="mt-1 rounded-md bg-desk px-2.5 py-1.5 whitespace-pre-wrap text-ink">{String(e.data.text ?? e.data.note)}</p>
                  )}
                  <time className="text-muted" dateTime={e.at} title={dateTime(e.at)}>{ago(e.at)}</time>
                </li>
              ))}
            </ol>
            {can.cancel && (
              <button className="mt-5 text-[13px] text-muted hover:text-wax" onClick={() => window.confirm('Cancel this request? It will be closed and cannot be reopened.') && act(() => api.post(`/requests/${id}/cancel`), 'Request cancelled')}>
                Cancel this request
              </button>
            )}
          </Section>
        </aside>
      </div>

      <SendDialog detail={detail} users={users.data ?? []} open={sending} onClose={() => setSending(false)} onSent={() => { toast('Out for signature'); refresh(); }} flush={flush} />
      <Modal
        open={returning}
        onClose={() => setReturning(false)}
        title="Return to requester"
        footer={
          <>
            <Button onClick={() => setReturning(false)}>Cancel</Button>
            <Button variant="primary" disabled={!note.trim()} onClick={() => { void act(() => api.post(`/requests/${id}/return`, { note: note.trim() }), 'Returned to requester'); setReturning(false); setNote(''); }}>
              Return request
            </Button>
          </>
        }
      >
        <Label label={`What does ${detail.requester.name} need to change?`}>
          {(nid) => <Textarea id={nid} rows={4} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Label>
      </Modal>
    </div>
  );
}
