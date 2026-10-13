import { useState } from 'react';
import { api } from '../api';
import { useMe } from '../App';
import { Field } from '../ui';
import { Icon } from '../icons';

export function Login() {
  const { me, reload } = useMe();
  const [mode, setMode] = useState<'agency' | 'client'>('agency');
  const [email, setEmail] = useState(me.demoLogin?.email ?? '');
  const [password, setPassword] = useState(me.demoLogin?.password ?? '');
  const [contact, setContact] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const expired = new URLSearchParams(window.location.search).has('expired');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'agency') {
        await api.post('/api/auth/login', { email, password });
        await reload();
        const next = new URLSearchParams(window.location.search).get('next');
        if (next && next.startsWith('/') && !next.startsWith('//')) window.history.replaceState(null, '', next);
      } else {
        await api.post('/api/auth/manager-link', { contact });
        setSent(true);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login-art">
        <div className="row" style={{ gap: 10 }}>
          <span className="brand-mark" style={{ width: 40, height: 40 }}>
            {me.agency?.hasLogo ? <img src="/files/logo" alt="" /> : <Icon name="hardhat" style={{ width: 22, height: 22, color: 'var(--brand-ink)' }} />}
          </span>
          <div>
            <div className="brand-name">SiteRoll</div>
            <div className="brand-sub">{me.agency?.name}</div>
          </div>
        </div>
        <div>
          <div className="tag">
            Who's on site, <em>right now.</em>
            <br />
            Friday sign-off in one tap.
          </div>
          <ul>
            <li>Scan the board to sign in. No app to install.</li>
            <li>Live fire roll call for every site.</li>
            <li>Approved hours become invoices and payroll.</li>
          </ul>
        </div>
        <div className="small" style={{ color: '#7d838f' }}>
          Site sign-in and timesheets for labour agencies
        </div>
      </div>
      <div className="login-form">
        <form onSubmit={submit} className="stack" aria-labelledby="login-title">
          <div>
            <h1 id="login-title">Log in</h1>
            <p className="muted" style={{ margin: '6px 0 0' }}>
              {mode === 'agency' ? 'Agency staff' : 'Site managers: we’ll send you a link. No password needed.'}
            </p>
          </div>
          <div className="seg" role="tablist" aria-label="Who are you?">
            <button type="button" role="tab" aria-selected={mode === 'agency'} className={mode === 'agency' ? 'on' : ''} onClick={() => setMode('agency')}>
              Agency staff
            </button>
            <button type="button" role="tab" aria-selected={mode === 'client'} className={mode === 'client' ? 'on' : ''} onClick={() => setMode('client')}>
              Site manager
            </button>
          </div>
          {expired && <div className="note-box">That link has expired. Ask for a new one below.</div>}
          {error && (
            <div className="error-box" role="alert">
              {error}
            </div>
          )}
          {mode === 'agency' ? (
            <>
              <Field label="Email">
                <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </Field>
              <Field label="Password">
                <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </Field>
              <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
                {busy ? 'Logging in…' : 'Log in'}
              </button>
              {me.demoLogin && (
                <p className="small muted" style={{ margin: 0 }}>
                  Demo login is filled in for you: <code>{me.demoLogin.email}</code> / <code>{me.demoLogin.password}</code>
                </p>
              )}
            </>
          ) : sent ? (
            <div className="ok-box">
              If that email or mobile is registered, a login link is on its way. It works for 7 days.
              {me.demoMode && (
                <>
                  {' '}
                  <strong>Demo:</strong> agency staff can see the link in the Outbox.
                </>
              )}
            </div>
          ) : (
            <>
              <Field label="Your email or mobile number">
                <input className="input" autoComplete="email" value={contact} onChange={(e) => setContact(e.target.value)} required placeholder="e.g. 07700 900501" />
              </Field>
              <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
                {busy ? 'Sending…' : 'Send me a login link'}
              </button>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
