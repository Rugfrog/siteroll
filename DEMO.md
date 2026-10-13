# SiteRoll: 5-minute demo script

For a meeting with a labour agency owner. You need your laptop and your phone, both on the same Wi-Fi (or the laptop on your phone's hotspot).

## 10 minutes before the meeting

1. On the laptop, in the project folder: `npm run dev`. Note the **"On your Wi-Fi"** address it prints.
2. Open **http://localhost:3000** and click **Log in** (the demo login is filled in).
3. Click **Reset demo** in the dark strip at the top. Everything is now fresh and dated today.
4. Go to **Clients & sites → Woodhouse Gardens, Brighouse → Poster**. Leave this tab open: it's the "site board".
5. **Set up your phone as Callum, the labourer.** Scan the poster with your phone's camera and tap the link. Enter **07700 900102** and tap **Text me a code**. The code appears on screen, so type it in. You'll see "Hi Callum" and a big green **Sign in** button. **Don't tap it yet.**
   - Do this *after* Reset demo, because a reset forgets remembered phones.
6. Back on the laptop, open **On site now** in a second tab.

Close anything you don't need. In the meeting you'll switch between three things: the **phone**, the **On site now** tab and the **Outbox**.

---

## The script

### 0:00 The problem (20 seconds)

> "Right now your lads sign a paper sheet in the cabin. Every Friday you chase timesheets, the site manager argues about hours, the invoice goes out late, and someone gets paid wrong. And that paper sheet is your fire register. This fixes all of that, and nobody has to install an app."

### 0:20 Wow 1: "Try it from the yard and you're blocked"

On the **phone** (Callum's sign-in page):

1. In the yellow **DEMO ONLY** box, set **Pretend I'm at…** to **The yard (Huddersfield)**.
2. Tap **Sign in**.
3. Show the screen: **"You don't seem to be on site. You're about 3.8 miles away."**

> "He's tried to sign in from the yard to get an extra hour. It checks where the phone actually is, on our server, not on his phone. And if his GPS is genuinely playing up, there's a button to ask the site manager to sign him in by hand."

### 1:00 Wow 2: "Scan and you're signed in within 5 seconds"

1. On the phone, scroll to the **Pretend I'm at…** box at the bottom of the error screen, set it back to **Woodhouse Gardens, Brighouse**, and tap **Try again**.
2. **"You're signed in"**, with the time.
3. On the **laptop**, the **On site now** tab: Callum has just appeared on the Brighouse board (it updates by itself), flagged **Late**. The red **no-show** alert for Callum at the top has gone.

> "First time on a new phone they get a text code. After that it's camera, link, one tap. No app, no password, no account. And the same link goes on a £1 NFC sticker, so they can just tap their phone on the board."

### 2:00 Wow 3: Fire roll call

1. On **On site now**, Woodhouse Gardens: press the red **Fire roll call**.
2. Show the screen: **"0 of 9 accounted for"** (or however many are signed in right now), with everyone listed in big text.
3. Tick two or three people. The count goes up and they move to **Safe**.
4. **+ Add visitor**, type "Delivery driver", **Add to roll call**. Visitors show at the top until ticked.
5. **Finish** → leave it on **Drill** → **Finish and save record** → **Download PDF record**.

> "That's on the site manager's phone too. It's the real list of who's signed in, not a sheet of paper on a clipboard in a burning cabin. Every drill is recorded with a PDF for the health and safety file."

### 3:00 No-show and replacement (30 seconds)

1. Back to **On site now**. Under **Needs attention**: *"Mark Dyson (Groundworker) hasn't signed in…"*
2. Click **Send a replacement**. Only free **groundworkers** are shown, with their card status and whether they're inducted on this site.
3. Click **Send Paul**.
4. Open **Outbox**: Paul got a text with the site address, and Gareth (the site manager) got a text saying a replacement is on the way.

> "Fifteen minutes after the site starts, you know who hasn't turned up. You know before the site manager rings you."

### 3:30 Wow 4: Friday sign-off in one tap

1. **Outbox** → set the filter to **Sign-off requests** → find the latest text to **Gareth Holroyd** (sent last Friday at 14:00): *"Calder Construction Ltd – Woodhouse Gardens, Brighouse: 14 workers, 615.75 hours this week (w/c Mon …). Review and approve."*
2. Click **Open link as Gareth Holroyd ↗**. This opens his view in a new tab, and you stay logged in as the agency in the other tab.
3. Show the big panel: **"14 workers, 615.75 hours"**. Tap a worker to show their days, and the **Query** button.
4. Press **Approve all 615.75 hours**. It's locked, recording who approved it, when, and from which device.

> "Every Friday at two, the site manager gets a text with one link and one button. If something's wrong, he queries that one entry and it comes back to you. The rest of the week isn't held up."

### 4:15 The money: invoice, payroll, margin

Back in the **agency** tab:

1. **Invoices** → under **Ready to invoice**, **Calder Construction Ltd** for last week → **Create invoice**.
2. It opens as **INV-0012**: lines per worker, overtime at time and a half, VAT at 20%, your bank details. Click **View PDF**.
3. **Payroll & margins** (it opens on last week) → **Download CSV**, ready for your payroll software.
4. Click the **Margins** tab: charge, pay, margin in pounds and percent, by site, client or week.

> "Approved hours become the invoice and the pay run. Nobody types anything in. And the totals on screen, on the PDF and in the payroll file are always the same, because they come from the same sums."

### 4:45 Close

Finish on **Home**: who's on site now, no-shows, compliance warnings, money in, and six weeks of hours and margin.

> "We set it up with your logo and colours, print your posters, and run it for you for a monthly fee."

---

## If they ask to see more

- **Compliance** (left menu): expired and expiring CSCS cards. Kyle Dyson's card has expired. At Colne Valley's Marsden site, which is set to block, his phone tells him he can't sign in. At Calder's sites, which are set to warn, he's let in, flagged, and you're alerted.
- **Selfie:** Colne Valley's site at Marsden asks for a selfie at sign-in. Show it under **Clients & sites → Rules**.
- **Bookings:** drag a worker onto a day. On a phone, tap a day and **Book**.
- **Timesheets → a site → click any day:** every change has a reason and a history. For an example, open the Brighouse week three weeks ago and click Jordan Booth's Thursday: the client queried it, the agency fixed it, and both are logged.
- **Missed sign-outs:** Ryan Firth didn't sign out on Monday (unless today *is* Monday). He was closed at 16:30, flagged **Needs checking**, and texted to confirm. It's in **Needs attention** on Home and in the Outbox.
- **Site manager's phone view:** open Gareth's link on your actual phone. The big red **Fire roll call** button is the first thing he sees.

---

## Likely objections

**"My lads won't use an app."**
There isn't one. They point the phone camera they already use at the board and tap one button. First time on a new phone, they type their number and a 6-digit code, about 30 seconds, once. No download, no account, no password. Anyone without a smartphone can be signed in by the site manager, or added by the office. Those entries are marked, so you can see them.

**"What if there's no signal on site?"**
The sign-in page is tiny (about 9 KB, smaller than one photo), so it loads on one bar of 3G. GPS itself doesn't need mobile signal. If there's no signal at all when they tap Sign in, the phone keeps the sign-in with the real time and location, and sends it as soon as it gets signal. It's marked "Sent late (no signal)" so nobody's surprised.

**"GPS can be faked."**
True, by someone determined, and that's true of every app on the market. We don't rely on GPS alone:
- a sign-in from someone not booked on that site is flagged straight away;
- clients who want it get a selfie at sign-in, so mates can't sign each other in;
- the live board and the fire roll call are checked by a real person on site;
- the client approves the hours every week, and can query any entry;
- the agency sees the distance and GPS accuracy of every sign-in.

Faking it is more trouble than it's worth, and paper sheets were far easier to fiddle.

**"What does it cost?"**
A one-off set-up fee, which covers branding, your clients, sites and workers loaded in, posters and NFC tags printed, and a session with your office and a couple of site managers. Then a monthly fee for hosting, support, backups and updates. Texts are charged at cost, a few pence each. *(Put your actual prices here before the meeting.)*

Put it against what it saves. If one site manager disputes an hour a week for 14 workers at £30 an hour, that's £420 a week you're arguing about. And invoices go out on Friday afternoon instead of the following Wednesday.

**"We already use TimeKeeper (or Jibble, or QuickBooks Time)."**
Those are built for a builder clocking in their own staff. SiteRoll is built around the triangle you actually work in:
- **The client** sees who's on their site live, runs the fire roll call and approves hours in one tap.
- **You** get the approved hours as an invoice and a payroll file, with your margin, and no-show alerts with a replacement in two clicks.
- **The worker** needs nothing but their phone camera.

**"Is it GDPR-safe?"**
Location is read once, at the moment they sign in or out, and never tracked. Selfies are deleted automatically after the period you choose, and there's no face recognition. Card photos are only visible to you. There's a privacy page you can give your solicitor (PRIVACY.md).

**"Can we get our data out?"**
Yes. Timesheets and invoices as PDFs, payroll as CSV, and the whole database is a single file we back up nightly.
