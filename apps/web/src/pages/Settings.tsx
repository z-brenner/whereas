import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { api, type Role, type User } from '../api';
import { PageHeader, useUser } from '../Layout';
import { Button, ErrorNote, Input, Label, Modal, Select, Spinner, Textarea, useToast } from '../ui';

const ROLE: Record<Role, string> = { admin: 'Admin', legal: 'Legal', requester: 'Requester' };

interface SignatureView {
  docuseal: { baseUrl: string; hasSecret: boolean } | null;
  docusign: { environment: 'demo' | 'production'; integrationKey: string; userId: string; accountId: string; hasSecret: boolean } | null;
}

function Card({ title, lead, children }: { title: string; lead?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg bg-paper p-5 ring-1 ring-line">
      <h2 className="font-serif text-lg">{title}</h2>
      {lead && <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-muted">{lead}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function People() {
  const me = useUser();
  const toast = useToast();
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<User[]>('/users') });
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', role: 'requester' as Role, password: '' });
  const [error, setError] = useState('');

  const patch = async (id: string, body: Record<string, unknown>, done: string) => {
    try {
      await api.patch(`/users/${id}`, body);
      void qc.invalidateQueries({ queryKey: ['users'] });
      toast(done);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/users', form);
      void qc.invalidateQueries({ queryKey: ['users'] });
      setAdding(false);
      setForm({ name: '', email: '', role: 'requester', password: '' });
      toast('Person added');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Card title="People" lead="Requesters ask for agreements. Legal builds templates and completes requests. Admins also manage people and signature settings.">
      {users.isLoading ? <Spinner /> : (
        <table className="w-full text-left text-sm">
          <tbody>
            {users.data!.map((u) => (
              <tr key={u.id} className="border-b border-line-soft last:border-0">
                <td className="py-2 pr-3">
                  <div className={u.disabled ? 'text-muted line-through' : 'font-medium'}>{u.name}</div>
                  <div className="text-[13px] text-muted">{u.email}</div>
                </td>
                <td className="w-36 py-2 pr-3">
                  <Select aria-label={`Role for ${u.name}`} className="!h-8" value={u.role} disabled={u.disabled} onChange={(e) => patch(u.id, { role: e.target.value }, 'Role changed')}>
                    {Object.entries(ROLE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                </td>
                <td className="py-2 text-right whitespace-nowrap">
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => {
                      const password = window.prompt(`New password for ${u.name} (at least 10 characters):`);
                      if (password) void patch(u.id, { password }, 'Password changed. They have been signed out.');
                    }}
                  >
                    Reset password
                  </Button>
                  {u.id !== me.id && (
                    <Button size="sm" variant="quiet" onClick={() => patch(u.id, { disabled: !u.disabled }, u.disabled ? 'Access restored' : 'Access removed')}>
                      {u.disabled ? 'Restore access' : 'Remove access'}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Button className="mt-4" onClick={() => setAdding(true)}>Add a person</Button>
      <Modal open={adding} onClose={() => setAdding(false)} title="Add a person">
        <form onSubmit={add} className="space-y-4 pb-2">
          <Label label="Name">{(id) => <Input id={id} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Label>
          <Label label="Email">{(id) => <Input id={id} type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}</Label>
          <Label label="Role">
            {(id) => (
              <Select id={id} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                {Object.entries(ROLE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            )}
          </Label>
          <Label label="Starting password" hint="At least 10 characters. Share it with them yourself; Whereas does not send email.">
            {(id) => <Input id={id} type="text" required minLength={10} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}
          </Label>
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setAdding(false)}>Cancel</Button>
            <Button type="submit" variant="primary">Add person</Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}

function Signature() {
  const toast = useToast();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings', 'signature'], queryFn: () => api.get<SignatureView>('/settings/signature') });
  const [seal, setSeal] = useState({ baseUrl: 'https://api.docuseal.com', apiKey: '' });
  const [sign, setSign] = useState({ environment: 'demo' as 'demo' | 'production', integrationKey: '', userId: '', accountId: '', privateKey: '' });

  useEffect(() => {
    if (!settings.data) return;
    if (settings.data.docuseal) setSeal({ baseUrl: settings.data.docuseal.baseUrl, apiKey: '' });
    if (settings.data.docusign) setSign({ ...settings.data.docusign, privateKey: '' });
  }, [settings.data]);

  const put = async (body: Record<string, unknown>, done: string) => {
    try {
      await api.put('/settings/signature', body);
      void qc.invalidateQueries({ queryKey: ['settings', 'signature'] });
      toast(done);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  if (settings.isLoading) return <Spinner />;
  const d = settings.data!;
  return (
    <Card
      title="Signature"
      lead="Connect a provider to send agreements straight from a request. Without one you can still download an agreement, send it yourself and add the signed copy. Keys are encrypted on this server and never shown again."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void put({ docusign: { ...sign, privateKey: sign.privateKey || undefined } }, 'DocuSign saved'); }}>
          <h3 className="text-sm font-semibold">DocuSign {d.docusign && <span className="ml-1 font-normal text-[#17512a]">Connected</span>}</h3>
          <Label label="Environment">
            {(id) => (
              <Select id={id} value={sign.environment} onChange={(e) => setSign({ ...sign, environment: e.target.value as 'demo' | 'production' })}>
                <option value="demo">Developer sandbox</option>
                <option value="production">Production</option>
              </Select>
            )}
          </Label>
          <Label label="Integration key">{(id) => <Input id={id} required value={sign.integrationKey} onChange={(e) => setSign({ ...sign, integrationKey: e.target.value })} />}</Label>
          <Label label="User ID">{(id) => <Input id={id} required value={sign.userId} onChange={(e) => setSign({ ...sign, userId: e.target.value })} />}</Label>
          <Label label="API account ID">{(id) => <Input id={id} required value={sign.accountId} onChange={(e) => setSign({ ...sign, accountId: e.target.value })} />}</Label>
          <Label label="RSA private key" hint={d.docusign ? 'Leave empty to keep the stored key.' : 'From the integration key’s JWT settings. The user must have granted consent.'}>
            {(id) => <Textarea id={id} rows={3} className="font-mono text-xs" required={!d.docusign} placeholder="-----BEGIN RSA PRIVATE KEY-----" value={sign.privateKey} onChange={(e) => setSign({ ...sign, privateKey: e.target.value })} />}
          </Label>
          <div className="flex gap-2">
            <Button type="submit" variant="primary">Save DocuSign</Button>
            {d.docusign && <Button variant="danger" onClick={() => put({ docusign: null }, 'DocuSign disconnected')}>Disconnect</Button>}
          </div>
        </form>

        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void put({ docuseal: { baseUrl: seal.baseUrl, apiKey: seal.apiKey || undefined } }, 'DocuSeal saved'); }}>
          <h3 className="text-sm font-semibold">DocuSeal {d.docuseal && <span className="ml-1 font-normal text-[#17512a]">Connected</span>}</h3>
          <Label label="API address" hint="https://api.docuseal.com, or your own install followed by /api.">
            {(id) => <Input id={id} type="url" required value={seal.baseUrl} onChange={(e) => setSeal({ ...seal, baseUrl: e.target.value })} />}
          </Label>
          <Label label="API key" hint={d.docuseal ? 'Leave empty to keep the stored key.' : undefined}>
            {(id) => <Input id={id} type="password" autoComplete="off" required={!d.docuseal} value={seal.apiKey} onChange={(e) => setSeal({ ...seal, apiKey: e.target.value })} />}
          </Label>
          <div className="flex gap-2">
            <Button type="submit" variant="primary">Save DocuSeal</Button>
            {d.docuseal && <Button variant="danger" onClick={() => put({ docuseal: null }, 'DocuSeal disconnected')}>Disconnect</Button>}
          </div>
        </form>
      </div>
    </Card>
  );
}

export function Settings() {
  const user = useUser();
  const system = useQuery({ queryKey: ['settings', 'system'], queryFn: () => api.get<{ pdfAvailable: boolean }>('/settings/system') });
  if (user.role !== 'admin') return <Navigate to="/requests" replace />;
  return (
    <div>
      <PageHeader title="Settings" />
      <div className="max-w-5xl space-y-5 px-8 pb-10">
        <People />
        <Signature />
        <Card title="PDF">
          <p className="text-sm text-ink-soft">
            {system.data?.pdfAvailable
              ? 'LibreOffice is installed, so agreements can be downloaded as PDF.'
              : 'LibreOffice is not installed on this server, so agreements download as Word files only. Signature providers convert Word files themselves, so sending still works.'}
          </p>
        </Card>
      </div>
    </div>
  );
}
