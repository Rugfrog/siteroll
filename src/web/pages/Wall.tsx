// Office TV wall: a full-screen live view for the office telly. Map with headcounts, a money meter
// that ticks up by the second, a live feed of what's happening, and every site at a glance.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useApi, useLiveRefresh } from '../api';
import { osmTiles } from '../map';
import { Icon } from '../icons';
import { ErrorBox, Loading } from '../ui';
import { fmtDayLong, fmtHours, fmtMoney, fmtTime } from '../../shared/format';
import { londonDate } from '../../shared/time';

interface WallShift {
  inAt: string;
  outAt: string | null;
  breakMins: number | null;
  breakDefault: number;
  breakAfter: number;
  charge: number;
  pay: number;
}

interface WallSite {
  id: number;
  name: string;
  town: string;
  client: string;
  lat: number;
  lng: number;
  onSite: number;
  expected: number;
  noShows: number;
}

interface WallData {
  now: string;
  agency: { name: string; colour: string; hasLogo: boolean };
  sites: WallSite[];
  shifts: WallShift[];
  feed: { at: string; kind: string; text: string; detail?: string }[];
  stats: { compliance: number; awaitingApproval: number; overduePence: number };
}

/** Hours and money so far today, worked out to the second (a live estimate before overtime and rounding). */
function liveTotals(shifts: WallShift[], nowMs: number) {
  let mins = 0;
  let charge = 0;
  let pay = 0;
  for (const s of shifts) {
    const end = s.outAt ? Date.parse(s.outAt) : nowMs;
    const elapsed = Math.max(0, (end - Date.parse(s.inAt)) / 60000);
    const brk = Math.min(elapsed, s.breakMins ?? (elapsed >= s.breakAfter ? s.breakDefault : 0));
    const worked = elapsed - brk;
    mins += worked;
    charge += (worked / 60) * s.charge;
    pay += (worked / 60) * s.pay;
  }
  return { mins, charge, pay };
}

export default function Wall() {
  const state = useApi<WallData>('/api/wall');
  useLiveRefresh(state.reload, 15000);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 250);
    document.title = 'Office TV · SiteRoll';
    document.body.classList.add('wall-body');
    return () => {
      window.clearInterval(t);
      document.body.classList.remove('wall-body');
    };
  }, []);

  if (state.error && !state.data) return <div className="page"><ErrorBox error={state.error} onRetry={state.reload} /></div>;
  if (!state.data) return <Loading />;
  const d = state.data;
  const totals = liveTotals(d.shifts, now);
  const onSite = d.sites.reduce((s, x) => s + x.onSite, 0);
  const noShows = d.sites.reduce((s, x) => s + x.noShows, 0);
  const margin = totals.charge - totals.pay;

  return (
    <div className="wall">
      <header className="wall-top">
        <div className="wall-brand">
          <span className="brand-mark" style={{ width: 40, height: 40 }}>
            {d.agency.hasLogo ? <img src="/files/logo" alt="" /> : <Icon name="hardhat" style={{ width: 22, height: 22, color: '#fff' }} />}
          </span>
          <div>
            <div className="wall-agency">{d.agency.name}</div>
            <div className="wall-live">
              <span className="live-dot" aria-hidden="true" /> Live across {d.sites.length} sites
            </div>
          </div>
        </div>
        <div className="wall-clock" aria-label="Time now">
          <div className="wall-time">{new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(now)}</div>
          <div className="wall-date">{fmtDayLong(londonDate(new Date(now)))}</div>
        </div>
        <div className="wall-actions no-print">
          <button className="wall-btn" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.())}>
            Full screen
          </button>
          <Link className="wall-btn" to="/">
            Exit
          </Link>
        </div>
      </header>

      <main className="wall-main">
        <section className="wall-map-wrap" aria-label="Map of sites with headcounts">
          <WallMap sites={d.sites} />
          <div className="wall-map-total">
            <span className="n">{onSite}</span> on site now
            {noShows > 0 && <span className="wall-warn"> · {noShows} no-show{noShows === 1 ? '' : 's'}</span>}
          </div>
        </section>

        <aside className="wall-side">
          <section className="meter" aria-label="Money today">
            <div className="label">Billed today</div>
            <div className="big" aria-live="off">{fmtMoney(Math.round(totals.charge))}</div>
            <div className="row3">
              <div>
                <div className="label">Margin</div>
                <div className="v">{fmtMoney(Math.round(margin))}</div>
              </div>
              <div>
                <div className="label">Hours worked</div>
                <div className="v">{fmtHours(Math.floor(totals.mins))}</div>
              </div>
              <div>
                <div className="label">Margin %</div>
                <div className="v">{totals.charge ? ((margin / totals.charge) * 100).toFixed(1) : '0.0'}%</div>
              </div>
            </div>
            <div className="meter-note">Live estimate, ticking by the second · before overtime and rounding</div>
          </section>

          <section className="feed" aria-label="Live feed">
            <div className="feed-head">Live feed</div>
            <ul>
              {d.feed.length === 0 && <li className="feed-empty">Nothing yet today.</li>}
              {d.feed.map((f, i) => (
                <li key={`${f.at}-${i}`} className={`k-${f.kind}`}>
                  <span className="t">{fmtTime(f.at)}</span>
                  <span className="k" aria-hidden="true" />
                  <span className="x">
                    <span className="what">{f.text}</span>
                    {f.detail && <span className="detail">{f.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </main>

      <footer className="wall-sites">
        {d.sites.map((s) => (
          <div key={s.id} className="site-tile">
            <div style={{ minWidth: 0 }}>
              <div className="name">{s.name}</div>
              <div className="sub">{s.client}</div>
              <div className="sub">
                {s.expected > 0 ? `${s.expected} booked not here` : 'Everyone booked is in'}
                {s.noShows > 0 && <span className="wall-warn"> · {s.noShows} no-show</span>}
              </div>
            </div>
            <div className="n">{s.onSite}</div>
          </div>
        ))}
        <div className="site-tile stats">
          <div>
            <div className="sub">Compliance warnings</div>
            <div className="sub">Timesheets with clients</div>
            <div className="sub">Overdue invoices</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="sub strong">{d.stats.compliance}</div>
            <div className="sub strong">{d.stats.awaitingApproval}</div>
            <div className="sub strong">{fmtMoney(d.stats.overduePence)}</div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function WallMap({ sites }: { sites: WallSite[] }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef(new Map<number, L.Marker>());
  const counts = useRef(new Map<number, number>());
  const fitted = useRef(false);
  const placed = useMemo(() => sites.filter((s) => typeof s.lat === 'number' && typeof s.lng === 'number'), [sites]);

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: false, attributionControl: true, scrollWheelZoom: false, dragging: true });
    osmTiles(18).addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      markers.current.clear();
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !placed.length) return;
    for (const s of placed) {
      const before = counts.current.get(s.id);
      // A new arrival makes the pin ping.
      const ping = before !== undefined && s.onSite > before;
      counts.current.set(s.id, s.onSite);
      const size = 46 + Math.min(34, s.onSite * 3);
      const icon = L.divIcon({
        className: '',
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        html: `<div class="wall-pin ${s.onSite ? 'busy' : ''} ${ping ? 'ping' : ''}" style="width:${size}px;height:${size}px"><span>${s.onSite}</span></div><div class="wall-pin-label">${escapeHtml(s.town)}</div>`,
      });
      const existing = markers.current.get(s.id);
      if (existing) existing.setIcon(icon);
      else markers.current.set(s.id, L.marker([s.lat, s.lng], { icon, keyboard: false, title: `${s.name}: ${s.onSite} on site` }).addTo(m));
    }
    if (!fitted.current) {
      fit();
      fitted.current = true;
    }
  }, [placed]);

  // Frame every site, and again whenever the screen changes size (e.g. going full screen on a TV).
  const fit = () => {
    const m = map.current;
    if (!m || !placed.length) return;
    m.invalidateSize();
    m.fitBounds(L.latLngBounds(placed.map((s) => [s.lat, s.lng] as [number, number])).pad(0.3), { animate: false, maxZoom: 13 });
  };
  useEffect(() => {
    if (!el.current) return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el.current);
    return () => ro.disconnect();
  }, [placed]);

  return <div ref={el} className="wall-map" />;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
