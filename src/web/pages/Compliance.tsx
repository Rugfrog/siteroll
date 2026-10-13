import { Link } from 'react-router-dom';
import { useApi } from '../api';
import { Async, Card, CardBadge, Empty, PageHead, Stat } from '../ui';
import { fmtDate, fmtDateTime } from '../../shared/format';
import { daysBetween } from '../../shared/time';

export default function Compliance() {
  const state = useApi<any>('/api/compliance');
  return (
    <>
      <PageHead title="Compliance" sub="Cards, tickets, right-to-work and emergency contacts that need sorting. Anything expiring in the next 30 days shows here." />
      <Async state={state} rows={8}>
        {(d) => {
          const expired = d.items.filter((i: any) => i.status === 'expired');
          const expiring = d.items.filter((i: any) => i.status === 'expiring');
          const missing = d.items.filter((i: any) => i.status === 'missing');
          return (
            <>
              <div className="grid grid-3">
                <Stat label="Expired" value={expired.length} tone={expired.length ? 'bad' : undefined} sub="blocked or warned at the gate" />
                <Stat label="Expiring in 30 days" value={expiring.length} tone={expiring.length ? 'warn' : undefined} />
                <Stat label="Missing" value={missing.length} tone={missing.length ? 'warn' : undefined} sub="right to work, cards, contacts" />
              </div>
              <div className="grid grid-main mt">
                <Card title="To sort out">
                  {d.items.length === 0 ? (
                    <Empty icon="shield" title="Everyone's up to date" />
                  ) : (
                    <div className="table-wrap">
                      <table className="t responsive">
                        <thead>
                          <tr>
                            <th>Worker</th>
                            <th>What</th>
                            <th>Expiry</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.items.map((i: any, n: number) => (
                            <tr key={n}>
                              <td data-label="Worker">
                                <Link to={`/workers/${i.workerId}`} style={{ fontWeight: 650 }}>
                                  {i.name}
                                </Link>
                                <div className="tiny muted">{i.trade}</div>
                              </td>
                              <td data-label="What">{i.what}</td>
                              <td data-label="Expiry" className="nowrap">
                                {i.expiry ? (
                                  <>
                                    {fmtDate(i.expiry)}
                                    <div className="tiny muted">
                                      {i.status === 'expired' ? `${daysBetween(i.expiry, d.today)} days ago` : `in ${daysBetween(d.today, i.expiry)} days`}
                                    </div>
                                  </>
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td data-label="Status">
                                <CardBadge status={i.status} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
                <div className="stack">
                  <Card title="At the gate" sub="What happens when someone with an expired card scans in. Change it per client in Clients & sites.">
                    <ul className="list">
                      {d.clients.map((c: any) => (
                        <li key={c.id}>
                          <span className="grow">{c.name}</span>
                          {c.compliance_mode === 'block' ? <span className="badge badge-red">Blocked</span> : <span className="badge badge-amber">Warned, let in</span>}
                        </li>
                      ))}
                    </ul>
                  </Card>
                  <Card title="Stopped at the gate">
                    {d.blocked.length === 0 ? (
                      <p className="card-pad small muted" style={{ margin: 0 }}>
                        Nobody has been blocked.
                      </p>
                    ) : (
                      <ul className="list">
                        {d.blocked.map((b: any) => (
                          <li key={b.id}>
                            <div className="grow">
                              <div className="title small">
                                {b.first_name} {b.last_name}
                              </div>
                              <div className="tiny muted">
                                {b.site_name} · {fmtDateTime(b.at)}
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                </div>
              </div>
            </>
          );
        }}
      </Async>
    </>
  );
}
