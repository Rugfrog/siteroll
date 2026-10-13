import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './icons';
import { initials, fmtDay } from '../shared/format';
import { addDays, londonDate, mondayOf } from '../shared/time';

/* ---------------- Toasts ---------------- */

interface Toast {
  id: number;
  text: string;
  err?: boolean;
}
const ToastCtx = createContext<(text: string, err?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, err = false) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, err }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), err ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.err ? 'err' : ''}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------------- Layout bits ---------------- */

export function PageHead({ title, eyebrow, sub, children }: { title: ReactNode; eyebrow?: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  useEffect(() => {
    if (typeof title === 'string') document.title = `${title} · SiteRoll`;
  }, [title]);
  return (
    <div className="page-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className="actions">{children}</div>}
    </div>
  );
}

export function Card({ title, sub, actions, children, className = '', pad = false }: { title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {sub && <p>{sub}</p>}
          </div>
          {actions && <div className="actions">{actions}</div>}
        </div>
      )}
      {pad ? <div className="card-pad">{children}</div> : children}
    </section>
  );
}

export function Stat({ label, value, sub, tone, href }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'warn' | 'bad'; href?: string }) {
  const inner = (
    <>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {sub && <span className="sub">{sub}</span>}
    </>
  );
  return href ? (
    <a href={href} className={`card stat ${tone ?? ''}`} onClick={(e) => navigateLink(e, href)}>
      {inner}
    </a>
  ) : (
    <div className={`card stat ${tone ?? ''}`}>{inner}</div>
  );
}

/** Let plain <a> links use client-side routing. Set by App. */
export let navigateTo: (to: string) => void = (to) => (window.location.href = to);
export function setNavigate(fn: (to: string) => void) {
  navigateTo = fn;
}
export function navigateLink(e: React.MouseEvent, href: string) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  navigateTo(href);
}

export function Empty({ icon = 'inbox', title, children }: { icon?: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} />
      <h3>{title}</h3>
      {children && <div className="small">{children}</div>}
    </div>
  );
}

export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="card-pad stack" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ width: `${90 - i * 12}%`, height: 18 }} />
      ))}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="error-box row" role="alert">
      <span style={{ flex: 1 }}>{error}</span>
      {onRetry && (
        <button className="btn btn-sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

/** Standard wrapper: loading skeleton, error with retry, or the content. */
export function Async<T>({ state, children, rows }: { state: { data: T | null; error: string | null; reload: () => void }; children: (d: T) => ReactNode; rows?: number }) {
  if (state.error && !state.data) return <ErrorBox error={state.error} onRetry={state.reload} />;
  if (!state.data) return <Loading rows={rows} />;
  return <>{children(state.data)}</>;
}

export function Avatar({ name, src, size }: { name: string; src?: string | null; size?: 'lg' }) {
  return (
    <span className={`avatar ${size === 'lg' ? 'avatar-lg' : ''}`} aria-hidden="true">
      {src ? <img src={src} alt="" loading="lazy" /> : initials(name)}
    </span>
  );
}

const FLAG_INFO: Record<string, { label: string; tone: string }> = {
  late: { label: 'Late', tone: 'amber' },
  not_booked: { label: 'Not booked', tone: 'amber' },
  card: { label: 'Card issue', tone: 'red' },
  no_induction: { label: 'No induction', tone: 'amber' },
  missed_signout: { label: 'Missed sign-out', tone: 'amber' },
  manual: { label: 'Manual', tone: 'blue' },
  offline: { label: 'Sent late (no signal)', tone: 'blue' },
  edited: { label: 'Edited', tone: '' },
  disputed: { label: 'Queried', tone: 'red' },
  moved_site: { label: 'Moved site', tone: 'amber' },
  estimated: { label: 'Still on site', tone: 'blue' },
  after_approval: { label: 'After sign-off', tone: 'red' },
};

export function FlagBadge({ flag }: { flag: string }) {
  const f = FLAG_INFO[flag] ?? { label: flag, tone: '' };
  return <span className={`badge ${f.tone ? `badge-${f.tone}` : ''}`}>{f.label}</span>;
}

export function CardBadge({ status }: { status: string }) {
  if (status === 'ok') return <span className="badge badge-green">Valid</span>;
  if (status === 'expiring') return <span className="badge badge-amber">Expiring soon</span>;
  if (status === 'expired') return <span className="badge badge-red">Expired</span>;
  return <span className="badge badge-red">Missing</span>;
}

export function TimesheetStatus({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    open: ['Open', ''],
    sent: ['Waiting for client', 'badge-amber'],
    queried: ['Queried', 'badge-red'],
    approved: ['Approved', 'badge-green'],
  };
  const [label, cls] = map[status] ?? [status, ''];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function InvoiceStatus({ status }: { status: string }) {
  const map: Record<string, [string, string]> = { sent: ['Sent', 'badge-blue'], paid: ['Paid', 'badge-green'], overdue: ['Overdue', 'badge-red'] };
  const [label, cls] = map[status] ?? [status, ''];
  return <span className={`badge ${cls}`}>{label}</span>;
}

/* ---------------- Modal ---------------- */

export function Modal({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.modal-close)');
    (first ?? ref.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && ref.current) {
        const els = [...ref.current.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input, select, textarea')];
        if (!els.length) return;
        const [a, b] = [els[0], els[els.length - 1]];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          b.focus();
        } else if (!e.shiftKey && document.activeElement === b) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={ref} tabIndex={-1}>
        <div className="modal-head">
          <h2 id="modal-title">{title}</h2>
          <button className="btn btn-ghost btn-sm modal-close" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------------- Forms ---------------- */

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span>
        {label} {hint && <span className="hint">· {hint}</span>}
      </span>
      {children}
    </label>
  );
}

/** Button that shows it's busy and reports errors as a toast. */
export function ActionButton({ onClick, children, className = 'btn', disabled, done, ...rest }: { onClick: () => Promise<unknown>; children: ReactNode; className?: string; disabled?: boolean; done?: string } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'>) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <button
      {...rest}
      className={className}
      disabled={busy || disabled}
      aria-busy={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onClick();
          if (done) toast(done);
        } catch (e) {
          toast((e as Error).message, true);
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
    </button>
  );
}

/* ---------------- Week picker ---------------- */

export function WeekPicker({ week, onChange }: { week: string; onChange: (w: string) => void }) {
  const thisWeek = mondayOf(londonDate());
  return (
    <div className="row" role="group" aria-label="Choose week">
      <button className="btn btn-sm" onClick={() => onChange(addDays(week, -7))} aria-label="Previous week">
        ‹
      </button>
      <strong className="nowrap" style={{ minWidth: 150, textAlign: 'center' }}>
        {fmtDay(week)} – {fmtDay(addDays(week, 6))}
      </strong>
      <button className="btn btn-sm" onClick={() => onChange(addDays(week, 7))} aria-label="Next week">
        ›
      </button>
      {week !== thisWeek && (
        <button className="btn btn-sm btn-ghost" onClick={() => onChange(thisWeek)}>
          This week
        </button>
      )}
    </div>
  );
}

export function useQueryState(key: string, initial: string): [string, (v: string) => void] {
  const read = () => new URLSearchParams(window.location.search).get(key) ?? initial;
  const [value, setValue] = useState(read);
  const set = (v: string) => {
    const p = new URLSearchParams(window.location.search);
    if (v === initial) p.delete(key);
    else p.set(key, v);
    const qs = p.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    setValue(v);
  };
  return [value, set];
}
