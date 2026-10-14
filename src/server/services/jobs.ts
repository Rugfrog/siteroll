// Background checks, run once a minute: no-shows, Friday sign-off links, missed sign-outs
// and deleting old photos.
import type { DB } from '../db';
import { clock } from '../config';
import { addDays, londonDate } from '../../shared/time';
import { closeMissedSignOuts } from './attendance';
import { deleteUpload } from './files';
import { syncAllBookedHours } from './timesheets';
import { agencyRow, runNoShowCheck, runSignoffSchedule } from './workflows';

/** Delete selfies older than the agency's retention period (and card photos of people who've left). */
export function runPhotoRetention(db: DB): number {
  const a = agencyRow(db);
  if (!a) return 0;
  const cutoff = addDays(londonDate(clock.now()), -a.photo_retention_days);
  const old = db.prepare('SELECT id, selfie_path FROM attendance WHERE selfie_path IS NOT NULL AND work_date < ?').all(cutoff) as { id: number; selfie_path: string }[];
  for (const r of old) {
    deleteUpload(r.selfie_path);
    db.prepare('UPDATE attendance SET selfie_path = NULL WHERE id = ?').run(r.id);
  }
  const leavers = db.prepare("SELECT id, card_photo_path FROM workers WHERE active = 0 AND card_photo_path IS NOT NULL").all() as { id: number; card_photo_path: string }[];
  for (const w of leavers) {
    deleteUpload(w.card_photo_path);
    db.prepare('UPDATE workers SET card_photo_path = NULL WHERE id = ?').run(w.id);
  }
  // Housekeeping: expired sessions, links and codes.
  const now = clock.now().toISOString();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  db.prepare('DELETE FROM magic_links WHERE expires_at < ?').run(now);
  db.prepare('DELETE FROM verification_codes WHERE expires_at < ?').run(addDays(now.slice(0, 10), -1));
  return old.length + leavers.length;
}

export function runAllJobs(db: DB) {
  const result = { noShows: 0, signoffs: 0, missed: 0, photos: 0, bookedHours: 0 };
  try {
    result.bookedHours = syncAllBookedHours(db);
    result.noShows = runNoShowCheck(db);
    result.signoffs = runSignoffSchedule(db);
    result.missed = closeMissedSignOuts(db);
    // Retention once a day is plenty.
    const key = londonDate(clock.now());
    const last = db.prepare("SELECT last_key FROM job_runs WHERE name = 'retention'").get() as { last_key: string } | undefined;
    if (last?.last_key !== key) {
      result.photos = runPhotoRetention(db);
      db.prepare("INSERT INTO job_runs (name, last_key) VALUES ('retention', ?) ON CONFLICT(name) DO UPDATE SET last_key = excluded.last_key").run(key);
    }
  } catch (e) {
    console.error('Background job failed:', e);
  }
  return result;
}

export function startJobs(db: DB) {
  runAllJobs(db);
  return setInterval(() => runAllJobs(db), 60_000);
}
