import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

if (existsSync('.env') && typeof (process as any).loadEnvFile === 'function') {
  (process as any).loadEnvFile('.env');
}

const isProd = process.env.NODE_ENV === 'production';
const isTest = !!process.env.VITEST;

export const config = {
  isProd,
  isTest,
  port: Number(process.env.PORT || 3000),
  /** Demo tools: "Pretend I'm at…", demo reset, codes shown on screen. Off in production unless asked for. */
  demoMode: process.env.DEMO_MODE ? process.env.DEMO_MODE === 'true' : !isProd,
  // Render sets RENDER_EXTERNAL_URL for us, so QR codes and links point at the live site.
  publicUrl: (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, ''),
  https: process.env.HTTPS === '1' || process.env.HTTPS === 'true',
  dbPath: isTest ? ':memory:' : process.env.DB_PATH || 'data/siteroll.db',
  /** Twilio sends real WhatsApp messages and texts. Without it, messages are simulated in the Outbox. */
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    // e.g. whatsapp:+14155238886 (Twilio's WhatsApp sandbox) or your approved WhatsApp sender
    whatsappFrom: process.env.TWILIO_WHATSAPP_FROM || '',
    // a Twilio phone number for ordinary texts (optional)
    smsFrom: process.env.TWILIO_SMS_FROM || '',
  },
  dataDir: resolve(process.env.DATA_DIR || 'data'),
  get uploadDir() {
    return resolve(this.dataDir, isTest ? 'test-uploads' : 'uploads');
  },
};

export function ensureDirs() {
  for (const d of [config.dataDir, config.uploadDir, resolve(config.uploadDir, 'selfies'), resolve(config.uploadDir, 'cards'), resolve(config.uploadDir, 'branding')]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}

/** The clock. Tests replace `now` to check time-based rules. */
export const clock = {
  now: (): Date => new Date(),
};
