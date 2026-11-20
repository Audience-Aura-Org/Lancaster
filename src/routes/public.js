'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const v = require('../validate');
const svc = require('../services');
const awb = require('../awb');
const db = require('../db');
const config = require('../config');
const { SERVICE_TYPES, BOOKING_STATUSES, BOOKING_FLOW, QUOTE_STATUSES, kindOf } = require('../domain');
const { kindFrom, readShipment } = require('../shipment-form');

const router = express.Router();

const tooMany = (msg) => (req, res) => res.status(429).render('pages/message', { title: 'Too many requests', heading: 'Please slow down', message: msg, status: 429 });
const formLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, handler: tooMany('Too many submissions. Please wait a few minutes and try again.') });
const lookupLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, handler: tooMany('Too many lookups. Please wait a few minutes and try again.') });

/** Honeypot: real people leave the hidden "website" field empty. */
const isBot = (req) => Boolean(req.body && req.body.website);
const wantsText = (req) => req.xhr || /XMLHttpRequest/i.test(req.get('x-requested-with') || '');

/* --------------------------------------------- original site pages (theme) */

const PAGES = ['index', 'about-us', 'service', 'ocean-freight', 'air-freight', 'cargo-freight', 'express-delivery',
  'customs-clearance', 'project-cargo', 'pet-transport', 'reviews', 'locations', 'faqs', 'contact', 'privacy-policy', 'terms-of-service'];

router.get('/', (req, res) => res.render('site/index'));
router.get('/:page.html', (req, res, next) => {
  if (!PAGES.includes(req.params.page)) return next();
  res.render(`site/${req.params.page}`);
});
// Friendly URLs and the old tracking address
const ALIASES = { '/about': '/about-us.html', '/services': '/service.html', '/contact': '/contact.html', '/faq': '/faqs.html',
  '/reviews': '/reviews.html', '/locations': '/locations.html', '/privacy': '/privacy-policy.html', '/terms': '/terms-of-service.html',
  '/shipment-status.php': '/track' };
for (const [from, to] of Object.entries(ALIASES)) router.get(from, (req, res) => res.redirect(301, to));

/* ---------------------------------------------------------------- contact */

router.post('/contact', formLimiter, async (req, res, next) => {
  try {
    const done = () => (wantsText(req) ? res.type('text/plain').send('success')
      : res.render('pages/message', { title: 'Message sent', heading: 'Thanks, we got your message', message: 'We have emailed you a copy and will reply within one business day.' }));
    if (isBot(req)) return done();
    const b = req.body;
    const msg = {
      name: v.str(b.name, 120), email: v.email(b.email), phone: v.str(b.phone, 40),
      subject: v.str(b.subject, 150) || 'Website enquiry', message: v.str(b.message || b.msg, 4000),
    };
    const error = !msg.name ? 'Please enter your name.' : !msg.email ? 'Please enter a valid email address.'
      : msg.message.length < 5 ? 'Please write a short message.' : null;
    if (error) {
      return wantsText(req) ? res.status(422).type('text/plain').send(error)
        : res.status(422).render('pages/message', { title: 'Check your message', heading: 'Something is missing', message: error, back: '/contact.html' });
    }
    await svc.createContactMessage(msg);
    done();
  } catch (e) { next(e); }
});

/* ------------------------------------------------------------- newsletter */

router.post('/subscribe', formLimiter, (req, res) => {
  const email = v.email(req.body.email);
  if (!email) {
    return res.status(422).render('pages/message', { title: 'Newsletter', heading: 'Check your email address', message: 'Please enter a valid email address.', back: req.get('referer') || '/' });
  }
  if (!isBot(req)) db.get().prepare('INSERT OR IGNORE INTO subscribers (email) VALUES (?)').run(email);
  res.render('pages/message', { title: 'Subscribed', heading: 'You\'re on the list', message: `Thanks! We'll send updates to ${email}. You can unsubscribe at any time by replying to any newsletter.`, back: '/' });
});

/* ------------------------------------------------------------------ quote */

function quoteView(res, kind, values, errors, status = 200) {
  return res.status(status).render('pages/quote', { title: 'Request a Quote', kind, values, errors });
}

// Step 1: "What are you sending?" (pet or item). Step 2: the form for that kind.
router.get('/quote', (req, res) => {
  const kind = kindFrom({}, req.query);
  const service = v.oneOf(req.query.service, SERVICE_TYPES);
  quoteView(res, kind, { service_type: service && kindOf(service) === kind ? service : '', pet_count: 1 }, {});
});

router.post('/quote', formLimiter, async (req, res, next) => {
  try {
    if (isBot(req)) return res.redirect('/quote/thanks');
    const b = req.body;
    const kind = kindFrom(b);
    const { values, errors } = readShipment(b, kind);
    Object.assign(values, { name: v.str(b.name, 120), email: v.email(b.email), phone: v.str(b.phone, 40), message: v.str(b.message, 2000), consent: b.consent === 'on' });
    if (!values.name) errors.name = 'Please enter your name.';
    if (!values.email) errors.email = 'Please enter a valid email address.';
    if (!values.consent) errors.consent = 'Please agree so we can contact you about this request.';
    if (Object.keys(errors).length) {
      return quoteView(res, kind, { ...values, email: b.email, service_type: b.service_type, pet_type: b.pet_type, package_type: b.package_type }, errors, 422);
    }
    const quote = await svc.createQuote({ name: values.name, email: values.email, phone: values.phone }, values);
    req.session.lastQuoteRef = quote.ref;
    res.redirect('/quote/thanks');
  } catch (e) { next(e); }
});

router.get('/quote/thanks', (req, res) => {
  const ref = req.session.lastQuoteRef;
  res.render('pages/message', {
    title: 'Request received', heading: 'Thanks! We\'ve got your request.',
    message: 'We\'ve emailed you a confirmation. A coordinator will be in touch, usually within one business day.',
    badge: ref ? `Request reference: ${ref}` : null,
  });
});

/* ------------------------------------------------------------------ track */

function trackView(res, extra = {}) {
  return res.render('pages/track', {
    title: 'Tracking Information', ref: '', awbInput: '', awbResult: null, booking: null, quote: null, documents: [],
    lookupError: null, reached: new Set(), BOOKING_STATUSES, BOOKING_FLOW, QUOTE_STATUSES, ...extra,
  });
}

/** Look up a tracking number (booking or quote reference) and render the result. */
function trackLookup(res, input) {
  const typed = v.str(input, 40);
  const { ref, booking, quote } = svc.findByTrackingNumber(typed);
  if (booking) {
    const awbResult = booking.airline_awb && booking.status === 'scheduled' ? awb.parse(booking.airline_awb) : null;
    const reached = new Set(svc.getEvents(booking.id).map((e) => e.status));
    return trackView(res, { ref: booking.ref, booking, documents: svc.getDocuments(booking.id), awbResult, reached });
  }
  if (quote) return trackView(res, { ref: quote.ref, quote });
  return trackView(res.status(404), {
    ref: typed,
    lookupError: ref
      ? `We couldn't find a shipment with tracking number ${ref}. Check the number in your booking email and try again, or contact us.`
      : 'That doesn\'t look like a tracking number. It looks like LPM-B-XXXXXXXX and is in your booking email.',
  });
}

router.get('/track', lookupLimiter, (req, res) => {
  if (req.query.ref) return trackLookup(res, req.query.ref); // links in status emails
  const extra = {};
  if (req.query.awb) { extra.awbInput = v.str(req.query.awb, 30); extra.awbResult = awb.parse(extra.awbInput); }
  trackView(res, extra);
});

router.post('/track', lookupLimiter, (req, res) => trackLookup(res, req.body.ref));

/* ------------------------------------------------------------------- misc */

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nDisallow: /admin\nSitemap: ${config.baseUrl}/sitemap.xml\n`);
});

router.get('/sitemap.xml', (req, res) => {
  const urls = ['/', ...PAGES.filter((p) => p !== 'index').map((p) => `/${p}.html`), '/quote', '/track'];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${config.baseUrl}${u}</loc></url>`).join('')}</urlset>`);
});

module.exports = router;
module.exports.PAGES = PAGES;
