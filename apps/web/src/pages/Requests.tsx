import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError, type RequestRow, type RequestStatus, type TemplateRow } from '../api';
import { isLegal, PageHeader, useUser } from '../Layout';
import { ago, shortDate, SIGNATURE, STATUS } from '../lib/format';
import { Button, cx, ErrorNote, Input, Label, Modal, Spinner } from '../ui';

export function StatusPill({ status }: { status: RequestStatus }) {
  const s = STATUS[status];
  return <span className={cx('inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', s.tone)}>{s.label}</span>;
}

function NewRequest({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const templates = useQuery({ queryKey: ['templates'], queryFn: () => api.get<TemplateRow[]>('/templates'), enabled: open });
  const available = (templates.data ?? []).filter((t) => t.publishedVersionId && !t.archived);
  const [templateId, setTemplateId] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const chosen = available.find((t) => t.id === templateId) ?? (available.length === 1 ? available[0] : undefined);

  const start = async () => {
    if (!chosen) return;
    setBusy(true);
    setError('');
    try {
      const { id } = await api.post<{ id: string }>('/requests', { templateId: chosen.id, title: title.trim() || chosen.name });
      onClose();
      navigate(`/requests/${id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the request.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New request"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!chosen || busy} onClick={start}>Start request</Button>
        </>
      }
    >
      {templates.isLoading ? (
        <Spinner />
      ) : available.length === 0 ? (
        <p className="py-4 text-sm text-ink-soft">No templates are published yet. Ask the legal team to publish one.</p>
      ) : (
        <div className="space-y-4">
          <fieldset>
            <legend className="mb-1.5 text-[13px] font-medium">Which agreement do you need?</legend>
            <div className="space-y-1.5">
              {available.map((t) => (
                <label
                  key={t.id}
                  className={cx(
                    'block cursor-pointer rounded-md px-3 py-2 ring-1 ring-inset has-[:focus-visible]:outline-2',
                    chosen?.id === t.id ? 'bg-desk ring-ink' : 'ring-line hover:bg-desk',
                  )}
                >
                  <input type="radio" name="template" className="sr-only" checked={chosen?.id === t.id} onChange={() => setTemplateId(t.id)} />
                  <span className="block text-sm font-medium">{t.name}</span>
                  {t.description && <span className="block text-[13px] text-muted">{t.description}</span>}
                </label>
              ))}
            </div>
          </fieldset>
          <Label label="Name this request" hint="Something you will recognise in the list, like the counterparty or project.">
            {(id) => <Input id={id} value={title} placeholder={chosen?.name} maxLength={200} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && start()} />}
          </Label>
          {error && <ErrorNote>{error}</ErrorNote>}
        </div>
      )}
    </Modal>
  );
}

type View = 'todo' | 'mine' | 'all';

const EMPTY: Record<View, { title: string; body: string }> = {
  todo: { title: 'Nothing is waiting on you', body: 'Requests you need to act on will show up here.' },
  mine: { title: 'You have not requested anything yet', body: 'Start a request and it will be tracked here.' },
  all: { title: 'No requests yet', body: 'Requests from everyone will be listed here.' },
};

export function Requests() {
  const user = useUser();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = (['todo', 'mine', 'all'].includes(params.get('view') ?? '') ? params.get('view') : 'todo') as View;
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ['requests', view], queryFn: () => api.get<RequestRow[]>(`/requests?view=${view}`), refetchInterval: 30_000 });

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list.data ?? [];
    return (list.data ?? []).filter((r) =>
      [r.displayId, r.title, r.requester.name, r.owner?.name, r.template.name, STATUS[r.status].label].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [list.data, query]);

  const tabs: { id: View; label: string }[] = [
    { id: 'todo', label: 'To do' },
    { id: 'mine', label: 'Requested by me' },
    ...(isLegal(user) ? [{ id: 'all' as const, label: 'All requests' }] : []),
  ];

  return (
    <div>
      <PageHeader title="Requests">
        <Button variant="primary" onClick={() => setCreating(true)}><Plus size={16} /> New request</Button>
      </PageHeader>

      <div className="flex flex-wrap items-center justify-between gap-3 px-8">
        <div className="flex gap-1" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={view === t.id}
              onClick={() => setParams(t.id === 'todo' ? {} : { view: t.id })}
              className={cx('rounded-md px-3 py-1.5 text-sm', view === t.id ? 'bg-ink text-white' : 'text-ink-soft hover:bg-desk-deep')}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative w-64">
          <Search size={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" />
          <Input aria-label="Search requests" placeholder="Search" className="pl-8" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      <div className="px-8 py-4">
        {list.isLoading ? (
          <Spinner />
        ) : list.error ? (
          <ErrorNote>{(list.error as Error).message}</ErrorNote>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line px-6 py-14 text-center">
            <p className="font-serif text-xl">{query ? 'No requests match that search' : EMPTY[view].title}</p>
            <p className="mt-1 text-sm text-muted">{query ? 'Try a name, an ID or a status.' : EMPTY[view].body}</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg bg-paper ring-1 ring-line">
            <table className="w-full min-w-[1040px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[13px] text-muted">
                  {['ID', 'Name', 'Status', 'Tasks', 'Requester', 'Owner', 'Template', 'Requested', 'Last activity', 'Signature'].map((h) => (
                    <th key={h} scope="col" className="px-3 py-2.5 font-medium first:pl-4 last:pr-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    tabIndex={0}
                    onClick={() => navigate(`/requests/${r.id}`)}
                    onKeyDown={(e) => e.key === 'Enter' && navigate(`/requests/${r.id}`)}
                    className="cursor-pointer border-b border-line-soft last:border-0 hover:bg-desk/60 focus-visible:bg-desk/60"
                  >
                    <td className="py-2.5 pr-3 pl-4 tabular-nums text-muted">{r.displayId}</td>
                    <td className="max-w-[260px] truncate px-3 py-2.5 font-medium">{r.title}</td>
                    <td className="px-3 py-2.5"><StatusPill status={r.status} /></td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {r.tasksTotal === 0 ? <span className="text-muted">None</span> : (
                        <span className={cx(r.tasksDone === r.tasksTotal ? 'text-[#17512a]' : '')}>{r.tasksDone} of {r.tasksTotal}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{r.requester.name}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{r.owner?.name ?? <span className="text-muted">Unassigned</span>}</td>
                    <td className="max-w-[200px] truncate px-3 py-2.5 text-ink-soft">{r.template.name}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-ink-soft">{shortDate(r.requestedAt)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-ink-soft">{ago(r.lastActivityAt)}</td>
                    <td className={cx('py-2.5 pr-4 pl-3 whitespace-nowrap', r.signatureStatus === 'none' ? 'text-muted' : 'text-ink-soft')}>{SIGNATURE[r.signatureStatus]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <NewRequest open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
