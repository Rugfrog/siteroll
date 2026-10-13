import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, useApi, useLiveRefresh } from '../api';
import { Icon } from '../icons';
import { ShiftModal } from '../ShiftModal';
import { ActionButton, Async, Avatar, Card, Empty, ErrorBox, Field, FlagBadge, Modal, PageHead, TimesheetStatus, useToast } from '../ui';
import { fmtDateTime, fmtDay, fmtHours, fmtMoney, fmtTime } from '../../shared/format';
import { marginPctOf } from '../util';

export function TimesheetGrid({ view, onOpen, showMoney }: { view: any; onOpen: (id: number) => void; showMoney: boolean }) {
  // Weekend columns only when someone worked them, to keep the grid readable on a laptop.
  const all = view.workers.flatMap((w: any) => w.shifts);
  const days: string[] = view.days.filter((d: string, i: number) => i < 5 || all.some((s: any) => s.date === d));
  const dayTotal = (d: string) => view.workers.flatMap((w: any) => w.shifts).filter((s: any) => s.date === d).reduce((s: number, x: any) => s + x.workedMins, 0);
  return (
    <div className="table-wrap">
      <table className="t ts-grid">
        <thead>
          <tr>
            <th>Worker</th>
            {days.map((d: string) => (
              <th key={d} className="num" style={{ textAlign: 'center' }}>
                {fmtDay(d)}
              </th>
            ))}
            <th className="num">Basic</th>
            <th className="num">O/T</th>
            <th className="num">Total</th>
            {showMoney && <th className="num">Charge</th>}
            {showMoney && <th className="num">Pay</th>}
          </tr>
        </thead>
        <tbody>
          {view.workers.map((w: any) => (
            <tr key={w.workerId}>
              <td>
                <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                  <Avatar name={w.name} />
                  <div>
                    <div style={{ fontWeight: 650 }} className="nowrap">
                      {w.name}
                    </div>
                    <div className="tiny muted">{w.trade}</div>
                  </div>
                </div>
              </td>
              {days.map((d: string) => {
                const shifts = w.shifts.filter((s: any) => s.date === d);
                return (
                  <td key={d} className="day">
                    {shifts.map((s: any) => {
                      const flagged = s.status === 'needs_checking';
                      const queried = s.status === 'queried';
                      return (
                        <button
                          key={s.id}
                          className={`ts-cell ${flagged ? 'flagged' : ''} ${queried ? 'queried' : ''} ${s.estimatedOut ? 'estimated' : ''}`}
                          onClick={() => onOpen(s.id)}
                          aria-label={`${w.name}, ${fmtDay(d)}: ${fmtHours(s.workedMins)} hours, ${fmtTime(s.inAt)} to ${fmtTime(s.outAt)}${flagged ? ', needs checking' : ''}${queried ? ', queried' : ''}`}
                        >
                          <span className="h">{fmtHours(s.workedMins)}</span>
                          <span className="tm">
                            {fmtTime(s.inAt)}–{fmtTime(s.outAt)}
                          </span>
                          {(s.flags.length > 0 || flagged || queried) && (
                            <span style={{ display: 'flex', gap: 2, marginTop: 2 }} aria-hidden="true">
                              {s.flags.slice(0, 3).map((f: string) => (
                                <span key={f} className="dot" style={{ color: ['disputed', 'card'].includes(f) ? 'var(--red)' : ['manual', 'offline'].includes(f) ? 'var(--blue)' : f === 'edited' ? '#9aa0ab' : 'var(--amber)' }} />
                              ))}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </td>
                );
              })}
              <td className="num">{fmtHours(w.totals.normalMins)}</td>
              <td className="num">{w.totals.otMins ? fmtHours(w.totals.otMins) : '–'}</td>
              <td className="num">
                <strong>{fmtHours(w.totals.totalMins)}</strong>
              </td>
              {showMoney && <td className="num">{fmtMoney(w.totals.chargePence)}</td>}
              {showMoney && <td className="num">{fmtMoney(w.totals.payPence)}</td>}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>{view.totals.workers} workers</td>
            {days.map((d: string) => (
              <td key={d} className="num" style={{ textAlign: 'center' }}>
                {dayTotal(d) ? fmtHours(dayTotal(d)) : '–'}
              </td>
            ))}
            <td className="num">{fmtHours(view.totals.normalMins)}</td>
            <td className="num">{fmtHours(view.totals.otMins)}</td>
            <td className="num">{fmtHours(view.totals.totalMins)}</td>
            {showMoney && <td className="num">{fmtMoney(view.totals.chargePence)}</td>}
            {showMoney && <td className="num">{fmtMoney(view.totals.payPence)}</td>}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default function TimesheetDetail() {
  const { id } = useParams();
  const state = useApi<any>(`/api/timesheets/${id}`);
  useLiveRefresh(state.reload, 60000);
  const [shift, setShift] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const toast = useToast();

  return (
    <Async state={state} rows={8}>
      {(v) => {
        const toCheck = v.workers.flatMap((w: any) => w.shifts.filter((s: any) => s.status !== 'ok').map((s: any) => ({ ...s, name: w.name })));
        const ts = v.timesheet;
        return (
          <>
            <PageHead
              eyebrow={
                <Link to={`/timesheets?week=${v.weekStart}`} className="row" style={{ gap: 4, textDecoration: 'none' }}>
                  <Icon name="arrowLeft" style={{ width: 14, height: 14 }} /> Timesheets
                </Link>
              }
              title={v.site.name}
              sub={
                <>
                  {v.site.clientName} · week {fmtDay(v.weekStart)} – {fmtDay(v.days[6])} · <TimesheetStatus status={ts.status} />
                </>
              }
            >
              <a className="btn" href={`/api/timesheets/${ts.id}/pdf`}>
                <Icon name="download" /> PDF
              </a>
              {!v.locked && (
                <button className="btn" onClick={() => setAdding(true)}>
                  <Icon name="plus" /> Add a shift
                </button>
              )}
              {!v.locked && v.totals.totalMins > 0 && (
                <ActionButton
                  className="btn btn-primary"
                  disabled={v.queried > 0}
                  onClick={async () => {
                    const r = await api.post(`/api/timesheets/${ts.id}/send`);
                    toast(`Sent: “${r.headline}”`);
                    state.reload();
                  }}
                >
                  <Icon name="send" /> {ts.signoff_sent_at ? 'Send to client again' : 'Send to client for approval'}
                </ActionButton>
              )}
            </PageHead>

            <div className="grid grid-4">
              <div className="card stat">
                <span className="label">Hours</span>
                <span className="value">{fmtHours(v.totals.totalMins)}</span>
                <span className="sub">
                  {fmtHours(v.totals.normalMins)} basic · {fmtHours(v.totals.otMins)} overtime
                </span>
              </div>
              <div className="card stat">
                <span className="label">Workers</span>
                <span className="value">{v.totals.workers}</span>
              </div>
              <div className="card stat">
                <span className="label">Charge to client</span>
                <span className="value">{fmtMoney(v.totals.chargePence)}</span>
                <span className="sub">plus VAT</span>
              </div>
              <div className="card stat">
                <span className="label">Margin</span>
                <span className="value">{fmtMoney(v.totals.chargePence - v.totals.payPence)}</span>
                <span className="sub">{marginPctOf(v.totals.chargePence, v.totals.payPence)}% · pay {fmtMoney(v.totals.payPence)}</span>
              </div>
            </div>

            {v.locked && (
              <div className="ok-box mt spread">
                <div>
                  <strong>Approved and locked.</strong> {ts.approved_by_name} approved this on {fmtDateTime(ts.approved_at)}.
                  <div className="tiny" style={{ marginTop: 2 }}>Device: {ts.approved_device}</div>
                </div>
                {!ts.invoice_id && (
                  <ActionButton
                    className="btn btn-sm"
                    onClick={async () => {
                      const reason = prompt('Why are you reopening it? The client will be told.', 'Hours worked after sign-off');
                      if (!reason) return;
                      await api.post(`/api/timesheets/${ts.id}/reopen`, { reason });
                      toast('Reopened. Make your changes, then send it to the client again.');
                      state.reload();
                    }}
                  >
                    Reopen for changes
                  </ActionButton>
                )}
              </div>
            )}

            {toCheck.length > 0 && (
              <Card title="To check before it goes to the client" sub="Missed sign-outs, manual sign-ins and client queries." className="mt">
                <ul className="list">
                  {toCheck.map((s: any) => (
                    <li key={s.id}>
                      <span className={`alert-icon ${s.status === 'queried' ? 'red' : 'amber'}`}>
                        <Icon name={s.status === 'queried' ? 'flag' : 'alert'} />
                      </span>
                      <div className="grow">
                        <div className="title">
                          {s.name} · {fmtDay(s.date)} · {fmtTime(s.inAt)}–{fmtTime(s.outAt)}
                        </div>
                        <div className="row" style={{ gap: 4 }}>
                          {s.flags.map((f: string) => (
                            <FlagBadge key={f} flag={f} />
                          ))}
                          {s.queryComment && <span className="small muted">“{s.queryComment}”</span>}
                        </div>
                      </div>
                      <button className="btn btn-sm btn-primary" onClick={() => setShift(s.id)}>
                        Check
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <Card className="mt" title="The week" sub="Click any day to see the detail, fix it, or see its history.">
              {v.workers.length === 0 ? <Empty icon="clipboard" title="No sign-ins this week" /> : <TimesheetGrid view={v} onOpen={setShift} showMoney />}
              <div className="card-pad legend" style={{ borderTop: '1px solid var(--line-2)' }}>
                <span>
                  <i style={{ background: 'var(--amber-soft)', border: '1px solid #f0d590' }} />
                  Needs checking
                </span>
                <span>
                  <i style={{ background: 'var(--red-soft)', border: '1px solid #f3c2bc' }} />
                  Queried by client
                </span>
                <span>* still on site, counted to the usual finish time</span>
              </div>
            </Card>

            {shift && (
              <ShiftModal
                id={shift}
                onClose={() => setShift(null)}
                onSaved={() => {
                  setShift(null);
                  state.reload();
                }}
              />
            )}
            {adding && (
              <AddShift
                siteId={v.site.id}
                days={v.days}
                onClose={() => setAdding(false)}
                onDone={() => {
                  setAdding(false);
                  state.reload();
                }}
              />
            )}
          </>
        );
      }}
    </Async>
  );
}

function AddShift({ siteId, days, onClose, onDone }: { siteId: number; days: string[]; onClose: () => void; onDone: () => void }) {
  const workers = useApi<any[]>('/api/workers');
  const [f, setF] = useState({ workerId: '', date: days[0], inTime: '07:30', outTime: '16:30', breakMins: '30', reason: '' });
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  return (
    <Modal
      title="Add a shift by hand"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" form="add-shift">
            Add shift
          </button>
        </>
      }
    >
      <form
        id="add-shift"
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.post('/api/attendance', { ...f, siteId, workerId: Number(f.workerId), breakMins: f.breakMins === '' ? null : Number(f.breakMins) });
            toast('Shift added');
            onDone();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <p className="small muted" style={{ margin: 0 }}>
          For someone who couldn't sign in (no phone, flat battery). It's marked as added by the agency and kept in the history.
        </p>
        {error && <ErrorBox error={error} />}
        <Field label="Worker">
          <select className="select" value={f.workerId} onChange={(e) => setF({ ...f, workerId: e.target.value })} required>
            <option value="">Choose…</option>
            {(workers.data ?? [])
              .filter((w) => w.active)
              .map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} · {w.trade}
                </option>
              ))}
          </select>
        </Field>
        <div className="form-grid">
          <Field label="Day">
            <select className="select" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })}>
              {days.map((d) => (
                <option key={d} value={d}>
                  {fmtDay(d)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Signed in">
            <input className="input" type="time" value={f.inTime} onChange={(e) => setF({ ...f, inTime: e.target.value })} required />
          </Field>
          <Field label="Signed out">
            <input className="input" type="time" value={f.outTime} onChange={(e) => setF({ ...f, outTime: e.target.value })} required />
          </Field>
          <Field label="Break">
            <select className="select" value={f.breakMins} onChange={(e) => setF({ ...f, breakMins: e.target.value })}>
              <option value="">Client default</option>
              {[0, 15, 30, 45, 60].map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? 'None' : `${m} mins`}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Reason">
          <input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} required placeholder="e.g. Phone broken, confirmed by Gareth" />
        </Field>
      </form>
    </Modal>
  );
}
