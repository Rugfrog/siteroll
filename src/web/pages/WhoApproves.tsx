// "Who approves the hours?" The client opens this from a booking confirmation email. No login:
// the link itself is the key. Whoever they name gets the hours each week by email.
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, useApi } from '../api';
import { useMe } from '../App';
import { Icon } from '../icons';
import { Async, ErrorBox, Field } from '../ui';
import { fmtDate } from '../../shared/format';

export default function WhoApproves() {
  const { token } = useParams();
  const { me } = useMe();
  const state = useApi<any>(`/api/public/approver/${token}`);
  const [f, setF] = useState({ name: '', email: '', phone: '', role: 'Site manager', replace: true });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ name: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post(`/api/public/approver/${token}`, f);
      setDone({ name: r.name });
      window.scrollTo({ top: 0 });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="public-page">
      <header className="public-head">
        <span className="brand-mark" style={{ width: 34, height: 34 }}>
          {me.agency?.hasLogo ? <img src="/files/logo" alt="" /> : <Icon name="hardhat" style={{ width: 18, height: 18, color: 'var(--brand-ink)' }} />}
        </span>
        <strong>{me.agency?.name}</strong>
      </header>
      <main className="public-body">
        <Async state={state} rows={6}>
          {(d) =>
            done ? (
              <section className="card card-pad stack" aria-live="polite">
                <div className="row" style={{ gap: 10 }}>
                  <span className="tick-circle">
                    <Icon name="check" />
                  </span>
                  <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Thanks, that's set up</h1>
                </div>
                <p style={{ margin: 0 }}>
                  <strong>{done.name}</strong> will get the hours for {d.siteName} to approve each week, by email. We've emailed them to say how it works: they tap the link, check the hours and approve them. No password or account needed.
                </p>
                <p className="small muted" style={{ margin: 0 }}>
                  Need to change it later? Call {d.agency.name} on {d.agency.phone}.
                </p>
              </section>
            ) : (
              <form className="stack" onSubmit={submit}>
                <div>
                  <p className="small muted" style={{ margin: 0 }}>
                    {d.clientName} · {d.siteName}
                  </p>
                  <h1 style={{ margin: '4px 0 0' }}>Who approves the hours?</h1>
                </div>
                <p style={{ margin: 0 }}>
                  Each week {d.agency.name} will send the hours our workers do at this site to one person, by email. They check them and approve them in one tap, or query anything that looks wrong. There's no password or account to set up.
                </p>
                {d.answered && (
                  <div className="note-box small">
                    {d.answered.name}
                    {d.answered.role ? ` (${d.answered.role})` : ''} was named from this link. You can change it below.
                  </div>
                )}
                {d.bookings.length > 0 && (
                  <details className="card card-pad small">
                    <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Who's booked, week commencing {fmtDate(d.weekStart)}</summary>
                    <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                      {d.bookings.map((l: string) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                  </details>
                )}
                {error && <ErrorBox error={error} />}
                <section className="card card-pad stack">
                  <Field label="Their name">
                    <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoComplete="name" />
                  </Field>
                  <Field label="Their email" hint="the hours go here each week">
                    <input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required autoComplete="email" />
                  </Field>
                  <Field label="Their mobile" hint="optional, for a reminder by text or WhatsApp">
                    <input className="input" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} autoComplete="tel" />
                  </Field>
                  <Field label="Their role">
                    <select className="select" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
                      {d.roles.map((r: string) => (
                        <option key={r}>{r}</option>
                      ))}
                    </select>
                  </Field>
                  {d.approvers.length > 0 && (
                    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                      <legend className="small" style={{ fontWeight: 600, marginBottom: 6 }}>
                        At the moment the hours go to {d.approvers.map((a: any) => a.name).join(', ')}
                      </legend>
                      <label className="check" style={{ marginBottom: 6 }}>
                        <input type="radio" name="replace" checked={f.replace} onChange={() => setF({ ...f, replace: true })} /> Send them to this person instead
                      </label>
                      <label className="check">
                        <input type="radio" name="replace" checked={!f.replace} onChange={() => setF({ ...f, replace: false })} /> Send them to this person as well
                      </label>
                    </fieldset>
                  )}
                  <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
                    {busy ? 'Saving…' : 'Send the hours to this person'}
                  </button>
                </section>
                <p className="small muted" style={{ margin: 0 }}>
                  It can be you. Questions? Call {d.agency.name} on {d.agency.phone}.
                </p>
              </form>
            )
          }
        </Async>
      </main>
    </div>
  );
}
