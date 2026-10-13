import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ViteDevServer } from 'vite';
import { config } from './config';
import { getDb } from './db';
import { ValidationError } from './lib/validate';
import { loadUser, startSession } from './auth';
import { authRouter, consumeMagicLink } from './routes/auth';
import { workerRouter } from './routes/worker';
import { liveRouter } from './routes/live';
import { moneyRouter } from './routes/money';
import { adminRouter } from './routes/admin';
import { filesRouter } from './routes/files';
import { TimesheetError } from './services/timesheets';
import { ImageError } from './services/files';
import { agencyRow } from './services/workflows';

export interface AppOptions {
  vite?: ViteDevServer;
  distDir?: string;
}

export function createApp(opts: AppOptions = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      // Links contain secret tokens, so never leak the URL to other sites.
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'geolocation=(self), camera=(self), microphone=()',
    });
    if (config.isProd) {
      res.set(
        'Content-Security-Policy',
        "default-src 'self'; img-src 'self' data: blob: https://*.tile.openstreetmap.org; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      );
    }
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    next();
  });

  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use(loadUser);

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  app.use('/api/auth', authRouter);
  app.use('/api/w', workerRouter);
  app.use('/files', filesRouter);
  app.use('/api', liveRouter);
  app.use('/api', moneyRouter);
  app.use('/api', adminRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // Magic links for client site managers
  app.get('/m/:token', (req, res) => {
    const link = consumeMagicLink(String(req.params.token));
    if (!link) return res.redirect('/login?expired=1');
    startSession(req, res, 'manager', link.managerId);
    res.redirect('/client');
  });
  app.get('/approve/:token', (req, res) => {
    const link = consumeMagicLink(String(req.params.token));
    if (!link) return res.redirect('/login?expired=1');
    startSession(req, res, 'manager', link.managerId);
    res.redirect(link.timesheetId ? `/client/timesheets/${link.timesheetId}` : '/client/timesheets');
  });

  // Per-site web app manifest, so "Add to home screen" opens straight to that site.
  app.get('/s/:token/manifest.webmanifest', (req, res) => {
    const site = getDb().prepare('SELECT name FROM sites WHERE qr_token = ?').get(String(req.params.token)) as { name: string } | undefined;
    const a = agencyRow(getDb());
    res.type('application/manifest+json').json({
      name: site ? `Sign in – ${site.name}` : 'SiteRoll sign in',
      short_name: 'Sign in',
      start_url: `/s/${req.params.token}`,
      scope: '/s/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: a?.brand_colour ?? '#0e6655',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      ],
    });
  });

  const root = resolve('.');
  const sendHtml = (file: 'index.html' | 'worker.html') => async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (opts.vite) {
        const html = await opts.vite.transformIndexHtml(req.originalUrl, readFileSync(resolve(root, file), 'utf8'));
        res.status(200).set({ 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }).end(html);
      } else if (opts.distDir) {
        res.set('Cache-Control', 'no-cache').sendFile(resolve(opts.distDir, file));
      } else {
        res.status(200).type('html').send('<!doctype html><title>SiteRoll</title><p>Front end not built.</p>');
      }
    } catch (e) {
      opts.vite?.ssrFixStacktrace(e as Error);
      next(e);
    }
  };

  if (opts.vite) app.use(opts.vite.middlewares);
  else if (opts.distDir) app.use(express.static(opts.distDir, { index: false, maxAge: '7d', setHeaders: (res, p) => /sw\.js$|\.webmanifest$/.test(p) && res.set('Cache-Control', 'no-cache') }));

  app.get('/s/:token', sendHtml('worker.html'));
  app.get('*', sendHtml('index.html'));

  // Errors
  app.use((err: Error & { status?: number; type?: string }, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ValidationError || err instanceof TimesheetError || err instanceof ImageError) return res.status(400).json({ error: err.message });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That upload is too big' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
  });

  return app;
}
