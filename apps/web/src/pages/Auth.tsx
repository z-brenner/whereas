import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api';
import { Wordmark } from '../Layout';
import { Button, Checkbox, ErrorNote, Input, Label } from '../ui';

function Shell({ children, lead }: { children: React.ReactNode; lead: string }) {
  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <Wordmark className="text-5xl" />
        <p className="mt-3 mb-8 text-[15px] leading-relaxed text-ink-soft">{lead}</p>
        {children}
      </div>
    </div>
  );
}

export function Login() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<{ needsSetup: boolean }>('/auth/status').then((s) => s.needsSetup && navigate('/setup', { replace: true })).catch(() => {});
  }, [navigate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/login', { email, password });
      qc.clear();
      navigate('/requests');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell lead="Request an agreement, review it, and send it for signature.">
      <form onSubmit={submit} className="space-y-4">
        <Label label="Email">{(id) => <Input id={id} type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />}</Label>
        <Label label="Password">{(id) => <Input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}</Label>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button type="submit" variant="primary" className="w-full" disabled={busy}>Sign in</Button>
      </form>
    </Shell>
  );
}

export function Setup() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [sample, setSample] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/setup', { ...form, sample });
      qc.clear();
      navigate('/requests');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell lead="This install has no accounts yet. The first one you create is the admin.">
      <form onSubmit={submit} className="space-y-4">
        <Label label="Your name">{(id) => <Input id={id} required autoFocus autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}</Label>
        <Label label="Email">{(id) => <Input id={id} type="email" required autoComplete="username" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}</Label>
        <Label label="Password" hint="At least 10 characters.">
          {(id) => <Input id={id} type="password" required minLength={10} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}
        </Label>
        <Checkbox checked={sample} onChange={setSample}>Add a sample services agreement to try</Checkbox>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button type="submit" variant="primary" className="w-full" disabled={busy}>Create admin account</Button>
      </form>
    </Shell>
  );
}
