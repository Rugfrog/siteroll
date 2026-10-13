// Full-screen, high-contrast roll call for use outdoors at the muster point.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, useApi } from '../api';
import { useMe } from '../App';
import { ErrorBox, Loading, Modal, useToast } from '../ui';
import { fmtTime } from '../../shared/format';

export default function RollCall() {
  const { id } = useParams();
  const state = useApi<any>(`/api/rollcalls/${id}`);
  const { me } = useMe();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const back = me.user?.type === 'agency' ? '/live' : '/client';

  // Keep several marshals' phones in step.
  useEffect(() => {
    const t = setInterval(() => !state.data?.finishedAt && state.reload(), 5000);
    return () => clearInterval(t);
  }, [state.data?.finishedAt, state.reload]);

  useEffect(() => {
    document.title = 'Fire roll call · SiteRoll';
  }, []);

  if (state.error && !state.data) return <div className="page"><ErrorBox error={state.error} onRetry={state.reload} /></div>;
  if (!state.data) return <Loading />;
  const rc = state.data;
  const done = !!rc.finishedAt;
  const notSafe = rc.people.filter((p: any) => !p.safeAt).sort((a: any, b: any) => Number(b.visitor) - Number(a.visitor));
  const safe = rc.people.filter((p: any) => p.safeAt);
  const allSafe = rc.total > 0 && rc.safe === rc.total;

  const mark = async (personId: number, value: boolean) => {
    // Update on screen straight away; the server catches up.
    state.setData({
      ...rc,
      people: rc.people.map((p: any) => (p.id === personId ? { ...p, safeAt: value ? new Date().toISOString() : null } : p)),
      safe: rc.safe + (value ? 1 : -1),
    });
    try {
      state.setData(await api.post(`/api/rollcalls/${rc.id}/mark`, { personId, safe: value }));
    } catch (e) {
      toast((e as Error).message, true);
      state.reload();
    }
  };

  const Row = ({ p }: { p: any }) => (
    <li className={p.safeAt ? 'safe' : 'missing'}>
      <label>
        <input type="checkbox" checked={!!p.safeAt} disabled={done} onChange={(e) => mark(p.id, e.target.checked)} aria-label={`${p.name} is safe`} />
        <span>
          <span className="who">{p.name}</span>
          <br />
          <span className="what">
            {p.visitor ? `Visitor · ${p.detail}` : p.detail}
            {p.safeAt ? ` · safe ${fmtTime(p.safeAt)}` : ''}
          </span>
        </span>
      </label>
    </li>
  );

  return (
    <div className="rollcall">
      <header className={`rollcall-head ${allSafe ? 'done' : ''}`}>
        <div className="spread">
          <Link to={back} style={{ color: '#fff', fontWeight: 700 }}>
            ‹ Back
          </Link>
          <span style={{ fontWeight: 700 }}>
            {rc.kind === 'incident' ? 'INCIDENT' : 'FIRE ROLL CALL'} · {rc.siteName}
          </span>
        </div>
        <div className="rollcall-count" aria-live="polite" style={{ marginTop: 10 }}>
          {rc.safe} of {rc.total} accounted for
          <small>
            Started {fmtTime(rc.startedAt)} by {rc.startedBy.replace(/ \(.*\)$/, '')}
            {done ? ` · finished ${fmtTime(rc.finishedAt)}` : ''}
          </small>
        </div>
        {!done && (
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn btn-lg" style={{ flex: 1, fontWeight: 800 }} onClick={() => setAdding(true)}>
              + Add visitor
            </button>
            <button className="btn btn-lg btn-primary" style={{ flex: 1, fontWeight: 800, background: allSafe ? '#fff' : undefined, color: allSafe ? '#0d5b2a' : undefined }} onClick={() => setFinishing(true)}>
              Finish
            </button>
          </div>
        )}
        {done && (
          <div className="row" style={{ marginTop: 12 }}>
            <a className="btn btn-lg" style={{ flex: 1, fontWeight: 800 }} href={`/api/rollcalls/${rc.id}/pdf`}>
              Download PDF record
            </a>
          </div>
        )}
      </header>

      {rc.total === 0 && <p style={{ padding: 20, fontSize: '1.2rem' }}>Nobody was signed in on this site when the roll call started. Add any visitors above.</p>}

      {notSafe.length > 0 && (
        <>
          <div className="rollcall-section" style={{ background: '#a3150a' }}>
            Not yet accounted for ({notSafe.length})
          </div>
          <ul className="rollcall-list">
            {notSafe.map((p: any) => (
              <Row key={p.id} p={p} />
            ))}
          </ul>
        </>
      )}
      {safe.length > 0 && (
        <>
          <div className="rollcall-section" style={{ background: '#0d5b2a' }}>
            Safe at the muster point ({safe.length})
          </div>
          <ul className="rollcall-list">
            {safe.map((p: any) => (
              <Row key={p.id} p={p} />
            ))}
          </ul>
        </>
      )}
      {done && rc.notes && (
        <p style={{ padding: 16, fontSize: '1.05rem' }}>
          <strong>Notes:</strong> {rc.notes}
        </p>
      )}

      {adding && <AddVisitor rcId={rc.id} onClose={() => setAdding(false)} onDone={(d) => { state.setData(d); setAdding(false); }} />}
      {finishing && <Finish rc={rc} onClose={() => setFinishing(false)} onDone={(d) => { state.setData(d); setFinishing(false); }} />}
    </div>
  );
}

function AddVisitor({ rcId, onClose, onDone }: { rcId: number; onClose: () => void; onDone: (d: any) => void }) {
  const [name, setName] = useState('');
  const [detail, setDetail] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title="Add a visitor" onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            onDone(await api.post(`/api/rollcalls/${rcId}/visitor`, { name, detail }));
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        {error && <ErrorBox error={error} />}
        <label className="field">
          <span>Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required style={{ fontSize: '1.2rem', minHeight: 52 }} />
        </label>
        <label className="field">
          <span>Company or reason (optional)</span>
          <input className="input" value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="e.g. Delivery driver" style={{ fontSize: '1.2rem', minHeight: 52 }} />
        </label>
        <button className="btn btn-dark btn-lg">Add to roll call</button>
      </form>
    </Modal>
  );
}

function Finish({ rc, onClose, onDone }: { rc: any; onClose: () => void; onDone: (d: any) => void }) {
  const [notes, setNotes] = useState('');
  const [kind, setKind] = useState(rc.kind);
  const missing = rc.total - rc.safe;
  return (
    <Modal title="Finish roll call" onClose={onClose}>
      <div className="stack">
        {missing > 0 ? (
          <div className="error-box" style={{ fontSize: '1.05rem' }}>
            <strong>{missing} not accounted for.</strong> If this is a real fire, tell the fire service now.
          </div>
        ) : (
          <div className="ok-box" style={{ fontSize: '1.05rem' }}>
            <strong>Everyone is accounted for.</strong>
          </div>
        )}
        <div className="seg" role="radiogroup" aria-label="Was this a drill?">
          <button type="button" role="radio" aria-checked={kind === 'drill'} className={kind === 'drill' ? 'on' : ''} onClick={() => setKind('drill')}>
            Drill
          </button>
          <button type="button" role="radio" aria-checked={kind === 'incident'} className={kind === 'incident' ? 'on' : ''} onClick={() => setKind('incident')}>
            Real incident
          </button>
        </div>
        <label className="field">
          <span>Notes (optional)</span>
          <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. All out in 4 minutes. Alarm not heard in plot 12." />
        </label>
        <button className="btn btn-dark btn-lg" onClick={async () => onDone(await api.post(`/api/rollcalls/${rc.id}/finish`, { notes, kind }))}>
          Finish and save record
        </button>
      </div>
    </Modal>
  );
}
