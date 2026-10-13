import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApi } from '../api';
import { Icon } from '../icons';
import { Async, Avatar, Card, CardBadge, Empty, PageHead } from '../ui';
import { fmtMoney, fmtPhone } from '../../shared/format';

export default function Workers() {
  const state = useApi<any[]>('/api/workers');
  const [search, setSearch] = useState('');
  const [trade, setTrade] = useState('');
  const [showLeft, setShowLeft] = useState(false);
  const navigate = useNavigate();
  return (
    <>
      <PageHead title="Workers" sub="Everyone on your books, with their rates and card status.">
        <Link to="/workers/new" className="btn btn-primary">
          <Icon name="plus" /> Add worker
        </Link>
      </PageHead>
      <Async state={state} rows={10}>
        {(rows) => {
          const trades = [...new Set(rows.map((w) => w.trade))].sort();
          const needle = search.trim().toLowerCase();
          const matches = (w: any) => !needle || `${w.name} ${w.trade}`.toLowerCase().includes(needle) || w.phone.includes(needle.replace(/\s/g, ''));
          const list = rows.filter((w) => (showLeft || w.active) && (!trade || w.trade === trade) && matches(w));
          return (
            <Card
              title={`${list.length} ${list.length === 1 ? 'worker' : 'workers'}`}
              actions={
                <>
                  <input className="input" style={{ width: 200 }} placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search workers" />
                  <select className="select" style={{ width: 'auto' }} value={trade} onChange={(e) => setTrade(e.target.value)} aria-label="Trade">
                    <option value="">All trades</option>
                    {trades.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                  <label className="check small">
                    <input type="checkbox" checked={showLeft} onChange={(e) => setShowLeft(e.target.checked)} /> Show leavers
                  </label>
                </>
              }
            >
              {list.length === 0 ? (
                <Empty icon="users" title="Nobody matches" />
              ) : (
                <div className="table-wrap">
                  <table className="t responsive">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Trade</th>
                        <th>Mobile</th>
                        <th className="num">Pay</th>
                        <th className="num">Charge</th>
                        <th>Card</th>
                        <th>Right to work</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((w) => (
                        <tr key={w.id} className="clickable" onClick={() => navigate(`/workers/${w.id}`)}>
                          <td data-label="Name">
                            <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
                              <Avatar name={w.name} />
                              <Link to={`/workers/${w.id}`} onClick={(e) => e.stopPropagation()} style={{ fontWeight: 650, textDecoration: 'none' }}>
                                {w.name}
                              </Link>
                              {!w.active && <span className="badge">Left</span>}
                            </div>
                          </td>
                          <td data-label="Trade">{w.trade}</td>
                          <td data-label="Mobile" className="nowrap">
                            {fmtPhone(w.phone)}
                          </td>
                          <td data-label="Pay" className="num">
                            {fmtMoney(w.payRate)}/h
                          </td>
                          <td data-label="Charge" className="num">
                            {fmtMoney(w.chargeRate)}/h
                          </td>
                          <td data-label="Card">
                            <span className="row" style={{ gap: 6 }}>
                              <span className="small muted">{w.cardScheme}</span> <CardBadge status={w.card} />
                            </span>
                          </td>
                          <td data-label="Right to work">{w.rtw ? <span className="badge badge-green">Checked</span> : <span className="badge badge-red">Not checked</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          );
        }}
      </Async>
    </>
  );
}
