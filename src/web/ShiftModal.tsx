// One sign-in record: details, the agency's edit form (reason required) and the full edit history.
import { useEffect, useState } from 'react';
import { api, useApi } from './api';
import { useMe } from './App';
import { ErrorBox, Field, FlagBadge, Loading, Modal, useToast } from './ui';
import { fmtDateTime, fmtDayLong, fmtTime, fmtMiles } from '../shared/format';

const METHOD: Record<string, string> = {
  gps: 'Phone (location checked)',
  manual: 'By hand (approved by site manager)',
  agency: 'Added by the agency',
  auto: 'Closed automatically',
};

export function ShiftModal({ id, onClose, onSaved }: { id: number; onClose: () => void; onSaved: () => void }) {
  const state = useApi<any>(`/api/attendance/${id}`);
  const { me } = useMe();
  const isAgency = me.user?.type === 'agency';
  const toast = useToast();
  const [form, setForm] = useState({ inTime: '', outTime: '', breakMins: '' as string, reason: '', markChecked: true });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'view' | 'query'>('view');
  const [comment, setComment] = useState('');

  const a = state.data;
  useEffect(() => {
    if (a) setForm({ inTime: fmtTime(a.inAt), outTime: a.outAt ? fmtTime(a.outAt) : '', breakMins: a.breakMins == null ? '' : String(a.breakMins), reason: '', markChecked: a.status !== 'ok' });
  }, [a]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.put(`/api/attendance/${id}`, { ...form, breakMins: form.breakMins === '' ? null : Number(form.breakMins) });
      toast('Saved. The change is in the history.');
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const sendQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/attendance/${id}/query`, { comment });
      toast("Query sent to the agency. They'll sort it and send the week back.");
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={a ? `${a.workerName} · ${fmtDayLong(a.date)}` : 'Sign-in'} onClose={onClose} wide>
      {!a ? (
        state.error ? <ErrorBox error={state.error} /> : <Loading />
      ) : (
        <div className="stack">
          <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
            {a.hasSelfie && <img src={`/files/selfie/${a.id}`} alt={`Photo taken by ${a.workerName} when signing in`} style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--line)' }} />}
            <div className="grow" style={{ flex: 1, minWidth: 220 }}>
              <div className="muted small">
                {a.trade} · {a.siteName}
              </div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, marginTop: 2 }}>
                {fmtTime(a.inAt)} – {a.outAt ? fmtTime(a.outAt) : <span className="badge badge-blue">Still on site</span>}
              </div>
              <div className="small muted">Break: {a.breakMins == null ? 'not given (client default applies)' : `${a.breakMins} mins`}</div>
              <div className="row mt-s" style={{ gap: 5 }}>
                {a.flags.map((f: string) => (
                  <FlagBadge key={f} flag={f} />
                ))}
                {a.status === 'needs_checking' && <span className="badge badge-amber">Needs checking</span>}
                {a.status === 'queried' && <span className="badge badge-red">Queried by client</span>}
                {a.locked && <span className="badge badge-green">Approved · locked</span>}
              </div>
            </div>
            <dl className="small" style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto auto', gap: '2px 12px' }}>
              <dt className="muted">Signed in</dt>
              <dd style={{ margin: 0 }}>{METHOD[a.method] ?? a.method}</dd>
              <dt className="muted">Signed out</dt>
              <dd style={{ margin: 0 }}>{a.outMethod ? METHOD[a.outMethod] ?? a.outMethod : '–'}</dd>
              {isAgency && a.inDistanceM != null && (
                <>
                  <dt className="muted">Location</dt>
                  <dd style={{ margin: 0 }}>
                    {fmtMiles(a.inDistanceM)} from site centre (±{Math.round(a.inAccuracy ?? 0)} m)
                  </dd>
                </>
              )}
            </dl>
          </div>

          {a.queryComment && (
            <div className="note-box">
              <strong>Client's comment:</strong> {a.queryComment}
            </div>
          )}
          {error && <ErrorBox error={error} />}

          {isAgency && !a.locked && (
            <form onSubmit={save} className="card card-pad stack" style={{ background: '#fbfaf8' }}>
              <h3>Fix this entry</h3>
              <div className="form-grid">
                <Field label="Signed in">
                  <input className="input" type="time" value={form.inTime} onChange={(e) => setForm({ ...form, inTime: e.target.value })} required />
                </Field>
                <Field label="Signed out">
                  <input className="input" type="time" value={form.outTime} onChange={(e) => setForm({ ...form, outTime: e.target.value })} />
                </Field>
                <Field label="Break">
                  <select className="select" value={form.breakMins} onChange={(e) => setForm({ ...form, breakMins: e.target.value })}>
                    <option value="">Client default</option>
                    {[0, 15, 30, 45, 60].map((m) => (
                      <option key={m} value={m}>
                        {m === 0 ? 'None' : `${m} mins`}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Why are you changing it?" hint="kept in the history and shown to the client">
                <input className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required placeholder="e.g. Rang Ryan: left at 16:30, forgot to sign out" />
              </Field>
              {a.status !== 'ok' && (
                <label className="check">
                  <input type="checkbox" checked={form.markChecked} onChange={(e) => setForm({ ...form, markChecked: e.target.checked })} />
                  Mark as checked {a.status === 'queried' ? '(answers the client’s query)' : ''}
                </label>
              )}
              <div>
                <button className="btn btn-primary" disabled={busy}>
                  {busy ? 'Saving…' : 'Save change'}
                </button>
              </div>
            </form>
          )}

          {!isAgency && !a.locked && a.status !== 'queried' && (
            mode === 'view' ? (
              <div>
                <button className="btn" onClick={() => setMode('query')}>
                  Query this entry
                </button>
              </div>
            ) : (
              <form onSubmit={sendQuery} className="card card-pad stack" style={{ background: '#fbfaf8' }}>
                <Field label="What's wrong with it?" hint="goes straight to the agency">
                  <textarea className="input" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} required placeholder="e.g. He left site at 2pm, not 4:30pm" />
                </Field>
                <div className="row">
                  <button className="btn btn-primary" disabled={busy}>
                    {busy ? 'Sending…' : 'Send query'}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setMode('view')}>
                    Cancel
                  </button>
                </div>
              </form>
            )
          )}

          <div>
            <h3 style={{ marginBottom: 6 }}>History</h3>
            {a.edits.length === 0 ? (
              <p className="small muted" style={{ margin: 0 }}>
                No changes. This is exactly what was recorded on the phone.
              </p>
            ) : (
              <ol className="list card" style={{ margin: 0 }}>
                {a.edits.map((e: any) => (
                  <li key={e.id} style={{ display: 'block' }}>
                    <div className="small">
                      <strong>{e.edited_by}</strong> <span className="muted">· {fmtDateTime(e.edited_at)}</span>
                    </div>
                    <div className="small">
                      {e.changes.map((c: any, i: number) => (
                        <div key={i}>
                          {c.field}: {c.from ? <s className="muted">{c.from}</s> : null} {c.from ? '→' : ''} <strong>{c.to ?? '–'}</strong>
                        </div>
                      ))}
                    </div>
                    <div className="small muted">“{e.reason}”</div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
