// Worker sign-in page. Plain TypeScript, no framework, so it loads fast on a cheap phone with poor signal.
// Flow once a phone is remembered: scan → tap "Sign in" → done (2 taps or fewer).
import './worker.css';
import { fmtTime } from '../shared/format';

type Place = { key: string; label: string; lat: number; lng: number; accuracy: number };
interface SiteInfo {
  site: { name: string; address: string; postcode: string; clientName: string; selfieRequired: boolean; breakDefault: number; blocksExpiredCards: boolean };
  agency: { name: string; phone: string; colour: string; hasLogo: boolean };
  worker: null | { firstName: string; lastName: string; signedIn: null | { here: boolean; siteName: string; since: string }; card: string; inducted: boolean };
  demoMode: boolean;
  demoPlaces: Place[];
  demoHint: null | { phone: string; name: string };
}
interface Reading {
  lat: number;
  lng: number;
  accuracy: number;
}
interface Pending {
  token: string;
  action: 'in' | 'out';
  reading: Reading;
  capturedAt: string;
  breakMins?: number | null;
  selfie?: string | null;
}

const token = decodeURIComponent(location.pathname.split('/')[2] || '');
const app = document.getElementById('app')!;
const PENDING_KEY = 'siteroll-pending';
let info: SiteInfo;
let demoPlace = '';

/* ---------------- tiny DOM helper (text is always escaped) ---------------- */

type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(c));
  return el;
}

function svg(path: string) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '3');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  s.append(p);
  return s;
}
const ICON_TICK = 'M20 6 9 17l-5-5';
const ICON_IN = 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3';
const ICON_OUT = 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9';

function screen(...content: Child[]) {
  app.replaceChildren(header(), h('div', { class: 'body' }, ...content), footer());
  const focusable = app.querySelector<HTMLElement>('[data-autofocus]') ?? app.querySelector<HTMLElement>('.body h2, .body .hello');
  focusable?.setAttribute('tabindex', '-1');
  focusable?.focus({ preventScroll: true });
}

function header() {
  return h(
    'header',
    { class: 'top' },
    h('div', { class: 'agency' }, info.agency.hasLogo ? h('img', { src: '/files/logo', alt: '' }) : null, info.agency.name),
    h('h1', {}, info.site.name),
    h('div', { class: 'client' }, info.site.clientName),
  );
}

function footer() {
  return h(
    'footer',
    { class: 'foot' },
    h(
      'details',
      {},
      h('summary', {}, 'Privacy: how we use your location'),
      h('p', {}, `When you tap Sign in or Sign out, your phone tells us where it is once, so we can check you're really on site. We never track you in between, and we don't use your location for anything else.`),
      info.site.selfieRequired ? h('p', {}, `This site asks for a quick photo when you sign in, to stop people signing each other in. ${info.agency.name} and the site manager can see it. It's deleted automatically after a few weeks.`) : null,
      h('p', {}, `Your sign-in times are used for your timesheet, your pay, and the site's fire register. ${info.agency.name} is responsible for your data. Ask them for a copy or to correct anything.`),
    ),
    info.worker
      ? h(
          'p',
          {},
          `Not ${info.worker.firstName}? `,
          h('button', { class: 'link', onclick: forgetPhone }, 'Forget this phone'),
        )
      : null,
    h('p', {}, 'Problems? Call ', h('a', { href: `tel:${info.agency.phone.replace(/\s/g, '')}` }, `${info.agency.name} on ${info.agency.phone}`)),
  );
}

/* ---------------- API ---------------- */

async function post(path: string, body: unknown) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 400) throw Object.assign(new Error(data.error || 'Something went wrong. Please try again.'), { status: res.status, data });
  if (res.status === 400 && data.error && !data.status) throw Object.assign(new Error(data.error), { status: 400, data });
  return data;
}

async function load() {
  try {
    const res = await fetch(`/api/w/site/${encodeURIComponent(token)}`, { credentials: 'same-origin' });
    const data = await res.json();
    if (!res.ok) {
      app.replaceChildren(h('div', { class: 'body' }, h('div', { class: 'panel bad' }, h('h2', {}, 'Code not recognised'), h('p', {}, data.error || 'Please scan the poster again.'))));
      return;
    }
    info = data;
    try {
      localStorage.setItem(`siteroll-site-${token}`, JSON.stringify(data));
    } catch {
      /* ignore */
    }
    start();
  } catch {
    // No signal: use what we saved last time, so a sign-in can still be captured and sent later.
    let cached: SiteInfo | null = null;
    try {
      cached = JSON.parse(localStorage.getItem(`siteroll-site-${token}`) || 'null');
    } catch {
      /* ignore */
    }
    if (cached?.worker) {
      info = cached;
      return start();
    }
    app.replaceChildren(
      h(
        'div',
        { class: 'body' },
        h('div', { class: 'panel warn' }, h('h2', {}, 'No signal'), h('p', {}, "We can't reach SiteRoll right now. Move to where you get signal and try again.")),
        h('button', { class: 'btn primary', onclick: load }, 'Try again'),
      ),
    );
  }
}

function start() {
  {
    document.documentElement.style.setProperty('--brand', info.agency.colour);
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', info.agency.colour);
    document.title = `Sign in · ${info.site.name}`;
    addManifest();
    if (!demoPlace && info.demoPlaces.length) demoPlace = info.demoPlaces.find((p) => p.label === info.site.name)?.key ?? info.demoPlaces[0].key;
    const pending = readPending();
    if (pending) return sendPending(pending);
    info.worker ? showMain() : showPhone();
  }
}

function addManifest() {
  if (document.querySelector('link[rel=manifest]')) return;
  document.head.append(h('link', { rel: 'manifest', href: `/s/${encodeURIComponent(token)}/manifest.webmanifest` }));
}

/* ---------------- First time on this phone ---------------- */

function showPhone(error?: string) {
  const input = h('input', { class: 'text', type: 'tel', inputmode: 'tel', autocomplete: 'tel', id: 'phone', placeholder: '07700 900123', required: true, 'data-autofocus': true });
  const form = h(
    'form',
    {
      class: 'body',
      style: 'padding:0;gap:1rem;display:flex;flex-direction:column',
      onsubmit: async (e: Event) => {
        e.preventDefault();
        busy(form, true, 'Sending…');
        try {
          const r = await post('/api/w/code', { phone: input.value });
          showCode(input.value, r.demoCode);
        } catch (err) {
          showPhone((err as Error).message);
        }
      },
    },
    h('p', { class: 'hello' }, 'First time on this phone?', h('small', {}, "Enter your mobile number and we'll text you a 6-digit code. You only do this once.")),
    error ? h('div', { class: 'panel bad', role: 'alert' }, h('p', {}, error)) : null,
    h('label', { class: 'field', for: 'phone' }, 'Your mobile number', input),
    h('button', { class: 'btn primary', type: 'submit' }, 'Text me a code'),
    info.demoHint ? h('div', { class: 'demo' }, h('span', { class: 'tag' }, 'DEMO'), h('p', {}, `Try ${info.demoHint.phone} (${info.demoHint.name}). The text appears on screen and in the Outbox.`)) : null,
  );
  screen(form);
}

function showCode(phone: string, demoCode?: string, error?: string) {
  const input = h('input', { class: 'text code', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9]*', maxlength: 6, id: 'code', required: true, 'data-autofocus': true });
  const submit = async () => {
    busy(form, true, 'Checking…');
    try {
      await post('/api/w/verify', { phone, code: input.value });
      await load();
    } catch (err) {
      showCode(phone, demoCode, (err as Error).message);
    }
  };
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '').slice(0, 6);
    if (input.value.length === 6) submit();
  });
  const form = h(
    'form',
    {
      class: 'body',
      style: 'padding:0;gap:1rem;display:flex;flex-direction:column',
      onsubmit: (e: Event) => {
        e.preventDefault();
        submit();
      },
    },
    h('p', { class: 'hello' }, 'Enter the code', h('small', {}, `We've texted a 6-digit code to ${phone}.`)),
    error ? h('div', { class: 'panel bad', role: 'alert' }, h('p', {}, error)) : null,
    demoCode ? h('div', { class: 'demo' }, h('span', { class: 'tag' }, 'DEMO TEXT'), h('p', {}, `Your SiteRoll code is ${demoCode}`)) : null,
    h('label', { class: 'field', for: 'code' }, '6-digit code', input),
    h('button', { class: 'btn primary', type: 'submit' }, 'Confirm'),
    h('button', { class: 'btn', type: 'button', onclick: () => showPhone() }, 'Use a different number'),
  );
  screen(form);
}

/* ---------------- Main screen ---------------- */

function showMain() {
  const w = info.worker!;
  const signedHere = w.signedIn?.here;
  // This client turns away expired cards: say so now, rather than after a selfie. (The server checks too.)
  if (!signedHere && info.site.blocksExpiredCards && (w.card === 'expired' || w.card === 'missing')) {
    return screen(
      h('p', { class: 'hello' }, `Hi ${w.firstName}`),
      h(
        'div',
        { class: 'panel bad', role: 'alert' },
        h('h2', {}, "You can't sign in on this site"),
        h('p', {}, w.card === 'expired' ? 'Your card has expired, and this site only lets in people with an in-date card.' : "We don't have your card on file, and this site only lets in people with an in-date card."),
        h('p', {}, `Please call ${info.agency.name} to sort it out.`),
      ),
      h('a', { class: 'btn primary', href: `tel:${info.agency.phone.replace(/\s/g, '')}` }, `Call ${info.agency.phone}`),
    );
  }
  const action: 'in' | 'out' = signedHere ? 'out' : 'in';
  const btn = h(
    'button',
    { class: `big ${action === 'out' ? 'out' : ''}`, onclick: () => (action === 'in' ? startSignIn(btn) : showBreak()) },
    svg(action === 'in' ? ICON_IN : ICON_OUT),
    action === 'in' ? 'Sign in' : 'Sign out',
  );
  screen(
    h('p', { class: 'hello' }, `Hi ${w.firstName}`, h('small', {}, signedHere ? `You signed in here at ${fmtTime(w.signedIn!.since)}.` : 'Tap the button when you arrive on site.')),
    w.signedIn && !w.signedIn.here ? h('div', { class: 'status' }, h('strong', {}, `You're still signed in at ${w.signedIn.siteName}. `), "Signing in here will sign you out there.") : null,
    demoPicker(),
    btn,
    action === 'in' && info.site.selfieRequired ? h('p', { style: 'margin:0;color:var(--muted);text-align:center' }, 'This site asks for a quick selfie when you sign in.') : null,
  );
}

function demoPicker() {
  if (!info.demoMode || !info.demoPlaces.length) return null;
  const select = h(
    'select',
    { id: 'demo-place', onchange: (e: Event) => (demoPlace = (e.target as HTMLSelectElement).value) },
    ...info.demoPlaces.map((p) => h('option', { value: p.key, selected: p.key === demoPlace }, p.label)),
    h('option', { value: '', selected: demoPlace === '' }, 'Use my real location'),
  );
  return h('div', { class: 'demo' }, h('span', { class: 'tag' }, 'DEMO ONLY'), h('label', { for: 'demo-place', style: 'display:block;font-weight:700;margin-bottom:.3rem' }, "Pretend I'm at…"), select);
}

function busy(el: HTMLElement, on: boolean, text = 'Checking where you are…') {
  const b = el instanceof HTMLButtonElement ? el : el.querySelector<HTMLButtonElement>('button[type=submit]');
  if (!b) return;
  b.disabled = on;
  if (on) b.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', { class: 'sr-only' }, text), b.classList.contains('big') ? '' : text);
}

/** Read the phone's position once, with high accuracy. Never watched or tracked. */
function getReading(): Promise<Reading> {
  const place = info.demoMode ? info.demoPlaces.find((p) => p.key === demoPlace) : undefined;
  if (place) return Promise.resolve({ lat: place.lat, lng: place.lng, accuracy: place.accuracy });
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('no_geo'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(new Error(e.code === 1 ? 'denied' : 'unavailable')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  });
}

function locationProblem(kind: string) {
  screen(
    h(
      'div',
      { class: 'panel warn', role: 'alert' },
      h('h2', {}, kind === 'denied' ? 'Location is turned off' : "Can't find your location"),
      h('p', {}, kind === 'denied' ? 'SiteRoll needs your location once to check you are on site. Allow location for this page in your browser settings, then try again.' : 'Your phone could not work out where it is. Step outside, away from buildings, and try again.'),
      location.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(location.hostname) ? h('p', {}, '(This page needs a secure https:// address for location to work.)') : null,
    ),
    h('button', { class: 'btn primary', onclick: showMain }, 'Try again'),
  );
}

/* ---------------- Signing in ---------------- */

async function startSignIn(btn: HTMLButtonElement | null) {
  // The camera must open straight from the tap, so take the selfie first, then the location.
  if (info.site.selfieRequired && !info.worker?.signedIn?.here) return takeSelfie();
  if (btn) busy(btn, true);
  await doSign('in', null, null);
}

function takeSelfie() {
  const input = h('input', { type: 'file', accept: 'image/*', capture: 'user', class: 'sr-only', 'aria-label': 'Take a selfie' }) as HTMLInputElement;
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    showWorking('Checking where you are…');
    try {
      const selfie = await shrink(file);
      await doSign('in', null, selfie);
    } catch {
      showMain();
    }
  });
  document.body.append(input);
  input.click();
  setTimeout(() => input.remove(), 60000);
}

function shrink(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 480;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.75));
    };
    img.onerror = reject;
    img.src = url;
  });
}

function showWorking(text: string) {
  screen(h('div', { class: 'panel', style: 'display:flex;gap:1rem;align-items:center;background:var(--soft);border-color:var(--line)' }, h('span', { class: 'spinner', style: 'border-color:#ccc;border-top-color:#000' }), h('p', { style: 'font-weight:700' }, text)));
}

/* ---------------- Signing out ---------------- */

let readingPromise: Promise<Reading> | null = null;

function showBreak() {
  // Start finding the location while they answer, to save time.
  readingPromise = getReading();
  readingPromise.catch(() => {});
  const choose = (mins: number | null) => async () => {
    showWorking('Signing you out…');
    await doSign('out', mins, null);
  };
  screen(
    h('h2', { style: 'font-size:1.7rem;margin:0' }, 'Did you take a break?'),
    h(
      'div',
      { class: 'choices' },
      h('button', { class: 'btn', onclick: choose(0) }, 'None'),
      h('button', { class: 'btn', onclick: choose(30) }, '30 mins'),
      h('button', { class: 'btn', onclick: choose(60) }, '1 hour'),
    ),
    h('button', { class: 'btn', style: 'border-style:dashed', onclick: choose(null) }, `Skip (counts as ${info.site.breakDefault} mins)`),
    h('button', { class: 'btn', style: 'border:0;text-decoration:underline', onclick: showMain }, 'Back'),
  );
}

/* ---------------- Sending ---------------- */

async function doSign(action: 'in' | 'out', breakMins: number | null, selfie: string | null) {
  let reading: Reading;
  try {
    reading = await (action === 'out' && readingPromise ? readingPromise : getReading());
  } catch (e) {
    readingPromise = null;
    return locationProblem((e as Error).message);
  }
  readingPromise = null;
  const pending: Pending = { token, action, reading, capturedAt: new Date().toISOString(), breakMins, selfie };
  await send(pending);
}

async function send(p: Pending) {
  try {
    const r = await post('/api/w/sign', p);
    clearPending();
    handleResult(p, r);
  } catch (err) {
    const e = err as Error & { status?: number };
    if (e.status === 401) {
      clearPending();
      return showPhone('This phone needs setting up again.');
    }
    if (e.status) {
      // A real answer from the server (not a signal problem): show it.
      clearPending();
      return screen(h('div', { class: 'panel bad', role: 'alert' }, h('h2', {}, 'Something went wrong'), h('p', {}, e.message)), h('button', { class: 'btn primary', onclick: load }, 'Try again'));
    }
    // No signal: keep it on the phone and send it when we can.
    savePending(p);
    showSaved(p);
  }
}

function handleResult(p: Pending, r: any) {
  if (r.status === 'signed_in' || r.status === 'already_in') {
    const warnings: string[] = r.warnings ?? [];
    return screen(
      h(
        'div',
        { class: 'panel ok' },
        h('div', { class: 'tick' }, svg(ICON_TICK)),
        h('h2', {}, r.status === 'already_in' ? "You're already signed in" : "You're signed in"),
        h('div', { class: 'time' }, fmtTime(r.at)),
        h('p', {}, `${info.site.name}. Have a safe day, ${info.worker?.firstName}.`),
      ),
      warnings.length ? h('div', { class: 'panel warn', role: 'alert' }, h('h2', { style: 'font-size:1.25rem' }, 'Please note'), h('ul', { class: 'warnings' }, ...warnings.map((w) => h('li', {}, w)))) : null,
      h('p', { style: 'margin:0;color:var(--muted)' }, 'Scan the board again when you leave to sign out.'),
    );
  }
  if (r.status === 'signed_out') {
    return screen(
      h('div', { class: 'panel ok' }, h('div', { class: 'tick' }, svg(ICON_TICK)), h('h2', {}, "You're signed out"), h('div', { class: 'time' }, fmtTime(r.at)), h('p', {}, `${r.workedText}. Get home safe, ${info.worker?.firstName}.`)),
    );
  }
  if (r.status === 'not_signed_in') {
    return screen(h('div', { class: 'panel warn' }, h('h2', {}, "You're not signed in"), h('p', {}, 'We have no sign-in for you to close. Tap Sign in if you are starting work.')), h('button', { class: 'btn primary', onclick: load }, 'OK'));
  }
  if (r.status === 'need_selfie') return takeSelfie();
  if (r.status === 'blocked') {
    if (r.reason === 'card_expired') {
      return screen(
        h('div', { class: 'panel bad', role: 'alert' }, h('h2', {}, "You can't sign in on this site"), h('p', {}, r.message)),
        h('a', { class: 'btn primary', href: `tel:${info.agency.phone.replace(/\s/g, '')}` }, `Call ${info.agency.name}`),
      );
    }
    const manual = h(
      'button',
      {
        class: 'btn',
        onclick: async () => {
          manual.disabled = true;
          try {
            await post('/api/w/manual', { attemptId: r.attemptId });
            screen(
              h('div', { class: 'panel ok' }, h('h2', {}, 'Request sent'), h('p', {}, `We've asked the site manager to sign you ${p.action === 'in' ? 'in' : 'out'} by hand. Find them so they can approve it.`)),
              h('button', { class: 'btn', onclick: load }, 'Back'),
            );
          } catch (err) {
            manual.disabled = false;
            alert((err as Error).message);
          }
        },
      },
      `Ask the site manager to sign me ${p.action === 'in' ? 'in' : 'out'}`,
    );
    return screen(
      h(
        'div',
        { class: 'panel bad', role: 'alert' },
        h('h2', {}, r.reason === 'outside' ? "You don't seem to be on site" : "Can't confirm you're on site"),
        h('p', {}, r.reason === 'outside' ? String(r.message).replace(/^You don't seem to be on site\.\s*/, '') : r.message),
        r.reason === 'outside' ? h('p', { style: 'font-size:.95rem' }, 'If you are on site, step outside away from buildings and try again, or ask the site manager.') : null,
      ),
      h('button', { class: 'btn primary', onclick: () => (p.action === 'in' ? showMain() : showBreak()) }, 'Try again'),
      manual,
      demoPicker(),
    );
  }
  screen(h('div', { class: 'panel bad' }, h('h2', {}, 'Something went wrong'), h('p', {}, r.message || r.error || 'Please try again.')), h('button', { class: 'btn primary', onclick: load }, 'Try again'));
}

/* ---------------- No signal: keep and retry ---------------- */

function savePending(p: Pending) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(p));
  } catch {
    /* storage full or blocked: nothing more we can do */
  }
}
function readPending(): Pending | null {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null') as Pending | null;
    if (!p || p.token !== token) return null;
    if (Date.now() - new Date(p.capturedAt).getTime() > 12 * 3600000) {
      clearPending();
      return null;
    }
    return p;
  } catch {
    return null;
  }
}
function clearPending() {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

function showSaved(p: Pending) {
  screen(
    h(
      'div',
      { class: 'panel warn', role: 'alert' },
      h('h2', {}, 'No signal – saved on your phone'),
      h('p', {}, `We've saved your ${p.action === 'in' ? 'sign-in' : 'sign-out'} at ${fmtTime(p.capturedAt)}. It will be sent with that time as soon as you have signal.`),
      h('p', {}, 'Keep this page open, or open it again later.'),
    ),
    h('button', { class: 'btn primary', onclick: () => sendPending(p) }, 'Send now'),
  );
}

function sendPending(p: Pending) {
  showWorking(`Sending your ${p.action === 'in' ? 'sign-in' : 'sign-out'} from ${fmtTime(p.capturedAt)}…`);
  return send(p);
}

window.addEventListener('online', () => {
  const p = readPending();
  if (p && info) sendPending(p);
});

async function forgetPhone() {
  if (!confirm('Forget this phone? You will need a new text code next time.')) return;
  await post('/api/w/forget', {});
  load();
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js', { scope: '/s/' }).catch(() => {});
}

load();
