import { useMemo, useState } from 'react';
import { useApi } from '../api';
import { Icon } from '../icons';
import { Async, Card, Empty, PageHead, Stat, useQueryState, WeekPicker } from '../ui';
import { fmtDay, fmtHours, fmtMoney } from '../../shared/format';
import { addDays, londonDate, mondayOf } from '../../shared/time';
import { marginPctOf } from '../util';

export default function Payroll() {
  const [tab, setTab] = useQueryState('tab', 'payroll');
  return (
    <>
      <PageHead title="Payroll & margins" sub="What you pay, what you charge, and what you keep.">
        <div className="seg" role="tablist">
          <button role="tab" aria-selected={tab === 'payroll'} className={tab === 'payroll' ? 'on' : ''} onClick={() => setTab('payroll')}>
            Payroll export
          </button>
          <button role="tab" aria-selected={tab === 'margins'} className={tab === 'margins' ? 'on' : ''} onClick={() => setTab('margins')}>
            Margins
          </button>
        </div>
      </PageHead>
      {tab === 'payroll' ? <PayrollTab /> : <MarginsTab />}
    </>
  );
}

function PayrollTab() {
  const [week, setWeek] = useQueryState('week', addDays(mondayOf(londonDate()), -7));
  const state = useApi<any>(`/api/payroll?week=${week}`);
  return (
    <Async state={state} rows={8}>
      {(d) => (
        <>
          <div className="spread" style={{ marginBottom: 16 }}>
            <WeekPicker week={week} onChange={setWeek} />
            <a className={`btn btn-primary ${d.rows.length ? '' : 'disabled'}`} href={d.rows.length ? `/api/payroll.csv?week=${week}` : undefined} aria-disabled={!d.rows.length}>
              <Icon name="download" /> Download CSV
            </a>
          </div>
          {d.pendingSites.length > 0 && (
            <div className="note-box" style={{ marginBottom: 16 }}>
              Not included yet, because the client hasn't approved them: <strong>{d.pendingSites.join(', ')}</strong>. Only approved hours are paid.
            </div>
          )}
          <div className="grid grid-3">
            <Stat label="Workers to pay" value={d.rows.length} />
            <Stat label="Hours" value={fmtHours(d.rows.reduce((s: number, r: any) => s + r.normalMins + r.otMins, 0))} sub={`${fmtHours(d.rows.reduce((s: number, r: any) => s + r.otMins, 0))} overtime`} />
            <Stat label="Gross pay" value={fmtMoney(d.totalGross)} sub={`week ending ${fmtDay(addDays(week, 6))}`} />
          </div>
          <Card className="mt" title="Pay run" sub="Simple CSV: payroll ref, name, NI number, hours, rates and gross pay. Opens in Sage, BrightPay, Moneysoft or a spreadsheet.">
            {d.rows.length === 0 ? (
              <Empty icon="pound" title="Nothing approved for this week" />
            ) : (
              <div className="table-wrap">
                <table className="t responsive">
                  <thead>
                    <tr>
                      <th>Ref</th>
                      <th>Name</th>
                      <th>NI number</th>
                      <th className="num">Basic hrs</th>
                      <th className="num">Rate</th>
                      <th className="num">O/T hrs</th>
                      <th className="num">O/T rate</th>
                      <th className="num">Gross</th>
                      <th>Sites</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((r: any) => (
                      <tr key={r.payrollRef}>
                        <td data-label="Ref" className="muted">
                          {r.payrollRef}
                        </td>
                        <td data-label="Name">
                          <strong>
                            {r.firstName} {r.lastName}
                          </strong>
                        </td>
                        <td data-label="NI number" className="muted">
                          {r.niNumber || '—'}
                        </td>
                        <td data-label="Basic hrs" className="num">
                          {fmtHours(r.normalMins)}
                        </td>
                        <td data-label="Rate" className="num">
                          {fmtMoney(r.payRate)}
                        </td>
                        <td data-label="O/T hrs" className="num">
                          {r.otMins ? fmtHours(r.otMins) : '–'}
                        </td>
                        <td data-label="O/T rate" className="num">
                          {fmtMoney(r.otPayRate)}
                        </td>
                        <td data-label="Gross" className="num">
                          <strong>{fmtMoney(r.grossPence)}</strong>
                        </td>
                        <td data-label="Sites" className="small muted">
                          {r.sites}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={7}>Total</td>
                      <td className="num">{fmtMoney(d.totalGross)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </Async>
  );
}

function MarginsTab() {
  const state = useApi<any>('/api/margins?weeks=6');
  const [by, setBy] = useState<'site' | 'client' | 'week'>('site');
  return (
    <Async state={state} rows={8}>
      {(d) => <MarginTable data={d} by={by} setBy={setBy} />}
    </Async>
  );
}

function MarginTable({ data, by, setBy }: { data: any; by: 'site' | 'client' | 'week'; setBy: (b: 'site' | 'client' | 'week') => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, { label: string; sub: string; mins: number; charge: number; pay: number; weeks: Map<string, { charge: number; pay: number }> }>();
    for (const r of data.rows) {
      const key = by === 'site' ? `s${r.siteId}` : by === 'client' ? `c${r.clientId}` : r.weekStart;
      const label = by === 'site' ? r.siteName : by === 'client' ? r.clientName : `w/c ${fmtDay(r.weekStart)}`;
      const sub = by === 'site' ? r.clientName : '';
      const g = m.get(key) ?? { label, sub, mins: 0, charge: 0, pay: 0, weeks: new Map() };
      g.mins += r.mins;
      g.charge += r.chargePence;
      g.pay += r.payPence;
      const wk = g.weeks.get(r.weekStart) ?? { charge: 0, pay: 0 };
      wk.charge += r.chargePence;
      wk.pay += r.payPence;
      g.weeks.set(r.weekStart, wk);
      m.set(key, g);
    }
    return [...m.values()];
  }, [data, by]);
  const tot = groups.reduce((a, g) => ({ mins: a.mins + g.mins, charge: a.charge + g.charge, pay: a.pay + g.pay }), { mins: 0, charge: 0, pay: 0 });
  return (
    <>
      <div className="grid grid-4">
        <Stat label="Charged (6 weeks)" value={fmtMoney(tot.charge)} sub="before VAT" />
        <Stat label="Paid to workers" value={fmtMoney(tot.pay)} />
        <Stat label="Margin" value={fmtMoney(tot.charge - tot.pay)} />
        <Stat label="Margin %" value={`${marginPctOf(tot.charge, tot.pay)}%`} sub={`${fmtHours(tot.mins)} hours`} />
      </div>
      <Card
        className="mt"
        title="Margin by"
        actions={
          <div className="seg" role="tablist">
            {(['site', 'client', 'week'] as const).map((b) => (
              <button key={b} role="tab" aria-selected={by === b} className={by === b ? 'on' : ''} onClick={() => setBy(b)}>
                {b[0].toUpperCase() + b.slice(1)}
              </button>
            ))}
          </div>
        }
      >
        <div className="table-wrap">
          <table className="t responsive">
            <thead>
              <tr>
                <th>{by[0].toUpperCase() + by.slice(1)}</th>
                <th className="num">Hours</th>
                <th className="num">Charge</th>
                <th className="num">Pay</th>
                <th className="num">Margin</th>
                <th className="num">Margin %</th>
                {by !== 'week' && <th>Weekly margin %</th>}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.label}>
                  <td data-label={by}>
                    <strong>{g.label}</strong>
                    {g.sub && <div className="tiny muted">{g.sub}</div>}
                  </td>
                  <td data-label="Hours" className="num">
                    {fmtHours(g.mins)}
                  </td>
                  <td data-label="Charge" className="num">
                    {fmtMoney(g.charge)}
                  </td>
                  <td data-label="Pay" className="num">
                    {fmtMoney(g.pay)}
                  </td>
                  <td data-label="Margin" className="num">
                    <strong>{fmtMoney(g.charge - g.pay)}</strong>
                  </td>
                  <td data-label="Margin %" className="num">
                    {marginPctOf(g.charge, g.pay)}%
                  </td>
                  {by !== 'week' && (
                    <td data-label="Weekly">
                      <div className="row" style={{ gap: 3, flexWrap: 'nowrap' }} aria-label="Margin percentage each week">
                        {data.weeks.map((w: string) => {
                          const x = g.weeks.get(w);
                          const pct = x ? Number(marginPctOf(x.charge, x.pay)) : null;
                          return (
                            <span
                              key={w}
                              title={`w/c ${fmtDay(w)}: ${pct == null ? 'no hours' : `${pct}%`}`}
                              className="tiny"
                              style={{ minWidth: 36, textAlign: 'center', padding: '2px 0', borderRadius: 4, background: pct == null ? '#f3f2ee' : `color-mix(in srgb, var(--brand) ${Math.min(100, Math.max(12, pct * 3))}%, white)`, color: pct != null && pct > 20 ? '#fff' : 'var(--ink)' }}
                            >
                              {pct == null ? '–' : `${Math.round(pct)}%`}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="num">{fmtHours(tot.mins)}</td>
                <td className="num">{fmtMoney(tot.charge)}</td>
                <td className="num">{fmtMoney(tot.pay)}</td>
                <td className="num">{fmtMoney(tot.charge - tot.pay)}</td>
                <td className="num">{marginPctOf(tot.charge, tot.pay)}%</td>
                {by !== 'week' && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="small muted card-pad" style={{ margin: 0 }}>
          The current week is worked out live from sign-ins; earlier weeks use the figures the client approved.
        </p>
      </Card>
    </>
  );
}
