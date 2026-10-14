import Database from 'better-sqlite3';
import { config, ensureDirs } from './config';
import { SCHEMA } from './schema';

export type DB = Database.Database;

let instance: DB | null = null;

export function openDb(path = config.dbPath): DB {
  ensureDirs();
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Columns added after the first release: add them to older databases. */
function migrate(db: DB) {
  const add = (table: string, column: string, type: string) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  };
  add('roll_call_people', 'safe_by', 'TEXT');
  add('roll_call_people', 'help_at', 'TEXT');
  add('roll_call_people', 'alert_token_hash', 'TEXT');
  add('agency', 'message_channel', "TEXT NOT NULL DEFAULT 'whatsapp'");
  add('outbox', 'status', "TEXT NOT NULL DEFAULT 'simulated'");
  add('outbox', 'error', 'TEXT');
  add('clients', 'bookings_email', "TEXT NOT NULL DEFAULT ''");
  add('sites', 'signin_mode', "TEXT NOT NULL DEFAULT 'signin'");
  add('managers', 'role', "TEXT NOT NULL DEFAULT ''");
}

export function getDb(): DB {
  if (!instance) instance = openDb();
  return instance;
}

export function setDb(db: DB) {
  instance = db;
}

/** Wipe every table (used by the demo reset before re-seeding). */
export function clearAll(db: DB) {
  // App settings (notification keys, the demo phone) survive a demo reset.
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'app_settings'").all() as { name: string }[];
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    for (const t of tables) db.exec(`DELETE FROM "${t.name}"`);
  })();
  db.pragma('foreign_keys = ON');
}

export const nowIso = (d: Date = new Date()) => d.toISOString();

export function parseFlags(s: string | null | undefined): string[] {
  try {
    const v = JSON.parse(s || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
