import { useQuery, useQueryClient } from '@tanstack/react-query';
import { defaultAnswers, previewDocx, renderDocx, type Anchor, type Answers, type Problem, type TemplateDefinition } from '@whereas/core';
import { AlertTriangle, ArrowLeft, Eye, PencilLine } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, type TemplateDetail } from '../api';
import { addAnchor, allowed, KIND_LABEL, type AnchorKind } from '../builder/actions';
import { Inspector, KindDot } from '../builder/Inspector';
import { QuestionsPanel, SignersPanel, TasksPanel } from '../builder/QuestionsPanel';
import { DocView, type DocSelection } from '../doc/DocView';
import { useDocx } from '../doc/useDocx';
import { AnswerForm, hasQuestions } from '../form/AnswerForm';
import { isLegal, useUser } from '../Layout';
import { Button, cx, ErrorNote, Spinner, Textarea, useToast } from '../ui';

const KINDS: { kind: AnchorKind; hint: string }[] = [
  { kind: 'field', hint: 'Replace this text with an answer' },
  { kind: 'conditional', hint: 'Keep this text only in some cases' },
  { kind: 'alternatives', hint: 'Swap this text depending on an answer' },
  { kind: 'repeat', hint: 'Repeat this paragraph or table row for each entry' },
  { kind: 'signature', hint: 'A signer signs, initials or dates here' },
];

type Tab = 'questions' | 'signers' | 'tasks' | 'about';

export function TemplateBuilder() {
  const { id = '' } = useParams();
  const user = useUser();
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ['template', id],
    queryFn: () => api.get<TemplateDetail>(`/templates/${id}`),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const [docKey, setDocKey] = useState(0);
  const docx = useDocx(`/templates/${id}/document`, docKey);

  const [definition, setDefinition] = useState<TemplateDefinition | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [problems, setProblems] = useState<Problem[]>([]);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty' | 'error'>('saved');
  const [saveError, setSaveError] = useState('');
  const [hasDraftChanges, setHasDraftChanges] = useState(false);
  const [selection, setSelection] = useState<DocSelection | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('questions');
  const [openField, setOpenField] = useState<string | null>(null);
  const [mode, setMode] = useState<'build' | 'try'>('build');
  const [showProblems, setShowProblems] = useState(false);
  const [trial, setTrial] = useState<Answers>({});
  const base = useRef('');
  const latest = useRef<{ name: string; description: string; definition: TemplateDefinition } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const saving = useRef<Promise<void> | null>(null);
  const replaceInput = useRef<HTMLInputElement>(null);

  // Load once; after that this page owns the draft.
  useEffect(() => {
    if (!detail.data || latest.current) return;
    setDefinition(detail.data.definition);
    setName(detail.data.name);
    setDescription(detail.data.description);
    setProblems(detail.data.problems);
    setHasDraftChanges(detail.data.hasUnpublishedChanges);
    base.current = detail.data.updatedAt;
    latest.current = null;
    setSaveState('saved');
  }, [detail.data]);

  const save = useCallback(async (): Promise<void> => {
    clearTimeout(timer.current);
    if (saving.current) await saving.current.catch(() => {});
    const body = latest.current;
    if (!body) return;
    latest.current = null;
    setSaveState('saving');
    saving.current = api
      .put<{ problems: Problem[]; updatedAt: string }>(`/templates/${id}`, { ...body, name: body.name.trim() || 'Untitled template', baseUpdatedAt: base.current })
      .then((res) => {
        base.current = res.updatedAt;
        setProblems(res.problems);
        setHasDraftChanges(true);
        setSaveState(latest.current ? 'dirty' : 'saved');
        setSaveError('');
      })
      .catch((err: unknown) => {
        latest.current ??= body;
        setSaveState('error');
        setSaveError(err instanceof Error ? err.message : 'Could not save.');
        throw err;
      })
      .finally(() => {
        saving.current = null;
      });
    return saving.current;
  }, [id]);

  const queue = (next: { name?: string; description?: string; definition?: TemplateDefinition }) => {
    if (!definition) return;
    latest.current = { name: next.name ?? name, description: next.description ?? description, definition: next.definition ?? definition };
    setSaveState('dirty');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save().catch(() => {}), 900);
  };

  const change = (next: TemplateDefinition) => {
    setDefinition(next);
    queue({ definition: next });
  };

  useEffect(() => () => void save().catch(() => {}), [save]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (latest.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const rendered = useMemo(() => (docx.data ? renderDocx(docx.data) : null), [docx.data]);
  const preview = useMemo(() => {
    if (mode !== 'try' || !docx.data || !definition) return null;
    try {
      return renderDocx(previewDocx(docx.data, definition, trial));
    } catch {
      return null;
    }
  }, [mode, docx.data, definition, trial]);

  if (!isLegal(user)) return <Navigate to="/requests" replace />;
  if (detail.error) return <div className="p-8"><ErrorNote>{(detail.error as Error).message}</ErrorNote></div>;
  if (!definition || !detail.data || !rendered || !docx.data) return <Spinner />;

  const anchor = definition.anchors.find((a) => a.id === selected) ?? null;
  const can = selection ? allowed(selection) : null;

  const mark = (kind: AnchorKind) => {
    if (!selection) return;
    try {
      const added = addAnchor(definition, docx.data!, selection, kind);
      change(added.definition);
      setSelected(added.anchorId);
      setSelection(null);
      window.getSelection()?.removeAllRanges();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That selection cannot be marked.', 'error');
    }
  };

  const publish = async () => {
    try {
      await save();
      const res = await api.post<{ version: number; updatedAt: string }>(`/templates/${id}/publish`);
      base.current = res.updatedAt;
      setHasDraftChanges(false);
      void qc.invalidateQueries({ queryKey: ['templates'] });
      void qc.invalidateQueries({ queryKey: ['template', id] });
      toast(`Published as version ${res.version}. New requests will use it.`);
    } catch (err) {
      const found = err instanceof ApiError ? (err.details as { problems?: Problem[] } | undefined)?.problems : undefined;
      if (found) {
        setProblems(found);
        setShowProblems(true);
      }
      toast(err instanceof Error ? err.message : 'Could not publish.', 'error');
    }
  };

  const replaceDocument = async (file: File) => {
    try {
      await save();
      const res = await api.upload<{ lost: { quote: string }[] }>(`/templates/${id}/document`, file);
      setSelected(null);
      setDocKey((k) => k + 1);
      await qc.invalidateQueries({ queryKey: ['template', id] });
      toast(
        res.lost.length
          ? `Document replaced. ${res.lost.length} mark${res.lost.length === 1 ? '' : 's'} could not be found in the new text and ${res.lost.length === 1 ? 'was' : 'were'} removed.`
          : 'Document replaced. Every mark carried over.',
        res.lost.length ? 'error' : 'ok',
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not replace the document.', 'error');
    }
  };

  const blockLabel = (a: Anchor) => (a.kind === 'repeat' ? `Repeats: ${definition.groups.find((g) => g.id === a.group)?.label ?? ''}` : 'Conditional');
  const published = detail.data.published;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-5 py-2.5">
        <Link to="/templates" aria-label="Back to templates" className="rounded p-1 text-muted hover:bg-desk-deep hover:text-ink"><ArrowLeft size={18} /></Link>
        <input
          aria-label="Template name"
          className="min-w-40 flex-1 truncate rounded bg-transparent px-1 font-serif text-xl hover:bg-desk-deep focus:bg-paper"
          value={name}
          maxLength={200}
          onChange={(e) => { setName(e.target.value); queue({ name: e.target.value }); }}
        />
        <span className={cx('text-[13px]', saveState === 'error' ? 'text-wax' : 'text-muted')} aria-live="polite" title={saveError}>
          {saveState === 'saving' || saveState === 'dirty' ? 'Saving…' : saveState === 'error' ? `Not saved. ${saveError}` : published ? (hasDraftChanges ? `Draft saved, version ${published.version} is live` : `Version ${published.version} is live`) : 'Draft saved'}
        </span>
        {problems.length > 0 && (
          <div className="relative">
            <Button size="sm" variant="danger" aria-expanded={showProblems} onClick={() => setShowProblems(!showProblems)}>
              <AlertTriangle size={14} /> {problems.length} to fix
            </Button>
            {showProblems && (
              <ul className="absolute right-0 z-30 mt-1 max-h-80 w-80 overflow-y-auto rounded-md bg-paper p-1 text-[13px] shadow-xl ring-1 ring-line">
                {problems.map((p, i) => (
                  <li key={i}>
                    <button
                      className="w-full rounded px-2.5 py-1.5 text-left hover:bg-desk"
                      onClick={() => {
                        setShowProblems(false);
                        setMode('build');
                        if (p.anchor) setSelected(p.anchor);
                        if (p.field) { setTab('questions'); setOpenField(p.field); }
                      }}
                    >
                      {p.message}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <Button size="sm" onClick={() => { if (mode === 'build') setTrial((t) => ({ ...defaultAnswers(definition), ...t })); setMode(mode === 'build' ? 'try' : 'build'); setSelection(null); }}>
          {mode === 'build' ? <><Eye size={14} /> Try it</> : <><PencilLine size={14} /> Back to editing</>}
        </Button>
        <Button size="sm" variant="primary" disabled={saveState === 'saving' || (!!published && !hasDraftChanges && saveState === 'saved')} onClick={publish}>
          {published ? 'Publish changes' : 'Publish'}
        </Button>
      </header>

      {mode === 'try' ? (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
          <div className="min-h-0 space-y-6 overflow-y-auto border-r border-line bg-paper p-5">
            <p className="text-[13px] leading-relaxed text-muted">Answer as a requester would and watch the agreement change. Nothing here is saved.</p>
            <AnswerForm definition={definition} answers={trial} onChange={setTrial} audience="requester" />
            {hasQuestions(definition, 'legal') && (
              <div>
                <h2 className="mb-3 text-[13px] font-semibold">For legal</h2>
                <AnswerForm definition={definition} answers={trial} onChange={setTrial} audience="legal" />
              </div>
            )}
          </div>
          <div className="min-h-0 overflow-y-auto px-6 py-6">{preview ? <DocView doc={preview} /> : <ErrorNote>Fix the listed problems to see a preview.</ErrorNote>}</div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)_300px]">
          <div className="flex min-h-0 flex-col border-r border-line bg-paper">
            <div className="flex border-b border-line px-2 pt-1.5" role="tablist">
              {(['questions', 'signers', 'tasks', 'about'] as Tab[]).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={cx('-mb-px border-b-2 px-2.5 py-2 text-[13px] capitalize', tab === t ? 'border-ink font-medium text-ink' : 'border-transparent text-muted hover:text-ink')}
                >
                  {t}
                  {t === 'questions' && definition.fields.length > 0 && <span className="ml-1 text-muted">{definition.fields.length}</span>}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {tab === 'questions' && <QuestionsPanel definition={definition} onChange={change} openId={openField} setOpenId={setOpenField} />}
              {tab === 'signers' && <SignersPanel definition={definition} onChange={change} />}
              {tab === 'tasks' && <TasksPanel definition={definition} onChange={change} />}
              {tab === 'about' && (
                <div className="space-y-4 p-3">
                  <label className="block space-y-1.5">
                    <span className="text-[13px] font-medium">Description</span>
                    <Textarea rows={3} value={description} placeholder="When should someone pick this template?" onChange={(e) => { setDescription(e.target.value); queue({ description: e.target.value }); }} />
                  </label>
                  <div className="space-y-2">
                    <input ref={replaceInput} type="file" accept=".docx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void replaceDocument(f); }} />
                    <Button size="sm" onClick={() => replaceInput.current?.click()}>Replace the Word document</Button>
                    <p className="text-[13px] leading-relaxed text-muted">Upload an edited copy. Marks are matched to the new text and carried over where the wording still exists.</p>
                  </div>
                  <div className="space-y-2 border-t border-line-soft pt-4">
                    <Button
                      size="sm"
                      onClick={async () => {
                        await api.post(`/templates/${id}/archive`, { archived: !detail.data!.archived });
                        void qc.invalidateQueries({ queryKey: ['template', id] });
                        void qc.invalidateQueries({ queryKey: ['templates'] });
                        toast(detail.data!.archived ? 'Template restored' : 'Template archived. It can no longer be requested.');
                      }}
                    >
                      {detail.data.archived ? 'Restore template' : 'Archive template'}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={async () => {
                        if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
                        try {
                          latest.current = null;
                          await api.del(`/templates/${id}`);
                          void qc.invalidateQueries({ queryKey: ['templates'] });
                          navigate('/templates');
                        } catch (err) {
                          toast(err instanceof Error ? err.message : 'Could not delete.', 'error');
                        }
                      }}
                    >
                      Delete template
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="relative min-h-0 overflow-y-auto px-10 py-6" onScroll={() => selection && setSelection(null)} onClick={(e) => e.target === e.currentTarget && setSelected(null)}>
            <DocView doc={rendered} anchors={definition.anchors} selectedId={selected} blockLabel={blockLabel} onAnchorClick={(aid) => { setSelected(aid); setSelection(null); }} onSelect={setSelection} />
          </div>

          <aside className="min-h-0 overflow-y-auto border-l border-line bg-paper" aria-label="Selected mark">
            {anchor ? (
              <Inspector
                key={anchor.id}
                anchor={anchor}
                definition={definition}
                onChange={change}
                onEditField={(f) => { setTab('questions'); setOpenField(f); }}
                onShowSigners={() => setTab('signers')}
                onRemoved={() => setSelected(null)}
              />
            ) : (
              <div className="space-y-4 p-4">
                <h2 className="text-sm font-semibold">Mark up the agreement</h2>
                <p className="text-[13px] leading-relaxed text-ink-soft">Select text in the document, then choose what it should become. Click a mark to change it.</p>
                <ul className="space-y-2.5">
                  {KINDS.map((k) => (
                    <li key={k.kind} className="flex gap-2.5 text-[13px] leading-snug">
                      <span className="mt-0.5"><KindDot kind={k.kind} /></span>
                      <span><span className="font-medium">{KIND_LABEL[k.kind]}</span><br /><span className="text-muted">{k.hint}</span></span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </div>
      )}

      {mode === 'build' && selection && can && (
        <div
          role="toolbar"
          aria-label="Mark the selected text"
          className="fixed z-40 flex -translate-x-1/2 gap-0.5 rounded-lg bg-ink p-1 shadow-xl"
          style={{ left: Math.min(Math.max(selection.rect.left + selection.rect.width / 2, 260), window.innerWidth - 260), top: Math.max(selection.rect.top - 46, 8) }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {KINDS.map((k) => (
            <button
              key={k.kind}
              title={can[k.kind] ? k.hint : 'Select text within one paragraph for this'}
              disabled={!can[k.kind]}
              onClick={() => mark(k.kind)}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium text-white hover:bg-white/15 disabled:opacity-35"
            >
              <KindDot kind={k.kind} /> {KIND_LABEL[k.kind]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
