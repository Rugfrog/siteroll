import { Link } from 'react-router-dom';
import { useApi } from '../api';
import { Async, Card, Empty, PageHead } from '../ui';
import { fmtDateTime, fmtTime } from '../../shared/format';

export default function RollCallHistory() {
  const state = useApi<any[]>('/api/rollcalls');
  return (
    <>
      <PageHead title="Fire roll calls" sub="Every drill and incident, with who was accounted for and when. Start a new one from the live board." />
      <Card>
        <Async state={state}>
          {(rows) =>
            rows.length === 0 ? (
              <Empty icon="flame" title="No roll calls yet">
                Press <strong>Fire roll call</strong> on the live board to run a drill.
              </Empty>
            ) : (
              <div className="table-wrap">
                <table className="t responsive">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Site</th>
                      <th>Type</th>
                      <th>Run by</th>
                      <th className="num">Accounted for</th>
                      <th className="num">Took</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td data-label="When" className="nowrap">
                          <Link to={`/rollcall/${r.id}`}>{fmtDateTime(r.startedAt)}</Link>
                        </td>
                        <td data-label="Site">{r.siteName}</td>
                        <td data-label="Type">{r.kind === 'incident' ? <span className="badge badge-red">Incident</span> : <span className="badge">Drill</span>}</td>
                        <td data-label="Run by">{r.startedBy}</td>
                        <td data-label="Accounted for" className="num">
                          {r.safe === r.total ? (
                            <span className="badge badge-green">
                              {r.safe} of {r.total}
                            </span>
                          ) : (
                            <span className="badge badge-red">
                              {r.safe} of {r.total}
                            </span>
                          )}
                        </td>
                        <td data-label="Took" className="num">
                          {r.finishedAt ? `${Math.max(1, Math.round((new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) / 60000))} min` : <span className="badge badge-amber">Running since {fmtTime(r.startedAt)}</span>}
                        </td>
                        <td className="num">
                          <a className="btn btn-sm" href={`/api/rollcalls/${r.id}/pdf`}>
                            PDF
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </Async>
      </Card>
    </>
  );
}
