import http from 'node:http';
import https from 'node:https';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { config } from './config';
import { getDb } from './db';
import { createApp } from './app';
import { seed, DEMO_LOGIN } from './seed';
import { startJobs } from './services/jobs';
import { runtime } from './services/workflows';

function lanAddress(): string | null {
  for (const list of Object.values(networkInterfaces())) {
    for (const n of list ?? []) {
      if (n.family === 'IPv4' && !n.internal && !n.address.startsWith('169.254.')) return n.address;
    }
  }
  return null;
}

async function certificate(host: string) {
  const file = resolve(config.dataDir, 'dev-cert.json');
  if (existsSync(file)) {
    const c = JSON.parse(readFileSync(file, 'utf8'));
    if (c.host === host) return c;
  }
  const selfsigned = (await import('selfsigned')).default as any;
  const attrs = [{ name: 'commonName', value: host }];
  const pems = await Promise.resolve(
    selfsigned.generate(attrs, {
      days: 365,
      keySize: 2048,
      extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: host }, { type: 7, ip: '127.0.0.1' }] }],
    }),
  );
  const c = { host, key: pems.private, cert: pems.cert };
  writeFileSync(file, JSON.stringify(c));
  return c;
}

async function main() {
  const db = getDb();
  const hasData = db.prepare('SELECT 1 FROM agency WHERE id = 1').get();
  if (!hasData) {
    console.log('First run: loading the demo data…');
    seed(db);
  }

  const lan = lanAddress();
  const scheme = config.https ? 'https' : 'http';
  runtime.baseUrl = config.publicUrl || `${scheme}://${lan ?? 'localhost'}:${config.port}`;

  const server = config.https ? https.createServer(await certificate(lan ?? 'localhost')) : http.createServer();
  let vite;
  if (!config.isProd) {
    const { createServer } = await import('vite');
    // Hot reload shares the app's port, so there is only one port to think about.
    vite = await createServer({ server: { middlewareMode: true, hmr: { server } }, appType: 'custom' });
  }
  const app = createApp({ vite, distDir: config.isProd ? resolve('dist') : undefined });
  server.on('request', app);
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`
  SiteRoll is running${config.demoMode ? ' (demo mode)' : ''}

  Dashboard:     ${scheme}://localhost:${config.port}
  On your Wi-Fi: ${runtime.baseUrl}   (QR codes point here)
${config.demoMode ? `  Demo login:    ${DEMO_LOGIN.email} / ${DEMO_LOGIN.password}\n` : ''}`);
  });
  startJobs(db);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
