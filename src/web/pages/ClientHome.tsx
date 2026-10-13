import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useApi } from '../api';
import { useMe } from '../App';
import { Icon } from '../icons';
import { Modal, useToast } from '../ui';
import { LiveBoard } from './Live';

/** Client site manager's home: the fire button first, then who's on site. */
export default function ClientHome() {
  const sites = useApi<any>('/api/live');
  const [choosing, setChoosing] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();
  const { me } = useMe();

  const start = async (siteId: number) => {
    try {
      const rc = await api.post('/api/rollcalls', { siteId, kind: 'drill' });
      navigate(`/rollcall/${rc.id}`);
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const list = sites.data?.sites ?? [];

  return (
    <>
      <p className="muted small" style={{ margin: '0 0 10px' }}>
        Hello {me.user?.name.split(' ')[0]}. You're seeing {list.length === 1 ? list[0].name : `your ${list.length} sites`}.
      </p>
      <button className="fire-button" onClick={() => (list.length === 1 ? start(list[0].id) : setChoosing(true))} disabled={!list.length}>
        <Icon name="flame" /> Fire roll call
      </button>
      <p className="small muted" style={{ textAlign: 'center', margin: '8px 0 20px' }}>
        Lists everyone signed in on site right now, to tick off at the muster point.
      </p>
      <LiveBoard client />
      {choosing && (
        <Modal title="Which site?" onClose={() => setChoosing(false)}>
          <div className="stack">
            {list.map((s: any) => (
              <button key={s.id} className="btn btn-danger btn-lg btn-block" onClick={() => start(s.id)}>
                {s.name} ({s.onSite.length} on site)
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
