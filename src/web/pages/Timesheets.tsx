import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, useApi, useLiveRefresh } from '../api';
import { Icon } from '../icons';
import { ShiftModal } from '../ShiftModal';
import { ActionButton, Async, Empty, PageHead, TimesheetStatus, useQueryState, useToast, WeekPicker } from '../ui';
import { fmtDateTime, fmtHours, fmtMoney } from '../../shared/format';
import { londonDate, mondayOf } from '../../shared/time';
import { marginPctOf } from '../util';

export default function Timesheets() {
  const [week, setWeek] = useQueryState('week', mondayOf(londonDate()));
  const state = useApi<any>(`/api/timesheets?week=${week}`);
  useLiveRefresh(state.reload, 60000);
  const navigate = useNavigate();
  const toast = useToast();
  const attendanceParam = new URLSearchParams(window.location.search).get('attendance');
  const [shift, setShift] = useState<number | null>(attendanceParam ? Number(attendanceParam) : null);

  return (
    <>
      <PageHead title="Timesheets" sub="Built automatically from sign-ins. Check anything flagged, then send to the client for one-tap approval.">
        <WeekPicker week={week} onChange={setWeek} />
      </PageHead>
      <Async state={state} rows={6}>
        {(d) =>
          d.timesheets.length === 0 ? (
            <div className="card">
              <Empty icon="clipboard" title="No hours this week">
                Timesheets appear as soon as someone signs in.
              </Empty>
            </div>
          ) : (
            <div className="grid grid-3">
              {d.timesheets.map((t: any) => (
                <article key={t.id} className="card" style={{ display: 'flex', flexDirection: 'column' }}>
                  <div className="card-pad" style={{ flex: 1 }}>
                    <div className="spread">
                      <span className="small muted">{t.clientName}</span>
                      <TimesheetStatus status={t.status} />
                    </div>
                    <h2 style={{ marginTop: 4 }}>
                      <Link to={`/timesheets/${t.id}`} style={{ textDecoration: 'none' }}>
                        {t.siteName}
                      </Link>
                    </h2>
                    <div className="row" style={{ gap: 18, marginTop: 14 }}>
                      <div>
                        <div className="big-count" style={{ fontSize: '1.8rem' }}>
                          {fmtHours(t.totals.totalMins)}
                        </div>
                        <div className="small muted">hours · {t.totals.workers} workers</div>
                      </div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{fmtMoney(t.totals.chargePence)}</div>
                        <div className="small muted">
                          margin {fmtMoney(t.totals.chargePence - t.totals.payPence)} ({marginPctOf(t.totals.chargePence, t.totals.payPence)}%)
                        </div>
                      </div>
                    </div>
                    <div className="row mt-s" style={{ gap: 6 }}>
                      {t.needsChecking > 0 && <span className="badge badge-amber">{t.needsChecking} to check</span>}
                      {t.queried > 0 && <span className="badge badge-red">{t.queried} queried</span>}
                      {t.openShifts > 0 && <span className="badge badge-blue">{t.openShifts} still on site</span>}
                      {t.totals.otMins > 0 && <span className="badge">{fmtHours(t.totals.otMins)} h overtime</span>}
                    </div>
                    <p className="small muted" style={{ margin: '10px 0 0' }}>
                      {t.status === 'approved'
                        ? `Approved by ${t.approvedBy} · ${fmtDateTime(t.approvedAt)}`
                        : t.signoffSentAt
                          ? `Sent to client ${fmtDateTime(t.signoffSentAt)}`
                          : 'Not sent to the client yet'}
                    </p>
                  </div>
                  <div className="card-head" style={{ borderTop: '1px solid var(--line-2)', borderBottom: 0 }}>
                    <Link to={`/timesheets/${t.id}`} className="btn btn-sm">
                      Open
                    </Link>
                    <div className="row" style={{ gap: 6 }}>
                      {t.status !== 'approved' && t.totals.totalMins > 0 && (
                        <ActionButton
                          className="btn btn-sm btn-primary"
                          disabled={t.queried > 0}
                          title={t.queried ? 'Sort out the queries first' : undefined}
                          onClick={async () => {
                            const r = await api.post(`/api/timesheets/${t.id}/send`);
                            toast(`Sent to ${r.sent} site manager${r.sent === 1 ? '' : 's'}`);
                            state.reload();
                          }}
                        >
                          <Icon name="send" /> {t.signoffSentAt ? 'Send again' : 'Send for approval'}
                        </ActionButton>
                      )}
                      {t.status === 'approved' && !t.invoiceId && (
                        <ActionButton
                          className="btn btn-sm btn-primary"
                          onClick={async () => {
                            const r = await api.post('/api/invoices', { clientId: t.clientId, week });
                            toast(`Invoice ${r.number} created and emailed`);
                            navigate(`/invoices/${r.id}`);
                          }}
                        >
                          Create invoice
                        </ActionButton>
                      )}
                      {t.invoiceId && (
                        <Link to={`/invoices/${t.invoiceId}`} className="btn btn-sm">
                          View invoice
                        </Link>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )
        }
      </Async>
      {shift && (
        <ShiftModal
          id={shift}
          onClose={() => {
            setShift(null);
            window.history.replaceState(null, '', '/timesheets');
          }}
          onSaved={() => {
            setShift(null);
            state.reload();
          }}
        />
      )}
    </>
  );
}
