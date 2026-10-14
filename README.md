# SiteRoll

Site sign-in, live roll call and timesheets for construction labour agencies.

Workers sign in and out by scanning a QR code (or tapping an NFC tag) on the site board, with no app to install. The location check means it only counts if they're really on site. The client sees who's on site live and runs the fire roll call from their phone. Every Friday the site manager approves the week's hours in one tap, and those hours become the agency's invoice and the workers' pay run.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Rugfrog/siteroll)

**Share a public demo:** click the button above, sign in to Render with GitHub (free plan), and click **Deploy Blueprint**. After a few minutes you get a link like `https://siteroll-demo.onrender.com` that anyone can open, with nothing to install. It runs in demo mode with the demo login shown on the login page. On the free plan it goes to sleep after 15 minutes without visitors; the first visit after that takes about a minute to wake it, and the demo data reloads fresh.

- **DEMO.md** has a 5-minute walkthrough for a sales meeting.
- **PRIVACY.md** explains what's stored and why, for the agency's privacy notice.

---

## Run it

You need **Node.js 22 or newer** (nodejs.org, the LTS installer is fine). Then, in this folder:

```bash
npm install
npm run dev
```

Open **http://localhost:3000**. The demo login is filled in for you: `office@pennine.example` / `demo1234`.

The first run creates `data/siteroll.db` and loads the demo agency, Pennine Site Staffing Ltd: 2 clients, 3 sites, 25 workers and 6 weeks of history. The **Reset demo** button in the dark strip at the top puts everything back.

### Trying it on a phone

The terminal prints an "On your Wi-Fi" address (e.g. `http://192.168.0.20:3000`), and the QR posters point there. With your phone on the same Wi-Fi:

1. Open **Clients & sites**, pick a site, then **Print poster** (or just show the poster on screen).
2. Scan it with the phone's normal camera.
3. Use the demo number shown on the page (`07700 900102`, Callum Ainley). The 6-digit code appears on screen and in the **Outbox**.

**"Pretend I'm at…"** (demo mode only) lets you sign in "at" any site, or "from the yard", without being there. It works over plain `http://`.

To use the phone's **real GPS** on your Wi-Fi you need HTTPS, because phones only share location with secure pages:

```bash
# Mac/Linux
HTTPS=1 npm run dev
# Windows PowerShell
$env:HTTPS="1"; npm run dev
```

This uses a self-signed certificate, so the phone will warn you once; tap through. Or use a free tunnel such as `cloudflared tunnel --url http://localhost:3000`, and set `PUBLIC_URL` to the address it gives you so the QR codes point there.

### Other commands

| Command | What it does |
|---|---|
| `npm test` | Runs the tests (geofence, hours, breaks, overtime, clock changes, VAT, payroll CSV, no-shows, plus an end-to-end API test) |
| `npm run typecheck` | TypeScript check |
| `npm run seed` | Wipes the database and reloads the demo data |
| `npm run build` then `npm start` | Production build and server |
| `npm run setup -- …` | Sets up a real agency with no demo data (see below) |
| `npm run add-user -- …` | Adds another member of agency staff |

### Settings (`.env`)

Copy `.env.example` to `.env`. Everything is optional.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `PUBLIC_URL` | your Wi-Fi address | The address in QR codes and links, e.g. `https://siteroll.example.co.uk` |
| `DEMO_MODE` | `true` in dev, `false` in production | Shows "Pretend I'm at…", Reset demo, and codes on screen. **Never on for a real agency.** |
| `HTTPS` | off | `1` = serve over HTTPS with a self-signed certificate (for testing on phones) |
| `DB_PATH` | `data/siteroll.db` | Database file |

---

## Set up a new agency

1. Get a copy of the code onto the server or machine it will run on, and run `npm install`.
2. Create the agency and your first login. Pick a password of 12 or more characters:

   ```bash
   npm run setup -- --agency "Example Recruitment Ltd" --name "Sam Smith" --email sam@example.co.uk --password "a long password here"
   ```

3. Set `DEMO_MODE=false` and `PUBLIC_URL=https://…` in `.env`.
4. Start it and log in. The home page walks you through the rest:
   - **Settings:** logo, brand colour, address, bank details, VAT number, payment terms, photo retention.
   - **Clients & sites:** each client's break and overtime rules, whether they want selfies, whether to block or warn on expired cards, and their sign-off day and time. Then their site managers.
   - **New site:** drop the pin, set the geofence radius, then **Print poster** and put it on the site board. To use NFC, write the same link (shown above the poster) to a cheap NTAG215 sticker with any NFC writer app.
   - **Workers:** name, mobile, trade, pay and charge rates, CSCS card.
   - **Bookings:** drag workers onto sites.
5. Add more staff with `npm run add-user -- --name "…" --email "…" --password "…"`.

Workers need nothing set up. The first time they scan a poster, they enter their mobile number and get a text code. After that, their phone is remembered.

---

## Put it online

SiteRoll is one Node.js process with an SQLite file, so a small server is plenty. A £5–£10 a month VPS (Hetzner, DigitalOcean, Linode or similar) runs dozens of sites. Pick a UK or EU data centre.

1. On the server, install Node.js 22+, copy the code over, run `npm install`, then `npm run build`.
2. Run `npm run setup -- …` as above. In `.env`, set `DEMO_MODE=false` and `PUBLIC_URL=https://your-domain`.
3. Keep it running with `systemd` (or `pm2`), running `npm start` in the folder.
4. Put **Caddy** in front for automatic HTTPS. The whole `Caddyfile` is:

   ```
   siteroll.example.co.uk {
       reverse_proxy localhost:3000
   }
   ```

   HTTPS is required: phones won't share location with an insecure page.
5. **Back up** `data/siteroll.db` and `data/uploads/` nightly, e.g. `sqlite3 data/siteroll.db ".backup '/backups/siteroll-$(date +%F).db'"`, and copy the backups off the server.

Platforms with a persistent disk (Render, Railway, Fly.io) also work. Mount the disk at `data/`.

### Real texts and emails

Everything goes through one interface in `src/server/services/messaging.ts`. The demo's `SimulatedMessenger` writes to the Outbox table. To send for real, write a class with the same two methods and pass it to `setMessenger()` at start-up in `src/server/index.ts`. For example, for SMS with Twilio:

```ts
class TwilioMessenger extends SimulatedMessenger {
  sms(msg: SmsMessage) {
    super.sms(msg); // keep the Outbox as a log
    // POST to https://api.twilio.com/2010-04-01/Accounts/<SID>/Messages.json
    // with To=+44..., From=<your number>, Body=msg.body
  }
}
```

Email works the same way (Postmark, SendGrid, Amazon SES or plain SMTP).

### Payroll export columns

The CSV columns are a simple list in `src/server/lib/payroll.ts` (`PAYROLL_COLUMNS`). Rename, reorder or remove entries to match Sage, BrightPay, Moneysoft, Xero or a bureau's import template. Nothing else needs changing.

---

## How it works

- **One process.** Express serves the JSON API. In development it runs Vite as middleware, so the dashboard reloads as you edit. In production it serves the built files from `dist/`.
- **Database.** SQLite (`better-sqlite3`). Money is stored in **pence** (integers). Times are stored in **UTC** and shown in **Europe/London**, so the clocks changing is handled (see `src/shared/time.ts` and its tests). Every total on screen, in PDFs and in the CSV comes from the same functions (`src/server/lib/money.ts`), so they always agree.
- **Worker page** (`src/worker/`). Plain TypeScript with no framework, about 9 KB gzipped, so it's quick on a cheap phone with poor signal. It's a PWA, so workers can "Add to home screen". It saves a sign-in on the phone if there's no signal and sends it, with the original time, when signal returns.
- **Dashboard** (`src/web/`). React and React Router, with hand-written CSS. Mobile-first: tables turn into cards on a phone, with a bottom tab bar.
- **Live updates.** Server-sent events, with 20–30 second polling as a fallback.
- **Background checks,** once a minute (`src/server/services/jobs.ts`):
  - no-shows (15 minutes after the site's start time);
  - Friday sign-off links at each client's chosen day and time;
  - missed sign-outs (still signed in at 20:00);
  - deleting old selfies.
- **PDFs** use pdfkit: timesheets, invoices and fire roll call records.

```
src/
  server/      API, database, seed, PDFs, background jobs
    lib/       pure logic (geofence, hours, overtime, money, payroll, no-shows): unit tested
    services/  sign-in rules, timesheets, invoices, messaging
    routes/    HTTP endpoints, each checking who is asking
  worker/      the worker sign-in page
  web/         the agency and client dashboards
  shared/      UK date, time and money formatting
tests/         Vitest tests, including an end-to-end API test
```

---

## Security notes

- Long random tokens (256-bit) in every link. Tokens, codes and passwords are stored hashed (passwords with scrypt).
- Rate limits on text-code requests (3 per number and 10 per network address per 15 minutes), on code guesses (5 per code) and on failed logins.
- Every request is checked on the server: site managers only ever see their own sites, and pay rates and card photos are agency-only. All input is validated on the server.
- The geofence check happens **on the server**. The browser only sends its raw reading.
- Security headers include a strict Content-Security-Policy in production and `Referrer-Policy: no-referrer`, so tokens in links can't leak.

### Can GPS be faked?

Yes. Someone determined can fake a phone's location with a fake-GPS app or browser developer tools. No web or app-based system can fully prevent that. SiteRoll makes it pointless rather than impossible:

- **Booking check:** a sign-in from someone not booked on that site is flagged and the agency is alerted.
- **Selfie** (per client): a photo at sign-in stops mates signing each other in, and is visible to the site manager.
- **The live board and fire roll call** are checked by a real person on site. Someone "on site" who isn't there gets noticed at the first roll call.
- **Accuracy:** readings are judged on the reported accuracy, with a capped allowance, and the agency can see the distance and accuracy of every sign-in.
- **The client approves the hours** every week, and can query any entry.

---

## Decisions made where the brief was open

- **Sign-off covers the week to date.** If someone is still on site when the Friday 14:00 link goes out, their shift counts to the site's usual finish time and is marked "still on site".
- **Hours after sign-off.** Nobody is stopped at the gate because the paperwork is done. A sign-in after approval is flagged "After sign-off" and the agency is alerted. The agency can **Reopen** an approved week that hasn't been invoiced, and the client approves it again.
- **Overtime** is worked out per site, per week, using that client's rules: daily and/or weekly thresholds, Saturdays and Sundays, and a multiplier. Weekend hours don't count towards the weekly threshold.
- **Rounding:** each client can round sign-in and sign-out times to the nearest 5, 10 or 15 minutes. The demo clients use 15.
- **Breaks:** if the worker skips the question, the client's default break applies, but only on shifts longer than the client's threshold (6 hours in the demo).
- **One invoice per client per week,** covering all their approved sites. VAT is worked out once on the invoice total.
- **Payroll** includes only hours the client has approved.
- **Site managers** see only the sites they're assigned to, not every site their company has.
- **Unknown numbers:** a worker entering an unregistered number is told so, to save confusion at the gate. It's rate-limited, but it does show whether a number is registered.
- **Missed sign-outs:** anyone still signed in at 20:00 is closed at their site's usual finish time. In **demo mode**, today's sign-ins are left open so the live board stays busy whatever time you demo. The Outbox has a button to run the 20:00 check by hand.
- **Expired cards:** "block" clients turn the worker away at the gate (the page says so before asking for a selfie). "Warn" clients let them in, flag it, and alert the agency.
- **Phones are remembered** for about 400 days, the most a browser allows. The agency can forget a phone from the worker's page.
- **Demo data is relative to today,** so the demo always looks current. "Today" assumes a working day. If you demo before about 07:30, fewer people will be on site.
- The brief asked for Node 22. It was built and tested on Node 24 and declares `node >= 22`.
