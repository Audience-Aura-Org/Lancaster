'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const v = require('../validate');
const svc = require('../services');
const dashboard = require('../dashboard');
const { kindFrom, readShipment } = require('../shipment-form');
const awb = require('../awb');
const { requireAdmin, requireOwner, audit } = require('../security');
const { SERVICE_TYPES, PET_TYPES, QUOTE_STATUSES, BOOKING_STATUSES, DOCUMENTS, PACKAGE_TYPES, resolveDocuments, isFreight, isAir, CARGO, parseKind } = require('../domain');

const router = express.Router();
const PER_PAGE_OPTIONS = [10, 25, 50, 100];
const DEFAULT_PER_PAGE = 10;

// Admin pages must never be cached or indexed.
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, skipSuccessfulRequests: true,
  handler: (req, res) => res.status(429).render('admin/login', { title: 'Sign in', error: 'Too many sign-in attempts. Please wait 15 minutes.', email: '' }),
});

const MIN_PASSWORD = 10;
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', 10);

/* ------------------------------------------------------------------ auth */

router.get('/login', (req, res) => {
  if (req.session.adminId) return res.redirect('/admin');
  res.render('admin/login', { title: 'Sign in', error: null, email: '' });
});

router.post('/login', loginLimiter, (req, res, next) => {
  const email = v.email(req.body.email);
  const password = String(req.body.password || '');
  const admin = email ? db.get().prepare('SELECT * FROM admins WHERE email = ?').get(email) : null;
  const ok = bcrypt.compareSync(password, admin ? admin.password_hash : DUMMY_HASH);
  if (!admin || !ok || !admin.active) {
    return res.status(401).render('admin/login', { title: 'Sign in', error: 'Email or password is incorrect.', email: req.body.email || '' });
  }
  const returnTo = req.session.returnTo;
  // New session id on login prevents session fixation.
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.adminId = admin.id;
    db.get().prepare(`UPDATE admins SET last_login_at = datetime('now') WHERE id = ?`).run(admin.id);
    req.admin = admin;
    audit(req, 'login', 'admin', admin.id);
    const dest = typeof returnTo === 'string' && returnTo.startsWith('/admin') && !returnTo.startsWith('//') ? returnTo : '/admin';
    req.session.save(() => res.redirect(dest));
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('lpm.sid');
    res.redirect('/admin/login');
  });
});

router.use(requireAdmin);

// Sidebar badge counts.
router.use((req, res, next) => {
  const d = db.get();
  res.locals.navBadges = {
    quotes: d.prepare(`SELECT COUNT(*) n FROM quote_requests WHERE status = 'new'`).get().n,
    messages: d.prepare(`SELECT COUNT(*) n FROM contact_messages WHERE status = 'new'`).get().n,
  };
  next();
});

/* ------------------------------------------------------------- dashboard */

router.get('/', (req, res) => {
  res.render('admin/dashboard', { title: 'Dashboard', ...dashboard.getDashboard() });
});

/** Search everything: bookings, quotes, customers. An exact tracking number jumps straight to it. */
router.get('/search', (req, res) => {
  const q = v.str(req.query.q, 80);
  if (!q) return res.redirect('/admin');
  const ref = svc.normalizeRef(q);
  if (ref) {
    const d = db.get();
    const b = d.prepare('SELECT id FROM bookings WHERE ref = ?').get(ref);
    if (b) return res.redirect(`/admin/bookings/${b.id}`);
    const qq = d.prepare('SELECT id FROM quote_requests WHERE ref = ?').get(ref);
    if (qq) return res.redirect(`/admin/quotes/${qq.id}`);
  }
  res.render('admin/search', { title: `Search: ${q}`, q, ...dashboard.search(q) });
});

/* ---------------------------------------------------------------- helpers */

/** Rows per page: ?per=10|25|50|100, remembered for the admin's session. */
function perPage(req) {
  const asked = v.int(req.query.per, { min: 1 });
  if (PER_PAGE_OPTIONS.includes(asked)) req.session.perPage = asked;
  return PER_PAGE_OPTIONS.includes(req.session.perPage) ? req.session.perPage : DEFAULT_PER_PAGE;
}

/**
 * Paging for a list of `total` rows. Clamps the page into range (e.g. after deleting the
 * last row of the last page). Returns what the pager needs plus offset/limit for SQL.
 */
function pageInfo(req, total) {
  const limit = perPage(req);
  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(pages, Math.max(1, v.int(req.query.page, { min: 1 }) || 1));
  const offset = (page - 1) * limit;
  return { page, pages, total, limit, offset, per: limit, from: total ? offset + 1 : 0, to: Math.min(total, offset + limit), perOptions: PER_PAGE_OPTIONS };
}

/** Simpler helper for the smaller lists: same per-page setting. */
function paging(req) {
  const limit = perPage(req);
  const page = Math.max(1, v.int(req.query.page, { min: 1 }) || 1);
  return { page, offset: (page - 1) * limit, limit };
}

/** SQL fragment limiting a service_type column to one kind ('pet' | 'freight'). */
function kindWhere(col, kind) {
  const keys = Object.entries(SERVICE_TYPES).filter(([, x]) => x.category === kind).map(([k]) => k);
  return { sql: `${col} IN (${keys.map(() => '?').join(',')})`, params: keys };
}

/** 'pet' | 'item' | '' for keeping the filter in links. */
const typeParam = (t) => (t === 'pet' || t === 'item' ? t : '');

function idParam(req) {
  const id = v.int(req.params.id, { min: 1 });
  if (!id) { const e = new Error('Not found'); e.status = 404; throw e; }
  return id;
}

function notFound() { const e = new Error('Not found'); e.status = 404; return e; }

/** Split a textarea of "one per line" document names into unique, non-empty labels. */
function customDocLabels(text) {
  const seen = new Set();
  return String(text || '').split(/\r?\n/).map((s) => v.str(s, 200)).filter((s) => {
    const k = s.toLowerCase(); if (!s || seen.has(k)) return false; seen.add(k); return true;
  }).slice(0, 30);
}

/**
 * Documents chosen in a booking form: ticked boxes named docs_<service> plus "one per line"
 * extras in docs_custom. Returns undefined when the form had no document section (use defaults).
 */
function chosenDocuments(body, serviceType) {
  if (body.docs_present !== '1') return undefined;
  const picked = resolveDocuments(serviceType, [].concat(body[`docs_${serviceType}`] || []));
  const have = new Set(picked.map(([, l]) => l.toLowerCase()));
  const custom = customDocLabels(body.docs_custom).filter((l) => !have.has(l.toLowerCase()))
    .map((l, i) => [`custom_${Date.now()}_${i}`, l]);
  return [...picked, ...custom];
}

/* ----------------------------------------------------------------- quotes */

router.get('/quotes', (req, res) => {
  const status = v.oneOf(req.query.status, QUOTE_STATUSES);
  const type = parseKind(req.query.type);
  const q = v.str(req.query.q, 80);
  const where = []; const params = [];
  if (status) { where.push('q.status = ?'); params.push(status); }
  if (type) { const k = kindWhere('q.service_type', type); where.push(k.sql); params.push(...k.params); }
  if (q) { where.push('(q.ref LIKE ? OR c.name LIKE ? OR c.email LIKE ? OR q.pet_name LIKE ? OR q.cargo_description LIKE ?)'); params.push(...Array(5).fill(`%${q}%`)); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const d = db.get();
  const total = d.prepare(`SELECT COUNT(*) n FROM quote_requests q JOIN customers c ON c.id = q.customer_id ${w}`).get(...params).n;
  const pg = pageInfo(req, total);
  const rows = d.prepare(`SELECT q.*, c.name customer_name, c.email customer_email FROM quote_requests q JOIN customers c ON c.id = q.customer_id
    ${w} ORDER BY q.id DESC LIMIT ? OFFSET ?`).all(...params, pg.limit, pg.offset);
  res.render('admin/quotes', { title: 'Quote requests', rows, ...pg, filter: { status, type: typeParam(req.query.type), q } });
});

router.get('/quotes/new', (req, res) => {
  const kind = kindFrom({}, req.query);
  res.render('admin/quote-new', { title: 'New quote request', kind, values: { pet_count: 1 }, errors: {} });
});

router.post('/quotes/new', async (req, res, next) => {
  try {
    const b = req.body;
    const kind = kindFrom(b);
    const ship = readShipment(b, kind);
    const cust = readCustomer(b);
    const values = { ...ship.values, ...cust.c, message: v.str(b.message, 2000) };
    const errors = { ...cust.errors, ...ship.errors };
    if (Object.keys(errors).length) {
      return res.status(422).render('admin/quote-new', { title: 'New quote request', kind, values: { ...values, email: b.email, service_type: b.service_type }, errors });
    }
    const quote = await svc.createQuote(cust.c, values, { notifyCustomer: b.notify === 'on', notifyStaff: false });
    audit(req, 'quote_created', 'quote', quote.id, `${kind === 'pet' ? 'Pet' : 'Item'} · ${quote.ref}`);
    req.flash('success', `Quote request ${quote.ref} created.${b.notify === 'on' ? ' Confirmation emailed to the customer.' : ''} Add the price below when ready.`);
    res.redirect(`/admin/quotes/${quote.id}`);
  } catch (e) { next(e); }
});

router.get('/quotes/:id', (req, res, next) => {
  const quote = svc.getQuote(idParam(req));
  if (!quote) return next(notFound());
  const booking = db.get().prepare('SELECT id, ref FROM bookings WHERE quote_id = ?').get(quote.id);
  res.render('admin/quote', { title: `Quote ${quote.ref}`, quote, booking, notes: svc.getNotes('quote', quote.id) });
});

router.post('/quotes/:id/status', (req, res) => {
  const id = idParam(req);
  const status = v.oneOf(req.body.status, QUOTE_STATUSES);
  if (status && status !== 'converted') {
    db.get().prepare(`UPDATE quote_requests SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id);
    audit(req, 'quote_status', 'quote', id, status);
    req.flash('success', `Status changed to "${QUOTE_STATUSES[status]}".`);
  }
  res.redirect(`/admin/quotes/${id}`);
});

router.post('/quotes/:id/send-quote', async (req, res, next) => {
  try {
    const id = idParam(req);
    const amount = v.num(req.body.amount, { min: 0, max: 1000000 });
    if (amount == null) { req.flash('error', 'Enter a valid quote amount.'); return res.redirect(`/admin/quotes/${id}`); }
    const sent = await svc.sendQuote(id, { amount, notes: v.str(req.body.notes, 3000) });
    audit(req, 'quote_sent', 'quote', id, String(amount));
    req.flash(sent ? 'success' : 'error', sent ? 'Quote emailed to the customer.' : 'Quote saved, but the email failed. Check the email log.');
    res.redirect(`/admin/quotes/${id}`);
  } catch (e) { next(e); }
});

router.post('/quotes/:id/delete', (req, res) => {
  const id = idParam(req);
  const deleted = svc.deleteQuote(id);
  if (!deleted) {
    req.flash('error', 'That quote request no longer exists.');
    return res.redirect('/admin/quotes');
  }
  audit(req, 'quote_deleted', 'quote', id,
    `${deleted.ref} · ${deleted.customer_name} · ${SERVICE_TYPES[deleted.service_type] ? SERVICE_TYPES[deleted.service_type].label : deleted.service_type}`
    + (deleted.booking_ref ? ` (booking ${deleted.booking_ref} kept)` : ''));
  req.flash('success', `Quote request ${deleted.ref} was deleted.${deleted.booking_ref ? ` Booking ${deleted.booking_ref} was kept.` : ''}`);
  // Back to the quotes list the admin came from (keeps filters), never to the deleted page.
  const back = req.get('referer') || '';
  res.redirect(/\/admin\/quotes(\?|$)/.test(back) ? back.slice(back.indexOf('/admin/quotes')) : '/admin/quotes');
});

router.post('/quotes/:id/convert', async (req, res, next) => {
  try {
    const id = idParam(req);
    const quote = svc.getQuote(id);
    if (!quote) return next(notFound());
    const existing = db.get().prepare('SELECT id FROM bookings WHERE quote_id = ?').get(id);
    if (existing) return res.redirect(`/admin/bookings/${existing.id}`);
    const booking = svc.createBooking({ ...quote, quote_id: quote.id, total_amount: quote.quoted_amount, documents: chosenDocuments(req.body, quote.service_type) }, req.admin.id);
    audit(req, 'booking_created', 'booking', booking.id, `from quote ${quote.ref}`);
    const sent = req.body.notify === 'on' ? await svc.sendBookingStatusEmail(booking.id) : null;
    req.flash('success', `Booking ${booking.ref} created.${sent === true ? ' Confirmation email sent.' : sent === false ? ' Email failed. Check the email log.' : ''}`);
    res.redirect(`/admin/bookings/${booking.id}`);
  } catch (e) { next(e); }
});

/* --------------------------------------------------------------- bookings */

router.get('/bookings', (req, res) => {
  const status = v.oneOf(req.query.status, BOOKING_STATUSES);
  const service = v.oneOf(req.query.service, SERVICE_TYPES);
  const type = parseKind(req.query.type);
  const q = v.str(req.query.q, 80);
  const where = []; const params = [];
  if (status) { where.push('b.status = ?'); params.push(status); }
  if (service) { where.push('b.service_type = ?'); params.push(service); }
  if (type) { const k = kindWhere('b.service_type', type); where.push(k.sql); params.push(...k.params); }
  if (q) { where.push('(b.ref LIKE ? OR c.name LIKE ? OR c.email LIKE ? OR b.pet_name LIKE ? OR b.cargo_description LIKE ?)'); params.push(...Array(5).fill(`%${q}%`)); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const d = db.get();
  const total = d.prepare(`SELECT COUNT(*) n FROM bookings b JOIN customers c ON c.id = b.customer_id ${w}`).get(...params).n;
  const pg = pageInfo(req, total);
  const rows = d.prepare(`SELECT b.*, c.name customer_name FROM bookings b JOIN customers c ON c.id = b.customer_id
    ${w} ORDER BY b.id DESC LIMIT ? OFFSET ?`).all(...params, pg.limit, pg.offset);
  res.render('admin/bookings', { title: 'Bookings', rows, ...pg, filter: { status, service, type: typeParam(req.query.type), q } });
});

function bookingFormValues(b) {
  return {
    service_type: v.oneOf(b.service_type, SERVICE_TYPES),
    pet_type: isFreight(b.service_type) ? CARGO : v.oneOf(b.pet_type, PET_TYPES),
    cargo_description: v.str(b.cargo_description, 300), dimensions: v.str(b.dimensions, 120),
    pet_name: v.str(b.pet_name, 80), breed: v.str(b.breed, 80), weight_lbs: v.num(b.weight_lbs, { min: 0, max: 200000 }),
    pet_count: v.int(b.pet_count, { min: 1, max: 9999 }) || 1, origin: v.str(b.origin, 160), destination: v.str(b.destination, 160),
    travel_date: v.date(b.travel_date), total_amount: v.num(b.total_amount, { min: 0, max: 1000000 }),
    pet_age: v.str(b.pet_age, 40), package_type: v.oneOf(b.package_type, PACKAGE_TYPES),
    declared_value: v.num(b.declared_value, { min: 0, max: 100000000 }), special_needs: v.str(b.special_needs, 1000),
  };
}

/** Customer fields shared by the admin create forms. */
function readCustomer(b) {
  const c = { name: v.str(b.name, 120), email: v.email(b.email), phone: v.str(b.phone, 40) };
  const errors = {};
  if (!c.name) errors.name = 'Required';
  if (!c.email) errors.email = 'Valid email required';
  return { c, errors };
}

router.get('/bookings/new', (req, res) => {
  const kind = kindFrom({}, req.query);
  res.render('admin/booking-new', { title: 'New booking', kind, values: { pet_count: 1 }, errors: {} });
});

router.post('/bookings/new', async (req, res, next) => {
  try {
    const b = req.body;
    const kind = kindFrom(b);
    const ship = readShipment(b, kind);
    const cust = readCustomer(b);
    const values = { ...ship.values, ...cust.c, total_amount: v.num(b.total_amount, { min: 0, max: 100000000 }) };
    const errors = { ...cust.errors, ...ship.errors };
    if (Object.keys(errors).length) {
      return res.status(422).render('admin/booking-new', { title: 'New booking', kind, values: { ...values, email: b.email, service_type: b.service_type }, errors });
    }
    const customer = svc.upsertCustomer(cust.c);
    const booking = svc.createBooking({ ...values, customer_id: customer.id, documents: chosenDocuments(b, values.service_type) }, req.admin.id);
    audit(req, 'booking_created', 'booking', booking.id, `${kind === 'pet' ? 'Pet' : 'Item'} · ${booking.ref}`);
    const sent = b.notify === 'on' ? await svc.sendBookingStatusEmail(booking.id) : null;
    req.flash('success', `${kind === 'pet' ? 'Pet booking' : 'Item shipment'} ${booking.ref} created.${sent === true ? ' Confirmation email sent.' : sent === false ? ' Email failed. Check the email log.' : ''}`);
    res.redirect(`/admin/bookings/${booking.id}`);
  } catch (e) { next(e); }
});

router.get('/bookings/:id', (req, res, next) => {
  const booking = svc.getBooking(idParam(req));
  if (!booking) return next(notFound());
  const emails = db.get().prepare('SELECT * FROM email_log WHERE booking_id = ? ORDER BY id DESC LIMIT 20').all(booking.id);
  res.render('admin/booking', {
    title: `Booking ${booking.ref}`, booking,
    documents: svc.getDocuments(booking.id), events: svc.getEvents(booking.id), notes: svc.getNotes('booking', booking.id), emails,
    awbResult: booking.airline_awb ? awb.parse(booking.airline_awb) : null,
  });
});

router.post('/bookings/:id/status', async (req, res, next) => {
  try {
    const id = idParam(req);
    const status = v.oneOf(req.body.status, BOOKING_STATUSES);
    if (!status) { req.flash('error', 'Choose a status.'); return res.redirect(`/admin/bookings/${id}`); }
    const booking = svc.getBooking(id);
    if (!booking) return next(notFound());
    if (status === 'scheduled' && isAir(booking.service_type) && !booking.airline_awb) {
      req.flash('error', 'Add the airline air waybill number in Transport details before marking an air booking as scheduled.');
      return res.redirect(`/admin/bookings/${id}`);
    }
    const notify = req.body.notify === 'on';
    const sent = await svc.setBookingStatus(id, status, { adminId: req.admin.id, notify });
    audit(req, 'booking_status', 'booking', id, status);
    req.flash(notify && !sent ? 'error' : 'success',
      `Status set to "${BOOKING_STATUSES[status].label}".${notify ? (sent ? ' Customer emailed.' : ' Email failed. Check the email log.') : ''}`);
    const missing = svc.getDocuments(id).filter((d) => !d.received).length;
    if (missing && ['documents_complete', 'scheduled', 'completed'].includes(status)) {
      req.flash('error', `Heads up: ${missing} document(s) on the checklist are still marked as not received.`);
    }
    res.redirect(`/admin/bookings/${id}`);
  } catch (e) { next(e); }
});

router.post('/bookings/:id/details', (req, res, next) => {
  const id = idParam(req);
  const booking = svc.getBooking(id);
  if (!booking) return next(notFound());
  const values = bookingFormValues({ ...booking, ...req.body, service_type: booking.service_type });
  const awbInput = v.str(req.body.airline_awb, 30);
  let awbValue = null;
  if (awbInput) {
    const parsed = awb.parse(awbInput);
    if (!parsed.valid) { req.flash('error', parsed.error); return res.redirect(`/admin/bookings/${id}`); }
    awbValue = parsed.formatted;
  }
  if (!values.origin || !values.destination) { req.flash('error', 'Origin and destination are required.'); return res.redirect(`/admin/bookings/${id}`); }
  const freight = isFreight(booking.service_type);
  db.get().prepare(`UPDATE bookings SET pet_type = ?, pet_name = ?, breed = ?, pet_age = ?, cargo_description = ?, dimensions = ?, package_type = ?, declared_value = ?, special_needs = ?,
    weight_lbs = ?, pet_count = ?, origin = ?, destination = ?,
    travel_date = ?, total_amount = ?, airline_awb = ?, flight_details = ?, pickup_window = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(values.pet_type || booking.pet_type,
      freight ? null : (values.pet_name || null), freight ? null : (values.breed || null), freight ? null : (values.pet_age || null),
      freight ? (values.cargo_description || null) : null, freight ? (values.dimensions || null) : null,
      freight ? values.package_type : null, freight ? values.declared_value : null, values.special_needs || null,
      values.weight_lbs, values.pet_count,
      values.origin, values.destination, values.travel_date, values.total_amount, awbValue,
      v.str(req.body.flight_details, 300) || null, v.str(req.body.pickup_window, 200) || null, id);
  audit(req, 'booking_details', 'booking', id);
  req.flash('success', 'Travel details saved.');
  res.redirect(`/admin/bookings/${id}`);
});

/* ------------------------------------------------- booking document checklist */

function bookingOr404(req) {
  const booking = svc.getBooking(idParam(req));
  if (!booking) throw notFound();
  return booking;
}

/** Save the "received" ticks from the checklist form (only when the form was the checklist form). */
function applyTicks(req, bookingId) {
  if (req.body.checklist !== '1') return;
  const received = new Set([].concat(req.body.received || []).map(String));
  const upd = db.get().prepare(`UPDATE booking_documents SET received = ?,
    received_at = CASE WHEN ? = 1 THEN COALESCE(received_at, datetime('now')) ELSE NULL END WHERE id = ? AND booking_id = ?`);
  db.tx(() => {
    for (const doc of svc.getDocuments(bookingId)) { const r = received.has(String(doc.id)) ? 1 : 0; upd.run(r, r, doc.id, bookingId); }
  });
}

/** Add a document; ignores duplicates (same name, any capitalisation). Returns 'added' | 'duplicate' | 'empty'. */
function addDocument(bookingId, rawLabel) {
  const label = v.str(rawLabel, 200);
  if (!label) return 'empty';
  const d = db.get();
  if (d.prepare('SELECT 1 FROM booking_documents WHERE booking_id = ? AND lower(label) = lower(?)').get(bookingId, label)) return 'duplicate';
  d.prepare('INSERT INTO booking_documents (booking_id, doc_key, label) VALUES (?, ?, ?)')
    .run(bookingId, `custom_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, label);
  return 'added';
}

const docsPage = (id) => `/admin/bookings/${id}#documents`;

router.post('/bookings/:id/documents', (req, res) => {
  const { id } = bookingOr404(req);
  applyTicks(req, id);
  if (req.body.new_label) addDocument(id, req.body.new_label);
  audit(req, 'booking_documents', 'booking', id);
  req.flash('success', 'Document checklist saved.');
  res.redirect(docsPage(id));
});

router.post('/bookings/:id/documents/add', (req, res) => {
  const booking = bookingOr404(req);
  const id = booking.id;
  const added = [];
  let duplicates = 0;
  // Documents ticked from the list
  const ins = db.get().prepare('INSERT OR IGNORE INTO booking_documents (booking_id, doc_key, label) VALUES (?, ?, ?)');
  const exists = db.get().prepare('SELECT 1 FROM booking_documents WHERE booking_id = ? AND (doc_key = ? OR lower(label) = lower(?))');
  db.tx(() => {
    for (const [key, lbl] of resolveDocuments(booking.service_type, [].concat(req.body.pick || []))) {
      if (exists.get(id, key, lbl)) { duplicates++; continue; }
      ins.run(id, key, lbl); added.push(lbl);
    }
  });
  // Typed document name(s)
  for (const lbl of [v.str(req.body.label, 200), ...customDocLabels(req.body.custom)].filter(Boolean)) {
    const r = addDocument(id, lbl);
    if (r === 'added') added.push(lbl); else if (r === 'duplicate') duplicates++;
  }
  if (added.length) {
    audit(req, 'document_added', 'booking', id, added.join('; '));
    req.flash('success', added.length === 1 ? `Added "${added[0]}" to the checklist.` : `Added ${added.length} documents to the checklist.`);
  } else {
    req.flash('error', duplicates ? 'That document is already on the checklist.' : 'Tick a document from the list or type one to add.');
  }
  res.redirect(docsPage(id));
});

router.post('/bookings/:id/documents/:docId/delete', (req, res) => {
  const { id } = bookingOr404(req);
  applyTicks(req, id); // keep any ticks changed before clicking remove
  const docId = v.int(req.params.docId, { min: 1 });
  const doc = docId && db.get().prepare('SELECT * FROM booking_documents WHERE id = ? AND booking_id = ?').get(docId, id);
  if (!doc) {
    req.flash('error', 'That document is no longer on the checklist.');
  } else {
    db.get().prepare('DELETE FROM booking_documents WHERE id = ?').run(doc.id);
    audit(req, 'document_removed', 'booking', id, doc.label);
    req.flash('success', `Removed "${doc.label}" from the checklist.`);
  }
  res.redirect(docsPage(id));
});

router.post('/bookings/:id/documents/restore', (req, res) => {
  const booking = bookingOr404(req);
  const ins = db.get().prepare('INSERT OR IGNORE INTO booking_documents (booking_id, doc_key, label) VALUES (?, ?, ?)');
  let added = 0;
  db.tx(() => { for (const [key, lbl] of DOCUMENTS[booking.service_type] || []) added += Number(ins.run(booking.id, key, lbl).changes); });
  if (added) audit(req, 'documents_restored', 'booking', booking.id, `${added} standard document(s)`);
  req.flash('success', added ? `Restored ${added} standard document(s).` : 'All standard documents are already on the checklist.');
  res.redirect(docsPage(booking.id));
});

router.post('/bookings/:id/remind', async (req, res, next) => {
  try {
    const id = idParam(req);
    const sent = await svc.sendDocumentsReminder(id);
    audit(req, 'documents_reminder', 'booking', id);
    req.flash(sent ? 'success' : 'error', sent ? 'Reminder emailed to the customer.' : 'Nothing outstanding, or the email failed.');
    res.redirect(`/admin/bookings/${id}#documents`);
  } catch (e) { next(e); }
});

router.post('/bookings/:id/resend', async (req, res, next) => {
  try {
    const id = idParam(req);
    const sent = await svc.sendBookingStatusEmail(id);
    audit(req, 'status_email_resent', 'booking', id);
    req.flash(sent ? 'success' : 'error', sent ? 'Status email re-sent.' : 'Email failed. Check the email log.');
    res.redirect(`/admin/bookings/${id}`);
  } catch (e) { next(e); }
});

router.post('/bookings/:id/delete', (req, res) => {
  const id = idParam(req);
  const deleted = svc.deleteBooking(id);
  if (!deleted) {
    req.flash('error', 'That booking no longer exists.');
    return res.redirect('/admin/bookings');
  }
  audit(req, 'booking_deleted', 'booking', id,
    `${deleted.ref} · ${deleted.customer_name} · ${SERVICE_TYPES[deleted.service_type] ? SERVICE_TYPES[deleted.service_type].label : deleted.service_type} · ${deleted.origin} → ${deleted.destination}`);
  req.flash('success', `Shipment ${deleted.ref} was deleted.`);
  // Go back to the list the admin came from (keeps filters), never to the deleted page.
  const back = req.get('referer') || '';
  res.redirect(/\/admin\/bookings(\?|$)/.test(back) ? back.slice(back.indexOf('/admin/bookings')) : '/admin/bookings');
});

/* ------------------------------------------------------------------ notes */

router.post('/notes', (req, res) => {
  const entity = v.oneOf(req.body.entity, { quote: 1, booking: 1, customer: 1 });
  const entityId = v.int(req.body.entity_id, { min: 1 });
  const body = v.str(req.body.body, 4000);
  const back = { quote: '/admin/quotes/', booking: '/admin/bookings/', customer: '/admin/customers/' }[entity];
  if (!entity || !entityId) return res.redirect('/admin');
  if (body) { svc.addNote(entity, entityId, req.admin.id, body); req.flash('success', 'Note added.'); }
  res.redirect(`${back}${entityId}#notes`);
});

/* -------------------------------------------------------------- customers */

router.get('/customers', (req, res) => {
  const { page, offset, limit } = paging(req);
  const q = v.str(req.query.q, 80);
  const w = q ? 'WHERE name LIKE ? OR email LIKE ? OR phone LIKE ?' : '';
  const params = q ? Array(3).fill(`%${q}%`) : [];
  const d = db.get();
  const total = d.prepare(`SELECT COUNT(*) n FROM customers ${w}`).get(...params).n;
  const rows = d.prepare(`SELECT c.*, (SELECT COUNT(*) FROM bookings b WHERE b.customer_id = c.id) bookings,
    (SELECT COUNT(*) FROM quote_requests q WHERE q.customer_id = c.id) quotes FROM customers c ${w} ORDER BY c.id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  res.render('admin/customers', { title: 'Customers', rows, ...pageInfo(req, total), filter: { q } });
});

router.get('/customers/:id', (req, res, next) => {
  const customer = svc.getCustomer(idParam(req));
  if (!customer) return next(notFound());
  const d = db.get();
  res.render('admin/customer', {
    title: customer.name, customer,
    quotes: d.prepare('SELECT * FROM quote_requests WHERE customer_id = ? ORDER BY id DESC').all(customer.id),
    bookings: d.prepare('SELECT * FROM bookings WHERE customer_id = ? ORDER BY id DESC').all(customer.id),
    notes: svc.getNotes('customer', customer.id),
  });
});

router.post('/customers/:id', (req, res) => {
  const id = idParam(req);
  const name = v.str(req.body.name, 120);
  const email = v.email(req.body.email);
  if (!name || !email) { req.flash('error', 'Name and a valid email are required.'); return res.redirect(`/admin/customers/${id}`); }
  try {
    db.get().prepare(`UPDATE customers SET name = ?, email = ?, phone = ?, address = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(name, email, v.str(req.body.phone, 40) || null, v.str(req.body.address, 300) || null, id);
    audit(req, 'customer_updated', 'customer', id);
    req.flash('success', 'Customer saved.');
  } catch (e) {
    req.flash('error', /UNIQUE/.test(e.message) ? 'Another customer already uses that email.' : 'Could not save customer.');
  }
  res.redirect(`/admin/customers/${id}`);
});

/* --------------------------------------------------------------- messages */

router.get('/messages', (req, res) => {
  const { page, offset, limit } = paging(req);
  const status = v.oneOf(req.query.status, { new: 1, read: 1, archived: 1 });
  const w = status ? 'WHERE status = ?' : `WHERE status != 'archived'`;
  const params = status ? [status] : [];
  const d = db.get();
  const total = d.prepare(`SELECT COUNT(*) n FROM contact_messages ${w}`).get(...params).n;
  const rows = d.prepare(`SELECT * FROM contact_messages ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  res.render('admin/messages', { title: 'Messages', rows, ...pageInfo(req, total), filter: { status } });
});

router.post('/messages/:id', (req, res) => {
  const id = idParam(req);
  const status = v.oneOf(req.body.status, { new: 1, read: 1, archived: 1 });
  if (status) db.get().prepare('UPDATE contact_messages SET status = ? WHERE id = ?').run(status, id);
  res.redirect('/admin/messages');
});

/* ------------------------------------------------------------ subscribers */

router.get('/subscribers', (req, res) => {
  const { page, offset, limit } = paging(req);
  const d = db.get();
  const total = d.prepare('SELECT COUNT(*) n FROM subscribers').get().n;
  const rows = d.prepare('SELECT * FROM subscribers ORDER BY id DESC LIMIT ? OFFSET ?').all(limit, offset);
  res.render('admin/subscribers', { title: 'Newsletter subscribers', rows, ...pageInfo(req, total), filter: {} });
});

router.get('/subscribers.csv', (req, res) => {
  const rows = db.get().prepare('SELECT email, created_at FROM subscribers ORDER BY id').all();
  res.type('text/csv').attachment('subscribers.csv').send('email,subscribed_at_utc\n' + rows.map((r) => `${r.email},${r.created_at}`).join('\n'));
});

router.post('/subscribers/:id/delete', (req, res) => {
  const id = idParam(req);
  db.get().prepare('DELETE FROM subscribers WHERE id = ?').run(id);
  audit(req, 'subscriber_removed', null, id);
  req.flash('success', 'Subscriber removed.');
  res.redirect('/admin/subscribers');
});

/* -------------------------------------------------------------- email log */

router.get('/emails', (req, res) => {
  const { page, offset, limit } = paging(req);
  const d = db.get();
  const total = d.prepare('SELECT COUNT(*) n FROM email_log').get().n;
  const rows = d.prepare('SELECT * FROM email_log ORDER BY id DESC LIMIT ? OFFSET ?').all(limit, offset);
  res.render('admin/emails', { title: 'Email log', rows, ...pageInfo(req, total), filter: {} });
});

/* ------------------------------------------------------- account & users */

router.get('/account', (req, res) => res.render('admin/account', { title: 'My account' }));

router.post('/account/password', (req, res) => {
  const me = db.get().prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id);
  const current = String(req.body.current || '');
  const next = String(req.body.password || '');
  if (!bcrypt.compareSync(current, me.password_hash)) { req.flash('error', 'Current password is incorrect.'); return res.redirect('/admin/account'); }
  if (next.length < MIN_PASSWORD) { req.flash('error', `New password must be at least ${MIN_PASSWORD} characters.`); return res.redirect('/admin/account'); }
  if (next !== req.body.confirm) { req.flash('error', 'New passwords do not match.'); return res.redirect('/admin/account'); }
  db.get().prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(next, 12), me.id);
  // Sign out every other session for this admin.
  db.get().prepare(`DELETE FROM sessions WHERE sid != ? AND json_extract(sess, '$.adminId') = ?`).run(req.sessionID, me.id);
  audit(req, 'password_changed', 'admin', me.id);
  req.flash('success', 'Password changed. Other sessions were signed out.');
  res.redirect('/admin/account');
});

router.get('/users', requireOwner, (req, res) => {
  const rows = db.get().prepare('SELECT id, email, name, role, active, last_login_at, created_at FROM admins ORDER BY id').all();
  res.render('admin/users', { title: 'Team accounts', rows });
});

router.post('/users', requireOwner, (req, res) => {
  const email = v.email(req.body.email);
  const name = v.str(req.body.name, 120);
  const role = v.oneOf(req.body.role, { owner: 1, staff: 1 }) || 'staff';
  const password = String(req.body.password || '');
  if (!email || !name) { req.flash('error', 'Name and a valid email are required.'); return res.redirect('/admin/users'); }
  if (password.length < MIN_PASSWORD) { req.flash('error', `Password must be at least ${MIN_PASSWORD} characters.`); return res.redirect('/admin/users'); }
  try {
    const r = db.get().prepare('INSERT INTO admins (email, name, password_hash, role) VALUES (?, ?, ?, ?)').run(email, name, bcrypt.hashSync(password, 12), role);
    audit(req, 'admin_created', 'admin', Number(r.lastInsertRowid), `${email} (${role})`);
    req.flash('success', `Account created for ${email}. Share the password with them securely.`);
  } catch (e) {
    req.flash('error', /UNIQUE/.test(e.message) ? 'An account with that email already exists.' : 'Could not create account.');
  }
  res.redirect('/admin/users');
});

router.post('/users/:id/toggle', requireOwner, (req, res) => {
  const id = idParam(req);
  if (id === req.admin.id) { req.flash('error', 'You cannot deactivate your own account.'); return res.redirect('/admin/users'); }
  const d = db.get();
  d.prepare('UPDATE admins SET active = 1 - active WHERE id = ?').run(id);
  const row = d.prepare('SELECT active FROM admins WHERE id = ?').get(id);
  if (row && !row.active) d.prepare(`DELETE FROM sessions WHERE json_extract(sess, '$.adminId') = ?`).run(id);
  audit(req, row && row.active ? 'admin_activated' : 'admin_deactivated', 'admin', id);
  req.flash('success', 'Account updated.');
  res.redirect('/admin/users');
});

router.post('/users/:id/password', requireOwner, (req, res) => {
  const id = idParam(req);
  const password = String(req.body.password || '');
  if (password.length < MIN_PASSWORD) { req.flash('error', `Password must be at least ${MIN_PASSWORD} characters.`); return res.redirect('/admin/users'); }
  db.get().prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 12), id);
  db.get().prepare(`DELETE FROM sessions WHERE json_extract(sess, '$.adminId') = ? AND sid != ?`).run(id, req.sessionID);
  audit(req, 'admin_password_reset', 'admin', id);
  req.flash('success', 'Password reset.');
  res.redirect('/admin/users');
});

router.get('/activity', requireOwner, (req, res) => {
  const { page, offset, limit } = paging(req);
  const d = db.get();
  const total = d.prepare('SELECT COUNT(*) n FROM audit_log').get().n;
  const rows = d.prepare(`SELECT l.*, a.name admin_name,
      CASE l.entity
        WHEN 'booking' THEN EXISTS (SELECT 1 FROM bookings WHERE id = l.entity_id)
        WHEN 'quote' THEN EXISTS (SELECT 1 FROM quote_requests WHERE id = l.entity_id)
        WHEN 'customer' THEN EXISTS (SELECT 1 FROM customers WHERE id = l.entity_id)
        ELSE 0 END AS record_exists
    FROM audit_log l LEFT JOIN admins a ON a.id = l.admin_id ORDER BY l.id DESC LIMIT ? OFFSET ?`).all(limit, offset);
  res.render('admin/activity', { title: 'Activity log', rows, ...pageInfo(req, total), filter: {} });
});

module.exports = router;
