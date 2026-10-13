// Single-series bar chart (one measure, one axis). Two measures = two charts, never a dual axis.
import { useState } from 'react';

export interface Bar {
  key: string;
  label: string;
  value: number;
  display: string;
  detail?: string;
  muted?: boolean;
}

export function BarChart({ bars, title, format, minStep = 1 }: { bars: Bar[]; title: string; format: (v: number) => string; minStep?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (bars.every((b) => !b.value)) {
    return (
      <div className="empty" style={{ padding: '40px 10px' }}>
        <div className="small">Nothing to show yet. This fills in as people sign in.</div>
      </div>
    );
  }
  const W = 420;
  const H = 190;
  const pad = { l: 46, r: 8, t: 12, b: 26 };
  const max = Math.max(1, ...bars.map((b) => b.value));
  const step = Math.max(minStep, niceStep(max));
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const slot = iw / bars.length;
  const bw = Math.min(42, slot - 10);
  const y = (v: number) => pad.t + ih - (v / top) * ih;
  return (
    <figure className="chart" style={{ margin: 0, position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}: ${bars.map((b) => `${b.label} ${b.display}`).join(', ')}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? '#c9c6bd' : '#ecebe6'} strokeWidth={1} />
            <text x={pad.l - 6} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="#5d6370">
              {format(t)}
            </text>
          </g>
        ))}
        {bars.map((b, i) => {
          const x = pad.l + slot * i + (slot - bw) / 2;
          const h = Math.max(0, y(0) - y(b.value));
          const r = Math.min(4, h);
          return (
            <g key={b.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} aria-label={`${b.label}: ${b.display}`}>
              {/* Hit target bigger than the mark */}
              <rect x={pad.l + slot * i} y={pad.t} width={slot} height={ih} fill="transparent" />
              {h > 0 && (
                <path
                  d={`M${x},${y(0)} V${y(b.value) + r} Q${x},${y(b.value)} ${x + r},${y(b.value)} H${x + bw - r} Q${x + bw},${y(b.value)} ${x + bw},${y(b.value) + r} V${y(0)} Z`}
                  fill="var(--brand)"
                  opacity={b.muted ? 0.45 : hover === null || hover === i ? 1 : 0.55}
                />
              )}
              <text x={pad.l + slot * i + slot / 2} y={H - 8} textAnchor="middle" fontSize="10" fill={hover === i ? '#16181d' : '#5d6370'} fontWeight={hover === i ? 700 : 400}>
                {b.label}
              </text>
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            left: `${((pad.l + slot * hover + slot / 2) / W) * 100}%`,
            top: 0,
            transform: 'translateX(-50%)',
            background: '#16181d',
            color: '#fff',
            padding: '6px 10px',
            borderRadius: 8,
            fontSize: 12.5,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            boxShadow: '0 6px 20px rgb(0 0 0 / 20%)',
          }}
        >
          <div style={{ fontWeight: 700 }}>{bars[hover].display}</div>
          <div style={{ color: '#c4c8d0' }}>
            w/c {bars[hover].label}
            {bars[hover].detail ? ` · ${bars[hover].detail}` : ''}
          </div>
        </div>
      )}
    </figure>
  );
}

function niceStep(max: number) {
  const raw = max / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
