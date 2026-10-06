import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Inbox, LogOut, Settings as SettingsIcon } from 'lucide-react';
import { createContext, useContext, useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api, ApiError, type User } from './api';
import { cx, Spinner } from './ui';

const UserContext = createContext<User | null>(null);
export const useUser = (): User => useContext(UserContext)!;
export const isLegal = (u: User): boolean => u.role !== 'requester';

export function Wordmark({ className }: { className?: string }) {
  // "Whereas," is how a contract's recitals begin, comma included.
  return <span className={cx('font-serif tracking-tight', className)}>Whereas,</span>;
}

export function Layout() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<User>('/me'), retry: false, staleTime: 60_000 });

  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) {
      api
        .get<{ needsSetup: boolean }>('/auth/status')
        .then((s) => navigate(s.needsSetup ? '/setup' : '/login', { replace: true }))
        .catch(() => navigate('/login', { replace: true }));
    }
  }, [me.error, navigate]);

  if (!me.data) return <Spinner />;
  const user = me.data;
  const link = ({ isActive }: { isActive: boolean }) =>
    cx(
      'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm',
      isActive ? 'bg-paper font-medium text-ink shadow-[0_0_0_1px_var(--color-line)]' : 'text-ink-soft hover:bg-desk-deep',
    );

  return (
    <UserContext.Provider value={user}>
      <div className="flex min-h-screen">
        <nav className="sticky top-0 flex h-screen w-48 shrink-0 flex-col gap-1 border-r border-line px-3 py-4" aria-label="Main">
          <Wordmark className="mb-5 px-2.5 text-[22px]" />
          <NavLink to="/requests" className={link}><Inbox size={16} /> Requests</NavLink>
          {isLegal(user) && <NavLink to="/templates" className={link}><FileText size={16} /> Templates</NavLink>}
          {user.role === 'admin' && <NavLink to="/settings" className={link}><SettingsIcon size={16} /> Settings</NavLink>}
          <div className="mt-auto space-y-1 px-2.5 text-[13px]">
            <div className="truncate font-medium" title={user.email}>{user.name}</div>
            <button
              className="flex items-center gap-1.5 text-muted hover:text-ink"
              onClick={async () => {
                await api.post('/auth/logout');
                qc.clear();
                navigate('/login');
              }}
            >
              <LogOut size={14} /> Sign out
            </button>
          </div>
        </nav>
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </UserContext.Provider>
  );
}

export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 px-8 pt-8 pb-5">
      <h1 className="font-serif text-[28px] leading-none">{title}</h1>
      <div className="flex items-center gap-2">{children}</div>
    </header>
  );
}
