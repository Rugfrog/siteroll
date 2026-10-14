// Ask SiteRoll: questions in plain English, answered by Claude from the agency's own data.
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { currentRole, useApi } from '../api';
import { Icon } from '../icons';
import { Card, PageHead, useToast } from '../ui';

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  steps?: string[];
  pending?: boolean;
  error?: string;
}

export const SUGGESTIONS = [
  "Who's on site right now, and who hasn't turned up?",
  'Whose CSCS cards run out in the next month?',
  'What was our margin last week, by site?',
  'How many hours did Jordan Booth do last week?',
  'Which invoices are overdue, and who owes what?',
  'Draft a text to Gareth about the no-show at Brighouse',
];

export default function Ask() {
  const status = useApi<{ enabled: boolean; model: string }>('/api/ask/status');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const started = useRef(false);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns]);

  // Arriving from the home page's "Ask anything" box.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('q');
    if (q && status.data?.enabled && !started.current) {
      started.current = true;
      window.history.replaceState(null, '', '/ask');
      ask(q);
    }
  }, [status.data]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    const history = turns.filter((t) => !t.pending && !t.error && t.text).map((t) => ({ role: t.role, text: t.text }));
    setTurns((t) => [...t, { role: 'user', text: q }, { role: 'assistant', text: '', steps: [], pending: true }]);
    setInput('');
    setBusy(true);
    const update = (fn: (t: Turn) => Turn) => setTurns((all) => all.map((t, i) => (i === all.length - 1 ? fn(t) : t)));
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-SiteRoll-As': currentRole() },
        body: JSON.stringify({ question: q, history }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Something went wrong (${res.status})`);
      }
      // Newline-delimited JSON: steps as Claude looks things up, then the answer.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line);
          if (ev.type === 'step') update((t) => ({ ...t, steps: [...(t.steps ?? []), ev.text] }));
          if (ev.type === 'answer') update((t) => ({ ...t, text: ev.text, pending: false }));
          if (ev.type === 'error') update((t) => ({ ...t, error: ev.message, pending: false }));
        }
      }
      update((t) => (t.pending ? { ...t, pending: false, error: t.text ? undefined : 'No answer came back. Please try again.' } : t));
    } catch (e) {
      update((t) => ({ ...t, pending: false, error: (e as Error).message }));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  const enabled = status.data?.enabled;

  return (
    <div className="ask-page">
      <PageHead
        eyebrow={
          <span className="row" style={{ gap: 6 }}>
            <Icon name="sparkle" style={{ width: 14, height: 14 }} /> Powered by Claude
          </span>
        }
        title="Ask SiteRoll"
        sub="Ask anything about your workers, sites, hours and money, in plain English."
      >
        {turns.length > 0 && (
          <button className="btn btn-sm" onClick={() => setTurns([])} disabled={busy}>
            New question
          </button>
        )}
      </PageHead>

      {status.data && !enabled && (
        <Card title="Switch on Ask SiteRoll" pad>
          <p style={{ marginTop: 0 }}>Ask SiteRoll uses Claude, Anthropic's AI. To switch it on, add a Claude API key:</p>
          <ol className="small" style={{ paddingLeft: 18, lineHeight: 1.7 }}>
            <li>
              Get a key at <strong>console.anthropic.com</strong> (API keys).
            </li>
            <li>
              Running it yourself: add <code>ANTHROPIC_API_KEY=your-key</code> to the <code>.env</code> file and restart.
            </li>
            <li>
              On Render: open the service, go to <strong>Environment</strong>, add <code>ANTHROPIC_API_KEY</code>, and save. It restarts by itself.
            </li>
          </ol>
          <p className="small muted" style={{ marginBottom: 0 }}>
            Each question costs a few pence. There's a daily limit of questions (<code>ASK_DAILY_LIMIT</code>, default 300) so a shared demo link can't run up a bill.
          </p>
        </Card>
      )}

      {enabled && (
        <div className="ask-thread" aria-live="polite">
          {turns.length === 0 && (
            <div className="ask-empty">
              <div className="ask-orb" aria-hidden="true">
                <Icon name="sparkle" />
              </div>
              <h2>What do you want to know?</h2>
              <p className="muted">It looks things up in SiteRoll as it goes. It can't change anything.</p>
              <div className="chips" role="list">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="chip-btn" role="listitem" onClick={() => ask(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {turns.map((t, i) =>
            t.role === 'user' ? (
              <div key={i} className="ask-q">
                <div>{t.text}</div>
              </div>
            ) : (
              <Answer key={i} turn={t} />
            ),
          )}
          <div ref={endRef} style={{ scrollMarginBottom: 170 }} />
        </div>
      )}

      {enabled && (
        <form
          className="ask-input"
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                ask(input);
              }
            }}
            rows={1}
            placeholder={turns.length ? 'Ask a follow-up…' : 'e.g. Who worked Saturday at Brighouse?'}
            aria-label="Your question"
            maxLength={1000}
            disabled={busy}
          />
          <button className="btn btn-primary" disabled={busy || !input.trim()} aria-label="Ask">
            <Icon name="send" />
          </button>
        </form>
      )}
    </div>
  );
}

function Answer({ turn }: { turn: Turn }) {
  const toast = useToast();
  return (
    <div className="ask-a">
      <div className="ask-a-mark" aria-hidden="true">
        <Icon name="sparkle" />
      </div>
      <div className="ask-a-body">
        {(turn.steps?.length ?? 0) > 0 && (
          <ul className="ask-steps" aria-label="What it looked up">
            {turn.steps!.map((s, i) => (
              <li key={i} className={turn.pending && i === turn.steps!.length - 1 ? 'now' : ''}>
                <Icon name={turn.pending && i === turn.steps!.length - 1 ? 'clock' : 'check'} /> {s}
              </li>
            ))}
          </ul>
        )}
        {turn.pending && (
          <div className="ask-thinking">
            <span />
            <span />
            <span />
            <span className="sr-only">Working it out</span>
          </div>
        )}
        {turn.error && <div className="error-box">{turn.error}</div>}
        {!turn.pending && turn.text && (
          <>
            <div className="ask-text">{renderText(turn.text)}</div>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => {
                navigator.clipboard?.writeText(turn.text).then(
                  () => toast('Copied'),
                  () => toast("Couldn't copy", true),
                );
              }}
            >
              Copy
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** A little Markdown: paragraphs, bullet and numbered lists, **bold**. Built as React elements, never raw HTML. */
function renderText(text: string): ReactNode {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>);
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    list = null;
  };
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{para.map((l, i) => <Fragment key={i}>{i > 0 && <br />}{inline(l)}</Fragment>)}</p>);
    para = [];
  };
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const num = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || num) {
      flushPara();
      const ordered = !!num;
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? num)![1]);
    } else if (!line.trim()) {
      flush();
      flushPara();
    } else {
      flush();
      para.push(line.replace(/^#+\s*/, ''));
    }
  }
  flush();
  flushPara();
  return blocks;
}

function inline(s: string): ReactNode {
  return s.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part));
}
