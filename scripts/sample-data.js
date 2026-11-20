'use strict';
/**
 * Sample quotes and shipments for trying out the admin and the Track page.
 *   npm run samples           add sample data (no emails are sent)
 *   npm run samples -- --remove   delete all sample data again
 * Sample customers use @example.com addresses and are tagged "SAMPLE DATA".
 */
const db = require('../src/db');
const svc = require('../src/services');

const TAG = 'SAMPLE DATA';

function awb(prefix, seven) {
  return `${prefix}-${seven}${Number(seven) % 7}`;
}
function day(offset) {
  const d = new Date(Date.now() + offset * 86400000);
  return d.toISOString().slice(0, 10);
}

function remove() {
  const d = db.open();
  const ids = d.prepare('SELECT id FROM customers WHERE notes = ?').all(TAG).map((r) => r.id);
  if (!ids.length) { console.log('No sample data found.'); return; }
  db.tx(() => {
    for (const id of ids) {
      const bookings = d.prepare('SELECT id FROM bookings WHERE customer_id = ?').all(id).map((r) => r.id);
      for (const b of bookings) {
        d.prepare("DELETE FROM notes WHERE entity = 'booking' AND entity_id = ?").run(b);
        d.prepare('DELETE FROM email_log WHERE booking_id = ?').run(b);
        d.prepare('DELETE FROM bookings WHERE id = ?').run(b); // documents + events cascade
      }
      const quotes = d.prepare('SELECT id FROM quote_requests WHERE customer_id = ?').all(id).map((r) => r.id);
      for (const q of quotes) {
        d.prepare("DELETE FROM notes WHERE entity = 'quote' AND entity_id = ?").run(q);
        d.prepare('DELETE FROM email_log WHERE quote_id = ?').run(q);
        d.prepare('DELETE FROM quote_requests WHERE id = ?').run(q);
      }
      d.prepare("DELETE FROM notes WHERE entity = 'customer' AND entity_id = ?").run(id);
      d.prepare('DELETE FROM customers WHERE id = ?').run(id);
    }
  });
  console.log(`Removed sample data for ${ids.length} customers.`);
}

const SAMPLES = [
  { customer: ['Jane Doe', 'jane.doe@example.com', '717-555-0101'], service_type: 'domestic_air', pet_type: 'dog', pet_name: 'Biscuit', breed: 'Beagle', weight_lbs: 24,
    origin: 'Lancaster, PA', destination: 'Denver, CO', travel_date: day(9), total_amount: 1450,
    path: ['documents_pending', 'documents_complete', 'scheduled'], docsReceived: 'all',
    details: { airline_awb: awb('006', '1234567'), flight_details: 'DL 1823 PHL → DEN, departs 08:15, arrives 10:40' } },
  { customer: ['Ana Lopez', 'ana.lopez@example.com', '717-555-0102'], service_type: 'international_air', pet_type: 'cat', pet_name: 'Luna', breed: 'Domestic shorthair', weight_lbs: 9, pet_count: 2,
    origin: 'Philadelphia, PA', destination: 'Madrid, Spain', travel_date: day(48), total_amount: 3850,
    path: ['documents_pending'], docsReceived: 3 },
  { customer: ['Ray Turner', 'ray.turner@example.com', '717-555-0103'], service_type: 'domestic_ground', pet_type: 'dog', pet_name: 'Max', breed: 'Golden Retriever', weight_lbs: 68,
    origin: 'Lancaster, PA', destination: 'Boston, MA', travel_date: day(3), total_amount: 890,
    path: ['documents_complete', 'scheduled'], docsReceived: 'all',
    details: { pickup_window: `${day(3)}, 8:00–11:00am`, flight_details: 'Climate-controlled van, driver: Sam' } },
  { customer: ['Mei Chen', 'mei.chen@example.com', '717-555-0104'], service_type: 'domestic_ground', pet_type: 'cat', pet_name: 'Mochi',
    origin: 'Harrisburg, PA', destination: 'Raleigh, NC', travel_date: day(-6), total_amount: 640,
    path: ['documents_complete', 'scheduled', 'completed'], docsReceived: 'all' },
  { customer: ['Keystone Tools LLC', 'shipping@keystonetools.example.com', '717-555-0110'], service_type: 'ocean_freight', cargo_description: '1 x 20ft container of machine tools', dimensions: '20ft FCL', weight_lbs: 18500,
    origin: 'Port of Philadelphia, PA', destination: 'Rotterdam, Netherlands', travel_date: day(21), total_amount: 4200,
    path: ['documents_pending'], docsReceived: 2 },
  { customer: ['Susquehanna Medical Supply', 'logistics@susqmed.example.com', '717-555-0111'], service_type: 'air_freight', cargo_description: 'Medical equipment, 6 cartons', dimensions: '6 x 60x40x40 cm', weight_lbs: 210, pet_count: 6,
    origin: 'Lancaster, PA', destination: 'Toronto, ON, Canada', travel_date: day(2), total_amount: 1980,
    path: ['documents_complete', 'scheduled'], docsReceived: 'all',
    details: { airline_awb: awb('014', '7654321'), flight_details: 'AC 731 PHL → YYZ, departs 14:05' } },
  { customer: ['Amish Country Furniture', 'orders@acfurniture.example.com', '717-555-0112'], service_type: 'cargo_freight', cargo_description: '4 pallets of handmade furniture', dimensions: '4 pallets, 120x100x150 cm', weight_lbs: 2600, pet_count: 4,
    origin: 'Bird-in-Hand, PA', destination: 'Columbus, OH', travel_date: day(5), total_amount: 1150,
    path: [], docsReceived: 1 },
  { customer: ['Rivera Law Office', 'office@riveralaw.example.com', '717-555-0113'], service_type: 'express_delivery', cargo_description: 'Signed contract documents (1 envelope)', weight_lbs: 1,
    origin: 'Lancaster, PA', destination: 'New York, NY', travel_date: day(-1), total_amount: 145,
    path: ['documents_complete', 'scheduled', 'completed'], docsReceived: 'all' },
  { customer: ['Dutch Valley Imports', 'imports@dutchvalley.example.com', '717-555-0114'], service_type: 'customs_clearance', cargo_description: 'Imported kitchenware, 2 pallets', weight_lbs: 900, pet_count: 2,
    origin: 'Hamburg, Germany', destination: 'Lancaster, PA', travel_date: day(12), total_amount: 375,
    path: ['documents_pending'], docsReceived: 2 },
  { customer: ['Conestoga Energy', 'projects@conestoga.example.com', '717-555-0115'], service_type: 'project_cargo', cargo_description: 'Industrial transformer (oversized)', dimensions: '5.2 x 2.8 x 3.1 m', weight_lbs: 41000,
    origin: 'Pittsburgh, PA', destination: 'Lancaster, PA', travel_date: day(30), total_amount: 16800,
    path: [], docsReceived: 0 },
  { customer: ['Tom Becker', 'tom.becker@example.com', '717-555-0106'], service_type: 'domestic_air', pet_type: 'dog', pet_name: 'Rocky', breed: 'French Bulldog', weight_lbs: 22,
    origin: 'Lancaster, PA', destination: 'Phoenix, AZ', travel_date: day(15), total_amount: 1600,
    path: ['cancelled'], docsReceived: 0 },
];

const QUOTES = [
  { customer: ['Laura Kim', 'laura.kim@example.com', '717-555-0107'], service_type: 'international_air', pet_type: 'dog', pet_name: 'Coco', breed: 'Poodle mix', weight_lbs: 15,
    origin: 'Lancaster, PA', destination: 'London, United Kingdom', travel_date: day(70), message: 'Moving for work in spring. Coco has her microchip already.' },
  { customer: ['Penn Bakery Co.', 'ops@pennbakery.example.com', '717-555-0116'], service_type: 'cargo_freight', pet_type: 'cargo', cargo_description: '2 pallets of bakery equipment', dimensions: '2 pallets', weight_lbs: 1400, pet_count: 2,
    origin: 'Lancaster, PA', destination: 'Baltimore, MD', travel_date: day(10), message: 'Need a liftgate at delivery.' },
  { customer: ['Omar Haddad', 'omar.haddad@example.com', '717-555-0108'], service_type: 'domestic_ground', pet_type: 'cat', pet_name: 'Simba',
    origin: 'York, PA', destination: 'Atlanta, GA', travel_date: day(20), quoted: 720 },
];

async function add() {
  const d = db.open();
  if (d.prepare('SELECT COUNT(*) n FROM customers WHERE notes = ?').get(TAG).n) {
    console.log('Sample data already exists. Run with --remove first to recreate it.');
    return;
  }
  const mailer = require('../src/mailer');
  const realSend = mailer.send;
  mailer.send = async () => true; // never email sample customers

  const tag = (email) => d.prepare('UPDATE customers SET notes = ? WHERE email = ?').run(TAG, email);
  const out = [];

  for (const s of SAMPLES) {
    const [name, email, phone] = s.customer;
    const customer = svc.upsertCustomer({ name, email, phone });
    tag(email);
    const booking = svc.createBooking({ ...s, customer_id: customer.id, pet_type: s.pet_type || 'cargo' }, null);
    if (s.details) {
      d.prepare('UPDATE bookings SET airline_awb = ?, flight_details = ?, pickup_window = ? WHERE id = ?')
        .run(s.details.airline_awb || null, s.details.flight_details || null, s.details.pickup_window || null, booking.id);
    }
    const docs = svc.getDocuments(booking.id);
    const n = s.docsReceived === 'all' ? docs.length : s.docsReceived;
    for (const doc of docs.slice(0, n)) d.prepare("UPDATE booking_documents SET received = 1, received_at = datetime('now') WHERE id = ?").run(doc.id);
    for (const status of s.path) await svc.setBookingStatus(booking.id, status, { notify: false });
    svc.addNote('booking', booking.id, null, 'Sample booking created by scripts/sample-data.js');
    const b = svc.getBooking(booking.id);
    out.push({ ref: b.ref, email, service: s.service_type, status: b.status });
  }

  for (const q of QUOTES) {
    const [name, email, phone] = q.customer;
    const quote = await svc.createQuote({ name, email, phone }, q);
    tag(email);
    if (q.quoted) await svc.sendQuote(quote.id, { amount: q.quoted, notes: 'Shared ride, door to door. Valid for 14 days.' });
  }

  mailer.send = realSend;
  console.log(`Added ${SAMPLES.length} sample shipments and ${QUOTES.length} sample quote requests (no emails sent).\n`);
  console.log('Try them on /track (reference + email):');
  for (const r of out) console.log(`  ${r.ref}  ${r.email.padEnd(38)} ${r.service.padEnd(18)} ${r.status}`);
}

(async () => {
  try {
    if (process.argv.includes('--remove')) remove(); else await add();
  } finally {
    db.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
