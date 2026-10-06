import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api, ApiError, type TemplateRow } from '../api';
import { isLegal, PageHeader, useUser } from '../Layout';
import { ago } from '../lib/format';
import { Button, ErrorNote, Input, Label, Modal, Spinner } from '../ui';

function NewTemplate({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const title = name.trim() || file.name.replace(/\.docx$/i, '');
      const { id } = await api.upload<{ id: string }>(`/templates?name=${encodeURIComponent(title)}`, file);
      void qc.invalidateQueries({ queryKey: ['templates'] });
      onClose();
      navigate(`/templates/${id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The upload did not finish.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New template"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!file || busy} onClick={create}>Upload and set up</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Label label="Word document" hint="Your agreement as a .docx file. Whereas keeps the original untouched.">
          {(id) => (
            <input
              id={id}
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-desk-deep file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          )}
        </Label>
        <Label label="Template name">
          {(id) => <Input id={id} value={name} placeholder={file?.name.replace(/\.docx$/i, '') ?? 'Mutual NDA'} onChange={(e) => setName(e.target.value)} />}
        </Label>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Modal>
  );
}

export function Templates() {
  const user = useUser();
  const [creating, setCreating] = useState(false);
  const list = useQuery({ queryKey: ['templates'], queryFn: () => api.get<TemplateRow[]>('/templates') });
  if (!isLegal(user)) return <Navigate to="/requests" replace />;

  return (
    <div>
      <PageHeader title="Templates">
        <Button variant="primary" onClick={() => setCreating(true)}><Plus size={16} /> New template</Button>
      </PageHeader>
      <div className="px-8 pb-8">
        {list.isLoading ? (
          <Spinner />
        ) : list.error ? (
          <ErrorNote>{(list.error as Error).message}</ErrorNote>
        ) : list.data!.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line px-6 py-14 text-center">
            <p className="font-serif text-xl">No templates yet</p>
            <p className="mt-1 text-sm text-muted">Upload an agreement as a Word document, then mark what changes from deal to deal.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg bg-paper ring-1 ring-line">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[13px] text-muted">
                  {['Name', 'Published', 'Questions', 'Requests', 'Last changed'].map((h) => (
                    <th key={h} scope="col" className="px-3 py-2.5 font-medium first:pl-4 last:pr-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.data!.map((t) => (
                  <tr key={t.id} className="border-b border-line-soft last:border-0 hover:bg-desk/60">
                    <td className="py-2.5 pr-3 pl-4">
                      <Link to={`/templates/${t.id}`} className="font-medium hover:underline">{t.name}</Link>
                      {t.archived && <span className="ml-2 rounded-full px-2 py-0.5 text-xs text-muted ring-1 ring-inset ring-line">Archived</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {t.version ? <>Version {t.version}</> : <span className="text-muted">Not yet</span>}
                      {t.version && t.hasUnpublishedChanges ? <span className="ml-2 text-[13px] text-[#7a3410]">Unpublished changes</span> : null}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">{t.questionCount}</td>
                    <td className="px-3 py-2.5 tabular-nums">{t.requestCount}</td>
                    <td className="py-2.5 pr-4 pl-3 text-ink-soft">{ago(t.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <NewTemplate open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
