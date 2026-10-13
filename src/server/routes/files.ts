// Photos are never public: each request checks who is asking.
import { Router } from 'express';
import { getDb } from '../db';
import { v } from '../lib/validate';
import { canSeeSite } from '../auth';
import { uploadPath } from '../services/files';
import { agencyRow } from '../services/workflows';

export const filesRouter = Router();

const noStore = { 'Cache-Control': 'private, no-store' };

/** Selfies: agency, and the client manager for that site. */
filesRouter.get('/selfie/:attendanceId', (req, res) => {
  const a = getDb().prepare('SELECT site_id, selfie_path FROM attendance WHERE id = ?').get(v.id(req.params.attendanceId)) as { site_id: number; selfie_path: string | null } | undefined;
  if (!a || !canSeeSite(req.user, a.site_id)) return res.status(404).end();
  const p = uploadPath(a.selfie_path);
  if (!p) return res.status(404).end();
  res.set(noStore).sendFile(p);
});

/** Card photos: agency only. */
filesRouter.get('/card/:workerId', (req, res) => {
  if (req.user?.type !== 'agency') return res.status(404).end();
  const w = getDb().prepare('SELECT card_photo_path FROM workers WHERE id = ?').get(v.id(req.params.workerId)) as { card_photo_path: string | null } | undefined;
  const p = uploadPath(w?.card_photo_path);
  if (!p) return res.status(404).end();
  res.set(noStore).sendFile(p);
});

/** The agency logo is shown on posters and the worker page, so it is public. */
filesRouter.get('/logo', (_req, res) => {
  const p = uploadPath(agencyRow(getDb())?.logo_path);
  if (!p) return res.status(404).end();
  res.set({ 'Cache-Control': 'public, max-age=300' }).sendFile(p);
});
