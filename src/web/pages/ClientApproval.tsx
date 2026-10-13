// The Friday sign-off page a site manager lands on from the text/email link.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, useApi } from '../api';
import { Icon } from '../icons';
import { ShiftModal } from '../ShiftModal';
import { Async, Avatar, ErrorBox, FlagBadge, PageHead } from '../ui';
import { fmtDateTime, fmtDay, fmtHours, fmtMoney, fmtTime } from '../../shared/format';
import { addDays } from '../../shared/time';

export default function ClientApproval() {
  const { id } = useParams();
  const state = useApi<any>(`/api/timesheets/${id}`);
  const [open, setOpen] = useState<number | null>(null);
  const [shift, setShift] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/timesheets/${id}/approve`);
      await state.reload();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Async state={state} rows={8}>
      {(v) => {
        const ts = v.timesheet;
        const hours = fmtHours(v.totals.totalMins);
        return (
          <>
            <PageHead
              eyebrow={
                <Link to="/client/timesheets" className="row" style={{ gap: 4, textDecoration: 'none' }}>
                  <Icon name="arrowLeft" style={{ width: 14, height: 14 }} /> Timesheets
                </Link>
              }
              title={v.site.name}
              sub={`${v.site.clientName} · week ${fmtDay(v.weekStart)} – ${fmtDay(addDays(v.weekStart, 6))}`}
            />

            <section className="approve-hero" aria-live="polite">
              {v.locked ? (
                <>
                  <div className="row" style={{ gap: 10 }}>
                    <span style={{ width: 44, height: 44, borderRadius: 99, background: '#16a34a', display: 'grid', placeItems: 'center' }}>
                      <Icon name="check" style={{ width: 26, height: 26, color: '#fff' }} />
                    </span>
                    <div className="big" style={{ fontSize: '2rem' }}>
                      Approved
                    </div>
                  </div>
                  <p style={{ color: '#c4c8d0', margin: '10px 0 0' }}>
                    {v.totals.workers} workers, {hours} hours. Approved by {ts.approved_by_name} on {fmtDateTime(ts.approved_at)}. The timesheet is locked and the agency has been told.
                  </p>
                  <a className="btn btn-lg" href={`/api/timesheets/${ts.id}/pdf?as=manager`} style={{ marginTop: 16 }}>
                    <Icon name="download" /> Download timesheet (PDF)
                  </a>
                </>
              ) : (
                <>
                  <div className="big">
                    {v.totals.workers} workers, {hours} hours
                    <small style={{ display: 'block', marginTop: 8 }}>
                      {fmtHours(v.totals.normalMins)} basic · {fmtHours(v.totals.otMins)} overtime · {fmtMoney(v.totals.chargePence)} + VAT
                    </small>
                  </div>
                  {v.queried > 0 ? (
                    <p style={{ color: '#ffd34d', margin: '14px 0 0', fontWeight: 600 }}>
                      You've queried {v.queried} {v.queried === 1 ? 'entry' : 'entries'}. The agency will sort {v.queried === 1 ? 'it' : 'them'} out and send the week back to you.
                    </p>
                  ) : (
                    <>
                      <p style={{ color: '#c4c8d0', margin: '14px 0 16px' }}>Check the hours below. If they look right, approve them all in one tap.</p>
                      {error && <ErrorBox error={error} />}
                      <button className="btn btn-primary btn-lg btn-block" style={{ fontSize: '1.15rem', minHeight: 58 }} onClick={approve} disabled={busy}>
                        <Icon name="check" /> {busy ? 'Approving…' : `Approve all ${hours} hours`}
                      </button>
                    </>
                  )}
                  {v.openShifts > 0 && <p className="small" style={{ color: '#c4c8d0', margin: '10px 0 0' }}>{v.openShifts} people are still on site; they're counted to the usual finish time.</p>}
                </>
              )}
            </section>

            <h2 style={{ margin: '24px 0 10px' }}>Who worked</h2>
            <div className="stack" style={{ gap: 10 }}>
              {v.workers.map((w: any) => {
                const isOpen = open === w.workerId;
                const flagged = w.shifts.some((s: any) => s.flags.length || s.status !== 'ok');
                return (
                  <div key={w.workerId} className="card">
                    <button
                      className="row"
                      style={{ width: '100%', background: 'none', border: 0, padding: '12px 16px', cursor: 'pointer', textAlign: 'left', flexWrap: 'nowrap' }}
                      onClick={() => setOpen(isOpen ? null : w.workerId)}
                      aria-expanded={isOpen}
                    >
                      <Avatar name={w.name} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontWeight: 650, display: 'block' }}>{w.name}</span>
                        <span className="small muted">
                          {w.trade} · {w.shifts.length} {w.shifts.length === 1 ? 'day' : 'days'}
                          {flagged ? ' · ' : ''}
                          {flagged && <span style={{ color: 'var(--amber-ink)', fontWeight: 600 }}>has notes</span>}
                        </span>
                      </span>
                      <span className="num">
                        <strong style={{ fontSize: '1.15rem' }}>{fmtHours(w.totals.totalMins)}</strong>
                        <span className="tiny muted" style={{ display: 'block' }}>
                          {w.totals.otMins ? `${fmtHours(w.totals.otMins)} O/T` : 'hours'}
                        </span>
                      </span>
                      <Icon name="chevron" style={{ width: 18, height: 18, transform: isOpen ? 'rotate(90deg)' : undefined, transition: 'transform .15s', color: 'var(--faint)' }} />
                    </button>
                    {isOpen && (
                      <ul className="list" style={{ borderTop: '1px solid var(--line-2)' }}>
                        {w.shifts.map((s: any) => (
                          <li key={s.id}>
                            {s.hasSelfie && <img src={`/files/selfie/${s.id}`} alt="" style={{ width: 36, height: 36, borderRadius: 8, objectFit: 'cover' }} />}
                            <div className="grow">
                              <div className="title">{fmtDay(s.date)}</div>
                              <div className="small muted">
                                {fmtTime(s.inAt)} – {fmtTime(s.outAt)}
                                {s.estimatedOut ? ' (still on site)' : ''} · break {s.breakMins}m
                              </div>
                              {(s.flags.length > 0 || s.status === 'queried') && (
                                <div className="row" style={{ gap: 4, marginTop: 3 }}>
                                  {s.flags.map((f: string) => (
                                    <FlagBadge key={f} flag={f} />
                                  ))}
                                </div>
                              )}
                              {s.queryComment && <div className="small" style={{ marginTop: 3 }}>“{s.queryComment}”</div>}
                            </div>
                            <strong className="num">{fmtHours(s.workedMins)}</strong>
                            <button className="btn btn-sm" onClick={() => setShift(s.id)}>
                              {v.locked ? 'Details' : s.status === 'queried' ? 'Queried' : 'Query'}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>

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
          </>
        );
      }}
    </Async>
  );
}
