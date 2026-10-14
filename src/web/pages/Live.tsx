import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useApi, useLiveRefresh } from '../api';
import { useMe } from '../App';
import { Icon, type IconName } from '../icons';
import { ActionButton, Async, Avatar, Card, CardBadge, Empty, ErrorBox, FlagBadge, Loading, Modal, PageHead, useToast } from '../ui';
import { fmtDateTime, fmtMiles, fmtTime } from '../../shared/format';
import { timeSince } from '../util';

export default function Live() {
  return <LiveBoard />;
}

export function LiveBoard({ client = false }: { client?: boolean }) {
  const state = useApi<any>('/api/live');
  const alerts = useApi<any[]>(client ? null : '/api/alerts');
  useLiveRefresh(() => {
    state.reload();
    if (!client) alerts.reload();
  }, 20000);
  const [filter, setFilter] = useState<number | 'all'>('all');
  const navigate = useNavigate();
  const toast = useToast();

  const startRollCall = async (siteId: number) => {
    try {
      const rc = await api.post('/api/rollcalls', { siteId, kind: 'drill' });
      navigate(`/rollcall/${rc.id}`);
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  return (
    <>
      <PageHead
        eyebrow={
          <span className="row" style={{ gap: 8 }}>
            <span className="live-dot" aria-hidden="true" /> Live
          </span>
        }
        title="On site now"
        sub={state.data ? `Updated ${fmtTime(state.data.now)} · refreshes by itself` : undefined}
      >
        {!client && (
          <a className="btn" href="/wall">
            <Icon name="tv" /> Office TV view
          </a>
        )}
        {state.data && state.data.sites.length > 1 && (
          <select className="select" style={{ width: 'auto' }} value={filter} onChange={(e) => setFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))} aria-label="Show site">
            <option value="all">All sites</option>
            {state.data.sites.map((s: any) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </PageHead>

      {!client && alerts.data && alerts.data.length > 0 && (
        <Card title="Needs attention" sub={`${alerts.data.length} open`} className="mt-s" >
          <AlertList alerts={alerts.data} onChange={() => { alerts.reload(); state.reload(); }} />
        </Card>
      )}

      <Async state={state} rows={8}>
        {(d) => {
          const sites = d.sites.filter((s: any) => filter === 'all' || s.id === filter);
          if (!sites.length) return <Empty icon="building" title="No sites yet">Add a site under Clients &amp; sites.</Empty>;
          return (
            <div className="stack mt">
              {sites.map((s: any) => (
                <SiteBoard key={s.id} site={s} client={client} showFire={!client || d.sites.length > 1} onRollCall={() => startRollCall(s.id)} onChange={state.reload} />
              ))}
            </div>
          );
        }}
      </Async>
    </>
  );
}

function SiteBoard({ site, client, showFire, onRollCall, onChange }: { site: any; client: boolean; showFire: boolean; onRollCall: () => void; onChange: () => void }) {
  const flagged = site.onSite.filter((p: any) => p.flags.length || p.card !== 'ok').length;
  return (
    <section className="card site-board" aria-labelledby={`site-${site.id}`}>
      <div className="card-head">
        <div className="site-title">
          <div className="big-count" aria-label={`${site.onSite.length} on site`}>
            {site.onSite.length}
          </div>
          <div>
            <h2 id={`site-${site.id}`}>{site.name}</h2>
            <p>
              {site.clientName} · starts {site.startTime}
              {site.signedOutToday ? ` · ${site.signedOutToday} gone home` : ''}
              {flagged ? ` · ${flagged} flagged` : ''}
            </p>
          </div>
        </div>
        {showFire && (
          <button className="btn btn-danger" onClick={onRollCall}>
            <Icon name="flame" /> Fire roll call
          </button>
        )}
      </div>

      {site.pendingManual.length > 0 && (
        <div style={{ padding: '10px 18px', background: 'var(--blue-soft)', borderBottom: '1px solid var(--line-2)' }}>
          {site.pendingManual.map((p: any) => (
            <div key={p.id} className="spread" style={{ padding: '4px 0' }}>
              <div>
                <strong>
                  {p.first_name} {p.last_name}
                </strong>{' '}
                asked to sign {p.action === 'in' ? 'in' : 'out'} by hand at {fmtTime(p.at)}
                <div className="small muted">Phone said {p.distanceM != null ? `${fmtMiles(p.distanceM)} from the site` : 'no location'} (accuracy ±{Math.round(p.accuracy ?? 0)} m)</div>
              </div>
              <div className="row">
                <ActionButton className="btn btn-sm btn-primary" onClick={() => api.post(`/api/attempts/${p.id}/approve`).then(onChange)} done="Approved">
                  Approve
                </ActionButton>
                <ActionButton className="btn btn-sm" onClick={() => api.post(`/api/attempts/${p.id}/reject`).then(onChange)} done="Rejected">
                  Reject
                </ActionButton>
              </div>
            </div>
          ))}
        </div>
      )}

      {site.onSite.length === 0 ? (
        <Empty icon="users" title="Nobody signed in">
          {site.expected.length ? `${site.expected.length} booked today.` : 'No bookings today.'}
        </Empty>
      ) : (
        <div className="people">
          {site.onSite.map((p: any) => (
            <div className="person" key={p.attendanceId}>
              <Avatar name={p.name} src={p.hasSelfie ? `/files/selfie/${p.attendanceId}` : null} />
              <div style={{ minWidth: 0 }}>
                <div className="name">{p.name}</div>
                <div className="meta">
                  {p.trade} · in {fmtTime(p.inAt)} <span aria-hidden="true">·</span> {timeSince(p.inAt)}
                </div>
                {(p.flags.length > 0 || p.card !== 'ok') && (
                  <div className="flags">
                    {p.flags.map((f: string) => (
                      <FlagBadge key={f} flag={f} />
                    ))}
                    {p.card !== 'ok' && !p.flags.includes('card') && <CardBadge status={p.card} />}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {site.expected.length > 0 && (
        <div className="expected">
          <div className="small muted" style={{ fontWeight: 600, marginBottom: 4 }}>
            Booked but not here yet ({site.expected.length})
          </div>
          {site.expected.map((e: any) => (
            <span key={e.bookingId} className={`chip ${e.noShow ? 'no-show' : ''}`}>
              <Avatar name={e.name} />
              {e.name} <span className="muted small">{e.trade}</span>
              {e.noShow && <span className="badge badge-red">No-show</span>}
            </span>
          ))}
          {client && site.expected.some((e: any) => e.noShow) && <p className="small muted" style={{ margin: '6px 0 0' }}>The agency has been told and will send a replacement if needed.</p>}
        </div>
      )}
    </section>
  );
}

const ALERT_ICON: Record<string, [IconName, string]> = {
  no_show: ['clock', 'red'],
  compliance: ['shield', 'red'],
  missed_signout: ['alert', 'amber'],
  manual_request: ['pin', 'blue'],
  query: ['flag', 'red'],
  not_booked: ['calendar', 'amber'],
};

export function AlertList({ alerts, onChange }: { alerts: any[]; onChange: () => void }) {
  const [replacing, setReplacing] = useState<any | null>(null);
  const { me } = useMe();
  const isAgency = me.user?.type === 'agency';
  const navigate = useNavigate();
  return (
    <div>
      {alerts.map((a) => {
        const [icon, tone] = ALERT_ICON[a.type] ?? ['alert', 'amber'];
        return (
          <div className="alert-item" key={a.id}>
            <span className={`alert-icon ${tone}`}>
              <Icon name={icon} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div>{a.message}</div>
              <div className="tiny muted">{fmtDateTime(a.created_at)}</div>
              {isAgency && ['no_show', 'missed_signout', 'query', 'compliance'].includes(a.type) && (
                <div className="row mt-s" style={{ gap: 6 }}>
                  {a.type === 'no_show' && (
                    <>
                      <ActionButton className="btn btn-sm" onClick={() => api.post(`/api/alerts/${a.id}/text-worker`)} done={`Text sent to ${a.first_name}`}>
                        <Icon name="sms" /> Text {a.first_name}
                      </ActionButton>
                      <button className="btn btn-sm btn-primary" onClick={() => setReplacing(a)}>
                        Send a replacement
                      </button>
                    </>
                  )}
                  {(a.type === 'missed_signout' || a.type === 'query') && a.attendance_id && (
                    <button className="btn btn-sm" onClick={() => navigate(`/timesheets?attendance=${a.attendance_id}`)}>
                      Check timesheet
                    </button>
                  )}
                  {a.type === 'compliance' && a.worker_id && (
                    <button className="btn btn-sm" onClick={() => navigate(`/workers/${a.worker_id}`)}>
                      Open worker
                    </button>
                  )}
                </div>
              )}
              {isAgency && a.type !== 'manual_request' && (
                <ActionButton className="dismiss" aria-label="Dismiss" title="Dismiss" onClick={() => api.post(`/api/alerts/${a.id}/resolve`, {}).then(onChange)}>
                  <Icon name="x" />
                </ActionButton>
              )}
            </div>
          </div>
        );
      })}
      {replacing && (
        <ReplacementModal
          alert={replacing}
          onClose={() => setReplacing(null)}
          onDone={() => {
            setReplacing(null);
            onChange();
          }}
        />
      )}
    </div>
  );
}

function ReplacementModal({ alert, onClose, onDone }: { alert: any; onClose: () => void; onDone: () => void }) {
  const state = useApi<any>(`/api/alerts/${alert.id}/replacements`);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const [showAll, setShowAll] = useState(false);
  return (
    <Modal title={`Replace ${alert.first_name} ${alert.last_name}`} onClose={onClose} wide>
      <p className="muted" style={{ marginTop: 0 }}>
        {alert.site_name}. We'll text the replacement the site address, and tell the site manager they're on the way.
      </p>
      {error && <ErrorBox error={error} />}
      {!state.data ? (
        <Loading />
      ) : (
        (() => {
          const list = state.data.workers.filter((w: any) => showAll || w.sameTrade);
          return (
            <>
              <div className="spread" style={{ marginBottom: 8 }}>
                <strong>
                  Free today{showAll ? '' : ` · ${state.data.trade}`} ({list.length})
                </strong>
                <label className="check small">
                  <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show other trades
                </label>
              </div>
              {list.length === 0 ? (
                <Empty icon="users" title={`No free ${state.data.trade.toLowerCase()}s today`}>
                  Tick "Show other trades" to see everyone who's free.
                </Empty>
              ) : (
                <ul className="list card">
                  {list.map((w: any) => (
                    <li key={w.id}>
                      <Avatar name={w.name} />
                      <div className="grow">
                        <div className="title">{w.name}</div>
                        <div className="small muted row" style={{ gap: 6 }}>
                          {w.trade} <CardBadge status={w.card} /> {w.inducted ? <span className="badge badge-green">Inducted here</span> : <span className="badge badge-amber">Needs induction</span>}
                        </div>
                      </div>
                      <ActionButton
                        className="btn btn-primary btn-sm"
                        disabled={w.card === 'expired'}
                        onClick={async () => {
                          try {
                            await api.post(`/api/alerts/${alert.id}/replace`, { workerId: w.id });
                            toast(`${w.name} is on the way. Texts sent.`);
                            onDone();
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        Send {w.name.split(' ')[0]}
                      </ActionButton>
                    </li>
                  ))}
                </ul>
              )}
            </>
          );
        })()
      )}
    </Modal>
  );
}
