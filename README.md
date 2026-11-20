# Lancaster Pet Movers

The website, quote and booking system, and staff admin for Lancaster Pet Movers.
It is a Node.js + Express app that stores its data in SQLite, using the database module built into Node 22.13+, so there is nothing native to compile.

## Quick start

```bash
npm install
cp .env.example .env        # then edit it (see below)
npm run create-admin -- --email you@lancasterpetmovers.com --name "Your Name"
npm start                   # http://localhost:3000   admin: /admin
npm test                    # 16 end-to-end tests
npm run samples             # add sample shipments for every service (no emails sent)
npm run samples -- --remove # remove all sample data again
```

`create-admin` prints a one-time password. Sign in, then change it under **My account**.
Running it again for the same email resets that account's password.

## What's included

**Public site**: the original site's design, pages and pictures, rebranded (templates in `views/site/`, Poppins font)
- All 16 original pages at their original addresses: `/` (home), `/about-us.html`, `/service.html`, the six freight pages
  (`/ocean-freight.html`, `/air-freight.html`, `/cargo-freight.html`, `/express-delivery.html`, `/customs-clearance.html`, `/project-cargo.html`),
  `/pet-transport.html`, `/reviews.html`, `/locations.html`, `/faqs.html`, `/contact.html`, `/privacy-policy.html` and `/terms-of-service.html`
- The theme's contact form saves the message and emails both sides. The newsletter forms on every page save subscribers (see **Admin > Subscribers**, with CSV export).
- **Quote form** (`/quote`): pet or freight, with different fields for each. It saves the request, emails the customer a confirmation and notifies staff. The services' "Request a Quote" buttons open it with the service already selected.
- Live chat (Tawk.to) is on by default on every public page. Set `TAWK_PROPERTY` to another property ID to change it, or to `off` to hide it.
- **Track page** with two lookups:
  - *Booking status*: needs the booking reference **and** the customer's email. Shows the progress steps and the document checklist.
  - *Air waybill lookup*: checks the AWB check digit, identifies the airline from its prefix and links to the airline's own cargo tracking. Live flight status always comes from the airline.
- Contact form (saves the message and auto-replies), `sitemap.xml`, `robots.txt`, `/health`

**Admin** (`/admin`)
- Dashboard: new quotes, active bookings, bookings missing documents, new messages, failed emails, upcoming trips
- Quote requests: filter and search, email a written quote, convert a quote into a booking
- Bookings: create them manually or from a quote, edit travel details (an AWB is validated before saving), keep a document checklist per service type, send documents reminders, see status history and the emails sent for that booking
- Customers, contact messages, an email log, and internal notes on quotes, bookings and customers
- Owner only: team accounts (owner or staff, disable an account, reset a password) and an activity log

## Status emails

The email a customer gets depends on **both the service type and the booking status**:

| Status | Ground | Domestic air | International |
|---|---|---|---|
| Booking confirmed | pickup planning + checklist | airline booking + checklist | strict timeline warning + checklist |
| Waiting on documents | list of missing items | "airline can't accept without" | "destination can refuse entry" |
| Documents complete | pickup window next | flight confirmation next | flight + arrival plan next |
| Travel scheduled | pickup window | flight + AWB + airline link | flight + AWB + arrival inspection note |
| Trip completed | thank you + feedback request | same | same |
| Cancelled | contact us | same | same |

Other automatic emails: quote received (customer), new quote (staff), quote ready, documents reminder, contact auto-reply and contact notification (staff).
The wording lives in [src/emails/templates.js](src/emails/templates.js).
Every email ends with a scam warning ("we never ask for gift cards or crypto, or for money to release a pet").

Rules built in:
- An air booking can't be marked **Travel scheduled** until it has a valid AWB.
- Staff get a warning if they move a booking forward while checklist documents are still outstanding.

## Configuration (`.env`)

| Variable | Purpose |
|---|---|
| `SESSION_SECRET` | **Required in production.** A long random string. |
| `BASE_URL` | Public URL used in email links, e.g. `https://lancasterpetmovers.com` |
| `BUSINESS_*`, `NOTIFY_EMAIL` | Business name, email, phone and address shown on the site and in emails. `NOTIFY_EMAIL` receives staff notifications. |
| `SMTP_*`, `MAIL_FROM` | Your email provider's settings. **If `SMTP_HOST` is empty, emails are saved to `data/outbox/*.eml` instead of being sent**, which is handy for testing. |
| `TRUST_PROXY=1` | Set this when running behind Nginx, Render, Railway, Heroku and similar hosts. |
| `DB_FILE` | Location of the SQLite file (default `data/app.db`). |

For email delivery, use a transactional provider (Postmark, SendGrid, Mailgun, Amazon SES or your host's SMTP) and set up SPF/DKIM for `lancasterpetmovers.com` so messages don't land in spam.

## Deploying

1. Set `NODE_ENV=production`, `SESSION_SECRET`, `BASE_URL`, the SMTP settings and `TRUST_PROXY=1` (if behind a proxy).
2. Serve over HTTPS. In production the session cookie is only sent over HTTPS.
3. Keep `data/` on a persistent disk and **back up `data/app.db`** regularly. For a live copy, use `sqlite3 data/app.db ".backup backup.db"`.
4. Run it under a process manager (pm2, systemd, or your platform's) with `npm start`.

## Security

- Passwords are hashed with bcrypt. Sessions get a new ID at login and are stored in SQLite. Changing a password or disabling an account signs that user out everywhere.
- All forms have CSRF protection. Strict security headers are set with Helmet. Login and public forms are rate-limited, and public forms have a hidden spam trap.
- All SQL uses parameters, and all output is escaped by EJS. Admin pages are never cached or indexed.

## Project layout

```
server.js              entry point
src/app.js             Express setup, security headers, sessions
src/routes/public.js   website, quote, contact, track
src/routes/admin.js    admin area
src/services.js        quotes, bookings, documents, status changes and emails
src/emails/templates.js  all email content
src/domain.js          service types, statuses, document checklists
src/content.js         service page copy
src/awb.js             air waybill validation and airline list (check these links occasionally)
views/                 EJS templates (pages/, admin/, partials/)
public/                CSS, JS, Font Awesome, favicon
scripts/create-admin.js
test/app.test.js
```
