'use strict';
const db = require('./db');
const mailer = require('./mailer');
const tpl = require('./emails/templates');
const config = require('./config');
const { DOCUMENTS, BOOKING_STATUSES, paymentSummary } = require('./domain');
const { makeRef } = require('./security');

/* -------------------------------------------------------------- customers */

function upsertCustomer({ name, email, phone, address }) {
  const d = db.get();
  const existing = d.prepare('SELECT * FROM customers WHERE email = ?').get(email);
  if (existing) {
    d.prepare(`UPDATE customers SET name = ?, phone = COALESCE(NULLIF(?, ''), phone), address = COALESCE(NULLIF(?, ''), address), updated_at = datetime('now') WHERE id = ?`)
      .run(name, phone || '', address || '', existing.id);
    return d.prepare('SELECT * FROM customers WHERE id = ?').get(existing.id);
  }
  const r = d.prepare('INSERT INTO customers (name, email, phone, address) VALUES (?, ?, ?, ?)').run(name, email, phone || null, address || null);
  return d.prepare('SELECT * FROM customers WHERE id = ?').get(r.lastInsertRowid);
}

function getCustomer(id) {
  return db.get().prepare('SELECT * FROM customers WHERE id = ?').get(id);
}

/* ----------------------------------------------------------------- quotes */

/** opts.notifyCustomer / opts.notifyStaff (both default true) control the two emails. */
async function createQuote(customerInput, q, { notifyCustomer = true, notifyStaff = true } = {}) {
  const { customer, quote } = db.tx((d) => {
    const customer = upsertCustomer(customerInput);
    const ref = makeRef('Q');
    const r = d.prepare(`INSERT INTO quote_requests
      (ref, customer_id, service_type, pet_type, pet_name, breed, pet_age, cargo_description, dimensions, package_type, declared_value, special_needs, weight_lbs, pet_count, origin, destination, travel_date, message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(ref, customer.id, q.service_type, q.pet_type, q.pet_name || null, q.breed || null, q.pet_age || null, q.cargo_description || null, q.dimensions || null,
        q.package_type || null, q.declared_value ?? null, q.special_needs || null,
        q.weight_lbs ?? null, q.pet_count || 1, q.origin, q.destination, q.travel_date || null, q.message || null);
    return { customer, quote: d.prepare('SELECT * FROM quote_requests WHERE id = ?').get(r.lastInsertRowid) };
  });

  const toCustomer = tpl.quoteReceived({ customer, quote });
  const toStaff = tpl.quoteAdminNotify({ customer, quote });
  await Promise.all([
    notifyCustomer && mailer.send({ to: customer.email, ...toCustomer, template: 'quote_received', quoteId: quote.id }),
    notifyStaff && mailer.send({ to: config.business.notifyEmail, ...toStaff, template: 'quote_admin_notify', quoteId: quote.id, replyTo: customer.email }),
  ]);
  return quote;
}

function getQuote(id) {
  return db.get().prepare(`SELECT q.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
    FROM quote_requests q JOIN customers c ON c.id = q.customer_id WHERE q.id = ?`).get(id);
}

async function sendQuote(quoteId, { amount, notes }) {
  const d = db.get();
  d.prepare(`UPDATE quote_requests SET quoted_amount = ?, quote_notes = ?, status = 'quoted', updated_at = datetime('now') WHERE id = ?`)
    .run(amount ?? null, notes || null, quoteId);
  const quote = getQuote(quoteId);
  const customer = getCustomer(quote.customer_id);
  const mail = tpl.quoteReady({ customer, quote });
  return mailer.send({ to: customer.email, ...mail, template: 'quote_ready', quoteId });
}

/* --------------------------------------------------------------- bookings */

function createBooking(data, adminId) {
  return db.tx((d) => {
    const ref = makeRef('B');
    const r = d.prepare(`INSERT INTO bookings
      (ref, customer_id, quote_id, service_type, pet_type, pet_name, breed, pet_age, cargo_description, dimensions, package_type, declared_value, special_needs, weight_lbs, pet_count, origin, destination, travel_date, total_amount, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')`)
      .run(ref, data.customer_id, data.quote_id || null, data.service_type, data.pet_type, data.pet_name || null, data.breed || null,
        data.pet_age || null, data.cargo_description || null, data.dimensions || null,
        data.package_type || null, data.declared_value ?? null, data.special_needs || null,
        data.weight_lbs ?? null, data.pet_count || 1, data.origin, data.destination, data.travel_date || null, data.total_amount ?? null);
    const bookingId = Number(r.lastInsertRowid);
    // Documents: the ones chosen when booking (data.documents = [[key, label], ...]),
    // otherwise the standard list for this type of shipment.
    const ins = d.prepare('INSERT OR IGNORE INTO booking_documents (booking_id, doc_key, label) VALUES (?, ?, ?)');
    const docs = Array.isArray(data.documents) ? data.documents : (DOCUMENTS[data.service_type] || []);
    for (const [key, lbl] of docs) ins.run(bookingId, key, lbl);
    d.prepare('INSERT INTO booking_events (booking_id, status, admin_id) VALUES (?, ?, ?)').run(bookingId, 'confirmed', adminId || null);
    if (data.quote_id) d.prepare(`UPDATE quote_requests SET status = 'converted', updated_at = datetime('now') WHERE id = ?`).run(data.quote_id);
    return getBooking(bookingId);
  });
}

function getBooking(id) {
  return db.get().prepare(`SELECT b.*, c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
    FROM bookings b JOIN customers c ON c.id = b.customer_id WHERE b.id = ?`).get(id);
}

function getDocuments(bookingId) {
  return db.get().prepare('SELECT * FROM booking_documents WHERE booking_id = ? ORDER BY id').all(bookingId);
}

function getEvents(bookingId) {
  return db.get().prepare(`SELECT e.*, a.name AS admin_name FROM booking_events e LEFT JOIN admins a ON a.id = e.admin_id
    WHERE e.booking_id = ? ORDER BY e.id`).all(bookingId);
}

async function sendBookingStatusEmail(bookingId) {
  const booking = getBooking(bookingId);
  const customer = getCustomer(booking.customer_id);
  const reached = new Set(getEvents(bookingId).map((e) => e.status));
  const mail = tpl.bookingStatus({ customer, booking, documents: getDocuments(bookingId), reached });
  return mailer.send({ to: customer.email, ...mail, template: `booking_${booking.status}`, bookingId });
}

/** Change status, record the event, optionally email the customer. */
async function setBookingStatus(bookingId, status, { adminId, notify = true } = {}) {
  if (!BOOKING_STATUSES[status]) throw new Error('Unknown status');
  const d = db.get();
  d.prepare(`UPDATE bookings SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, bookingId);
  const ev = d.prepare('INSERT INTO booking_events (booking_id, status, admin_id) VALUES (?, ?, ?)').run(bookingId, status, adminId || null);
  let sent = false;
  if (notify) {
    sent = await sendBookingStatusEmail(bookingId);
    if (sent) d.prepare('UPDATE booking_events SET email_sent = 1 WHERE id = ?').run(ev.lastInsertRowid);
  }
  return sent;
}

async function sendDocumentsReminder(bookingId) {
  const booking = getBooking(bookingId);
  const documents = getDocuments(bookingId);
  if (!documents.some((x) => !x.received)) return false;
  const customer = getCustomer(booking.customer_id);
  const mail = tpl.documentsReminder({ customer, booking, documents });
  return mailer.send({ to: customer.email, ...mail, template: 'documents_reminder', bookingId });
}

/** Public lookup: needs both the reference and the customer's email. */
function findBookingForCustomer(ref, email) {
  return db.get().prepare(`SELECT b.* FROM bookings b JOIN customers c ON c.id = b.customer_id
    WHERE b.ref = ? AND c.email = ?`).get(ref, email);
}

/**
 * Turn whatever a customer typed into a reference: trims, uppercases, removes spaces,
 * and accepts the bare 8-character code. Returns null when it can't be a reference.
 * "lpm-b-l6qr rprw" -> "LPM-B-L6QRRPRW", "L6QRRPRW" -> "LPM-B-L6QRRPRW", "Q-ABCD2345" -> "LPM-Q-ABCD2345"
 */
function normalizeRef(input) {
  const s = String(input || '').toUpperCase().replace(/[\s_]/g, '');
  let m = s.match(/^(?:LPM-?)?([BQ])-?([A-Z0-9]{8})$/);
  if (m) return `LPM-${m[1]}-${m[2]}`;
  m = s.match(/^([A-Z0-9]{8})$/);
  return m ? `LPM-B-${m[1]}` : null;
}

/** Public lookup by tracking number alone (booking LPM-B-… or quote request LPM-Q-…). */
function findByTrackingNumber(input) {
  const ref = normalizeRef(input);
  if (!ref) return { ref: null };
  if (ref.startsWith('LPM-Q-')) {
    const quote = db.get().prepare('SELECT * FROM quote_requests WHERE ref = ?').get(ref);
    if (quote && quote.status === 'converted') {
      const booking = db.get().prepare('SELECT * FROM bookings WHERE quote_id = ?').get(quote.id);
      if (booking) return { ref: booking.ref, booking };
    }
    return { ref, quote: quote || null };
  }
  return { ref, booking: db.get().prepare('SELECT * FROM bookings WHERE ref = ?').get(ref) || null };
}

/**
 * Permanently delete a booking. Its documents and status history are removed
 * (ON DELETE CASCADE), its notes are removed, and the email log keeps its rows
 * but is unlinked. A quote it came from goes back to "quoted" (or "new") so it
 * can be booked again. Returns the deleted booking, or null if it didn't exist.
 */
function deleteBooking(id) {
  return db.tx((d) => {
    const booking = getBooking(id);
    if (!booking) return null;
    d.prepare("DELETE FROM notes WHERE entity = 'booking' AND entity_id = ?").run(id);
    d.prepare('UPDATE email_log SET booking_id = NULL WHERE booking_id = ?').run(id);
    d.prepare('DELETE FROM bookings WHERE id = ?').run(id);
    if (booking.quote_id) {
      d.prepare(`UPDATE quote_requests SET status = CASE WHEN quoted_amount IS NULL THEN 'new' ELSE 'quoted' END,
        updated_at = datetime('now') WHERE id = ? AND status = 'converted'`).run(booking.quote_id);
    }
    return booking;
  });
}

/**
 * Permanently delete a quote request. Its notes are removed, the email log keeps
 * its rows (unlinked), and a booking made from it is kept but no longer points
 * to it. Returns the deleted quote, or null if it didn't exist.
 */
function deleteQuote(id) {
  return db.tx((d) => {
    const quote = getQuote(id);
    if (!quote) return null;
    const booking = d.prepare('SELECT ref FROM bookings WHERE quote_id = ?').get(id);
    d.prepare("DELETE FROM notes WHERE entity = 'quote' AND entity_id = ?").run(id);
    d.prepare('UPDATE email_log SET quote_id = NULL WHERE quote_id = ?').run(id);
    d.prepare('UPDATE bookings SET quote_id = NULL WHERE quote_id = ?').run(id);
    d.prepare('DELETE FROM quote_requests WHERE id = ?').run(id);
    return { ...quote, booking_ref: booking ? booking.ref : null };
  });
}

/* --------------------------------------------------------------- payments */

function getPayments(bookingId) {
  return db.get().prepare(`SELECT p.*, a.name AS admin_name FROM payments p LEFT JOIN admins a ON a.id = p.admin_id
    WHERE p.booking_id = ? ORDER BY p.paid_on, p.id`).all(bookingId);
}

/** { total, paid, balance, status, label } for a booking */
function getPaymentSummary(bookingId) {
  const b = db.get().prepare('SELECT total_amount FROM bookings WHERE id = ?').get(bookingId);
  return paymentSummary(b ? b.total_amount : null, getPayments(bookingId));
}

/** Invoice number INV-<year>-0001, assigned once per booking. */
function ensureInvoiceNumber(bookingId) {
  const d = db.get();
  const b = d.prepare('SELECT invoice_number FROM bookings WHERE id = ?').get(bookingId);
  if (b.invoice_number) return b.invoice_number;
  const year = new Date().getUTCFullYear();
  const last = d.prepare("SELECT invoice_number FROM bookings WHERE invoice_number LIKE ? ORDER BY invoice_number DESC LIMIT 1").get(`INV-${year}-%`);
  const next = last ? Number(last.invoice_number.split('-')[2]) + 1 : 1;
  const num = `INV-${year}-${String(next).padStart(4, '0')}`;
  d.prepare('UPDATE bookings SET invoice_number = ? WHERE id = ?').run(num, bookingId);
  return num;
}

/** Email the invoice (marked PAID when fully paid). Returns true when sent. */
async function sendInvoice(bookingId) {
  const invoiceNumber = ensureInvoiceNumber(bookingId);
  const booking = getBooking(bookingId);
  const customer = getCustomer(booking.customer_id);
  const payments = getPayments(bookingId);
  const summary = getPaymentSummary(bookingId);
  const mail = tpl.invoice({ customer, booking, payments, summary, invoiceNumber });
  const ok = await mailer.send({ to: customer.email, ...mail, template: 'invoice', bookingId });
  if (ok) db.get().prepare(`UPDATE bookings SET invoice_sent_at = datetime('now') WHERE id = ?`).run(bookingId);
  return ok;
}

/**
 * Record a payment. When it completes the balance and `sendInvoiceWhenPaid` is true,
 * the invoice is emailed. Returns { summary, becamePaid, invoiceSent }.
 */
async function recordPayment(bookingId, { amount, method, reference, paidOn, note }, { adminId, sendInvoiceWhenPaid = true } = {}) {
  const before = getPaymentSummary(bookingId);
  db.get().prepare('INSERT INTO payments (booking_id, amount, method, reference, paid_on, note, admin_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(bookingId, amount, method, reference || null, paidOn, note || null, adminId || null);
  const summary = getPaymentSummary(bookingId);
  const becamePaid = before.status !== 'paid' && summary.status === 'paid';
  let invoiceSent = null;
  if (becamePaid && sendInvoiceWhenPaid) invoiceSent = await sendInvoice(bookingId);
  return { summary, becamePaid, invoiceSent };
}

function deletePayment(bookingId, paymentId) {
  return db.get().prepare('DELETE FROM payments WHERE id = ? AND booking_id = ?').run(paymentId, bookingId).changes > 0;
}

/* ------------------------------------------------------------------ notes */

function addNote(entity, entityId, adminId, body) {
  db.get().prepare('INSERT INTO notes (entity, entity_id, admin_id, body) VALUES (?, ?, ?, ?)').run(entity, entityId, adminId, body);
}

function getNotes(entity, entityId) {
  return db.get().prepare(`SELECT n.*, a.name AS admin_name FROM notes n LEFT JOIN admins a ON a.id = n.admin_id
    WHERE n.entity = ? AND n.entity_id = ? ORDER BY n.id DESC`).all(entity, entityId);
}

/* ---------------------------------------------------------------- contact */

async function createContactMessage(msg) {
  const r = db.get().prepare('INSERT INTO contact_messages (name, email, phone, subject, message) VALUES (?, ?, ?, ?, ?)')
    .run(msg.name, msg.email, msg.phone || null, msg.subject || null, msg.message);
  await Promise.all([
    mailer.send({ to: config.business.notifyEmail, ...tpl.contactAdminNotify({ msg }), template: 'contact_admin_notify', replyTo: msg.email }),
    mailer.send({ to: msg.email, ...tpl.contactReceived({ msg }), template: 'contact_received' }),
  ]);
  return Number(r.lastInsertRowid);
}

module.exports = {
  upsertCustomer, getCustomer, createQuote, getQuote, sendQuote,
  createBooking, getBooking, getDocuments, getEvents, setBookingStatus, sendBookingStatusEmail,
  sendDocumentsReminder, findBookingForCustomer, normalizeRef, findByTrackingNumber, deleteBooking, deleteQuote, addNote,
  getPayments, getPaymentSummary, recordPayment, deletePayment, sendInvoice, ensureInvoiceNumber, getNotes, createContactMessage,
};
