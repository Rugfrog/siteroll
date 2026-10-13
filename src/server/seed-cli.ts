// npm run seed — wipe the database and load the demo data again.
import { getDb } from './db';
import { seed } from './seed';

const r = seed(getDb());
console.log(`Demo data loaded for ${r.today}.`);
