import { useState } from 'react';
import { api, useApi, useLiveRefresh } from '../api';
import { useMe } from '../App';
import { Icon } from '../icons';
import { ActionButton, Async, Card, Empty, PageHead, useToast } from '../ui';
import { fmtDateTime, fmtPhone } from '../../shared/format';

const KINDS: [string, string][] = [
  ['', 'Everything'],
  ['fire', 'Fire alarms'],
  ['code', 'Sign-in codes'],
  ['signoff', 'Sign-off requests'],
  ['no_show', 'No-shows'],
  ['replacement', 'Replacements'],
  ['missed_signout', 'Missed sign-outs'],
  ['invoice', 'Invoices'],
  ['magic_link', 'Login links'],
  ['manual_request', 'Manual sign-ins'],
  ['query', 'Queries'],
];

/** Every simulated text and email: what each person would have received. */
export default function Outbox() {
  const [kind, setKind] = useState('');
  const state = useApi<any[]>(`/api/outbox${kind ? `?kind=${kind}` : ''}`);
  useLiveRefresh(state.reload, 15000);
  const toast = useToast();
  const { me } = useMe();
  return (
    <>
      <PageHead
        title="Outbox"
        sub={
          me.demoMode
            ? 'Demo only. Every text and email SiteRoll would have sent, so you can show exactly what each person receives. Plug in a real provider (e.g. Twilio) to send them for real.'
            : 'Every text and email SiteRoll has sent.'
        }
      >
        <select className="select" style={{ width: 'auto' }} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Show">
          {KINDS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </PageHead>
      {me.demoMode && (
      <Card
        title="Run the background checks now"
        sub="These run by themselves every minute. In a demo, press them to see what happens straight away."
        className="no-print"
        actions={
          <>
            <ActionButton className="btn btn-sm" onClick={async () => { const r = await api.post('/api/demo/run/no-shows'); toast(`${r.count} new no-show alert${r.count === 1 ? '' : 's'}`); state.reload(); }}>
              No-show check
            </ActionButton>
            <ActionButton className="btn btn-sm" onClick={async () => { const r = await api.post('/api/demo/run/missed-sign-outs'); toast(`${r.count} missed sign-out${r.count === 1 ? '' : 's'} closed`); state.reload(); }}>
              20:00 missed sign-out check
            </ActionButton>
          </>
        }
      >
        <></>
      </Card>
      )}
      <Card className="mt">
        <Async state={state} rows={10}>
          {(rows) =>
            rows.length === 0 ? (
              <Empty icon="mail" title="Nothing sent yet" />
            ) : (
              <div>
                {rows.map((m) => (
                  <article key={m.id} className="message">
                    <span className={`icon ${m.channel}`} aria-label={m.channel === 'sms' ? 'Text message' : 'Email'}>
                      <Icon name={m.channel === 'sms' ? 'sms' : 'mail'} />
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div className="spread">
                        <div>
                          <strong>{m.recipient_name || (m.channel === 'sms' ? fmtPhone(m.recipient) : m.recipient)}</strong>{' '}
                          <span className="small muted">{m.channel === 'sms' ? fmtPhone(m.recipient) : m.recipient}</span>
                        </div>
                        <span className="tiny muted nowrap">{fmtDateTime(m.created_at)}</span>
                      </div>
                      {m.subject && <div className="small" style={{ fontWeight: 600, marginTop: 2 }}>{m.subject}</div>}
                      <div className="bubble">{linkify(m.body)}</div>
                      {m.link && (
                        <div className="row mt-s">
                          <a className="btn btn-sm" href={m.link} target="_blank" rel="noopener">
                            Open link as {m.recipient_name || 'recipient'} ↗
                          </a>
                          {(m.kind === 'signoff' || m.kind === 'magic_link') && <span className="tiny muted">Opens their view in a new tab. You stay logged in here.</span>}
                        </div>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )
          }
        </Async>
      </Card>
    </>
  );
}

function linkify(text: string) {
  const parts = text.split(/(https?:\/\/\S+)/g);
  return parts.map((p, i) =>
    /^https?:\/\//.test(p) ? (
      <a key={i} href={p} target="_blank" rel="noopener">
        {p.length > 60 ? `${p.slice(0, 57)}…` : p}
      </a>
    ) : (
      p
    ),
  );
}
