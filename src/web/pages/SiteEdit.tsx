import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api, useApi } from '../api';
import { Icon } from '../icons';
import { ActionButton, Card, Empty, ErrorBox, Field, Loading, PageHead, useToast } from '../ui';

const DEFAULT = { lat: 53.6458, lng: -1.785 }; // Huddersfield

export default function SiteEdit() {
  const { id } = useParams();
  const isNew = id === 'new';
  const site = useApi<any>(isNew ? null : `/api/sites/${id}`);
  const clients = useApi<any[]>('/api/clients');
  const navigate = useNavigate();
  const toast = useToast();
  const [f, setF] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isNew && clients.data && !f)
      setF({ client_id: clients.data[0]?.id ?? '', name: '', address: '', postcode: '', lat: DEFAULT.lat, lng: DEFAULT.lng, radius_m: 200, start_time: '07:30', finish_time: '16:30', active: true });
    if (!isNew && site.data) setF({ ...site.data, active: !!site.data.active });
  }, [isNew, clients.data, site.data]);

  if (isNew && clients.data && clients.data.length === 0) {
    return (
      <>
        <PageHead title="New site" />
        <div className="card">
          <Empty icon="building" title="Add a client first">
            Every site belongs to a client. <Link to="/clients">Add a client</Link>, then come back.
          </Empty>
        </div>
      </>
    );
  }
  if (!f) return site.error ? <ErrorBox error={site.error} /> : <Loading rows={8} />;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const body = { ...f, lat: Number(f.lat), lng: Number(f.lng), radius_m: Number(f.radius_m), client_id: Number(f.client_id) };
      if (isNew) {
        const r = await api.post('/api/sites', body);
        toast('Site added. Print its poster next.');
        navigate(`/sites/${r.id}`, { replace: true });
      } else {
        await api.put(`/api/sites/${id}`, body);
        toast('Saved');
        site.reload();
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const findPostcode = async () => {
    try {
      const r = await api.get(`/api/geocode?postcode=${encodeURIComponent(f.postcode)}`);
      setF({ ...f, lat: r.lat, lng: r.lng, postcode: r.postcode });
      toast('Pin moved to the postcode. Drag it onto the site gate if needed.');
    } catch (err) {
      toast((err as Error).message, true);
    }
  };

  return (
    <>
      <PageHead
        eyebrow={
          <Link to="/clients" className="row" style={{ gap: 4, textDecoration: 'none' }}>
            <Icon name="arrowLeft" style={{ width: 14, height: 14 }} /> Clients & sites
          </Link>
        }
        title={isNew ? 'New site' : f.name}
        sub={isNew ? 'Put the pin on the site and set how far out people can sign in.' : f.client_name}
      >
        {!isNew && (
          <>
            <a className="btn" href={`/s/${f.qr_token}`} target="_blank" rel="noopener">
              Open sign-in page
            </a>
            <Link className="btn" to={`/sites/${id}/poster`}>
              <Icon name="printer" /> Print poster
            </Link>
          </>
        )}
        <button className="btn btn-primary" form="site-form">
          {isNew ? 'Add site' : 'Save'}
        </button>
      </PageHead>
      {error && <ErrorBox error={error} />}
      <div className="grid grid-main mt">
        <Card title="Where is it?" sub="Drag the pin, or click the map. People can sign in anywhere inside the circle.">
          <div className="card-pad">
            <SiteMap lat={Number(f.lat)} lng={Number(f.lng)} radius={Number(f.radius_m)} onMove={(lat, lng) => setF((x: any) => ({ ...x, lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 }))} />
            <Field label={`Geofence radius: ${f.radius_m} metres`} hint="150–300 m suits most sites">
              <input type="range" min={50} max={600} step={10} value={f.radius_m} onChange={set('radius_m')} style={{ width: '100%', accentColor: 'var(--brand)' }} />
            </Field>
            <p className="tiny muted" style={{ margin: '6px 0 0' }}>
              {Number(f.lat).toFixed(5)}, {Number(f.lng).toFixed(5)} · Map © OpenStreetMap contributors
            </p>
          </div>
        </Card>
        <form id="site-form" onSubmit={save} className="stack">
          <Card title="Details" pad>
            <div className="stack">
              <Field label="Client">
                <select className="select" value={f.client_id} onChange={set('client_id')} required>
                  {(clients.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Site name" hint="what workers see when they scan">
                <input className="input" value={f.name} onChange={set('name')} required placeholder="e.g. Woodhouse Gardens, Brighouse" />
              </Field>
              <Field label="Address">
                <input className="input" value={f.address} onChange={set('address')} />
              </Field>
              <Field label="Postcode">
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <input className="input" value={f.postcode} onChange={set('postcode')} />
                  <button type="button" className="btn" onClick={findPostcode} disabled={!f.postcode}>
                    Find
                  </button>
                </div>
              </Field>
              <div className="form-grid">
                <Field label="Start time" hint="for no-show alerts">
                  <input className="input" type="time" value={f.start_time} onChange={set('start_time')} required />
                </Field>
                <Field label="Usual finish">
                  <input className="input" type="time" value={f.finish_time} onChange={set('finish_time')} required />
                </Field>
              </div>
              {!isNew && (
                <label className="check">
                  <input type="checkbox" checked={!f.active} onChange={(e) => setF({ ...f, active: !e.target.checked })} /> Site closed (nobody can sign in)
                </label>
              )}
            </div>
          </Card>
          {!isNew && (
            <Card title="QR code" pad>
              <p className="small muted" style={{ marginTop: 0 }}>
                If a photo of the poster gets passed round, make a new code. The old posters will stop working.
              </p>
              <ActionButton
                className="btn"
                onClick={async () => {
                  if (!confirm('Make a new code? You will need to print and put up new posters.')) return;
                  await api.post(`/api/sites/${id}/new-code`);
                  site.reload();
                }}
                done="New code made. Print the new poster."
              >
                <Icon name="refresh" /> Make a new code
              </ActionButton>
            </Card>
          )}
        </form>
      </div>
    </>
  );
}

function SiteMap({ lat, lng, radius, onMove }: { lat: number; lng: number; radius: number; onMove: (lat: number, lng: number) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const circle = useRef<L.Circle | null>(null);
  const move = useRef(onMove);
  move.current = onMove;

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { scrollWheelZoom: false }).setView([lat, lng], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
    const icon = L.divIcon({
      className: '',
      html: '<div style="width:26px;height:26px;border-radius:50% 50% 50% 0;background:var(--brand);transform:rotate(-45deg);border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)"></div>',
      iconSize: [26, 26],
      iconAnchor: [13, 26],
    });
    marker.current = L.marker([lat, lng], { draggable: true, icon, keyboard: true, title: 'Site pin' }).addTo(m);
    circle.current = L.circle([lat, lng], { radius, color: getComputedStyle(document.documentElement).getPropertyValue('--brand').trim() || '#0e6655', weight: 2, fillOpacity: 0.12 }).addTo(m);
    marker.current.on('drag', (e) => {
      const p = (e.target as L.Marker).getLatLng();
      circle.current?.setLatLng(p);
    });
    marker.current.on('dragend', (e) => {
      const p = (e.target as L.Marker).getLatLng();
      move.current(p.lat, p.lng);
    });
    m.on('click', (e: L.LeafletMouseEvent) => move.current(e.latlng.lat, e.latlng.lng));
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    if (!map.current) return;
    marker.current?.setLatLng([lat, lng]);
    circle.current?.setLatLng([lat, lng]);
    circle.current?.setRadius(radius);
    if (!map.current.getBounds().contains([lat, lng])) map.current.setView([lat, lng]);
  }, [lat, lng, radius]);

  return <div ref={el} className="map" role="application" aria-label="Map. Drag the pin to the site." style={{ marginBottom: 14 }} />;
}
