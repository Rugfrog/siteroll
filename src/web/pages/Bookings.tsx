// Bookings planner: drag workers onto a site and day (desktop), or tap a day to book (mobile).
import { useMemo, useState } from 'react';
import { api, useApi } from '../api';
import { Icon } from '../icons';
import { Async, Avatar, CardBadge, Empty, ErrorBox, Modal, PageHead, useQueryState, useToast, WeekPicker } from '../ui';
import { fmtDay, fmtDayLong } from '../../shared/format';
import { londonDate, mondayOf } from '../../shared/time';

interface Target {
  siteId: number;
  siteName: string;
  dates: string[];
}

export default function Bookings() {
  const [week, setWeek] = useQueryState('week', mondayOf(londonDate()));
  const state = useApi<any>(`/api/bookings?week=${week}`);
  const [target, setTarget] = useState<Target | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [trade, setTrade] = useState('');
  const [mobileDay, setMobileDay] = useState(() => {
    const t = londonDate();
    return mondayOf(t) === week ? t : week;
  });
  const toast = useToast();
  const today = londonDate();

  const book = async (workerId: number, siteId: number, dates: string[], label: string) => {
    try {
      await api.post('/api/bookings', { workerId, siteId, dates });
      toast(label);
      state.reload();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const remove = async (id: number) => {
    try {
      await api.del(`/api/bookings/${id}`);
      state.reload();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  return (
    <>
      <PageHead title="Bookings" sub="Who's going where. Drag a worker onto a day, or onto a site's name to book the whole week. On a phone, tap a day.">
        <WeekPicker week={week} onChange={setWeek} />
      </PageHead>
      <Async state={state} rows={8}>
        {(d) => {
          const trades = [...new Set<string>(d.workers.map((w: any) => w.trade))].sort();
          const bookedDays = new Map<number, number>();
          for (const b of d.bookings) if (b.status === 'booked') bookedDays.set(b.workerId, (bookedDays.get(b.workerId) ?? 0) + 1);
          const pool = d.workers.filter((w: any) => (!trade || w.trade === trade) && w.name.toLowerCase().includes(search.toLowerCase()));
          const weekdays = d.days.slice(0, 5);
          const cell = (siteId: number, date: string) => d.bookings.filter((b: any) => b.siteId === siteId && b.date === date);
          const onDrop = (e: React.DragEvent, siteId: number, siteName: string, dates: string[]) => {
            e.preventDefault();
            setOver(null);
            const workerId = Number(e.dataTransfer.getData('text/worker'));
            const w = d.workers.find((x: any) => x.id === workerId);
            if (!w) return;
            book(workerId, siteId, dates, `${w.name} booked at ${siteName} ${dates.length > 1 ? 'Mon–Fri' : fmtDay(dates[0])}`);
          };
          return (
            <>
              {/* Desktop planner */}
              <div className="planner planner-desktop">
                <aside className="card planner-pool" aria-label="Workers">
                  <div className="card-pad stack" style={{ gap: 8, paddingBottom: 10 }}>
                    <input className="input" placeholder="Search workers" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search workers" />
                    <select className="select" value={trade} onChange={(e) => setTrade(e.target.value)} aria-label="Filter by trade">
                      <option value="">All trades</option>
                      {trades.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <div className="pool-list">
                    {pool.map((w: any) => (
                      <div
                        key={w.id}
                        className="pool-worker"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/worker', String(w.id));
                          e.dataTransfer.effectAllowed = 'copy';
                        }}
                        title="Drag onto a day"
                      >
                        <Avatar name={w.name} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600 }}>{w.name}</div>
                          <div className="tiny muted">
                            {w.trade} · {bookedDays.get(w.id) ? `${bookedDays.get(w.id)} days booked` : 'free all week'}
                          </div>
                        </div>
                        {w.card !== 'ok' && <CardBadge status={w.card} />}
                      </div>
                    ))}
                  </div>
                </aside>
                <div className="card" style={{ overflowX: 'auto' }}>
                  <div className="week-grid" role="grid" aria-label="Bookings by site and day">
                    <div className="cell head">Site</div>
                    {d.days.map((day: string) => (
                      <div key={day} className={`cell head ${day === today ? 'today' : ''}`}>
                        {fmtDay(day)}
                      </div>
                    ))}
                    {d.sites.map((s: any) => (
                      <SiteRow key={s.id}>
                        <div
                          className={`cell site-cell drop ${over === `s${s.id}` ? 'over' : ''}`}
                          onDragOver={(e) => {
                            e.preventDefault();
                            setOver(`s${s.id}`);
                          }}
                          onDragLeave={() => setOver(null)}
                          onDrop={(e) => onDrop(e, s.id, s.name, weekdays)}
                          title="Drop here to book Mon–Fri"
                        >
                          {s.name}
                          <div className="tiny muted" style={{ fontWeight: 400 }}>
                            {s.clientName}
                          </div>
                          <div className="tiny muted" style={{ fontWeight: 400, marginTop: 6 }}>
                            Drop here for the whole week
                          </div>
                        </div>
                        {d.days.map((day: string) => {
                          const key = `${s.id}-${day}`;
                          return (
                            <div
                              key={day}
                              className={`cell drop ${over === key ? 'over' : ''} ${day < today ? 'past' : ''}`}
                              onDragOver={(e) => {
                                e.preventDefault();
                                setOver(key);
                              }}
                              onDragLeave={() => setOver(null)}
                              onDrop={(e) => onDrop(e, s.id, s.name, [day])}
                              onClick={(e) => {
                                if ((e.target as HTMLElement).closest('button')) return;
                                setTarget({ siteId: s.id, siteName: s.name, dates: [day] });
                              }}
                              onKeyDown={(e) => e.key === 'Enter' && setTarget({ siteId: s.id, siteName: s.name, dates: [day] })}
                              tabIndex={0}
                              role="gridcell"
                              aria-label={`${s.name}, ${fmtDay(day)}: ${cell(s.id, day).length} booked. Press Enter to book someone.`}
                            >
                              {cell(s.id, day).map((b: any) => (
                                <div key={b.id} className={`booking ${b.status === 'no_show' ? 'no-show' : ''}`} title={`${b.name} · ${b.trade}${b.status === 'no_show' ? ' · no-show' : ''}`}>
                                  <span>{b.name}</span>
                                  <button onClick={() => remove(b.id)} aria-label={`Remove ${b.name}`}>
                                    ×
                                  </button>
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </SiteRow>
                    ))}
                  </div>
                </div>
              </div>

              {/* Mobile planner: one day at a time */}
              <div className="planner-mobile stack">
                <div className="seg" style={{ display: 'flex', overflowX: 'auto' }} role="tablist" aria-label="Day">
                  {d.days.map((day: string) => (
                    <button key={day} role="tab" aria-selected={mobileDay === day} className={mobileDay === day ? 'on' : ''} onClick={() => setMobileDay(day)} style={{ flex: 1 }}>
                      {fmtDay(day).slice(0, 3)}
                      <br />
                      <span className="tiny">{fmtDay(day).slice(4)}</span>
                    </button>
                  ))}
                </div>
                <h2 style={{ fontSize: '1rem' }}>{fmtDayLong(d.days.includes(mobileDay) ? mobileDay : d.days[0])}</h2>
                {d.sites.map((s: any) => {
                  const day = d.days.includes(mobileDay) ? mobileDay : d.days[0];
                  const list = cell(s.id, day);
                  return (
                    <section key={s.id} className="card">
                      <div className="card-head">
                        <div>
                          <h3>{s.name}</h3>
                          <p>
                            {list.length} booked · {s.clientName}
                          </p>
                        </div>
                        <button className="btn btn-sm btn-primary" onClick={() => setTarget({ siteId: s.id, siteName: s.name, dates: [day] })}>
                          <Icon name="plus" /> Book
                        </button>
                      </div>
                      {list.length === 0 ? (
                        <p className="small muted" style={{ padding: '10px 20px', margin: 0 }}>
                          Nobody booked.
                        </p>
                      ) : (
                        <ul className="list">
                          {list.map((b: any) => (
                            <li key={b.id}>
                              <Avatar name={b.name} />
                              <div className="grow">
                                <div className="title" style={{ textDecoration: b.status === 'no_show' ? 'line-through' : undefined }}>
                                  {b.name}
                                </div>
                                <div className="small muted">
                                  {b.trade}
                                  {b.status === 'no_show' ? ' · no-show' : ''}
                                </div>
                              </div>
                              <button className="btn btn-sm btn-ghost" onClick={() => remove(b.id)} aria-label={`Remove ${b.name}`}>
                                <Icon name="x" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  );
                })}
              </div>

              {target && (
                <BookModal
                  target={target}
                  weekdays={weekdays}
                  workers={d.workers}
                  bookings={d.bookings}
                  onClose={() => setTarget(null)}
                  onBook={async (ids, dates) => {
                    for (const id of ids) await api.post('/api/bookings', { workerId: id, siteId: target.siteId, dates });
                    toast(`${ids.length} booked at ${target.siteName}`);
                    setTarget(null);
                    state.reload();
                  }}
                />
              )}
            </>
          );
        }}
      </Async>
    </>
  );
}

function SiteRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'contents' }} role="row">{children}</div>;
}

function BookModal({ target, weekdays, workers, bookings, onClose, onBook }: { target: Target; weekdays: string[]; workers: any[]; bookings: any[]; onClose: () => void; onBook: (ids: number[], dates: string[]) => Promise<void> }) {
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [wholeWeek, setWholeWeek] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const day = target.dates[0];
  const bookedThatDay = useMemo(() => new Map(bookings.filter((b) => b.date === day && b.status === 'booked').map((b) => [b.workerId, b])), [bookings, day]);
  const list = workers.filter((w) => w.name.toLowerCase().includes(search.toLowerCase()) || w.trade.toLowerCase().includes(search.toLowerCase()));
  return (
    <Modal
      title={`Book on ${target.siteName}`}
      onClose={onClose}
      footer={
        <>
          <label className="check" style={{ marginRight: 'auto' }}>
            <input type="checkbox" checked={wholeWeek} onChange={(e) => setWholeWeek(e.target.checked)} /> Whole week (Mon–Fri)
          </label>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!chosen.size || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onBook([...chosen], wholeWeek ? weekdays : [day]);
              } catch (e) {
                setError((e as Error).message);
                setBusy(false);
              }
            }}
          >
            Book {chosen.size || ''}
          </button>
        </>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>{wholeWeek ? 'Monday to Friday this week' : fmtDayLong(day)}</p>
      {error && <ErrorBox error={error} />}
      <input className="input" placeholder="Search by name or trade" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
      {list.length === 0 ? (
        <Empty icon="users" title="Nobody matches" />
      ) : (
        <ul className="list" style={{ maxHeight: 360, overflowY: 'auto', marginTop: 8 }}>
          {list.map((w) => {
            const elsewhere = bookedThatDay.get(w.id);
            return (
              <li key={w.id} style={{ padding: '8px 4px' }}>
                <label className="check" style={{ flex: 1, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={chosen.has(w.id)}
                    onChange={(e) => {
                      const n = new Set(chosen);
                      if (e.target.checked) n.add(w.id);
                      else n.delete(w.id);
                      setChosen(n);
                    }}
                  />
                  <Avatar name={w.name} />
                  <span style={{ flex: 1 }}>
                    <strong>{w.name}</strong>
                    <span className="small muted" style={{ display: 'block' }}>
                      {w.trade}
                      {elsewhere ? ` · already booked${elsewhere.siteId === target.siteId ? ' here' : ' elsewhere (will move)'}` : ''}
                      {!w.inductedSiteIds.includes(target.siteId) ? ' · needs induction' : ''}
                    </span>
                  </span>
                  {w.card !== 'ok' && <CardBadge status={w.card} />}
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
