# SiteRoll

Site sign-in, live roll call and timesheets for construction labour agencies.

Workers sign in and out by scanning a QR code (or tapping an NFC tag) on the site board, with no app to install. The location check means it only counts if they're really on site. The client sees who's on site live and runs the fire roll call from their phone. Every Friday the site manager approves the week's hours in one tap, and those hours become the agency's invoice and the workers' pay run.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Rugfrog/siteroll)

**Share a public demo:** click the button above, sign in to Render with GitHub (free plan), and click **Deploy Blueprint**. After a few minutes you get a link like `https://siteroll-demo.onrender.com` that anyone can open, with nothing to install. It runs in demo mode with the demo login shown on the login page. On the free plan it goes to sleep after 15 minutes without visitors; the first visit after that takes about a minute to wake it, and the demo data reloads fresh.

**Headline features**

- **Sign in by QR code or NFC tag**, with no app to install. The location check means it only counts if they're really on site.
- **Live board and fire roll call.** When a roll call starts, **every worker on site gets a fire alarm on their phone**: a text with their own "I'm safe" link, a notification that buzzes even when the phone is locked, and a full-screen alarm on the sign-in page. Most people mark themselves safe; anyone who taps "I need help" goes to the top in red.
- **Friday sign-off in one tap** for the client, turning straight into invoices, payroll and margins.
- **Ask SiteRoll:** questions in plain English ("What was our margin last week?", "Whose cards run out this month?"), answered by Claude from the agency's own figures.
- **Office TV:** a full-screen live view for the office telly, with a map of sites, a live feed, and today's billed £ ticking up by the second.
- Bookings and no-show alerts with replacements, compliance at the gate (CSCS/CPCS, inductions, right to work), timesheets with an edit history, and invoices, payroll and margins.

- **DEMO.md** has a 6-minute walkthrough for a sales meeting.
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
| `ANTHROPIC_API_KEY` | none | Switches on Ask SiteRoll (get a key at console.anthropic.com) |
| `ASK_DAILY_LIMIT` | `300` | Most questions Ask SiteRoll answers per day, so a shared link can't run up a bill |
| `ASK_EFFORT` | `low` | How hard Claude thinks before answering: `low` (fastest), `medium` or `high` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | made automatically | Keys for fire alert notifications. Set them to keep phones subscribed if the database is ever replaced. |

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

## Ask SiteRoll (AI assistant)

Agency staff can ask questions in plain English on the **Ask SiteRoll** page, or in the box at the top of Home. It uses Claude (`claude-opus-5-5`) with twelve read-only lookups: today's live board, workers, one worker in detail, timesheets, compliance, invoices, margins, bookings, clients and sites, payroll, fire roll calls, and messages sent. The lookups use the same calculations as the rest of SiteRoll, so its figures match the screens, PDFs and CSVs. It **can't change anything**: if you ask it to book someone or send a text, it tells you where to click and offers to draft the message.

- **Switch it on:** add `ANTHROPIC_API_KEY` to `.env` (or in Render: the service's **Environment** page) and restart. Without a key, the page explains how to set one up.
- **Cost:** a few pence per question. There's a limit per person (20 questions per 10 minutes) and a daily cap (`ASK_DAILY_LIMIT`). On a public demo link, anyone with the demo login can ask questions, which spends your API credit.
- **Privacy:** answering a question sends the relevant SiteRoll data (names, hours, rates and so on) to Anthropic's API. List Anthropic as a supplier in your privacy notice (see PRIVACY.md), and check their current commercial terms and data processing addendum.
- **Refusals:** if Claude's safety checks decline a question, the API retries on Anthropic's recommended fallback model (`fallbacks: "default"`); if that also declines, the user sees a polite "can't help with that".
- The code is in `src/server/services/ask.ts` (Claude) and `src/server/services/askTools.ts` (the lookups).

## Fire alarm to every phone

When anyone starts a fire roll call (the red button on the live board, or the big button on a site manager's phone):

1. Everyone signed in on that site gets a **text** with their own "I'm safe" link. Texts are simulated in the Outbox until a texting service such as Twilio is connected.
2. Phones that have turned on **fire alerts** get a **push notification** that buzzes even when the phone is locked. Workers turn alerts on with one tap on the sign-in page. Push is free (web push, no account needed), but needs the https address: Android works in Chrome, and an iPhone only once SiteRoll has been added to the home screen.
3. Any **sign-in page that's open** turns into a full-screen red alarm within a few seconds, with an alarm tone and vibration.

Workers tap **I'M SAFE** or **I NEED HELP**. "I need help" puts them at the top of the marshal's list in red, and texts the site's managers and agency staff at once. The marshal's screen updates live and shows who answered on their own phone; the PDF record includes it. It doesn't replace the site's fire alarm system or marshals. It replaces the paper register.

## Office TV

**Office TV** in the menu (or `/wall`) is a full-screen live view for the office telly. It shows:
- a dark map with each site's headcount, which pings when someone signs in;
- today's billed £, margin and hours ticking up by the second. This is a live estimate before overtime and rounding; the timesheets have the exact figures.
- a live feed of sign-ins, blocked attempts, no-shows and roll calls;
- every site and the key numbers along the bottom.

Press **Full screen** on a TV or a spare monitor in the office.

## How it works

- **One process.** Express serves the JSON API. In development it runs Vite as middleware, so the dashboard reloads as you edit. In production it serves the built files from `dist/`.
- **Database.** SQLite (`better-sqlite3`). Money is stored in **pence** (integers). Times are stored in **UTC** and shown in **Europe/London**, so the clocks changing is handled (see `src/shared/time.ts` and its tests). Every total on screen, in PDFs and in the CSV comes from the same functions (`src/server/lib/money.ts`), so they always agree.
- **Worker page** (`src/worker/`). Plain TypeScript with no framework, about 10 KB gzipped, so it's quick on a cheap phone with poor signal. It's a PWA, so workers can "Add to home screen". It saves a sign-in on the phone if there's no signal and sends it, with the original time, when signal returns.
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
