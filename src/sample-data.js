'use strict';
/**
 * Sample quotes and bookings for trying out the admin and the Track page.
 * Used by the admin dashboard (owner only) and by `npm run samples`.
 * Never sends email. Sample customers use @example.com addresses and are tagged "SAMPLE DATA".
 */
const db = require('./db');
const svc = require('./services');

const TAG = 'SAMPLE DATA';

const awb = (prefix, seven) => `${prefix}-${seven}${Number(seven) % 7}`;
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

/* pay: [[amount, method, daysAgo], ...] */
const SAMPLES = () => [
  { customer: ['Jane Doe', 'jane.doe@example.com', '717-555-0101'], service_type: 'domestic_air', pet_type: 'dog', pet_name: 'Biscuit', breed: 'Beagle', weight_lbs: 24,
    origin: 'Lancaster, PA', destination: 'Denver, CO', travel_date: day(9), total_amount: 1450,
    path: ['documents_pending', 'documents_complete', 'scheduled'], docsReceived: 'all', pay: [[500, 'card', 12]],
    details: { airline_awb: awb('006', '1234567'), flight_details: 'DL 1823 PHL → DEN, departs 08:15, arrives 10:40' } },
  { customer: ['Ana Lopez', 'ana.lopez@example.com', '717-555-0102'], service_type: 'international_air', pet_type: 'cat', pet_name: 'Luna', breed: 'Domestic shorthair', weight_lbs: 9, pet_count: 2,
    origin: 'Philadelphia, PA', destination: 'Madrid, Spain', travel_date: day(48), total_amount: 3850,
    path: ['documents_pending'], docsReceived: 3 },
  { customer: ['Ray Turner', 'ray.turner@example.com', '717-555-0103'], service_type: 'domestic_ground', pet_type: 'dog', pet_name: 'Max', breed: 'Golden Retriever', weight_lbs: 68,
    origin: 'Lancaster, PA', destination: 'Boston, MA', travel_date: day(3), total_amount: 890,
    path: ['documents_complete', 'scheduled'], docsReceived: 'all', pay: [[890, 'bank_transfer', 4]],
    details: { pickup_window: `${day(3)}, 8:00–11:00am`, flight_details: 'Climate-controlled van, driver: Sam' } },
  { customer: ['Mei Chen', 'mei.chen@example.com', '717-555-0104'], service_type: 'domestic_ground', pet_type: 'cat', pet_name: 'Mochi',
    origin: 'Harrisburg, PA', destination: 'Raleigh, NC', travel_date: day(-6), total_amount: 640,
    path: ['documents_complete', 'scheduled', 'completed'], docsReceived: 'all', pay: [[200, 'card', 20], [440, 'card', 7]] },
  { customer: ['Priya Patel', 'priya.patel@example.com', '717-555-0110'], service_type: 'international_air', pet_type: 'dog', pet_name: 'Bella', breed: 'Labrador Retriever', pet_age: '4 years', weight_lbs: 62,
    origin: 'Philadelphia, PA', destination: 'Sydney, Australia', travel_date: day(95), total_amount: 6800,
    path: ['documents_pending'], docsReceived: 2, pay: [[2000, 'bank_transfer', 3]] },
  { customer: ['Marcus Green', 'marcus.green@example.com', '717-555-0111'], service_type: 'domestic_air', pet_type: 'cat', pet_name: 'Pepper', breed: 'Maine Coon', pet_age: '2 years', weight_lbs: 14,
    origin: 'Lancaster, PA', destination: 'Seattle, WA', travel_date: day(2), total_amount: 1380,
    path: ['documents_complete', 'scheduled'], docsReceived: 'all',
    details: { airline_awb: awb('016', '7654321'), flight_details: 'UA 1442 PHL → SEA, departs 09:40' } },
  { customer: ['The Yoder Family', 'yoder.family@example.com', '717-555-0112'], service_type: 'domestic_ground', pet_type: 'dog', pet_name: 'Duke & Daisy', breed: 'Beagles', pet_count: 2, weight_lbs: 48,
    origin: 'Bird-in-Hand, PA', destination: 'Columbus, OH', travel_date: day(5), total_amount: 980,
    path: [], docsReceived: 1 },
  { customer: ['Elena Rossi', 'elena.rossi@example.com', '717-555-0113'], service_type: 'domestic_ground', pet_type: 'bird', pet_name: 'Kiwi', breed: 'African Grey parrot', pet_age: '11 years', weight_lbs: 1,
    origin: 'Lancaster, PA', destination: 'New York, NY', travel_date: day(-1), total_amount: 420,
    path: ['documents_complete', 'scheduled', 'completed'], docsReceived: 'all', pay: [[420, 'cash', 2]] },
  { customer: ['David Chen', 'david.chen@example.com', '717-555-0114'], service_type: 'international_air', pet_type: 'cat', pet_name: 'Mochi & Tofu', breed: 'Ragdolls', pet_count: 2, weight_lbs: 20,
    origin: 'Harrisburg, PA', destination: 'London, United Kingdom', travel_date: day(40), total_amount: 5200,
    path: ['documents_pending'], docsReceived: 4 },
  { customer: ['Grace Miller', 'grace.miller@example.com', '717-555-0115'], service_type: 'domestic_air', pet_type: 'small_mammal', pet_name: 'Clover', breed: 'Holland Lop rabbit', pet_age: '3 years', weight_lbs: 4,
    origin: 'Pittsburgh, PA', destination: 'Denver, CO', travel_date: day(30), total_amount: 890,
    path: [], docsReceived: 0 },
  { customer: ['Tom Becker', 'tom.becker@example.com', '717-555-0106'], service_type: 'domestic_air', pet_type: 'dog', pet_name: 'Rocky', breed: 'French Bulldog', weight_lbs: 22,
    origin: 'Lancaster, PA', destination: 'Phoenix, AZ', travel_date: day(15), total_amount: 1600,
    path: ['cancelled'], docsReceived: 0 },
];

const QUOTES = () => [
  { customer: ['Laura Kim', 'laura.kim@example.com', '717-555-0107'], service_type: 'international_air', pet_type: 'dog', pet_name: 'Coco', breed: 'Poodle mix', weight_lbs: 15,
    origin: 'Lancaster, PA', destination: 'London, United Kingdom', travel_date: day(70), message: 'Moving for work in spring. Coco has her microchip already.' },
  { customer: ['Hannah Weber', 'hannah.weber@example.com', '717-555-0116'], service_type: 'domestic_ground', pet_type: 'dog', pet_name: 'Bruno', breed: 'German Shepherd', pet_age: '6 years', weight_lbs: 80,
    origin: 'Lancaster, PA', destination: 'Charlotte, NC', travel_date: day(10), message: 'Bruno gets anxious on long drives.' },
  { customer: ['Omar Haddad', 'omar.haddad@example.com', '717-555-0108'], service_type: 'domestic_ground', pet_type: 'cat', pet_name: 'Simba',
    origin: 'York, PA', destination: 'Atlanta, GA', travel_date: day(20), quoted: 720 },
];

/** Number of sample customers currently in the database. */
function count() {
  return db.get().prepare('SELECT COUNT(*) n FROM customers WHERE notes = ?').get(TAG).n;
}

/** Add the samples (no emails). Returns { added, quotes, bookings: [{ ref, email, service, status }] } or { exists: true }. */
async function add() {
  const d = db.get();
  if (count()) return { exists: true };
  const tag = (email) => d.prepare('UPDATE customers SET notes = ? WHERE email = ?').run(TAG, email);
  const samples = SAMPLES(); const quotes = QUOTES();
  const out = [];

  for (const s of samples) {
    const [name, email, phone] = s.customer;
    const customer = svc.upsertCustomer({ name, email, phone });
    tag(email);
    const booking = svc.createBooking({ ...s, customer_id: customer.id }, null);
    if (s.details) {
      d.prepare('UPDATE bookings SET airline_awb = ?, flight_details = ?, pickup_window = ? WHERE id = ?')
        .run(s.details.airline_awb || null, s.details.flight_details || null, s.details.pickup_window || null, booking.id);
    }
    const docs = svc.getDocuments(booking.id);
    const n = s.docsReceived === 'all' ? docs.length : s.docsReceived;
    for (const doc of docs.slice(0, n)) d.prepare("UPDATE booking_documents SET received = 1, received_at = datetime('now') WHERE id = ?").run(doc.id);
    for (const status of s.path) await svc.setBookingStatus(booking.id, status, { notify: false });
    for (const [amount, method, ago] of s.pay || []) {
      await svc.recordPayment(booking.id, { amount, method, paidOn: day(-ago), reference: 'SAMPLE' }, { sendInvoiceWhenPaid: false });
    }
    if (svc.getPaymentSummary(booking.id).status === 'paid') svc.ensureInvoiceNumber(booking.id);
    svc.addNote('booking', booking.id, null, 'Sample booking (sample data). Remove it from the dashboard when you are done.');
    const b = svc.getBooking(booking.id);
    out.push({ ref: b.ref, email, service: s.service_type, status: b.status });
  }

  for (const q of quotes) {
    const [name, email, phone] = q.customer;
    const { quote } = await createQuoteSilently({ name, email, phone }, q);
    tag(email);
    if (q.quoted) {
      d.prepare(`UPDATE quote_requests SET quoted_amount = ?, quote_notes = ?, status = 'quoted', updated_at = datetime('now') WHERE id = ?`)
        .run(q.quoted, 'Shared ride, door to door. Valid for 14 days.', quote.id);
    }
  }
  return { added: samples.length, quotes: quotes.length, bookings: out };
}

async function createQuoteSilently(customer, q) {
  const quote = await svc.createQuote(customer, q, { notifyCustomer: false, notifyStaff: false });
  return { quote };
}

/** Delete every sample customer with their quotes, bookings, payments, notes and email log. Returns customers removed. */
function remove() {
  const d = db.get();
  const ids = d.prepare('SELECT id FROM customers WHERE notes = ?').all(TAG).map((r) => r.id);
  if (!ids.length) return 0;
  db.tx(() => {
    for (const id of ids) {
      for (const { id: b } of d.prepare('SELECT id FROM bookings WHERE customer_id = ?').all(id)) {
        d.prepare("DELETE FROM notes WHERE entity = 'booking' AND entity_id = ?").run(b);
        d.prepare('DELETE FROM email_log WHERE booking_id = ?').run(b);
        d.prepare('DELETE FROM bookings WHERE id = ?').run(b); // documents, events, payments cascade
      }
      for (const { id: q } of d.prepare('SELECT id FROM quote_requests WHERE customer_id = ?').all(id)) {
        d.prepare("DELETE FROM notes WHERE entity = 'quote' AND entity_id = ?").run(q);
        d.prepare('DELETE FROM email_log WHERE quote_id = ?').run(q);
        d.prepare('DELETE FROM quote_requests WHERE id = ?').run(q);
      }
      d.prepare("DELETE FROM notes WHERE entity = 'customer' AND entity_id = ?").run(id);
      d.prepare('DELETE FROM customers WHERE id = ?').run(id);
    }
  });
  return ids.length;
}

module.exports = { TAG, add, remove, count };
