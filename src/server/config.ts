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
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/$/, ''),
  https: process.env.HTTPS === '1' || process.env.HTTPS === 'true',
  dbPath: isTest ? ':memory:' : process.env.DB_PATH || 'data/siteroll.db',
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
