import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useApi } from '../api';
import { Icon } from '../icons';
import { ActionButton, Async, Card, Empty, ErrorBox, Field, Modal, PageHead, useToast } from '../ui';
import { fmtPhone } from '../../shared/format';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export default function Clients() {
  const state = useApi<any[]>('/api/clients');
  const [editing, setEditing] = useState<any | null>(null);
  const [manager, setManager] = useState<any | null>(null);
  return (
    <>
      <PageHead title="Clients & sites" sub="Each client's rules (breaks, overtime, selfies, compliance) and their sites and site managers.">
        <button className="btn" onClick={() => setEditing({})}>
          <Icon name="plus" /> New client
        </button>
        <Link to="/sites/new" className="btn btn-primary">
          <Icon name="plus" /> New site
        </Link>
      </PageHead>
      <Async state={state} rows={8}>
        {(clients) =>
          clients.length === 0 ? (
            <div className="card">
              <Empty icon="building" title="No clients yet">
                Add your first client, then their sites.
              </Empty>
            </div>
          ) : (
            <div className="stack">
              {clients.map((c) => (
                <Card
                  key={c.id}
                  title={c.name}
                  sub={c.address}
                  actions={
                    <button className="btn btn-sm" onClick={() => setEditing(c)}>
                      <Icon name="settings" /> Rules
                    </button>
                  }
                >
                  <div className="card-pad row" style={{ gap: 6, borderBottom: '1px solid var(--line-2)' }}>
                    <span className="badge">Break {c.break_default_mins} mins after {c.break_after_mins / 60}h</span>
                    {c.ot_daily_mins && <span className="badge">O/T after {c.ot_daily_mins / 60}h a day</span>}
                    {c.ot_weekly_mins && <span className="badge">O/T after {c.ot_weekly_mins / 60}h a week</span>}
                    {!!c.ot_saturday && <span className="badge">Saturdays ×{c.ot_multiplier}</span>}
                    {!!c.ot_sunday && <span className="badge">Sundays ×{c.ot_multiplier}</span>}
                    {c.round_mins > 0 && <span className="badge">Rounded to {c.round_mins} mins</span>}
                    {c.selfie_required ? <span className="badge badge-blue">Selfie at sign-in</span> : <span className="badge">No selfie</span>}
                    {c.compliance_mode === 'block' ? <span className="badge badge-red">Expired cards blocked</span> : <span className="badge badge-amber">Expired cards warned</span>}
                    <span className="badge">
                      Sign-off {DAYS[c.signoff_day]} {c.signoff_time}
                    </span>
                  </div>
                  <div className="grid grid-2" style={{ gap: 0 }}>
                    <div style={{ borderRight: '1px solid var(--line-2)' }}>
                      <h3 className="card-pad small muted" style={{ paddingBottom: 0, textTransform: 'uppercase', letterSpacing: '.06em', fontSize: '.72rem' }}>
                        Sites
                      </h3>
                      <ul className="list">
                        {c.sites.length === 0 && <li className="small muted">No sites yet.</li>}
                        {c.sites.map((s: any) => (
                          <li key={s.id}>
                            <span className="alert-icon blue">
                              <Icon name="pin" />
                            </span>
                            <div className="grow">
                              <Link to={`/sites/${s.id}`} className="title" style={{ textDecoration: 'none' }}>
                                {s.name}
                              </Link>
                              <div className="tiny muted">
                                {s.postcode} · {s.start_time}–{s.finish_time} · {s.radius_m} m geofence {s.active ? '' : '· closed'}
                              </div>
                            </div>
                            <Link to={`/sites/${s.id}/poster`} className="btn btn-sm" title="Print the QR poster">
                              <Icon name="qr" /> Poster
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <div className="card-pad spread" style={{ paddingBottom: 0 }}>
                        <h3 className="small muted" style={{ textTransform: 'uppercase', letterSpacing: '.06em', fontSize: '.72rem' }}>
                          Site managers
                        </h3>
                        <button className="btn btn-sm btn-ghost" onClick={() => setManager({ clientId: c.id, siteIds: [], sites: c.sites })}>
                          <Icon name="plus" /> Add
                        </button>
                      </div>
                      <ul className="list">
                        {c.managers.length === 0 && <li className="small muted">Add a site manager so they can approve timesheets.</li>}
                        {c.managers.map((m: any) => (
                          <li key={m.id}>
                            <div className="grow">
                              <button className="linkish title" style={{ textDecoration: 'none', fontWeight: 650 }} onClick={() => setManager({ ...m, clientId: c.id, sites: c.sites })}>
                                {m.name}
                              </button>
                              <div className="tiny muted">
                                {[m.phone && fmtPhone(m.phone), m.email].filter(Boolean).join(' · ')}
                                <br />
                                {c.sites
                                  .filter((s: any) => m.siteIds.includes(s.id))
                                  .map((s: any) => s.name)
                                  .join(', ') || 'No sites'}
                              </div>
                            </div>
                            <ActionButton className="btn btn-sm" onClick={() => api.post(`/api/managers/${m.id}/send-link`)} done={`Login link sent to ${m.name.split(' ')[0]} (see Outbox)`}>
                              Send login link
                            </ActionButton>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )
        }
      </Async>
      {editing && (
        <ClientModal
          client={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            state.reload();
          }}
        />
      )}
      {manager && (
        <ManagerModal
          manager={manager}
          onClose={() => setManager(null)}
          onSaved={() => {
            setManager(null);
            state.reload();
          }}
        />
      )}
    </>
  );
}

function ClientModal({ client, onClose, onSaved }: { client: any; onClose: () => void; onSaved: () => void }) {
  const isNew = !client.id;
  const [f, setF] = useState({
    name: client.name ?? '',
    address: client.address ?? '',
    billing_email: client.billing_email ?? '',
    break_default_mins: client.break_default_mins ?? 30,
    break_after_hours: (client.break_after_mins ?? 360) / 60,
    ot_daily_hours: client.ot_daily_mins ? client.ot_daily_mins / 60 : '',
    ot_weekly_hours: client.ot_weekly_mins ? client.ot_weekly_mins / 60 : '',
    ot_saturday: !!(client.ot_saturday ?? 1),
    ot_sunday: !!(client.ot_sunday ?? 1),
    ot_multiplier: client.ot_multiplier ?? 1.5,
    round_mins: client.round_mins ?? 15,
    selfie_required: !!client.selfie_required,
    compliance_mode: client.compliance_mode ?? 'warn',
    signoff_day: client.signoff_day ?? 4,
    signoff_time: client.signoff_time ?? '14:00',
  });
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value });
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = {
      ...f,
      break_after_mins: Math.round(Number(f.break_after_hours) * 60),
      ot_daily_mins: f.ot_daily_hours === '' ? null : Math.round(Number(f.ot_daily_hours) * 60),
      ot_weekly_mins: f.ot_weekly_hours === '' ? null : Math.round(Number(f.ot_weekly_hours) * 60),
    };
    try {
      if (isNew) await api.post('/api/clients', body);
      else await api.put(`/api/clients/${client.id}`, body);
      toast('Saved');
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Modal
      title={isNew ? 'New client' : `${client.name}: rules`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" form="client-form">
            Save
          </button>
        </>
      }
    >
      <form id="client-form" onSubmit={save} className="stack">
        {error && <ErrorBox error={error} />}
        <div className="form-grid">
          <Field label="Company name">
            <input className="input" value={f.name} onChange={set('name')} required />
          </Field>
          <Field label="Accounts email" hint="invoices go here">
            <input className="input" type="email" value={f.billing_email} onChange={set('billing_email')} />
          </Field>
        </div>
        <Field label="Address">
          <input className="input" value={f.address} onChange={set('address')} />
        </Field>
        <h3>Breaks</h3>
        <div className="form-grid">
          <Field label="Default break (mins)" hint="if the worker doesn't say">
            <input className="input" type="number" min={0} max={120} value={f.break_default_mins} onChange={set('break_default_mins')} />
          </Field>
          <Field label="Only on shifts longer than (hours)">
            <input className="input" type="number" min={0} max={12} step={0.5} value={f.break_after_hours} onChange={set('break_after_hours')} />
          </Field>
        </div>
        <h3>Overtime</h3>
        <div className="form-grid">
          <Field label="After this many hours a day" hint="blank = no daily rule">
            <input className="input" type="number" min={1} max={24} step={0.5} value={f.ot_daily_hours} onChange={set('ot_daily_hours')} />
          </Field>
          <Field label="After this many hours a week" hint="blank = no weekly rule">
            <input className="input" type="number" min={1} max={168} step={0.5} value={f.ot_weekly_hours} onChange={set('ot_weekly_hours')} />
          </Field>
          <Field label="Overtime rate">
            <select className="select" value={f.ot_multiplier} onChange={set('ot_multiplier')}>
              <option value={1}>Same rate</option>
              <option value={1.25}>Time and a quarter (×1.25)</option>
              <option value={1.5}>Time and a half (×1.5)</option>
              <option value={2}>Double time (×2)</option>
            </select>
          </Field>
          <Field label="Round sign-in times to">
            <select className="select" value={f.round_mins} onChange={set('round_mins')}>
              <option value={0}>Exact minute</option>
              <option value={5}>Nearest 5 mins</option>
              <option value={10}>Nearest 10 mins</option>
              <option value={15}>Nearest quarter hour</option>
            </select>
          </Field>
        </div>
        <div className="row">
          <label className="check">
            <input type="checkbox" checked={f.ot_saturday} onChange={set('ot_saturday')} /> All Saturday hours are overtime
          </label>
          <label className="check">
            <input type="checkbox" checked={f.ot_sunday} onChange={set('ot_sunday')} /> All Sunday hours are overtime
          </label>
        </div>
        <h3>At the gate</h3>
        <label className="check">
          <input type="checkbox" checked={f.selfie_required} onChange={set('selfie_required')} /> Take a selfie when signing in (stops mates signing each other in)
        </label>
        <Field label="If someone's card has expired">
          <select className="select" value={f.compliance_mode} onChange={set('compliance_mode')}>
            <option value="warn">Warn them and tell the agency, but let them sign in</option>
            <option value="block">Block them from signing in</option>
          </select>
        </Field>
        <h3>Friday sign-off</h3>
        <div className="form-grid">
          <Field label="Send the approval link on">
            <select className="select" value={f.signoff_day} onChange={set('signoff_day')}>
              {DAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
          </Field>
          <Field label="At">
            <input className="input" type="time" value={f.signoff_time} onChange={set('signoff_time')} />
          </Field>
        </div>
      </form>
    </Modal>
  );
}

function ManagerModal({ manager, onClose, onSaved }: { manager: any; onClose: () => void; onSaved: () => void }) {
  const isNew = !manager.id;
  const [f, setF] = useState({ name: manager.name ?? '', email: manager.email ?? '', phone: manager.phone ? fmtPhone(manager.phone) : '', siteIds: manager.siteIds as number[], active: manager.active !== 0 });
  const [error, setError] = useState<string | null>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const body = { ...f, clientId: manager.clientId };
      if (isNew) await api.post('/api/managers', body);
      else await api.put(`/api/managers/${manager.id}`, body);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <Modal
      title={isNew ? 'Add a site manager' : manager.name}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" form="mgr-form">
            Save
          </button>
        </>
      }
    >
      <form id="mgr-form" className="stack" onSubmit={save}>
        <p className="small muted" style={{ margin: 0 }}>
          Site managers log in with a link sent by text or email. No password. They only see the sites you tick.
        </p>
        {error && <ErrorBox error={error} />}
        <Field label="Name">
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        </Field>
        <Field label="Mobile">
          <input className="input" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </Field>
        <Field label="Email">
          <input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small" style={{ fontWeight: 600, marginBottom: 6 }}>
            Sites they look after
          </legend>
          {manager.sites.map((s: any) => (
            <label key={s.id} className="check" style={{ marginBottom: 6 }}>
              <input
                type="checkbox"
                checked={f.siteIds.includes(s.id)}
                onChange={(e) => setF({ ...f, siteIds: e.target.checked ? [...f.siteIds, s.id] : f.siteIds.filter((x) => x !== s.id) })}
              />
              {s.name}
            </label>
          ))}
        </fieldset>
        {!isNew && (
          <label className="check">
            <input type="checkbox" checked={!f.active} onChange={(e) => setF({ ...f, active: !e.target.checked })} /> No longer works there (logs them out)
          </label>
        )}
      </form>
    </Modal>
  );
}
