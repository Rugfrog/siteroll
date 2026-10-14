import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApi, useLiveRefresh } from '../api';
import { BarChart } from '../Chart';
import { Icon } from '../icons';
import { Async, Card, Empty, PageHead, Stat } from '../ui';
import { fmtDate, fmtDay, fmtDayLong, fmtHours, fmtMoney, fmtTime } from '../../shared/format';
import { greeting, marginPctOf } from '../util';
import { useMe } from '../App';
import { AlertList } from './Live';

export default function Home() {
  const state = useApi<any>('/api/dashboard');
  useLiveRefresh(state.reload);
  const [table, setTable] = useState(false);
  const { me } = useMe();
  return (
    <Async state={state} rows={8}>
      {(d) => {
        const onSiteTotal = d.onSite.reduce((s: number, x: any) => s + x.n, 0);
        const noShows = d.alerts.filter((a: any) => a.type === 'no_show');
        const marginPence = d.week.chargePence - d.week.payPence;
        return (
          <>
            <PageHead eyebrow={fmtDayLong(d.today)} title={greeting(me.user?.name)} sub="Here's what's happening across your sites today.">
              <Link to="/live" className="btn btn-primary">
                <Icon name="live" /> Live board
              </Link>
            </PageHead>

            <AskBar />

            <h2 className="sr-only">Today</h2>
            <div className="grid grid-4">
              <Stat label="On site now" value={onSiteTotal} sub={`across ${d.onSite.filter((s: any) => s.n > 0).length} sites`} href="/live" />
              <Stat label="No-shows" value={noShows.length} sub={noShows.length ? 'need a replacement?' : 'everyone booked is in'} tone={noShows.length ? 'bad' : undefined} href="/live" />
              <Stat
                label="Still signed in after hours"
                value={d.afterHours.length}
                sub={d.afterHours.length ? d.afterHours.slice(0, 2).map((a: any) => `${a.first_name} ${a.last_name}`).join(', ') : 'nobody'}
                tone={d.afterHours.length ? 'warn' : undefined}
                href="/live"
              />
              <Stat label="Compliance warnings" value={d.compliance.length} sub="cards expired or expiring in 30 days" tone={d.compliance.some((c: any) => c.status === 'expired') ? 'bad' : d.compliance.length ? 'warn' : undefined} href="/compliance" />
            </div>

            <div className="grid grid-main mt">
              <div className="stack">
                <Card title="On site now" sub="Signed in vs booked today" actions={<Link to="/live" className="btn btn-sm">Open live board</Link>}>
                  {d.onSite.length === 0 && <GettingStarted />}
                  <ul className="list">
                    {d.onSite.map((s: any) => (
                      <li key={s.id}>
                        <div className="grow">
                          <div className="title">{s.name}</div>
                          <div className="small muted">{s.client_name}</div>
                        </div>
                        <div style={{ width: 140 }} aria-hidden="true" className="hide-mobile">
                          <div style={{ height: 8, background: '#ecebe6', borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${s.booked ? Math.min(100, (s.n / s.booked) * 100) : s.n ? 100 : 0}%`, background: 'var(--brand)', borderRadius: 4 }} />
                          </div>
                        </div>
                        <div className="num" style={{ minWidth: 90 }}>
                          <span className="big-count" style={{ fontSize: '1.5rem' }}>{s.n}</span> <span className="muted small">/ {s.booked} booked</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>

                <Card
                  title="Last 6 weeks"
                  sub="Hours worked and margin by week. This week so far is shown lighter."
                  actions={
                    <button className="btn btn-sm" onClick={() => setTable(!table)} aria-pressed={table}>
                      {table ? 'Show charts' : 'Show as table'}
                    </button>
                  }
                >
                  {table ? (
                    <div className="table-wrap">
                      <table className="t">
                        <thead>
                          <tr>
                            <th>Week commencing</th>
                            <th className="num">Hours</th>
                            <th className="num">Charged</th>
                            <th className="num">Paid</th>
                            <th className="num">Margin</th>
                            <th className="num">Margin %</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.chart.map((w: any) => (
                            <tr key={w.weekStart}>
                              <td>{fmtDate(w.weekStart)}</td>
                              <td className="num">{fmtHours(w.mins)}</td>
                              <td className="num">{fmtMoney(w.chargePence)}</td>
                              <td className="num">{fmtMoney(w.payPence)}</td>
                              <td className="num">{fmtMoney(w.marginPence)}</td>
                              <td className="num">{marginPctOf(w.chargePence, w.payPence)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="grid grid-2 card-pad">
                      <div>
                        <h3 className="small">Hours worked</h3>
                        <BarChart
                          title="Hours worked per week"
                          format={(v) => `${Math.round(v)}`}
                          bars={d.chart.map((w: any, i: number) => ({
                            key: w.weekStart,
                            label: fmtDay(w.weekStart).slice(4),
                            value: w.mins / 60,
                            display: `${fmtHours(w.mins)} hours`,
                            muted: i === d.chart.length - 1,
                          }))}
                        />
                      </div>
                      <div>
                        <h3 className="small">Margin (charge minus pay)</h3>
                        <BarChart
                          title="Margin per week"
                          minStep={10000}
                          format={(v) => (v >= 100000 ? `£${Math.round(v / 100000)}k` : `£${Math.round(v / 100)}`)}
                          bars={d.chart.map((w: any, i: number) => ({
                            key: w.weekStart,
                            label: fmtDay(w.weekStart).slice(4),
                            value: w.marginPence,
                            display: fmtMoney(w.marginPence),
                            detail: `${marginPctOf(w.chargePence, w.payPence)}% of ${fmtMoney(w.chargePence)}`,
                            muted: i === d.chart.length - 1,
                          }))}
                        />
                      </div>
                    </div>
                  )}
                </Card>
              </div>

              <div className="stack">
                <Card title="Needs attention" sub={d.alerts.length ? `${d.alerts.length} open` : undefined}>
                  {d.alerts.length ? <AlertList alerts={d.alerts.slice(0, 6)} onChange={state.reload} /> : <Empty icon="check" title="All clear">Nothing needs you right now.</Empty>}
                  {d.alerts.length > 6 && (
                    <div className="card-pad small">
                      <Link to="/live">See all {d.alerts.length} alerts</Link>
                    </div>
                  )}
                </Card>

                <Card title="This week">
                  <ul className="list">
                    <li>
                      <span className="grow">Hours worked so far</span>
                      <strong className="num">{fmtHours(d.week.mins)}</strong>
                    </li>
                    <li>
                      <span className="grow">Margin so far</span>
                      <strong className="num">
                        {fmtMoney(marginPence)} <span className="muted small">({marginPctOf(d.week.chargePence, d.week.payPence)}%)</span>
                      </strong>
                    </li>
                    <li>
                      <span className="grow">
                        <Link to="/timesheets">Timesheets waiting for the client</Link>
                        {d.awaiting.length > 0 && <div className="small muted">{d.awaiting.map((a: any) => `${a.site_name} (w/c ${fmtDay(a.week_start)})`).join(', ')}</div>}
                      </span>
                      <strong className="num">{d.awaiting.length}</strong>
                    </li>
                    <li>
                      <span className="grow">
                        <Link to="/invoices">Invoices overdue</Link>
                      </span>
                      <strong className="num" style={{ color: d.overdue.count ? 'var(--red)' : undefined }}>
                        {d.overdue.count} · {fmtMoney(d.overdue.pence)}
                      </strong>
                    </li>
                    <li>
                      <span className="grow">Money in this week</span>
                      <strong className="num">{fmtMoney(d.moneyIn.thisWeekPence)}</strong>
                    </li>
                    <li>
                      <span className="grow">Money in, last 30 days</span>
                      <strong className="num">{fmtMoney(d.moneyIn.last30Pence)}</strong>
                    </li>
                  </ul>
                </Card>

                {d.afterHours.length > 0 && (
                  <Card title="Still signed in after hours" sub="Past their site's usual finish time">
                    <ul className="list">
                      {d.afterHours.slice(0, 5).map((a: any) => (
                        <li key={a.id}>
                          <span className="grow">
                            <span className="title">
                              {a.first_name} {a.last_name}
                            </span>
                            <div className="small muted">
                              {a.site_name} · in since {fmtTime(a.in_at)}
                            </div>
                          </span>
                          <span className="badge badge-amber">Finish {a.finish_time}</span>
                        </li>
                      ))}
                    </ul>
                    {d.afterHours.length > 5 && (
                      <div className="card-pad small" style={{ borderTop: '1px solid var(--line-2)' }}>
                        <Link to="/live">and {d.afterHours.length - 5} more on the live board</Link>
                      </div>
                    )}
                  </Card>
                )}
              </div>
            </div>
          </>
        );
      }}
    </Async>
  );
}

/** Shown to a brand-new agency with no sites yet. */
function GettingStarted() {
  const steps: [string, string, string][] = [
    ['/settings', 'Add your details', 'Logo, colour, bank details and VAT number for invoices.'],
    ['/clients', 'Add a client', 'Their break and overtime rules, and who signs off timesheets.'],
    ['/sites/new', 'Add a site', 'Drop a pin, set the geofence, then print the QR poster for the site board.'],
    ['/workers/new', 'Add your workers', 'Name, mobile, trade, rates and CSCS card.'],
    ['/bookings', 'Book them on', "Drag workers onto sites. They'll scan the poster on day one."],
  ];
  return (
    <ol className="list">
      {steps.map(([to, title, text], i) => (
        <li key={to}>
          <span className="avatar" aria-hidden="true">
            {i + 1}
          </span>
          <div className="grow">
            <Link to={to} className="title">
              {title}
            </Link>
            <div className="small muted">{text}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** "Ask anything" box: opens Ask SiteRoll with the question. */
function AskBar() {
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  return (
    <form
      className="ask-bar"
      onSubmit={(e) => {
        e.preventDefault();
        navigate(q.trim() ? `/ask?q=${encodeURIComponent(q.trim())}` : '/ask');
      }}
    >
      <Icon name="sparkle" />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask SiteRoll anything, e.g. What was our margin last week?" aria-label="Ask SiteRoll a question" />
      <button className="btn btn-primary btn-sm">Ask</button>
    </form>
  );
}
