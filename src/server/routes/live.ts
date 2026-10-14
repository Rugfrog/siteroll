// Shared by agency staff and client site managers. Every handler checks the user can see the site.
import { Router, type Request, type Response } from 'express';
import { getDb, nowIso } from '../db';
import { clock } from '../config';
import { asyncRoute, v } from '../lib/validate';
import { actorName, canSeeSite, requireStaff } from '../auth';
import { decideManual } from '../services/attendance';
import { live, notify, type LiveEvent } from '../services/events';
import { liveBoard } from '../services/board';
import { raiseAlarm } from '../services/firealarm';
import { rollCallPdf } from '../pdf/documents';

export const liveRouter = Router();
liveRouter.use(requireStaff);

liveRouter.get('/live', (req, res) => {
  res.json(liveBoard(getDb(), req.user!.siteIds));
});

/** Server-sent events: tells the board to refresh when something changes. */
liveRouter.get('/live/stream', (req: Request, res: Response) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 5000\n\n');
  const user = req.user;
  const onChange = (ev: LiveEvent) => {
    if (ev.siteId && !canSeeSite(user, ev.siteId)) return;
    res.write(`event: change\ndata: ${JSON.stringify({ type: ev.type })}\n\n`);
  };
  live.on('change', onChange);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    live.off('change', onChange);
  });
});

/* ---------- Alerts ---------- */

liveRouter.get('/alerts', (req, res) => {
  const db = getDb();
  const open = req.query.all ? '' : 'AND al.resolved_at IS NULL';
  const rows = db
    .prepare(
      `SELECT al.*, w.first_name, w.last_name, w.phone, s.name AS site_name FROM alerts al
       LEFT JOIN workers w ON w.id = al.worker_id LEFT JOIN sites s ON s.id = al.site_id
       WHERE 1 = 1 ${open} ORDER BY al.created_at DESC LIMIT 200`,
    )
    .all() as { site_id: number | null; type: string }[];
  const visible = rows.filter((a) => {
    if (req.user!.type === 'agency') return true;
    return a.site_id != null && canSeeSite(req.user, a.site_id) && ['manual_request', 'no_show'].includes(a.type);
  });
  res.json(visible);
});

/* ---------- Manual sign-in requests ---------- */

liveRouter.post('/attempts/:id/:decision', (req, res) => {
  const db = getDb();
  const id = v.id(req.params.id);
  const decision = v.oneOf(req.params.decision, 'decision', ['approve', 'reject'] as const);
  const att = db.prepare('SELECT site_id FROM sign_in_attempts WHERE id = ?').get(id) as { site_id: number } | undefined;
  if (!att || !canSeeSite(req.user, att.site_id)) return res.status(404).json({ error: 'Not found' });
  const r = decideManual(db, id, decision === 'approve', actorName(req.user!));
  if (!r.ok) return res.status(400).json({ error: r.message });
  res.json({ ok: true });
});

/* ---------- Fire roll call ---------- */

interface RollCallRow {
  id: number;
  site_id: number;
  kind: string;
  started_by: string;
  started_at: string;
  finished_at: string | null;
  notes: string;
}

function loadRollCall(req: Request, id: number) {
  const db = getDb();
  const rc = db.prepare('SELECT * FROM roll_calls WHERE id = ?').get(id) as RollCallRow | undefined;
  if (!rc || !canSeeSite(req.user, rc.site_id)) return null;
  return rc;
}

function rollCallView(rc: RollCallRow) {
  const db = getDb();
  const site = db.prepare('SELECT name FROM sites WHERE id = ?').get(rc.site_id) as { name: string };
  const people = db.prepare('SELECT * FROM roll_call_people WHERE roll_call_id = ? ORDER BY is_visitor DESC, name').all(rc.id) as {
    id: number;
    name: string;
    detail: string;
    is_visitor: number;
    safe_at: string | null;
    safe_by: string | null;
    help_at: string | null;
    alert_token_hash: string | null;
  }[];
  return {
    id: rc.id,
    siteId: rc.site_id,
    siteName: site.name,
    kind: rc.kind,
    startedBy: rc.started_by,
    startedAt: rc.started_at,
    finishedAt: rc.finished_at,
    notes: rc.notes,
    people: people.map((p) => ({
      id: p.id,
      name: p.name,
      detail: p.detail,
      visitor: !!p.is_visitor,
      safeAt: p.safe_at,
      safeBy: p.safe_by,
      helpAt: p.safe_at ? null : p.help_at,
      alerted: !!p.alert_token_hash,
    })),
    total: people.length,
    safe: people.filter((p) => p.safe_at).length,
    alerted: people.filter((p) => p.alert_token_hash).length,
    safeByPhone: people.filter((p) => p.safe_by === 'phone').length,
    needHelp: people.filter((p) => p.help_at && !p.safe_at).length,
  };
}

liveRouter.post('/rollcalls', (req, res) => {
  const db = getDb();
  const siteId = v.id(req.body?.siteId, 'site');
  if (!canSeeSite(req.user, siteId)) return res.status(404).json({ error: 'Site not found' });
  const kind = v.oneOf(req.body?.kind ?? 'drill', 'type', ['drill', 'incident'] as const);
  const now = nowIso(clock.now());
  // If one is already running on this site, carry on with it rather than starting another.
  const running = db.prepare('SELECT * FROM roll_calls WHERE site_id = ? AND finished_at IS NULL ORDER BY id DESC LIMIT 1').get(siteId) as RollCallRow | undefined;
  if (running) return res.json(rollCallView(running));
  const id = Number(db.prepare('INSERT INTO roll_calls (site_id, kind, started_by, started_at) VALUES (?,?,?,?)').run(siteId, kind, actorName(req.user!), now).lastInsertRowid);
  const people = db
    .prepare(`SELECT a.worker_id, w.first_name, w.last_name, w.trade, a.in_at FROM attendance a JOIN workers w ON w.id = a.worker_id WHERE a.site_id = ? AND a.out_at IS NULL`)
    .all(siteId) as { worker_id: number; first_name: string; last_name: string; trade: string; in_at: string }[];
  const ins = db.prepare('INSERT INTO roll_call_people (roll_call_id, worker_id, name, detail) VALUES (?,?,?,?)');
  for (const p of people) ins.run(id, p.worker_id, `${p.first_name} ${p.last_name}`, p.trade);
  // Text (and push) everyone on site: their phones turn into an "Are you safe?" alarm.
  raiseAlarm(db, id);
  notify({ type: 'rollcall', siteId });
  res.json(rollCallView(db.prepare('SELECT * FROM roll_calls WHERE id = ?').get(id) as RollCallRow));
});

liveRouter.get('/rollcalls', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM roll_calls ORDER BY started_at DESC LIMIT 100').all() as RollCallRow[];
  res.json(rows.filter((r) => canSeeSite(req.user, r.site_id)).map(rollCallView));
});

liveRouter.get('/rollcalls/:id', (req, res) => {
  const rc = loadRollCall(req, v.id(req.params.id));
  if (!rc) return res.status(404).json({ error: 'Not found' });
  res.json(rollCallView(rc));
});

liveRouter.post('/rollcalls/:id/mark', (req, res) => {
  const rc = loadRollCall(req, v.id(req.params.id));
  if (!rc) return res.status(404).json({ error: 'Not found' });
  if (rc.finished_at) return res.status(400).json({ error: 'This roll call has finished' });
  const personId = v.id(req.body?.personId, 'person');
  const safe = v.bool(req.body?.safe);
  getDb()
    .prepare('UPDATE roll_call_people SET safe_at = ?, safe_by = ? WHERE id = ? AND roll_call_id = ?')
    .run(safe ? nowIso(clock.now()) : null, safe ? req.user!.name : null, personId, rc.id);
  notify({ type: 'rollcall', siteId: rc.site_id });
  res.json(rollCallView(rc));
});

liveRouter.post('/rollcalls/:id/visitor', (req, res) => {
  const rc = loadRollCall(req, v.id(req.params.id));
  if (!rc) return res.status(404).json({ error: 'Not found' });
  if (rc.finished_at) return res.status(400).json({ error: 'This roll call has finished' });
  const name = v.str(req.body?.name, 'Name', 80);
  const detail = v.str(req.body?.detail, 'Details', 80, { required: false }) || 'Visitor';
  getDb().prepare('INSERT INTO roll_call_people (roll_call_id, name, detail, is_visitor) VALUES (?,?,?,1)').run(rc.id, name, detail);
  res.json(rollCallView(rc));
});

liveRouter.post('/rollcalls/:id/finish', (req, res) => {
  const rc = loadRollCall(req, v.id(req.params.id));
  if (!rc) return res.status(404).json({ error: 'Not found' });
  const notes = v.str(req.body?.notes, 'Notes', 2000, { required: false });
  const kind = v.oneOf(req.body?.kind ?? rc.kind, 'type', ['drill', 'incident'] as const);
  getDb().prepare('UPDATE roll_calls SET finished_at = COALESCE(finished_at, ?), notes = ?, kind = ? WHERE id = ?').run(nowIso(clock.now()), notes, kind, rc.id);
  notify({ type: 'rollcall', siteId: rc.site_id });
  res.json(rollCallView(getDb().prepare('SELECT * FROM roll_calls WHERE id = ?').get(rc.id) as RollCallRow));
});

liveRouter.get('/rollcalls/:id/pdf', asyncRoute(async (req, res) => {
  const rc = loadRollCall(req, v.id(req.params.id));
  if (!rc) return res.status(404).json({ error: 'Not found' });
  const pdf = await rollCallPdf(getDb(), rc.id);
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="roll-call-${rc.id}.pdf"` });
  res.send(pdf);
}));
