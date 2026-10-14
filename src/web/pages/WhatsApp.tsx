// WhatsApp: conversations with SiteRoll's number. In demo mode you can message as anyone, to show what
// workers, site managers and the office can do from WhatsApp without Twilio set up.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useApi } from '../api';
import { Icon } from '../icons';
import { Avatar, PageHead, useToast } from '../ui';
import { fmtPhone, fmtTime } from '../../shared/format';
import { londonDate } from '../../shared/time';

interface Person {
  name: string;
  phone: string;
  role: 'staff' | 'manager' | 'worker';
  detail: string;
  real: boolean;
  last: { body: string; at: string } | null;
}

interface Msg {
  dir: 'in' | 'out';
  id: number;
  channel: string;
  body: string;
  at: string;
  status: string;
  error: string | null;
  kind: string;
}

const QUICK: Record<Person['role'], string[]> = {
  staff: ["Who's on site?", 'Any no-shows today?', 'Whose cards run out this month?', 'Margin last week by site?'],
  manager: ['APPROVE', 'YES', 'ON SITE'],
  worker: ['SAFE', 'HELP', 'YES', 'NO'],
};

const ROLE_LABEL: Record<Person['role'], string> = { staff: 'Agency office', manager: 'Site managers', worker: 'Workers' };

export default function WhatsApp() {
  const status = useApi<any>('/api/whatsapp/status');
  const people = useApi<Person[]>('/api/whatsapp/people');
  const [phone, setPhone] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const endRef = useRef<HTMLDivElement>(null);
  const demo = !!status.data?.demoMode;
  const person = people.data?.find((p) => p.phone === phone) ?? null;

  // Start with the office login (Ask SiteRoll), the most impressive conversation.
  useEffect(() => {
    if (!phone && people.data?.length) setPhone((people.data.find((p) => p.role === 'staff') ?? people.data[0]).phone);
  }, [people.data]);

  const loadConversation = async (p = phone) => {
    if (!p) return;
    try {
      setMsgs(await api.get<Msg[]>(`/api/whatsapp/conversation?phone=${encodeURIComponent(p)}`));
    } catch {
      /* try again on the next tick */
    }
  };
  useEffect(() => {
    setMsgs([]);
    loadConversation(phone);
    const t = window.setInterval(() => {
      loadConversation();
      people.reload();
    }, 3000);
    return () => window.clearInterval(t);
  }, [phone]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [msgs.length, busy]);

  const say = async (body: string) => {
    const b = body.trim();
    if (!b || !phone || busy) return;
    setText('');
    setBusy(true);
    // Show their message straight away, as WhatsApp does.
    setMsgs((m) => [...m, { dir: 'in', id: -Date.now(), channel: 'whatsapp', body: b, at: new Date().toISOString(), status: 'received', error: null, kind: '' }]);
    try {
      await api.post('/api/whatsapp/simulate', { phone, body: b });
      await loadConversation();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };

  const groups = useMemo(() => {
    const q = search.toLowerCase();
    const list = (people.data ?? []).filter((p) => !q || `${p.name} ${p.detail}`.toLowerCase().includes(q));
    return (['staff', 'manager', 'worker'] as const).map((role) => ({ role, people: list.filter((p) => p.role === role) })).filter((g) => g.people.length);
  }, [people.data, search]);

  const live = status.data?.whatsapp;

  return (
    <>
      <PageHead
        title="WhatsApp"
        sub={
          demo
            ? 'Message SiteRoll as anyone to see what they can do from WhatsApp. Real phones work the same way once Twilio is connected.'
            : "Conversations with SiteRoll's WhatsApp number."
        }
      >
        {status.data && (
          <span className={`badge ${live ? 'badge-green' : 'badge-amber'}`} style={{ fontSize: '.8rem', padding: '5px 10px' }}>
            {live ? `Live on WhatsApp${status.data.sandbox ? ' (Twilio sandbox)' : ''}` : 'Simulated: Twilio not connected'}
          </span>
        )}
        <Link to="/settings#whatsapp" className="btn btn-sm">
          <Icon name="settings" /> WhatsApp settings
        </Link>
      </PageHead>

      <div className="wa-layout">
        <aside className="card wa-people" aria-label="People">
          <div className="card-pad" style={{ paddingBottom: 8 }}>
            <input className="input" placeholder="Search people" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search people" />
          </div>
          <div className="wa-people-list">
            {groups.map((g) => (
              <div key={g.role}>
                <div className="wa-group">{ROLE_LABEL[g.role]}</div>
                {g.people.map((p) => (
                  <button key={`${p.role}-${p.phone}-${p.name}`} className={`wa-person ${p.phone === phone ? 'on' : ''}`} onClick={() => setPhone(p.phone)}>
                    <Avatar name={p.name} />
                    <span className="wa-person-text">
                      <span className="wa-person-name">
                        {p.name}
                        {p.real && <span className="badge badge-green" title="A real phone number">Real phone</span>}
                      </span>
                      <span className="wa-person-sub">{p.last ? p.last.body.replace(/\s+/g, ' ').slice(0, 60) : p.detail}</span>
                    </span>
                    {p.last && <span className="wa-person-time">{londonDate(p.last.at) === londonDate() ? fmtTime(p.last.at) : ''}</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </aside>

        <section className="wa-phone" aria-label="Chat">
          <header className="wa-head">
            <span className="wa-head-avatar">
              <Icon name="hardhat" />
            </span>
            <span style={{ minWidth: 0 }}>
              <span className="wa-head-name">SiteRoll</span>
              <span className="wa-head-sub">{person ? `${person.name} · ${person.detail} · ${fmtPhone(person.phone)}` : 'Choose someone'}</span>
            </span>
          </header>
          <div className="wa-chat">
            {msgs.length === 0 && person && (
              <div className="wa-note">
                {demo ? `You're ${person.name}. Send SiteRoll a message.` : `No messages with ${person.name} yet.`}
              </div>
            )}
            {msgs.map((m) => (
              <div key={`${m.dir}-${m.id}`} className={`wa-bubble ${m.dir === 'in' ? 'me' : 'them'}`}>
                <div className="wa-text">{waFormat(m.body)}</div>
                <div className="wa-meta">
                  {m.channel === 'sms' && <span className="wa-sms">text</span>}
                  {m.status === 'failed' && <span className="wa-failed" title={m.error ?? ''}>not delivered</span>}
                  {fmtTime(m.at)}
                  {m.dir === 'in' && <span className="wa-ticks">✓✓</span>}
                </div>
              </div>
            ))}
            {busy && (
              <div className="wa-bubble them wa-typing" aria-label="SiteRoll is typing">
                <span />
                <span />
                <span />
              </div>
            )}
            <div ref={endRef} />
          </div>
          {demo && person ? (
            <>
              <div className="wa-quick">
                {QUICK[person.role].map((q) => (
                  <button key={q} className="wa-chip" onClick={() => say(q)} disabled={busy}>
                    {q}
                  </button>
                ))}
              </div>
              <form
                className="wa-input"
                onSubmit={(e) => {
                  e.preventDefault();
                  say(text);
                }}
              >
                <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message" aria-label={`Message SiteRoll as ${person.name}`} maxLength={1000} />
                <button className="wa-send" disabled={busy || !text.trim()} aria-label="Send">
                  <Icon name="send" />
                </button>
              </form>
            </>
          ) : (
            <div className="wa-readonly">Replies from real phones appear here as they arrive.</div>
          )}
        </section>
      </div>
    </>
  );
}

/** WhatsApp's *bold*, built as React elements (never raw HTML). Links stay as plain text. */
function waFormat(text: string) {
  return text.split('\n').map((line, i) => (
    <span key={i} style={{ display: 'block', minHeight: line ? undefined : '0.6em' }}>
      {line.split(/(\*[^*\n]+\*)/g).map((part, j) => (part.length > 2 && part.startsWith('*') && part.endsWith('*') ? <strong key={j}>{part.slice(1, -1)}</strong> : part))}
    </span>
  ));
}
