import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, useApi } from '../api';
import { Icon } from '../icons';
import { ActionButton, Async, Card, Empty, InvoiceStatus, Loading, Modal, PageHead, Stat, useToast } from '../ui';
import { fmtDate, fmtDay, fmtHours, fmtMoney } from '../../shared/format';
import { addDays } from '../../shared/time';

export default function Invoices() {
  const { id } = useParams();
  const state = useApi<any>('/api/invoices');
  const navigate = useNavigate();
  const toast = useToast();

  return (
    <>
      <PageHead title="Invoices" sub="Made from approved timesheets: hours × charge rate, overtime, VAT at 20%." />
      <Async state={state} rows={8}>
        {(d) => {
          const unpaid = d.invoices.filter((i: any) => i.displayStatus !== 'paid');
          const overdue = d.invoices.filter((i: any) => i.displayStatus === 'overdue');
          return (
            <>
              <div className="grid grid-3">
                <Stat label="Outstanding" value={fmtMoney(unpaid.reduce((s: number, i: any) => s + i.gross_pence, 0))} sub={`${unpaid.length} ${unpaid.length === 1 ? 'invoice' : 'invoices'}`} />
                <Stat label="Overdue" value={fmtMoney(overdue.reduce((s: number, i: any) => s + i.gross_pence, 0))} sub={`${overdue.length} ${overdue.length === 1 ? 'invoice' : 'invoices'}`} tone={overdue.length ? 'bad' : undefined} />
                <Stat label="Ready to invoice" value={d.ready.length} sub={d.ready.length ? fmtMoney(d.ready.reduce((s: number, r: any) => s + r.chargePence, 0)) + ' + VAT' : 'nothing waiting'} tone={d.ready.length ? 'warn' : undefined} />
              </div>

              {d.ready.length > 0 && (
                <Card className="mt" title="Ready to invoice" sub="Approved by the client, not invoiced yet.">
                  <ul className="list">
                    {d.ready.map((r: any) => (
                      <li key={`${r.clientId}-${r.weekStart}`}>
                        <div className="grow">
                          <div className="title">{r.clientName}</div>
                          <div className="small muted">
                            Week {fmtDay(r.weekStart)} – {fmtDay(addDays(r.weekStart, 6))} · {r.sites} {r.sites === 1 ? 'site' : 'sites'}
                          </div>
                        </div>
                        <strong className="num">{fmtMoney(r.chargePence)}</strong>
                        <ActionButton
                          className="btn btn-primary btn-sm"
                          onClick={async () => {
                            const inv = await api.post('/api/invoices', { clientId: r.clientId, week: r.weekStart });
                            toast(`${inv.number} created and emailed to ${r.clientName}`);
                            await state.reload();
                            navigate(`/invoices/${inv.id}`);
                          }}
                        >
                          Create invoice
                        </ActionButton>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}

              <Card className="mt" title="All invoices">
                {d.invoices.length === 0 ? (
                  <Empty icon="receipt" title="No invoices yet">
                    Once a client approves a timesheet, you can invoice it here.
                  </Empty>
                ) : (
                  <div className="table-wrap">
                    <table className="t responsive">
                      <thead>
                        <tr>
                          <th>Number</th>
                          <th>Client</th>
                          <th>Week</th>
                          <th>Issued</th>
                          <th>Due</th>
                          <th className="num">Total</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.invoices.map((i: any) => (
                          <tr key={i.id} className="clickable" onClick={() => navigate(`/invoices/${i.id}`)}>
                            <td data-label="Number">
                              <Link to={`/invoices/${i.id}`} onClick={(e) => e.stopPropagation()}>
                                <strong>{i.number}</strong>
                              </Link>
                            </td>
                            <td data-label="Client">{i.client_name}</td>
                            <td data-label="Week" className="nowrap">
                              w/c {fmtDay(i.week_start)}
                            </td>
                            <td data-label="Issued" className="nowrap">
                              {fmtDate(i.issued_on)}
                            </td>
                            <td data-label="Due" className="nowrap">
                              {fmtDate(i.due_on)}
                            </td>
                            <td data-label="Total" className="num">
                              <strong>{fmtMoney(i.gross_pence)}</strong>
                            </td>
                            <td data-label="Status">
                              <InvoiceStatus status={i.displayStatus} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
              {id && <InvoiceModal id={Number(id)} onClose={() => navigate('/invoices')} onChange={state.reload} />}
            </>
          );
        }}
      </Async>
    </>
  );
}

function InvoiceModal({ id, onClose, onChange }: { id: number; onClose: () => void; onChange: () => void }) {
  const state = useApi<any>(`/api/invoices/${id}`);
  const inv = state.data;
  const bySite = new Map<string, any[]>();
  for (const l of inv?.lines ?? []) {
    if (!bySite.has(l.site_name)) bySite.set(l.site_name, []);
    bySite.get(l.site_name)!.push(l);
  }
  return (
    <Modal
      title={inv ? `Invoice ${inv.number}` : 'Invoice'}
      onClose={onClose}
      wide
      footer={
        inv && (
          <>
            {inv.displayStatus !== 'paid' ? (
              <ActionButton
                className="btn"
                onClick={async () => {
                  await api.post(`/api/invoices/${id}/status`, { status: 'paid' });
                  await state.reload();
                  onChange();
                }}
                done="Marked as paid"
              >
                <Icon name="check" /> Mark as paid
              </ActionButton>
            ) : (
              <ActionButton
                className="btn btn-ghost"
                onClick={async () => {
                  await api.post(`/api/invoices/${id}/status`, { status: 'sent' });
                  await state.reload();
                  onChange();
                }}
              >
                Mark as unpaid
              </ActionButton>
            )}
            <a className="btn" href={`/api/invoices/${id}/pdf?inline=1`} target="_blank" rel="noopener">
              View PDF
            </a>
            <a className="btn btn-primary" href={`/api/invoices/${id}/pdf`}>
              <Icon name="download" /> Download PDF
            </a>
          </>
        )
      }
    >
      {!inv ? (
        <Loading />
      ) : (
        <div className="stack">
          <div className="spread">
            <div>
              <div className="title" style={{ fontWeight: 700, fontSize: '1.1rem' }}>
                {inv.client_name}
              </div>
              <div className="small muted">
                Week commencing {fmtDate(inv.week_start)} · issued {fmtDate(inv.issued_on)} · due {fmtDate(inv.due_on)}
              </div>
            </div>
            <InvoiceStatus status={inv.displayStatus} />
          </div>
          <div className="table-wrap card">
            <table className="t">
              <thead>
                <tr>
                  <th>Description</th>
                  <th className="num">Hours</th>
                  <th className="num">Rate</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              {[...bySite].map(([site, lines]) => (
                <tbody key={site}>
                  <tr>
                    <td colSpan={4} style={{ background: '#fbfaf8', fontWeight: 650 }}>
                      {site}
                    </td>
                  </tr>
                  {lines.map((l: any) => (
                    <tr key={l.id}>
                      <td>{l.description}</td>
                      <td className="num">{fmtHours(l.minutes)}</td>
                      <td className="num">{fmtMoney(l.rate_pence)}</td>
                      <td className="num">{fmtMoney(l.amount_pence)}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
              <tfoot>
                <tr>
                  <td colSpan={3} className="num">
                    Net
                  </td>
                  <td className="num">{fmtMoney(inv.net_pence)}</td>
                </tr>
                <tr>
                  <td colSpan={3} className="num">
                    VAT at 20%
                  </td>
                  <td className="num">{fmtMoney(inv.vat_pence)}</td>
                </tr>
                <tr>
                  <td colSpan={3} className="num">
                    Total due
                  </td>
                  <td className="num" style={{ fontSize: '1.1rem' }}>
                    {fmtMoney(inv.gross_pence)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          {inv.paid_on && <div className="ok-box">Paid on {fmtDate(inv.paid_on)}.</div>}
        </div>
      )}
    </Modal>
  );
}
