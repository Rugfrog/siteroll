// Web push notifications (free, no account needed): a phone that has turned on fire alerts gets
// a notification even when it's locked. Uses VAPID keys from the environment, or makes a pair
// and keeps it in the database.
import webpush from 'web-push';
import type { DB } from '../db';
import { nowIso } from '../db';
import { clock } from '../config';
import { agencyRow } from './workflows';

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

interface SubscriptionRow {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Swapped out in tests so nothing is sent over the network. */
export const pushDeps = {
  send: (sub: webpush.PushSubscription, payload: string, options: webpush.RequestOptions) => webpush.sendNotification(sub, payload, options),
};

export function vapidKeys(db: DB): { publicKey: string; privateKey: string } {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'vapid'").get() as { value: string } | undefined;
  if (row) return JSON.parse(row.value);
  const keys = webpush.generateVAPIDKeys();
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('vapid', ?)").run(JSON.stringify(keys));
  return keys;
}

export function saveSubscription(db: DB, workerId: number, sub: unknown): boolean {
  const s = sub as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof s?.endpoint !== 'string' || !/^https:\/\//.test(s.endpoint) || s.endpoint.length > 1000) return false;
  if (typeof s.keys?.p256dh !== 'string' || typeof s.keys?.auth !== 'string') return false;
  db.prepare(
    `INSERT INTO push_subscriptions (worker_id, endpoint, p256dh, auth, created_at) VALUES (?,?,?,?,?)
     ON CONFLICT(endpoint) DO UPDATE SET worker_id = excluded.worker_id, p256dh = excluded.p256dh, auth = excluded.auth`,
  ).run(workerId, s.endpoint, s.keys.p256dh.slice(0, 200), s.keys.auth.slice(0, 100), nowIso(clock.now()));
  return true;
}

export function hasSubscription(db: DB, workerId: number): boolean {
  return !!db.prepare('SELECT 1 FROM push_subscriptions WHERE worker_id = ?').get(workerId);
}

/** Send to every phone this worker has turned alerts on for. Returns how many were sent. Never throws. */
export async function pushToWorker(db: DB, workerId: number, payload: PushPayload): Promise<number> {
  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE worker_id = ?').all(workerId) as SubscriptionRow[];
  if (!subs.length) return 0;
  const keys = vapidKeys(db);
  const contact = agencyRow(db)?.email ? `mailto:${agencyRow(db).email}` : 'mailto:siteroll@example.com';
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await pushDeps.send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), {
          TTL: 600,
          urgency: 'high',
          topic: payload.tag.slice(0, 32).replace(/[^A-Za-z0-9_-]/g, '-'),
          vapidDetails: { subject: contact, publicKey: keys.publicKey, privateKey: keys.privateKey },
        });
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // The phone has unsubscribed or the browser data was cleared.
        if (status === 404 || status === 410) db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
        else console.error('Push failed:', status ?? (err as Error).message);
      }
    }),
  );
  return sent;
}
