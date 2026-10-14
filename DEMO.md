# SiteRoll: 7-minute demo script

For a meeting with a labour agency owner. You need a laptop and your own phone.

**Use your public https link** (the Render deploy, see the README). Three things only work properly over https: real GPS on the phone, the fire alarm buzzing a locked phone, and nothing to set up on the Wi-Fi. Running locally with `npm run dev` works too, but the phone then needs to be on the same Wi-Fi, and it won't get the locked-phone notification.

## 10 minutes before the meeting

1. On the laptop, open your SiteRoll link and log in. Locally the demo login is filled in. On an invite-only public link, log in as `office@pennine.example` with your private password (anyone you've sent an invite link to goes straight in).
2. Click **Reset demo** in the dark strip at the top. Everything is fresh and dated today, and you stay logged in.
3. Go to **Clients & sites → Woodhouse Gardens, Brighouse → Poster**. Leave this tab open: it's the "site board".
4. **Set up your phone as Callum, the labourer.** Scan the poster with your phone's camera and open the link.
   - **iPhone:** in Safari, tap Share → **Add to Home Screen**, then open SiteRoll from the new home screen icon and carry on from there. The home screen app keeps its own login, and fire alerts only work in it.
   - Enter **07700 900102**, tap **Text me a code**, and type in the code shown on screen.
5. Still on the phone, tap **🔔 Turn on fire alerts** and **Allow** notifications.
6. You'll see "Hi Callum" and a big green **Sign in** button. **Don't tap it yet.**
7. On the laptop, open **Office TV** from the menu and press **Full screen**. Open **On site now** in a second tab.
8. If you'll use Ask SiteRoll, open it once and check you see the suggested questions, not "Switch on Ask SiteRoll" (that means the Claude API key isn't set; see the README).

Don't press Reset demo again after step 4: a reset forgets remembered phones.

---

## The script

### 0:00 Opening shot: the Office TV (20 seconds)

Start with the laptop on the **Office TV** screen (or cast it to the meeting room TV).

> "This is your business, live. Who's on every site, money billed today ticking up by the second, and everything that's happening as it happens. Your lads sign in by scanning a sign on the site board. No app."

### 0:20 The problem (20 seconds)

> "Right now they sign a paper sheet in the cabin. Every Friday you chase timesheets, the site manager argues about hours, the invoice goes out late, and someone gets paid wrong. And that paper sheet is your fire register."

### 0:40 Wow 1: "Try it from the yard and you're blocked"

On the **phone**:

1. In the yellow **DEMO ONLY** box, set **Pretend I'm at…** to **The yard (Huddersfield)**.
2. Tap **Sign in**.
3. Show the screen: **"You don't seem to be on site. You're about 3.8 miles away."**

> "He's tried to sign in from the yard to get an extra hour. We check where the phone really is, on our server. If his GPS is genuinely playing up, he can ask the site manager to sign him in by hand."

### 1:10 Wow 2: "Scan and you're signed in within 5 seconds"

1. On the phone, scroll to **Pretend I'm at…**, pick **Woodhouse Gardens, Brighouse**, and tap **Try again**.
2. **"You're signed in"**, with the time.
3. Point at the **Office TV**: the Brighouse pin pings, "Callum Ainley signed in" appears at the top of the live feed, and the money meter is still ticking.

> "Camera, link, one tap. On a new phone they get a text code once. The same link goes on a £1 NFC sticker, so they can just tap the board."

### 1:45 Wow 3: The fire alarm goes to every phone

1. **Lock your phone** and put it face down on the table. Say nothing about it.
2. On the laptop, go to **On site now** and press the red **Fire roll call** on Woodhouse Gardens.
3. Your phone buzzes on the table: **🔥 FIRE ALARM – Woodhouse Gardens, Brighouse**. Hand it to them.
4. They tap the notification, then **I'M SAFE**.
5. On the laptop: **"Alarm sent to 9 phones · 1 said safe on their phone"**, and Callum has moved to **Safe**.
6. Tick two or three more people, **+ Add visitor** ("Delivery driver"), then **Finish** → **Finish and save record** → **Download PDF record**.

> "Every worker on site gets a text with their own 'I'm safe' link, and their phone buzzes even if it's locked. Most people mark themselves safe, so the marshal only chases who's left. Anyone who taps 'I need help' goes straight to the top in red, and the site manager gets a text. Every drill is recorded for the health and safety file."

(If the notification doesn't come, keep the sign-in page open on the phone instead: it turns red and buzzes by itself within a few seconds. In the **Outbox**, filter by **Fire alarms** to show the texts.)

### 3:00 No-show and replacement (30 seconds)

1. **On site now** → **Needs attention**: *"Mark Dyson (Groundworker) hasn't signed in…"* → **Send a replacement**.
2. Only free groundworkers are shown, with card status and site induction. Click **Send Paul**.
3. **Outbox**: Paul got the site address, and Gareth (the site manager) was told who's coming.

### 3:30 Wow 4: Friday sign-off in one tap

1. **Outbox** → filter **Sign-off requests** → the latest text to **Gareth Holroyd**: *"…14 workers, 615.75 hours this week… Review and approve."*
2. **Open link as Gareth Holroyd ↗**. This is his phone view, in a new tab; you stay logged in as the agency.
3. **Approve all 615.75 hours**. It's locked, recording who approved it, when and on which device.

> "One text, one button. If something's wrong he queries that one entry, and it comes back to you."

### 4:10 The money

1. **Invoices** → **Ready to invoice** → Calder Construction for last week → **Create invoice**: INV-0012, with VAT, your bank details and a PDF.
2. **Payroll & margins** → **Download CSV** for your payroll software, then the **Margins** tab.

### 4:40 Wow 5: Ask SiteRoll

1. Click **Ask SiteRoll** (or type into the box at the top of Home).
2. Ask: **"What was our margin last week, by site?"** It shows what it's checking, then answers in plain English.
3. Ask a follow-up: **"Draft a text to Gareth explaining Mark's no-show today"**, then **Copy**.
4. Let *them* ask something, e.g. "Whose cards run out this month?"

> "Ask it anything about your workers, sites, hours or money. It reads the same figures as the rest of SiteRoll, so the numbers match, and it can't change anything."

### 5:20 Wow 6: Run it from WhatsApp

Open **WhatsApp** in the menu. It's a phone-style chat; pick who you're messaging as on the left:
1. **Michelle Lockwood (office):** tap **Who's on site?** and Ask SiteRoll answers in WhatsApp.
2. **Gareth Holroyd (site manager):** tap **APPROVE**, then **YES**. The week is approved without opening anything.
3. Back on **On site now**, open Mark Dyson's no-show → **Send a replacement** → **Offer by WhatsApp**. Then as **Paul Crowther**, tap **YES**: "It's yours, Paul…", and Gareth is told he's coming.

> "Your lads already live on WhatsApp. Fire alarm: reply SAFE. Shift going: first to reply YES gets it. Site manager signs off the week from WhatsApp. And you can ask your business a question from the pub."

With Twilio connected (README → WhatsApp), do the same from your real phone. Set **Settings → WhatsApp → Use my phone** first, and send the SiteRoll number "hi" before the meeting.

### 5:50 Close

Back to the **Office TV**.

> "We set it up with your logo and colours, print your posters, and run it for you for a monthly fee."

---

## If they ask to see more

- **"My clients won't want sign-in on their site."** Open **Clients & sites → Penistone Road Barns, Shepley**: it's set to **Timesheet only**. Each booked day counts as a normal day, and the client approves the week by email or queries a day. On **On site now** it shows who's booked instead of who's signed in.
- **Who approves the hours:** on **Bookings**, Shepley says "Nobody approves the hours yet". Press **Confirm with client** → **Send confirmation**, then in the **Outbox** open the email to Jo Ramsden and tap the link. Type a name and email, pick a role, and press **Send the hours to this person**. They're set up, with no password, and the agency is told. Now **Timesheets** → last week's Shepley sheet → send it for approval.
- **Workers' hours:** on the worker's phone, open **Your hours** under the Sign in button: this week and last, and whether the client has approved them.

- **Compliance:** Kyle Dyson's card has expired. On Colne Valley's site (set to block), his phone tells him he can't sign in. On Calder's sites (set to warn), he's let in, flagged, and you're alerted.
- **Selfie:** Colne Valley's Marsden site asks for one. See **Clients & sites → Rules**.
- **Bookings:** drag a worker onto a day. On a phone, tap a day, then **Book**.
- **Edit history:** open the Brighouse week three weeks ago and click Jordan Booth's Thursday. The client queried it, the agency fixed it, and both are logged with reasons.
- **Site manager's phone:** open Gareth's link on your phone. The big red **Fire roll call** button is the first thing he sees.

---

## Likely objections

**"My lads won't use an app."**
There isn't one. They point the phone camera they already use at the board and tap one button. First time on a new phone, they type their number and a 6-digit code, once. Anyone without a smartphone is signed in by the site manager or the office, and those entries are marked.

**"What if there's no signal on site?"**
The sign-in page is tiny (about 10 KB), so it loads on one bar of 3G. GPS doesn't need mobile signal. If there's no signal at all, the phone keeps the sign-in with the real time and sends it when it gets signal, marked "Sent late (no signal)".

**"GPS can be faked."**
True, by someone determined, and that's true of every app. We don't rely on GPS alone:
- anyone signing in on a site they're not booked on is flagged straight away;
- clients who want it get a selfie at sign-in;
- the fire roll call and the site manager check who's really there;
- the client approves the hours every week, and can query any entry.

Paper sheets were far easier to fiddle.

**"Does the fire alarm replace our fire alarm?"**
No. The site's alarm system and marshals stay as they are. SiteRoll replaces the paper register: it tells the marshal exactly who's on site, lets people mark themselves safe, and shows instantly who's missing or needs help.

**"Is the AI safe? Does it see our data?"**
Ask SiteRoll only *reads* SiteRoll's figures, to answer the question you asked. It can't change, send or approve anything. Questions go to Anthropic's Claude service; it's listed in the privacy notice like any other supplier, and you can switch it off.

**"What does it cost?"**
A one-off set-up fee covering branding, loading your clients, sites and workers, posters and NFC tags, and training for your office and site managers. Then a monthly fee for hosting, support, backups and updates. Texts are charged at cost, a few pence each, and so are AI questions. *(Put your actual prices here before the meeting.)*

Put it against what it saves: one disputed hour a week for 14 workers at £30 an hour is £420 a week, and invoices go out on Friday afternoon instead of the following Wednesday.

**"We already use TimeKeeper (or Jibble, or QuickBooks Time)."**
Those are good at clocking in a firm's *own* staff: geofenced clock-ins, face checks, kiosks, holidays. SiteRoll is built for an agency whose workers are on *someone else's* site:
- the client's site manager sees them live, runs the roll call and signs off the hours;
- that sign-off becomes your invoice, your pay run and your margin.

**"Can we get our data out?"**
Yes. Timesheets and invoices as PDFs, payroll as CSV, and the whole database is a single file we back up nightly.
