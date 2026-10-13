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
  return db;
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
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
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
