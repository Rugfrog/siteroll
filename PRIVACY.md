# SiteRoll: what it stores and why

This page is for agencies using SiteRoll. It explains what personal data the system holds, why, who can see it and how long it's kept. Use it to write or update your own privacy notice for workers and clients.

The agency is the **data controller**. Whoever hosts and supports SiteRoll for you is a **data processor** acting on your instructions. So is any text or email provider you connect. This page is guidance, not legal advice. Have your privacy notice checked if you're unsure.

## Workers

| What | Why | Who can see it | How long |
|---|---|---|---|
| Name, mobile number, trade | To identify them, send their sign-in code, book them and pay them | Agency staff. Client site managers see name and trade only. | While they're on your books, then your normal records period |
| Pay and charge rates, NI number | To pay them and invoice clients | Agency staff only | As required for payroll and tax records (HMRC: 3 years from the end of the tax year, often kept 6) |
| CSCS/CPCS card number, type, expiry and photo | To check they're qualified to be on site (a client requirement) | Agency staff only. Card photos are never shown to clients. | Card photo deleted automatically when the worker is marked as having left; card details kept with their records |
| Tickets and qualifications | As above | Agency staff only | As above |
| Right-to-work check (date and who checked) | Legal obligation (Immigration, Asylum and Nationality Act 2006) | Agency staff only | Keep for the employment plus 2 years. Store the copy of the document itself outside SiteRoll, as you do now. |
| Emergency contact | Their safety | Agency staff only | While they're on your books |
| Site inductions | Site safety | Agency staff | With their records |
| Sign-in and sign-out times, site, break taken | Timesheets, pay, invoicing, and the site's fire register | Agency staff. Client site managers see this only for their own sites. | With timesheet and payroll records (as above) |
| **Location at the moment of signing in or out** | To confirm they're really on site | Agency staff (distance from the site and GPS accuracy). Clients see only that the check passed. | With the sign-in record |
| **Sign-in selfie** (only on sites where the client asks for it) | To stop people signing each other in | Agency staff and that site's managers | Deleted automatically after the retention period set in Settings (default 90 days) |
| Remembered phones (a random code stored in a cookie on their phone) | So they don't need a text code every time | Agency staff can see which phones are remembered and remove them | Until removed, or about 400 days (the most a browser allows) |
| Sign-in codes sent by text | To link a phone to the worker | Nobody (codes are stored scrambled and expire in 10 minutes) | Deleted after a day |

### About location

- SiteRoll reads the phone's location **once**, at the moment the worker taps Sign in or Sign out.
- It **never** tracks them in between, in the background, or after they leave.
- The phone asks the worker's permission the first time.
- Workers who won't or can't share their location can ask the site manager to sign them in by hand.

### About selfies

The photo is stored as an ordinary picture so a person can glance at it. SiteRoll does **no face recognition or other biometric processing** on it. It is not used for anything else, and it is deleted automatically.

### Fire alarm and fire alerts

When a fire roll call starts, everyone signed in on that site gets a text with a personal link to say they're safe (or need help), and a notification if they've turned on fire alerts. SiteRoll records when each person said they were safe or asked for help, and whether they did it on their own phone or a marshal ticked them. This is kept with the roll call record, for health and safety.

Turning on fire alerts stores a push subscription for that phone (a web address issued by the phone's browser, plus encryption keys). It contains no location or personal details, and is deleted if the phone unsubscribes or the browser data is cleared.

## Client site managers

| What | Why | Who can see it | How long |
|---|---|---|---|
| Name, work email, work mobile, which sites they manage | To send login and sign-off links, and texts about their sites | Agency staff | While they work with you |
| Timesheet approvals: who, when, and the device (browser type and network address) | A record that the client agreed the hours, in case of a dispute | Agency staff; shown on the timesheet | With the timesheet |
| Queries they raise | To sort out disputed hours | Agency staff and the manager | With the timesheet |

## Agency staff

Name, email, and a scrambled (hashed) password. Login sessions expire after 14 days.

## WhatsApp and texts

Texts and WhatsApp messages are sent through Twilio, and WhatsApp messages also pass through WhatsApp (Meta). Both act as processors; name them in your privacy notice. Messages people send to SiteRoll's number (for example "SAFE", "YES", "APPROVE" or a question from the office) are kept with the time and number, so there's a record of what was agreed. Anyone can reply STOP to get ordinary texts instead of WhatsApp messages.

## Ask SiteRoll (AI assistant)

If you switch on Ask SiteRoll, a question from agency staff, plus the SiteRoll data needed to answer it (for example names, trades, hours, rates, card expiry dates, invoice totals), is sent to Anthropic's Claude API to produce the answer. Anthropic acts as a processor. Name them as a supplier in your privacy notice, and check their current commercial terms and data processing addendum (including where data is processed and how long it is kept). Ask SiteRoll can only read data; it cannot change anything. Only agency staff can use it, not site managers or workers. Leave `ANTHROPIC_API_KEY` unset to keep it switched off.

## Lawful bases you're likely to rely on

- **Contract:** paying workers and invoicing clients.
- **Legal obligation:** right-to-work checks, payroll and tax records, health and safety (including the fire register).
- **Legitimate interests:** checking people are on site before recording hours, selfies to prevent buddy sign-ins, card checks the client requires. Write a short legitimate interests assessment for location and selfies, and tell workers about them before they start. The sign-in page has a short notice workers can open.

## Workers' rights

Workers can ask for a copy of their data, ask for corrections, or object to selfies or location checks. If they object to location, the site manager can sign them in by hand. You can export a worker's sign-ins from their timesheets, and correct any entry. Every change is logged with who made it and why.

## Security

- Links sent to site managers contain long random codes (256-bit) and expire.
- Codes and passwords are stored scrambled (hashed), never as plain text.
- Code requests and logins are rate-limited.
- Every request is checked on the server, so site managers only ever see their own sites. Card photos are agency-only.
- Photos are not stored in a public folder. Each one is served only after checking who is asking.
- When online, SiteRoll must run over HTTPS. Phones won't share location otherwise.

## Where the data lives

In one database file and an uploads folder on the server you host SiteRoll on. Choose a UK or EU host, and back up the database and uploads folder (see the README).
