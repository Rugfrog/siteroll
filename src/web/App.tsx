import { createContext, lazy, Suspense, useContext, useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, setRole, useApi } from './api';
import { Icon, type IconName } from './icons';
import { Loading, setNavigate, ToastProvider, useToast } from './ui';
import { Login } from './pages/Login';

const Home = lazy(() => import('./pages/Home'));
const Live = lazy(() => import('./pages/Live'));
const RollCall = lazy(() => import('./pages/RollCall'));
const Bookings = lazy(() => import('./pages/Bookings'));
const Timesheets = lazy(() => import('./pages/Timesheets'));
const TimesheetDetail = lazy(() => import('./pages/TimesheetDetail'));
const Invoices = lazy(() => import('./pages/Invoices'));
const Payroll = lazy(() => import('./pages/Payroll'));
const Workers = lazy(() => import('./pages/Workers'));
const WorkerDetail = lazy(() => import('./pages/WorkerDetail'));
const Compliance = lazy(() => import('./pages/Compliance'));
const Clients = lazy(() => import('./pages/Clients'));
const SiteEdit = lazy(() => import('./pages/SiteEdit'));
const Poster = lazy(() => import('./pages/Poster'));
const Outbox = lazy(() => import('./pages/Outbox'));
const Settings = lazy(() => import('./pages/Settings'));
const ClientHome = lazy(() => import('./pages/ClientHome'));
const ClientTimesheets = lazy(() => import('./pages/ClientTimesheets'));
const ClientApproval = lazy(() => import('./pages/ClientApproval'));
const RollCallHistory = lazy(() => import('./pages/RollCallHistory'));
const Ask = lazy(() => import('./pages/Ask'));

export interface Me {
  user: { type: 'agency' | 'manager'; id: number; name: string; clientId: number | null; siteIds: number[] | null } | null;
  agency: { name: string; colour: string; hasLogo: boolean; phone: string } | null;
  demoMode: boolean;
  demoLogin: { email: string; password: string } | null;
}

const MeCtx = createContext<{ me: Me; reload: () => Promise<void> }>(null as any);
export const useMe = () => useContext(MeCtx);

function applyBrand(colour?: string) {
  if (colour && /^#[0-9a-f]{6}$/i.test(colour)) {
    document.documentElement.style.setProperty('--brand', colour);
    // Pick white or black text for contrast on the brand colour.
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    document.documentElement.style.setProperty('--brand-ink', lum > 0.4 ? '#111' : '#fff');
  }
}

function NavHook() {
  const nav = useNavigate();
  useEffect(() => setNavigate((to) => nav(to)), [nav]);
  return null;
}

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const reload = async () => {
    const m = await api.get<Me>('/api/auth/me');
    applyBrand(m.agency?.colour);
    setMe(m);
  };
  useEffect(() => {
    reload().catch(() => setMe({ user: null, agency: null, demoMode: false, demoLogin: null }));
    const onOut = () => reload();
    window.addEventListener('sr:logged-out', onOut);
    return () => window.removeEventListener('sr:logged-out', onOut);
  }, []);
  if (!me) return <Loading />;
  return (
    <MeCtx.Provider value={{ me, reload }}>
      <ToastProvider>
        <BrowserRouter>
          <NavHook />
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/login" element={me.user ? <Navigate to={me.user.type === 'agency' ? '/' : '/client'} replace /> : <Login />} />
              <Route path="/sites/:id/poster" element={<Guard type="agency"><Poster /></Guard>} />
              <Route path="/rollcall/:id" element={<Guard><RollCall /></Guard>} />
              <Route path="/client/*" element={<Guard type="manager"><ClientShell /></Guard>} />
              <Route path="/*" element={<Guard type="agency"><AgencyShell /></Guard>} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ToastProvider>
    </MeCtx.Provider>
  );
}

function Guard({ type, children }: { type?: 'agency' | 'manager'; children: ReactNode }) {
  const { me } = useMe();
  const loc = useLocation();
  if (!me.user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  if (type && me.user.type !== type) return <Navigate to={me.user.type === 'agency' ? '/' : '/client'} replace />;
  return <>{children}</>;
}

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
  count?: number;
  mobile?: boolean;
}

function BrandBlock({ sub }: { sub: string }) {
  const { me } = useMe();
  return (
    <a href="/" className="brand" onClick={(e) => e.preventDefault()}>
      <span className="brand-mark">{me.agency?.hasLogo ? <img src="/files/logo" alt="" /> : <Icon name="hardhat" style={{ width: 20, height: 20, color: 'var(--brand-ink)' }} />}</span>
      <span>
        <span className="brand-name">SiteRoll</span>
        <br />
        <span className="brand-sub">{sub}</span>
      </span>
    </a>
  );
}

function DemoBar() {
  const { me } = useMe();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!me.demoMode) return null;
  return (
    <div className="demo-bar no-print" role="note">
      <strong>DEMO</strong>
      <span className="demo-text">Texts and emails are simulated — see the Outbox.</span>
      {me.user?.type === 'agency' && (
        <>
          <NavLink to="/outbox">Open Outbox</NavLink>
          <button
            disabled={busy}
            onClick={async () => {
              if (!confirm('Reset all demo data? Everything you have changed will be lost.')) return;
              setBusy(true);
              try {
                await api.post('/api/demo/reset');
                toast('Demo data reset');
                setTimeout(() => window.location.reload(), 400);
              } catch (e) {
                toast((e as Error).message, true);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Resetting…' : 'Reset demo'}
          </button>
        </>
      )}
    </div>
  );
}

function Shell({ items, groups, sub, children }: { items: NavItem[]; groups?: { label: string; from: number }[]; sub: string; children: ReactNode }) {
  const { me, reload } = useMe();
  const [menu, setMenu] = useState(false);
  const loc = useLocation();
  useEffect(() => setMenu(false), [loc.pathname]);
  const logout = async () => {
    await api.post('/api/auth/logout');
    await reload();
  };
  const navList = (
    <nav className="nav" aria-label="Main">
      {items.map((it, i) => (
        <div key={it.to} style={{ display: 'contents' }}>
          {groups?.find((g) => g.from === i) && <div className="nav-group">{groups.find((g) => g.from === i)!.label}</div>}
          <NavLink to={it.to} end={it.end}>
            <Icon name={it.icon} />
            {it.label}
            {!!it.count && <span className="count">{it.count}</span>}
          </NavLink>
        </div>
      ))}
    </nav>
  );
  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar">
        <BrandBlock sub={sub} />
        {navList}
        <div className="sidebar-foot">
          <div className="who">{me.user?.name}</div>
          <button className="linkish small muted" onClick={logout}>
            Log out
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <BrandBlock sub={sub} />
          <button onClick={() => setMenu(true)} aria-expanded={menu} aria-label="Open menu">
            Menu
          </button>
        </header>
        {menu && (
          <div className="mobile-menu" role="dialog" aria-label="Menu">
            <div className="spread" style={{ padding: '4px 8px 12px' }}>
              <BrandBlock sub={sub} />
              <button className="btn btn-sm" onClick={() => setMenu(false)}>
                Close
              </button>
            </div>
            {navList}
            <div className="sidebar-foot" style={{ color: '#d9dbe0' }}>
              <div className="who">{me.user?.name}</div>
              <button className="linkish" onClick={logout}>
                Log out
              </button>
            </div>
          </div>
        )}
        <DemoBar />
        <main id="main" className="page">
          <Suspense fallback={<Loading />}>{children}</Suspense>
        </main>
        <nav className="tabbar no-print" aria-label="Quick links">
          {items
            .filter((i) => i.mobile)
            .map((it) => (
              <NavLink key={it.to} to={it.to} end={it.end}>
                <Icon name={it.icon} />
                {it.label}
              </NavLink>
            ))}
        </nav>
      </div>
    </div>
  );
}

function AgencyShell() {
  useEffect(() => setRole('agency'), []);
  const counts = useApi<{ alerts: unknown[]; awaiting: unknown[] }>('/api/dashboard');
  const items: NavItem[] = [
    { to: '/', label: 'Home', icon: 'home', end: true, mobile: true },
    { to: '/ask', label: 'Ask SiteRoll', icon: 'sparkle', mobile: true },
    { to: '/live', label: 'On site now', icon: 'live', mobile: true, count: counts.data?.alerts.length },
    { to: '/bookings', label: 'Bookings', icon: 'calendar', mobile: true },
    { to: '/timesheets', label: 'Timesheets', icon: 'clipboard', mobile: true },
    { to: '/invoices', label: 'Invoices', icon: 'receipt' },
    { to: '/payroll', label: 'Payroll & margins', icon: 'pound' },
    { to: '/workers', label: 'Workers', icon: 'users' },
    { to: '/compliance', label: 'Compliance', icon: 'shield' },
    { to: '/clients', label: 'Clients & sites', icon: 'building' },
    { to: '/rollcalls', label: 'Fire roll calls', icon: 'flame' },
    { to: '/outbox', label: 'Outbox', icon: 'mail' },
    { to: '/settings', label: 'Settings', icon: 'settings' },
  ];
  const { me } = useMe();
  return (
    <Shell
      items={items}
      sub={me.agency?.name ?? ''}
      groups={[
        { label: 'Today', from: 0 },
        { label: 'Money', from: 4 },
        { label: 'People and places', from: 7 },
        { label: 'Admin', from: 11 },
      ]}
    >
      <Routes>
        <Route index element={<Home />} />
        <Route path="ask" element={<Ask />} />
        <Route path="live" element={<Live />} />
        <Route path="bookings" element={<Bookings />} />
        <Route path="timesheets" element={<Timesheets />} />
        <Route path="timesheets/:id" element={<TimesheetDetail />} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="invoices/:id" element={<Invoices />} />
        <Route path="payroll" element={<Payroll />} />
        <Route path="workers" element={<Workers />} />
        <Route path="workers/:id" element={<WorkerDetail />} />
        <Route path="compliance" element={<Compliance />} />
        <Route path="clients" element={<Clients />} />
        <Route path="sites/:id" element={<SiteEdit />} />
        <Route path="rollcalls" element={<RollCallHistory />} />
        <Route path="outbox" element={<Outbox />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}

function ClientShell() {
  useEffect(() => setRole('manager'), []);
  const items: NavItem[] = [
    { to: '/client', label: 'On site now', icon: 'live', end: true, mobile: true },
    { to: '/client/timesheets', label: 'Timesheets', icon: 'clipboard', mobile: true },
    { to: '/client/rollcalls', label: 'Roll calls', icon: 'flame', mobile: true },
  ];
  const { me } = useMe();
  return (
    <Shell items={items} sub={`via ${me.agency?.name ?? ''}`}>
      <Routes>
        <Route index element={<ClientHome />} />
        <Route path="timesheets" element={<ClientTimesheets />} />
        <Route path="timesheets/:id" element={<ClientApproval />} />
        <Route path="rollcalls" element={<RollCallHistory />} />
        <Route path="*" element={<Navigate to="/client" replace />} />
      </Routes>
    </Shell>
  );
}
