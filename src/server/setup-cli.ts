// Set up a real agency (no demo data), or add another member of staff.
//
//   npm run setup -- --agency "Pennine Site Staffing Ltd" --name "Michelle Lockwood" --email office@example.co.uk --password "a long password"
//   npm run add-user -- --name "Dan Hirst" --email dan@example.co.uk --password "another long password"
//
// Then log in, and fill in the rest under Settings (address, bank details, logo and colour).
import { getDb, clearAll, nowIso } from './db';
import { hashPassword } from './lib/security';

function args(): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  const list = process.argv.slice(2);
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a.startsWith('--')) continue;
    const next = list[i + 1];
    if (next && !next.startsWith('--')) {
      out[a.slice(2)] = next;
      i++;
    } else out[a.slice(2)] = true;
  }
  return out;
}

function need(a: Record<string, string | true>, key: string): string {
  const v = a[key];
  if (typeof v !== 'string' || !v.trim()) {
    console.error(`Missing --${key}`);
    process.exit(1);
  }
  return v.trim();
}

function checkPassword(p: string) {
  if (p.length < 12) {
    console.error('Please use a password of at least 12 characters.');
    process.exit(1);
  }
}

const a = args();
const db = getDb();
const mode = a['add-user'] ? 'add-user' : 'setup';

if (mode === 'setup') {
  const agency = need(a, 'agency');
  const name = need(a, 'name');
  const email = need(a, 'email').toLowerCase();
  const password = need(a, 'password');
  checkPassword(password);
  const hasData = db.prepare('SELECT 1 FROM agency WHERE id = 1').get();
  if (hasData && !a.force) {
    console.error('There is already an agency in this database. Add --force to wipe everything (including all records) and start again.');
    process.exit(1);
  }
  clearAll(db);
  db.prepare('INSERT INTO agency (id, name) VALUES (1, ?)').run(agency);
  db.prepare('INSERT INTO users (name, email, password_hash, created_at) VALUES (?,?,?,?)').run(name, email, hashPassword(password), nowIso());
  console.log(`\n  ${agency} is set up. Log in as ${email}, then fill in Settings, add clients, sites and workers.\n  Remember to set DEMO_MODE=false in .env.\n`);
} else {
  const name = need(a, 'name');
  const email = need(a, 'email').toLowerCase();
  const password = need(a, 'password');
  checkPassword(password);
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    console.error('Someone with that email already has a login.');
    process.exit(1);
  }
  db.prepare('INSERT INTO users (name, email, password_hash, created_at) VALUES (?,?,?,?)').run(name, email, hashPassword(password), nowIso());
  console.log(`Added ${name} (${email}).`);
}
