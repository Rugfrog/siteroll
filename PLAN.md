# SiteRoll — build plan

## Stack

| Part | Choice | Why |
|---|---|---|
| Runtime | Node.js 22+ with TypeScript, run with `tsx` (no separate compile step) | One `npm run dev`, nothing to build for the server |
| API | Express, JSON | Familiar, small |
| Database | SQLite via better-sqlite3, file at `data/siteroll.db` | No server to install; auto-created and seeded on first run |
| Dashboard | React + Vite + React Router, hand-written CSS | Agency and client manager screens |
| Worker page | Separate Vite entry in plain TypeScript (no React) | Tiny bundle for cheap phones on poor signal; PWA with a service worker |
| Maps | Leaflet + OpenStreetMap tiles | Free, no API key |
| PDFs | pdfkit | Timesheets, invoices, fire roll call records |
| QR codes | `qrcode` | SVG posters |
| Tests | Vitest + supertest | Unit tests plus an end-to-end API test |

In development, Express runs Vite as middleware, so the whole thing is **one process on one port** (default 3000). It listens on the local network, so a phone on the same Wi-Fi can scan a poster.

## Folder structure

```
siteroll/
  index.html             dashboard (agency + client manager) entry
  worker.html            worker sign-in page entry
  public/                icons, service worker
  src/
    server/
      index.ts           start-up (dev: Vite middleware; prod: static files)
      app.ts             createApp() — used by index.ts and the tests
      db.ts, schema.sql  database
      seed.ts            demo data (also used by "Reset demo")
      lib/               pure logic: time, geo, hours, overtime, money, invoice, payroll, no-shows
      services/          messaging (simulated SMS/email), timesheets, attendance, jobs
      routes/            auth, worker, agency, client, files
      pdf/               pdfkit documents
    shared/              formatting shared by server and browser (UK dates, £)
    web/                 React dashboard
    worker/              worker page
  tests/
```

## Data model (main tables)

- **agency** (one row): name, branding colour, logo, address, bank details, VAT number, payment terms, photo retention days.
- **users**: agency staff (email + scrypt-hashed password).
- **clients**: break rule, overtime rules, rounding, selfie required, compliance mode (block/warn), sign-off day and time.
- **managers** (client site managers) + **manager_sites**: which sites each manager can see.
- **sites**: address, lat/lng, geofence radius, start/finish time, random QR token.
- **workers**: trade, pay/charge rates (pence), CSCS/CPCS card, right-to-work, emergency contact, NI number. **worker_tickets**, **inductions**.
- **devices**: remembered phones (hashed long-lived token). **verification_codes**: 6-digit codes (hashed, rate-limited).
- **attendance**: one row per sign-in: site, London work date, in/out (UTC), GPS + accuracy + distance, break, selfie, method, flags, status.
- **sign_in_attempts**: blocked attempts (out of area, expired card) and manual sign-in requests.
- **attendance_edits**: who changed what, when and why.
- **bookings**: worker × site × date.
- **alerts**: no-shows, compliance, missed sign-outs, manual requests, client queries.
- **roll_calls** + **roll_call_people**: fire drills and incidents.
- **timesheets** (site × week) + **timesheet_lines** (snapshot locked at approval).
- **invoices** + **invoice_lines**: numbered INV-0001…
- **outbox**: every simulated text and email.
- **sessions**, **magic_links**.

Money is stored in pence (integers). Times are stored as UTC ISO strings and shown in Europe/London.

## Stages

1. **Foundations** — git, schema, seed + demo reset, agency login, clients/sites (map + geofence)/workers, app shell.
2. **Signing in** — QR posters, worker sign-in/out page, phone verification, geofence, selfie, "Pretend I'm at…", Outbox.
3. **Live board and fire roll call** — live board (SSE), client magic-link login, roll call with PDF.
4. **Bookings, no-shows, compliance** — planner, no-show alerts and replacements, compliance records, warnings and blocks.
5. **Timesheets and Friday sign-off** — automatic timesheets, flags, edits with history, approval link and flow.
6. **Invoices, payroll, margins** — invoice PDFs, payroll CSV, margin view.
7. **Dashboard and polish** — home dashboard and chart, empty/loading states, mobile pass, PRIVACY.md.
8. **Demo script** — DEMO.md.

Tests run after each stage; each stage is committed.
