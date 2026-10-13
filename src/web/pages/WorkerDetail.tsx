import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, fileToJpeg, useApi } from '../api';
import { Icon } from '../icons';
import { ActionButton, Avatar, Card, CardBadge, ErrorBox, Field, FlagBadge, Loading, PageHead, useToast } from '../ui';
import { fmtDate, fmtDateTime, fmtDay, fmtPhone, fmtTime, penceToDecimal } from '../../shared/format';
import { londonDate } from '../../shared/time';

const TRADES = ['General labourer', 'Bricklayer', 'Joiner', 'Plasterer', 'Groundworker', 'Plant operator', 'Scaffolder', 'Electrician', 'Plumber', 'Painter & decorator', 'Roofer', 'Site supervisor'];

const blank = {
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  trade: 'General labourer',
  payRate: '13.50',
  chargeRate: '17.50',
  niNumber: '',
  cardScheme: 'CSCS',
  cardType: '',
  cardNumber: '',
  cardExpiry: '',
  rtwCheckedOn: '',
  rtwCheckedBy: '',
  emergencyName: '',
  emergencyPhone: '',
  notes: '',
  active: true,
};

export default function WorkerDetail() {
  const { id } = useParams();
  const isNew = id === 'new';
  const state = useApi<any>(isNew ? null : `/api/workers/${id}`);
  const sites = useApi<any[]>('/api/clients');
  const navigate = useNavigate();
  const toast = useToast();
  const [f, setF] = useState<typeof blank>(blank);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const w = state.data;

  useEffect(() => {
    if (w)
      setF({
        firstName: w.firstName,
        lastName: w.lastName,
        phone: fmtPhone(w.phone),
        email: w.email,
        trade: w.trade,
        payRate: penceToDecimal(w.payRate),
        chargeRate: penceToDecimal(w.chargeRate),
        niNumber: w.niNumber,
        cardScheme: w.cardScheme,
        cardType: w.cardType,
        cardNumber: w.cardNumber,
        cardExpiry: w.cardExpiry ?? '',
        rtwCheckedOn: w.rtwCheckedOn ?? '',
        rtwCheckedBy: w.rtwCheckedBy,
        emergencyName: w.emergencyName,
        emergencyPhone: w.emergencyPhone,
        notes: w.notes,
        active: w.active,
      });
  }, [w]);

  if (!isNew && !w) return state.error ? <ErrorBox error={state.error} onRetry={state.reload} /> : <Loading rows={10} />;
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const allSites = (sites.data ?? []).flatMap((c: any) => c.sites.map((s: any) => ({ ...s, clientName: c.name })));
  const margin = Number(f.chargeRate) - Number(f.payRate);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (isNew) {
        const r = await api.post('/api/workers', f);
        toast('Worker added');
        navigate(`/workers/${r.id}`, { replace: true });
      } else {
        await api.put(`/api/workers/${id}`, f);
        toast('Saved');
        state.reload();
      }
    } catch (err) {
      setError((err as Error).message);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead
        eyebrow={
          <Link to="/workers" className="row" style={{ gap: 4, textDecoration: 'none' }}>
            <Icon name="arrowLeft" style={{ width: 14, height: 14 }} /> Workers
          </Link>
        }
        title={isNew ? 'Add a worker' : w.name}
        sub={isNew ? 'They sign in with this mobile number. No password or app needed.' : `${w.trade} · ${fmtPhone(w.phone)}`}
      >
        <button className="btn btn-primary" form="worker-form" disabled={busy}>
          {busy ? 'Saving…' : isNew ? 'Add worker' : 'Save changes'}
        </button>
      </PageHead>
      {error && <ErrorBox error={error} />}
      <div className="grid grid-main mt">
        <form id="worker-form" onSubmit={save} className="stack">
          <Card title="Details" pad>
            <div className="form-grid">
              <Field label="First name">
                <input className="input" value={f.firstName} onChange={set('firstName')} required />
              </Field>
              <Field label="Last name">
                <input className="input" value={f.lastName} onChange={set('lastName')} required />
              </Field>
              <Field label="Mobile" hint="for sign-in codes">
                <input className="input" type="tel" value={f.phone} onChange={set('phone')} required placeholder="07700 900123" />
              </Field>
              <Field label="Email" hint="optional">
                <input className="input" type="email" value={f.email} onChange={set('email')} />
              </Field>
              <Field label="Trade">
                <select className="select" value={f.trade} onChange={set('trade')}>
                  {[...new Set([f.trade, ...TRADES])].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="NI number" hint="for payroll">
                <input className="input" value={f.niNumber} onChange={set('niNumber')} placeholder="QQ 12 34 56 C" />
              </Field>
            </div>
          </Card>
          <Card title="Rates" sub={Number.isFinite(margin) ? `Margin £${margin.toFixed(2)} an hour (${Number(f.chargeRate) ? ((margin / Number(f.chargeRate)) * 100).toFixed(1) : 0}%)` : undefined} pad>
            <div className="form-grid">
              <Field label="Pay rate (£/hour)">
                <input className="input" inputMode="decimal" value={f.payRate} onChange={set('payRate')} required />
              </Field>
              <Field label="Charge rate (£/hour)">
                <input className="input" inputMode="decimal" value={f.chargeRate} onChange={set('chargeRate')} required />
              </Field>
            </div>
            <p className="small muted" style={{ margin: '10px 0 0' }}>
              Overtime uses each client's multiplier (e.g. time and a half). Changes apply to weeks not yet approved.
            </p>
          </Card>
          <Card title="Card" sub="CSCS, CPCS or similar" pad>
            <div className="form-grid">
              <Field label="Scheme">
                <select className="select" value={f.cardScheme} onChange={set('cardScheme')}>
                  {['CSCS', 'CPCS', 'NPORS', 'Other'].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="Card type">
                <input className="input" value={f.cardType} onChange={set('cardType')} placeholder="e.g. Labourer (green)" />
              </Field>
              <Field label="Card number">
                <input className="input" value={f.cardNumber} onChange={set('cardNumber')} />
              </Field>
              <Field label="Expiry date">
                <input className="input" type="date" value={f.cardExpiry} onChange={set('cardExpiry')} />
              </Field>
            </div>
          </Card>
          <Card title="Right to work and emergency contact" pad>
            <div className="form-grid">
              <Field label="Right to work checked on">
                <input className="input" type="date" value={f.rtwCheckedOn} onChange={set('rtwCheckedOn')} />
              </Field>
              <Field label="Checked by">
                <input className="input" value={f.rtwCheckedBy} onChange={set('rtwCheckedBy')} />
              </Field>
              <Field label="Emergency contact">
                <input className="input" value={f.emergencyName} onChange={set('emergencyName')} />
              </Field>
              <Field label="Emergency phone">
                <input className="input" type="tel" value={f.emergencyPhone} onChange={set('emergencyPhone')} />
              </Field>
            </div>
            <Field label="Notes">
              <textarea className="input" rows={2} value={f.notes} onChange={set('notes')} />
            </Field>
            {!isNew && (
              <label className="check mt">
                <input type="checkbox" checked={!f.active} onChange={(e) => setF({ ...f, active: !e.target.checked })} /> They've left (can't sign in any more)
              </label>
            )}
          </Card>
        </form>

        {!isNew && (
          <div className="stack">
            <Card title="Card photo" sub="Only the agency can see this">
              <div className="card-pad stack">
                <div className="row">
                  <span className="small muted">
                    {w.cardScheme} {w.cardExpiry ? `expires ${fmtDate(w.cardExpiry)}` : ''}
                  </span>
                  <CardBadge status={w.card} />
                </div>
                {w.hasCardPhoto ? (
                  <img src={`/files/card/${w.id}?v=${Date.now()}`} alt={`${w.name}'s ${w.cardScheme} card`} style={{ width: '100%', borderRadius: 10, border: '1px solid var(--line)' }} />
                ) : (
                  <p className="small muted" style={{ margin: 0 }}>
                    No photo yet.
                  </p>
                )}
                <label className="btn">
                  <Icon name="camera" /> {w.hasCardPhoto ? 'Replace photo' : 'Add photo'}
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        await api.post(`/api/workers/${w.id}/card-photo`, { image: await fileToJpeg(file) });
                        toast('Card photo saved');
                        state.reload();
                      } catch (err) {
                        toast((err as Error).message, true);
                      }
                    }}
                  />
                </label>
              </div>
            </Card>
            <Tickets worker={w} onChange={state.reload} />
            <Inductions worker={w} sites={allSites} onChange={state.reload} />
            <Card title="Recent sign-ins">
              {w.recent.length === 0 ? (
                <p className="card-pad small muted" style={{ margin: 0 }}>
                  None yet.
                </p>
              ) : (
                <ul className="list">
                  {w.recent.map((a: any) => (
                    <li key={a.id}>
                      <div className="grow">
                        <div className="title small">
                          {fmtDay(a.work_date)} · {fmtTime(a.in_at)}{a.out_at ? `–${fmtTime(a.out_at)}` : ' · still on site'}
                        </div>
                        <div className="tiny muted">{a.site_name}</div>
                      </div>
                      <div className="row" style={{ gap: 3 }}>
                        {JSON.parse(a.flags).map((fl: string) => (
                          <FlagBadge key={fl} flag={fl} />
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Remembered phones" sub="Phones that can sign in without a code">
              {w.devices.length === 0 ? (
                <p className="card-pad small muted" style={{ margin: 0 }}>
                  None. They'll get a text code the first time they scan a site board.
                </p>
              ) : (
                <ul className="list">
                  {w.devices.map((dv: any) => (
                    <li key={dv.id}>
                      <div className="grow">
                        <div className="small">{describeDevice(dv.user_agent)}</div>
                        <div className="tiny muted">Last used {fmtDateTime(dv.last_seen_at)}</div>
                      </div>
                      <ActionButton className="btn btn-sm" onClick={() => api.del(`/api/workers/${w.id}/devices/${dv.id}`).then(state.reload)} done="Phone forgotten">
                        Forget
                      </ActionButton>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}
      </div>
    </>
  );
}

function describeDevice(ua: string) {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return /SM-|Samsung/i.test(ua) ? 'Samsung Android phone' : 'Android phone';
  if (/Windows/.test(ua)) return 'Windows computer';
  if (/Mac OS/.test(ua)) return 'Mac';
  return ua.slice(0, 60) || 'Unknown device';
}

function Tickets({ worker, onChange }: { worker: any; onChange: () => void }) {
  const [f, setF] = useState({ name: '', number: '', expiry: '' });
  const toast = useToast();
  const today = londonDate();
  return (
    <Card title="Tickets and qualifications">
      <ul className="list">
        {worker.tickets.map((t: any) => {
          const status = !t.expiry ? 'ok' : t.expiry < today ? 'expired' : t.expiry <= addDaysLocal(today, 30) ? 'expiring' : 'ok';
          return (
            <li key={t.id}>
              <div className="grow">
                <div className="title small">{t.name}</div>
                <div className="tiny muted">
                  {t.number ? `No. ${t.number} · ` : ''}
                  {t.expiry ? `expires ${fmtDate(t.expiry)}` : 'no expiry'}
                </div>
              </div>
              {status !== 'ok' && <CardBadge status={status} />}
              <ActionButton className="btn btn-sm btn-ghost" aria-label={`Remove ${t.name}`} onClick={() => api.del(`/api/workers/${worker.id}/tickets/${t.id}`).then(onChange)}>
                <Icon name="x" />
              </ActionButton>
            </li>
          );
        })}
      </ul>
      <form
        className="card-pad stack"
        style={{ gap: 8, borderTop: '1px solid var(--line-2)' }}
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.post(`/api/workers/${worker.id}/tickets`, f);
            setF({ name: '', number: '', expiry: '' });
            onChange();
          } catch (err) {
            toast((err as Error).message, true);
          }
        }}
      >
        <input className="input" placeholder="Add a ticket, e.g. SMSTS" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required aria-label="Ticket name" />
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <input className="input" placeholder="Number" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} aria-label="Ticket number" />
          <input className="input" type="date" value={f.expiry} onChange={(e) => setF({ ...f, expiry: e.target.value })} aria-label="Expiry date" />
          <button className="btn">Add</button>
        </div>
      </form>
    </Card>
  );
}

function addDaysLocal(d: string, n: number) {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day + n)).toISOString().slice(0, 10);
}

function Inductions({ worker, sites, onChange }: { worker: any; sites: any[]; onChange: () => void }) {
  const [siteId, setSiteId] = useState('');
  const toast = useToast();
  const done = new Set(worker.inductions.map((i: any) => i.site_id));
  return (
    <Card title="Site inductions">
      <ul className="list">
        {worker.inductions.length === 0 && (
          <li className="small muted">Not inducted anywhere yet. They'll be warned when they sign in.</li>
        )}
        {worker.inductions.map((i: any) => (
          <li key={i.site_id}>
            <div className="grow">
              <div className="title small">{i.site_name}</div>
              <div className="tiny muted">
                {fmtDate(i.inducted_on)}
                {i.inducted_by ? ` by ${i.inducted_by}` : ''}
              </div>
            </div>
            <ActionButton className="btn btn-sm btn-ghost" aria-label={`Remove induction at ${i.site_name}`} onClick={() => api.del(`/api/workers/${worker.id}/inductions/${i.site_id}`).then(onChange)}>
              <Icon name="x" />
            </ActionButton>
          </li>
        ))}
      </ul>
      <div className="card-pad row" style={{ borderTop: '1px solid var(--line-2)', flexWrap: 'nowrap' }}>
        <select className="select" value={siteId} onChange={(e) => setSiteId(e.target.value)} aria-label="Site">
          <option value="">Inducted at…</option>
          {sites
            .filter((s) => !done.has(s.id))
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
        </select>
        <ActionButton
          className="btn"
          disabled={!siteId}
          onClick={async () => {
            await api.post(`/api/workers/${worker.id}/inductions`, { siteId: Number(siteId), date: londonDate(), by: '' });
            setSiteId('');
            onChange();
            toast('Induction recorded');
          }}
        >
          Today
        </ActionButton>
      </div>
    </Card>
  );
}

export { Avatar };
