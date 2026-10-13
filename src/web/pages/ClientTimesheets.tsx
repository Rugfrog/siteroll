import { Link } from 'react-router-dom';
import { useApi } from '../api';
import { Async, Card, Empty, PageHead, TimesheetStatus, useQueryState, WeekPicker } from '../ui';
import { fmtDateTime, fmtDay, fmtHours } from '../../shared/format';
import { addDays, londonDate, mondayOf } from '../../shared/time';

export default function ClientTimesheets() {
  const pending = useApi<any[]>('/api/timesheets-pending');
  const [week, setWeek] = useQueryState('week', addDays(mondayOf(londonDate()), -7));
  const all = useApi<any>(`/api/timesheets?week=${week}`);
  return (
    <>
      <PageHead title="Timesheets" sub="Approve the week's hours in one tap, or query anything that doesn't look right." />
      <Card title="Waiting for you">
        <Async state={pending}>
          {(rows) =>
            rows.length === 0 ? (
              <Empty icon="check" title="Nothing to approve">
                You're all caught up.
              </Empty>
            ) : (
              <ul className="list">
                {rows.map((t) => (
                  <li key={t.id}>
                    <div className="grow">
                      <div className="title">{t.siteName}</div>
                      <div className="small muted">
                        Week {fmtDay(t.weekStart)} – {fmtDay(addDays(t.weekStart, 6))} · {t.workers} workers, {fmtHours(t.mins)} hours
                        {t.sentAt ? ` · sent ${fmtDateTime(t.sentAt)}` : ''}
                      </div>
                    </div>
                    {t.status === 'queried' ? <TimesheetStatus status="queried" /> : null}
                    <Link to={`/client/timesheets/${t.id}`} className="btn btn-primary">
                      Review
                    </Link>
                  </li>
                ))}
              </ul>
            )
          }
        </Async>
      </Card>

      <Card className="mt" title="All weeks" actions={<WeekPicker week={week} onChange={setWeek} />}>
        <Async state={all}>
          {(d) =>
            d.timesheets.length === 0 ? (
              <Empty icon="clipboard" title="No hours this week" />
            ) : (
              <ul className="list">
                {d.timesheets.map((t: any) => (
                  <li key={t.id}>
                    <div className="grow">
                      <div className="title">{t.siteName}</div>
                      <div className="small muted">
                        {t.totals.workers} workers · {fmtHours(t.totals.totalMins)} hours
                        {t.approvedAt ? ` · approved by ${t.approvedBy} ${fmtDateTime(t.approvedAt)}` : ''}
                      </div>
                    </div>
                    <TimesheetStatus status={t.status} />
                    <Link to={`/client/timesheets/${t.id}`} className="btn btn-sm">
                      Open
                    </Link>
                    <a href={`/api/timesheets/${t.id}/pdf?as=manager`} className="btn btn-sm">
                      PDF
                    </a>
                  </li>
                ))}
              </ul>
            )
          }
        </Async>
      </Card>
    </>
  );
}
