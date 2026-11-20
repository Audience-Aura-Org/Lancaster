'use strict';
/* End-to-end tests against a real server on a random port with a throwaway database. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lpm-test-'));
process.env.DB_FILE = path.join(tmp, 'test.db');
process.env.OUTBOX_DIR = path.join(tmp, 'outbox');
process.env.SMTP_HOST = '';
process.env.NOTIFY_EMAIL = 'staff@example.com';
process.env.ADMIN_EMAIL = ''; // keep the local .env admin out of the test database
process.env.ADMIN_PASSWORD = '';
process.env.NODE_ENV = 'test';

const bcrypt = require('bcryptjs');
const db = require('../src/db');
const awb = require('../src/awb');
const { createApp } = require('../src/app');
const svc = require('../src/services');

let server; let base;

/** Minimal browser: keeps cookies, does not follow redirects. */
function client() {
  const jar = new Map();
  async function req(method, url, form) {
    const headers = { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') };
    let body;
    if (form) { headers['content-type'] = 'application/x-www-form-urlencoded'; const u = new URLSearchParams(); for (const [k, val] of Object.entries(form)) for (const one of [].concat(val)) u.append(k, one); body = u.toString(); }
    const res = await fetch(base + url, { method, headers, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
    const text = await res.text();
    return { status: res.status, text, location: res.headers.get('location'), headers: res.headers };
  }
  const token = (html) => (html.match(/name="_csrf" value="([^"]+)"/) || [])[1];
  return {
    get: (u) => req('GET', u),
    post: (u, f) => req('POST', u, f),
    async form(pageUrl, actionUrl, fields) {
      const page = await req('GET', pageUrl);
      return req('POST', actionUrl, { _csrf: token(page.text), ...fields });
    },
  };
}

const emails = () => db.get().prepare('SELECT * FROM email_log ORDER BY id').all();

before(async () => {
  const app = createApp();
  db.get().prepare('INSERT INTO admins (email, name, password_hash, role) VALUES (?, ?, ?, ?)')
    .run('owner@example.com', 'Olivia Owner', bcrypt.hashSync('correct-horse-battery', 4), 'owner');
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('AWB check digit validation', () => {
  assert.equal(awb.parse('006-12345675').valid, true);
  assert.equal(awb.parse('006 1234 5675').airline.name, 'Delta Cargo');
  assert.equal(awb.parse('006-12345676').valid, false);
  assert.equal(awb.parse('123').valid, false);
  assert.equal(awb.parse('999-12345675').airline, null);
});

test('public pages render', async () => {
  const c = client();
  const { PAGES } = require('../src/routes/public');
  for (const u of ['/', ...PAGES.map((p) => `/${p}.html`), '/quote', '/quote?service=air_freight', '/track', '/robots.txt', '/sitemap.xml', '/health',
    '/css/custom.css', '/js/function.js', '/images/service-1.jpg', '/images/post-22.jpeg', '/images/hero-port-sunset.jpg', '/webfonts/fa-solid-900.woff2']) {
    const r = await c.get(u);
    assert.equal(r.status, 200, `${u} -> ${r.status}`);
  }
  // Every original page is rebranded: no old name, email, chat account or remote images left.
  for (const p of PAGES) {
    const r = await c.get(`/${p}.html`);
    assert.doesNotMatch(r.text, /hyper ?fast|hyperfastdelivery|tawk\.to\/6addfe|wallpapercave/i, p);
    assert.match(r.text, /Lancaster/, p);
    assert.match(r.text, /Poppins/, p);
  }
  const home = await c.get('/');
  assert.match(home.text, /\/images\/hero-port-sunset\.jpg/);
  assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await c.get('/about')).location, '/about-us.html');
  assert.equal((await c.get('/shipment-status.php')).location, '/track');
  assert.equal((await c.get('/nope')).status, 404);
  assert.equal((await c.get('/nope.html')).status, 404);
});

test('POST without CSRF token is rejected', async () => {
  const c = client();
  const r = await c.post('/contact', { name: 'X', email: 'x@example.com', message: 'hello there' });
  assert.equal(r.status, 403);
});

test('quote form validates input', async () => {
  const c = client();
  const r = await c.form('/quote?type=pet', '/quote', { kind: 'pet', name: '', email: 'bad' });
  assert.equal(r.status, 422);
  assert.match(r.text, /Please enter a valid email address/);
});

test('honeypot submissions are silently dropped', async () => {
  const before = db.get().prepare('SELECT COUNT(*) n FROM quote_requests').get().n;
  const c = client();
  const r = await c.form('/quote', '/quote', { website: 'spam.example', name: 'Bot', email: 'bot@example.com' });
  assert.equal(r.status, 302);
  assert.equal(db.get().prepare('SELECT COUNT(*) n FROM quote_requests').get().n, before);
});

let quoteId;
test('valid quote request is saved and emails customer + staff', async () => {
  const c = client();
  const r = await c.form('/quote', '/quote', {
    name: 'Jane Doe', email: 'Jane@Example.com', phone: '555-0100', service_type: 'domestic_air', pet_type: 'dog',
    pet_name: 'Biscuit', breed: 'Beagle', weight_lbs: '24', pet_count: '1', origin: 'Lancaster, PA', destination: 'Denver, CO',
    travel_date: '2027-03-15', message: 'Nervous flyer', consent: 'on',
  });
  assert.equal(r.status, 302);
  assert.equal(r.location, '/quote/thanks');
  const q = db.get().prepare('SELECT * FROM quote_requests ORDER BY id DESC').get();
  quoteId = q.id;
  assert.equal(q.pet_name, 'Biscuit');
  assert.match(q.ref, /^LPM-Q-[A-Z0-9]{8}$/);
  const cust = db.get().prepare('SELECT * FROM customers WHERE id = ?').get(q.customer_id);
  assert.equal(cust.email, 'jane@example.com');
  const sent = emails().filter((e) => e.quote_id === q.id).map((e) => [e.template, e.to_email, e.status]);
  assert.deepEqual(sent.sort(), [['quote_admin_notify', 'staff@example.com', 'saved_to_outbox'], ['quote_received', 'jane@example.com', 'saved_to_outbox']]);
  assert.ok(fs.readdirSync(process.env.OUTBOX_DIR).some((f) => f.endsWith('quote_received.eml')));
  const thanks = await c.get('/quote/thanks');
  assert.match(thanks.text, new RegExp(q.ref));
});

test('contact form saves message and emails both sides', async () => {
  const c = client();
  // Same fields the theme's contact form sends (message field is "msg")
  const r = await c.form('/contact.html', '/contact', { name: 'Sam', email: 'sam@example.com', msg: 'Do you move cats to Canada?' });
  assert.equal(r.status, 200);
  assert.match(r.text, /Thanks, we got your message/);
  assert.equal(db.get().prepare(`SELECT COUNT(*) n FROM contact_messages WHERE email = 'sam@example.com'`).get().n, 1);
  assert.ok(emails().some((e) => e.template === 'contact_received' && e.to_email === 'sam@example.com'));
});

test('admin requires login and rejects bad passwords', async () => {
  const c = client();
  const r = await c.get('/admin/bookings');
  assert.equal(r.status, 302);
  assert.equal(r.location, '/admin/login');
  const bad = await c.form('/admin/login', '/admin/login', { email: 'owner@example.com', password: 'wrong-password' });
  assert.equal(bad.status, 401);
});

async function login() {
  const c = client();
  const r = await c.form('/admin/login', '/admin/login', { email: 'owner@example.com', password: 'correct-horse-battery' });
  assert.equal(r.status, 302);
  return c;
}

let bookingId;
test('admin flow: send quote, convert, documents, status emails, track lookup', async () => {
  const c = await login();
  for (const u of ['/admin', '/admin/quotes', '/admin/bookings', '/admin/customers', '/admin/messages', '/admin/subscribers', '/admin/subscribers.csv', '/admin/emails', '/admin/users', '/admin/activity', '/admin/account', '/admin/bookings/new', `/admin/quotes/${quoteId}`]) {
    const r = await c.get(u);
    assert.equal(r.status, 200, `${u} -> ${r.status}`);
  }

  // Send a quote
  let r = await c.form(`/admin/quotes/${quoteId}`, `/admin/quotes/${quoteId}/send-quote`, { amount: '1450', notes: 'Includes crate.' });
  assert.equal(r.status, 302);
  assert.ok(emails().some((e) => e.template === 'quote_ready' && e.quote_id === quoteId));

  // Convert to booking with notification
  r = await c.form(`/admin/quotes/${quoteId}`, `/admin/quotes/${quoteId}/convert`, { notify: 'on' });
  assert.equal(r.status, 302);
  bookingId = Number(r.location.split('/').pop());
  const b = db.get().prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
  assert.equal(b.status, 'confirmed');
  assert.equal(b.total_amount, 1450);
  assert.equal(db.get().prepare('SELECT status FROM quote_requests WHERE id = ?').get(quoteId).status, 'converted');
  const docs = db.get().prepare('SELECT * FROM booking_documents WHERE booking_id = ?').all(bookingId);
  assert.equal(docs.length, 5, 'domestic air checklist');
  assert.ok(emails().some((e) => e.template === 'booking_confirmed' && e.booking_id === bookingId));

  // Converting twice does not duplicate
  r = await c.form(`/admin/quotes/${quoteId}`, `/admin/quotes/${quoteId}/convert`, {});
  assert.equal(r.location, `/admin/bookings/${bookingId}`);
  assert.equal(db.get().prepare('SELECT COUNT(*) n FROM bookings WHERE quote_id = ?').get(quoteId).n, 1);

  // Booking page renders
  assert.equal((await c.get(`/admin/bookings/${bookingId}`)).status, 200);

  // Air booking can't be scheduled without an AWB
  r = await c.form(`/admin/bookings/${bookingId}`, `/admin/bookings/${bookingId}/status`, { status: 'scheduled', notify: 'on' });
  assert.equal(db.get().prepare('SELECT status FROM bookings WHERE id = ?').get(bookingId).status, 'confirmed');

  // Invalid AWB is refused, valid one saved formatted
  await c.form(`/admin/bookings/${bookingId}`, `/admin/bookings/${bookingId}/details`, { origin: 'Lancaster, PA', destination: 'Denver, CO', airline_awb: '006-12345676' });
  assert.equal(db.get().prepare('SELECT airline_awb FROM bookings WHERE id = ?').get(bookingId).airline_awb, null);
  await c.form(`/admin/bookings/${bookingId}`, `/admin/bookings/${bookingId}/details`, {
    origin: 'Lancaster, PA', destination: 'Denver, CO', pet_name: 'Biscuit', pet_type: 'dog', pet_count: '1',
    airline_awb: '00612345675', flight_details: 'DL 1234 PHL-DEN', travel_date: '2027-03-15',
  });
  assert.equal(db.get().prepare('SELECT airline_awb FROM bookings WHERE id = ?').get(bookingId).airline_awb, '006-12345675');

  // Documents: tick two, send reminder
  r = await c.form(`/admin/bookings/${bookingId}`, `/admin/bookings/${bookingId}/documents`, { checklist: '1', received: String(docs[0].id) });
  assert.equal(db.get().prepare('SELECT COUNT(*) n FROM booking_documents WHERE booking_id = ? AND received = 1').get(bookingId).n, 1);
  r = await c.form(`/admin/bookings/${bookingId}`, `/admin/bookings/${bookingId}/remind`, {});
  assert.ok(emails().some((e) => e.template === 'documents_reminder' && e.booking_id === bookingId));

  // Schedule -> email includes airline tracking
  r = await c.form(`/admin/bookings/${bookingId}`, `/admin/bookings/${bookingId}/status`, { status: 'scheduled', notify: 'on' });
  assert.equal(db.get().prepare('SELECT status FROM bookings WHERE id = ?').get(bookingId).status, 'scheduled');
  const outbox = fs.readdirSync(process.env.OUTBOX_DIR).filter((f) => f.endsWith('booking_scheduled.eml'));
  assert.equal(outbox.length, 1);
  const eml = fs.readFileSync(path.join(process.env.OUTBOX_DIR, outbox[0]), 'utf8').replace(/=\r?\n/g, '');
  assert.match(eml, /Delta Cargo/);
  assert.match(eml, /006-12345675/);
  assert.match(eml, /never ask you to pay with gift cards/);

  // Status change without notify sends nothing new
  const n = emails().length;
  await c.form(`/admin/bookings/${bookingId}`, `/admin/bookings/${bookingId}/status`, { status: 'scheduled' });
  assert.equal(emails().length, n);

  // Notes
  await c.form(`/admin/bookings/${bookingId}`, '/admin/notes', { entity: 'booking', entity_id: String(bookingId), body: 'Owner prefers texts' });
  assert.match((await c.get(`/admin/bookings/${bookingId}`)).text, /Owner prefers texts/);

  // Public track: tracking number alone is enough
  const ref = db.get().prepare('SELECT ref FROM bookings WHERE id = ?').get(bookingId).ref;
  const pub = client();
  let t = await pub.form('/track', '/track', { ref });
  assert.equal(t.status, 200);
  assert.match(t.text, /Biscuit/);
  assert.match(t.text, /Transport scheduled/);
  assert.match(t.text, /Delta Cargo/);
  assert.doesNotMatch(t.text, /jane@example\.com|Jane Doe/, 'no customer details on the public page');
  // Typed loosely: lowercase, spaces, or just the 8-character code
  for (const typed of [ref.toLowerCase(), ` ${ref.slice(0, 9)} ${ref.slice(9)} `, ref.slice(-8)]) {
    t = await pub.form('/track', '/track', { ref: typed });
    assert.equal(t.status, 200, `lookup "${typed}"`);
    assert.match(t.text, new RegExp(ref));
  }
  // Link from the status email opens the result directly
  t = await pub.get(`/track?ref=${encodeURIComponent(ref)}`);
  assert.equal(t.status, 200);
  assert.match(t.text, /Journey progress/);
  // Unknown and malformed numbers
  t = await pub.form('/track', '/track', { ref: 'LPM-B-ZZZZZZZZ' });
  assert.equal(t.status, 404);
  assert.match(t.text, /couldn&#39;t find a shipment/);
  t = await pub.form('/track', '/track', { ref: 'hello' });
  assert.equal(t.status, 404);
  // A quote reference that became a booking shows the booking
  const qref = db.get().prepare('SELECT ref FROM quote_requests WHERE id = ?').get(quoteId).ref;
  t = await pub.form('/track', '/track', { ref: qref });
  assert.match(t.text, new RegExp(ref));
  // Public AWB lookup
  t = await pub.get('/track?awb=006-12345675');
  assert.match(t.text, /deltacargo\.com/);
});

test('manual booking for ground service gets the ground checklist', async () => {
  const c = await login();
  const r = await c.form('/admin/bookings/new', '/admin/bookings/new', {
    name: 'Ray Ground', email: 'ray@example.com', service_type: 'domestic_ground', pet_type: 'cat',
    pet_name: 'Mochi', origin: 'Lancaster, PA', destination: 'Boston, MA', notify: 'on',
  });
  assert.equal(r.status, 302);
  const id = Number(r.location.split('/').pop());
  assert.equal(db.get().prepare('SELECT COUNT(*) n FROM booking_documents WHERE booking_id = ?').get(id).n, 4);
  // Ground can be scheduled without AWB
  await c.form(`/admin/bookings/${id}`, `/admin/bookings/${id}/details`, { origin: 'Lancaster, PA', destination: 'Boston, MA', pickup_window: 'Mon 8-11am' });
  await c.form(`/admin/bookings/${id}`, `/admin/bookings/${id}/status`, { status: 'scheduled', notify: 'on' });
  assert.equal(db.get().prepare('SELECT status FROM bookings WHERE id = ?').get(id).status, 'scheduled');
});

test('owner can add staff; staff cannot manage users', async () => {
  const owner = await login();
  await owner.form('/admin/users', '/admin/users', { name: 'Sid Staff', email: 'sid@example.com', role: 'staff', password: 'staff-password-1' });
  assert.ok(db.get().prepare(`SELECT id FROM admins WHERE email = 'sid@example.com'`).get());
  const staff = client();
  const r = await staff.form('/admin/login', '/admin/login', { email: 'sid@example.com', password: 'staff-password-1' });
  assert.equal(r.status, 302);
  assert.equal((await staff.get('/admin/bookings')).status, 200);
  assert.equal((await staff.get('/admin/users')).status, 403);
});

test('button addresses never show Not found (signed in or after signing in)', async () => {
  // Opening a POST-only action address while signed in goes to its page
  const admin = await login();
  const q = await svc.createQuote({ name: 'Nf', email: 'nf@example.com' }, { service_type: 'domestic_ground', pet_type: 'dog', origin: 'A', destination: 'B' }, { notifyCustomer: false, notifyStaff: false });
  let r = await admin.get(`/admin/quotes/${q.id}/send-quote`);
  assert.equal(r.status, 302);
  assert.equal(r.location, `/admin/quotes/${q.id}`);
  // Clicking a button while signed out, then signing in, lands on the quote page (not the action)
  const c = client();
  const page = await c.get('/admin/login');
  const token = page.text.match(/name="_csrf" value="([^"]+)"/)[1];
  r = await c.post(`/admin/quotes/${q.id}/send-quote`, { _csrf: token, amount: '10' });
  assert.equal(r.location, '/admin/login');
  r = await c.form('/admin/login', '/admin/login', { email: 'owner@example.com', password: 'correct-horse-battery' });
  assert.equal(r.location, `/admin/quotes/${q.id}`);
});

test('logout ends the session', async () => {
  const c = await login();
  const page = await c.get('/admin');
  const token = page.text.match(/name="_csrf" value="([^"]+)"/)[1];
  await c.post('/admin/logout', { _csrf: token });
  assert.equal((await c.get('/admin')).status, 302);
});

test('theme contact form (AJAX) gets a plain "success" reply', async () => {
  const c = client();
  const page = await c.get('/contact.html');
  const token = page.text.match(/name="_csrf" value="([^"]+)"/)[1];
  const res = await fetch(base + '/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-requested-with': 'XMLHttpRequest', cookie: page.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ') },
    body: new URLSearchParams({ _csrf: token, name: 'Ajax Person', email: 'ajax@example.com', msg: 'Hello from the theme form & friends' }).toString(),
  });
  assert.equal(await res.text(), 'success');
  assert.equal(db.get().prepare(`SELECT message FROM contact_messages WHERE email = 'ajax@example.com'`).get().message, 'Hello from the theme form & friends');
});

test('newsletter forms subscribe (once per email)', async () => {
  const c = client();
  let r = await c.form('/index.html', '/subscribe', { email: 'news@example.com' });
  assert.equal(r.status, 200);
  r = await c.form('/faqs.html', '/subscribe', { email: 'NEWS@example.com' });
  assert.equal(db.get().prepare(`SELECT COUNT(*) n FROM subscribers WHERE email = 'news@example.com'`).get().n, 1);
  r = await c.form('/index.html', '/subscribe', { email: 'not-an-email' });
  assert.equal(r.status, 422);
});

test('item shipping is gone: only pet services are offered', async () => {
  const { SERVICE_TYPES } = require('../src/domain');
  const offered = Object.entries(SERVICE_TYPES).filter(([, x]) => !x.retired).map(([k]) => k);
  assert.deepEqual(offered.sort(), ['domestic_air', 'domestic_ground', 'international_air']);

  const c = client();
  // Old item pages redirect to pet pages
  for (const [from, to] of [['/air-freight.html', '/pet-air-travel.html'], ['/ocean-freight.html', '/international-pet-relocation.html'],
    ['/cargo-freight.html', '/pet-ground-transport.html'], ['/express-delivery.html', '/pet-ground-transport.html'],
    ['/customs-clearance.html', '/international-pet-relocation.html'], ['/project-cargo.html', '/pet-transport.html']]) {
    const r = await c.get(from);
    assert.equal(r.status, 301, from);
    assert.equal(r.location, to, from);
  }
  // The quote form is pet-only, even for old item links
  for (const u of ['/quote', '/quote?type=item', '/quote?service=ocean_freight']) {
    const r = await c.get(u);
    assert.match(r.text, /Tell us about your pet/);
    assert.doesNotMatch(r.text, /name="cargo_description"|value="ocean_freight"|What are you sending/);
  }
  // Posting an item service is refused
  const r = await c.form('/quote', '/quote', { kind: 'item', service_type: 'ocean_freight', cargo_description: 'Boxes', name: 'X', email: 'x@example.com', origin: 'A', destination: 'B', consent: 'on' });
  assert.equal(r.status, 422);
  assert.equal(db.get().prepare(`SELECT COUNT(*) n FROM quote_requests WHERE service_type = 'ocean_freight'`).get().n, 0);

  // Public pages talk about pets, not freight
  const { PAGES } = require('../src/routes/public');
  for (const p of PAGES) {
    const html = (await c.get(p === 'index' ? '/' : `/${p}.html`)).text
      .replace(/<!--[\s\S]*?-->/g, '').replace(/class="[^"]*"/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
    assert.doesNotMatch(html, /freight|containers?\b|pallets?|logistics|supply chain|project cargo|express delivery/i, p);
  }

  // Admin: no item choice, no item forms
  const admin = await login();
  for (const u of ['/admin/bookings/new', '/admin/bookings/new?type=item', '/admin/quotes/new?type=item']) {
    const html = (await admin.get(u)).text;
    assert.match(html, /New pet (booking|quote)/, u);
    assert.doesNotMatch(html, /name="cargo_description"|value="ocean_freight"|Item booking|Item quote/, u);
  }
  // An older item booking still opens (labelled as no longer offered)
  const cust = svc.upsertCustomer({ name: 'Legacy', email: 'legacy@example.com' });
  const old = svc.createBooking({ customer_id: cust.id, service_type: 'ocean_freight', pet_type: 'cargo', cargo_description: 'Old container', origin: 'A', destination: 'B' });
  const page = await admin.get(`/admin/bookings/${old.id}`);
  assert.equal(page.status, 200);
  assert.match(page.text, /Item \(no longer offered\)/);
});

test('admin can add, remove and restore needed documents', async () => {
  const admin = await login();
  const cust = svc.upsertCustomer({ name: 'Doc Test', email: 'doctest@example.com' });
  const b = svc.createBooking({ customer_id: cust.id, service_type: 'domestic_ground', pet_type: 'dog', pet_name: 'Rex', origin: 'A', destination: 'B' });
  const docs = () => db.get().prepare('SELECT * FROM booking_documents WHERE booking_id = ? ORDER BY id').all(b.id);
  const page = async () => (await admin.get(`/admin/bookings/${b.id}`)).text;
  const tok = (html) => html.match(/name="_csrf" value="([^"]+)"/)[1];
  assert.equal(docs().length, 4);

  // Add (and duplicates/empty are refused)
  let r = await admin.form(`/admin/bookings/${b.id}`, `/admin/bookings/${b.id}/documents/add`, { label: 'Tapeworm treatment record' });
  assert.equal(r.status, 302);
  assert.ok(docs().some((d) => d.label === 'Tapeworm treatment record'));
  await admin.form(`/admin/bookings/${b.id}`, `/admin/bookings/${b.id}/documents/add`, { label: 'TAPEWORM treatment record' });
  await admin.form(`/admin/bookings/${b.id}`, `/admin/bookings/${b.id}/documents/add`, { label: '   ' });
  assert.equal(docs().length, 5);

  // Remove: keeps ticks changed in the same form, and only removes this booking's document
  const rabies = docs().find((d) => d.doc_key === 'rabies');
  const vaccines = docs().find((d) => d.doc_key === 'vaccines');
  let html = await page();
  assert.match(html, new RegExp(`/admin/bookings/${b.id}/documents/${rabies.id}/delete`));
  r = await admin.post(`/admin/bookings/${b.id}/documents/${rabies.id}/delete`, { _csrf: tok(html), checklist: '1', received: String(vaccines.id) });
  assert.equal(r.status, 302);
  assert.equal(docs().length, 4);
  assert.ok(!docs().some((d) => d.doc_key === 'rabies'));
  assert.equal(docs().find((d) => d.doc_key === 'vaccines').received, 1, 'tick kept');
  const other = svc.createBooking({ customer_id: cust.id, service_type: 'domestic_ground', pet_type: 'cat', origin: 'A', destination: 'B' });
  const otherDoc = db.get().prepare('SELECT id FROM booking_documents WHERE booking_id = ? LIMIT 1').get(other.id);
  html = await page();
  await admin.post(`/admin/bookings/${b.id}/documents/${otherDoc.id}/delete`, { _csrf: tok(html) });
  assert.ok(db.get().prepare('SELECT 1 FROM booking_documents WHERE id = ?').get(otherDoc.id), "another booking's document is untouched");

  // Customers see the updated list on the Track page
  let t = await client().get(`/track?ref=${b.ref}`);
  assert.match(t.text, /Tapeworm treatment record/);
  assert.doesNotMatch(t.text, /rabies vaccination/i);

  // Restore brings back the removed standard document, once
  html = await page();
  assert.match(html, /Restore 1 standard document/);
  await admin.post(`/admin/bookings/${b.id}/documents/restore`, { _csrf: tok(html) });
  assert.ok(docs().some((d) => d.doc_key === 'rabies'));
  assert.equal(docs().length, 5);
  html = await page();
  assert.doesNotMatch(html, /Restore \d+ standard document/);

  // Remove everything: page still works, reminder button disabled
  for (const d of docs()) { html = await page(); await admin.post(`/admin/bookings/${b.id}/documents/${d.id}/delete`, { _csrf: tok(html) }); }
  assert.equal(docs().length, 0);
  html = await page();
  assert.match(html, /No documents needed<\/strong> for this shipment/);
  assert.match(db.get().prepare(`SELECT detail FROM audit_log WHERE action = 'document_removed' ORDER BY id DESC`).get().detail, /./);
  // Unknown booking -> 404
  assert.equal((await admin.post('/admin/bookings/999999/documents/add', { _csrf: tok(html), label: 'x' })).status, 404);
});

test('documents are pre-selected by shipment type and can be chosen from a list', async () => {
  const admin = await login();
  const tok = (html) => html.match(/name="_csrf" value="([^"]+)"/)[1];
  const docsOf = (id) => db.get().prepare('SELECT doc_key, label FROM booking_documents WHERE booking_id = ? ORDER BY id').all(id);

  // New booking form: every service's standard documents are pre-ticked
  let html = (await admin.get('/admin/bookings/new')).text;
  assert.match(html, /name="docs_domestic_ground" value="rabies" checked/);
  assert.match(html, /name="docs_domestic_ground" value="lib_tapeworm">/, 'extras offered but not ticked');
  assert.doesNotMatch(html, /docs_ocean_freight/, 'pet form only offers pet services');


  // Untick one standard document, tick an extra, type a custom one; ticks for another service are ignored
  let r = await admin.post('/admin/bookings/new', {
    _csrf: tok(html), docs_present: '1', name: 'Pick Test', email: 'pick@example.com', service_type: 'domestic_ground', pet_type: 'dog',
    origin: 'A', destination: 'B', docs_domestic_ground: ['rabies', 'vaccines', 'lib_tapeworm'], docs_domestic_air: ['crate'],
    docs_custom: 'Employer letter\nemployer letter\n  ',
  });
  assert.equal(r.status, 302);
  let id = Number(r.location.split('/').pop());
  assert.deepEqual(docsOf(id).map((d) => d.label), [
    'Current rabies vaccination certificate', 'Vaccination records',
    'Tapeworm treatment record (UK, Ireland, Finland, Malta, Norway)', 'Employer letter',
  ]);

  // Booking page: "choose from the list" hides documents already on the checklist
  html = (await admin.get(`/admin/bookings/${id}`)).text;
  assert.match(html, /Choose from the list/);
  assert.doesNotMatch(html, /name="pick" value="rabies"/);
  assert.match(html, /name="pick" value="vet_contact"/, 'unticked standard document can be added back');
  r = await admin.post(`/admin/bookings/${id}/documents/add`, { _csrf: tok(html), pick: ['vet_contact', 'lib_pet_passport', 'rabies'] });
  assert.equal(docsOf(id).length, 6, 'two added, the duplicate skipped');
  assert.ok(docsOf(id).some((d) => d.label === 'Pet passport (EU / UK)'));

  // Nothing ticked = no documents
  html = (await admin.get('/admin/bookings/new')).text;
  r = await admin.post('/admin/bookings/new', { _csrf: tok(html), docs_present: '1', name: 'None', email: 'none@example.com', service_type: 'domestic_ground', pet_type: 'dog', origin: 'A', destination: 'B' });
  assert.equal(docsOf(Number(r.location.split('/').pop())).length, 0);

  // Converting a quote: standard documents pre-ticked on the quote page; the ticked set is used
  const q = await svc.createQuote({ name: 'Conv', email: 'conv@example.com' }, { service_type: 'international_air', pet_type: 'cat', origin: 'A', destination: 'B' });
  html = (await admin.get(`/admin/quotes/${q.id}`)).text;
  assert.match(html, /name="docs_international_air" value="usda" checked/);
  r = await admin.post(`/admin/quotes/${q.id}/convert`, { _csrf: tok(html), docs_present: '1', docs_international_air: ['microchip', 'rabies', 'lib_pet_passport'] });
  id = Number(r.location.split('/').pop());
  assert.deepEqual(docsOf(id).map((d) => d.doc_key), ['microchip', 'rabies', 'lib_pet_passport']);
});

test('dashboard shows what needs attention, the pipeline and search works', async () => {
  const admin = await login();
  const cust = svc.upsertCustomer({ name: 'Dash Test', email: 'dash@example.com' });
  const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const soon = svc.createBooking({ customer_id: cust.id, service_type: 'domestic_ground', pet_type: 'dog', pet_name: 'Soonie', origin: 'Lancaster', destination: 'Erie', travel_date: day(2) });
  const late = svc.createBooking({ customer_id: cust.id, service_type: 'domestic_ground', pet_type: 'cat', pet_name: 'Latey', origin: 'Lancaster', destination: 'York', travel_date: day(-3) });

  const html = (await admin.get('/admin')).text;
  assert.match(html, /Needs attention/);
  assert.match(html, new RegExp(`${soon.ref} · Soonie departs in 2 days`));
  assert.match(html, /4 of 4 documents still missing/);
  assert.match(html, new RegExp(`${late.ref} · Latey travel date has passed`));
  assert.match(html, /Urgent/);
  assert.match(html, /Coming up/);
  assert.match(html, /0\/4 documents/);
  assert.doesNotMatch(html, /Shipments by stage|Recent activity/, 'kept simple');

  // Search: exact tracking number jumps to the booking (any capitalisation / bare code)
  let r = await admin.get(`/admin/search?q=${soon.ref.slice(-8).toLowerCase()}`);
  assert.equal(r.location, `/admin/bookings/${soon.id}`);
  r = await admin.get('/admin/search?q=Latey');
  assert.equal(r.status, 200);
  assert.match(r.text, new RegExp(late.ref));
  r = await admin.get('/admin/search?q=dash%40example.com');
  assert.match(r.text, /Customers \(1\)/);
  r = await admin.get('/admin/search?q=zzzz-nothing');
  assert.match(r.text, /Nothing found/);
  assert.equal((await admin.get('/admin/search?q=')).location, '/admin');
});

test('admin can delete a quote request', async () => {
  const admin = await login();
  const tok = (html) => html.match(/name="_csrf" value="([^"]+)"/)[1];

  // A plain quote with a note and emails
  const q = await svc.createQuote({ name: 'Quote Del', email: 'qdel@example.com' }, { service_type: 'domestic_ground', pet_type: 'dog', origin: 'A', destination: 'B' });
  let html = (await admin.get(`/admin/quotes/${q.id}`)).text;
  assert.match(html, /Delete quote request/);
  await admin.post('/admin/notes', { _csrf: tok(html), entity: 'quote', entity_id: String(q.id), body: 'call back' });

  // Without CSRF: refused
  assert.equal((await admin.post(`/admin/quotes/${q.id}/delete`, {})).status, 403);

  // From the filtered list -> back to the same list
  html = (await admin.get('/admin/quotes?status=new')).text;
  assert.match(html, new RegExp(`/admin/quotes/${q.id}/delete`));
  let r = await admin.post(`/admin/quotes/${q.id}/delete`, { _csrf: tok(html) });
  assert.equal(r.status, 302);
  const count = (sql, ...p) => db.get().prepare(sql).get(...p).n;
  assert.equal(count('SELECT COUNT(*) n FROM quote_requests WHERE id = ?', q.id), 0);
  assert.equal(count(`SELECT COUNT(*) n FROM notes WHERE entity = 'quote' AND entity_id = ?`, q.id), 0);
  assert.equal(count('SELECT COUNT(*) n FROM email_log WHERE quote_id = ?', q.id), 0);
  assert.ok(count(`SELECT COUNT(*) n FROM email_log WHERE to_email = 'qdel@example.com'`) > 0, 'email history kept');
  assert.equal((await admin.get(`/admin/quotes/${q.id}`)).status, 404);
  assert.equal((await client().form('/track', '/track', { ref: q.ref })).status, 404);
  assert.match(db.get().prepare(`SELECT detail FROM audit_log WHERE action = 'quote_deleted' AND entity_id = ?`).get(q.id).detail, new RegExp(q.ref));

  // A converted quote: the booking survives and still tracks
  const q2 = await svc.createQuote({ name: 'Quote Conv', email: 'qconv@example.com' }, { service_type: 'domestic_ground', pet_type: 'cat', origin: 'A', destination: 'B' });
  html = (await admin.get(`/admin/quotes/${q2.id}`)).text;
  r = await admin.post(`/admin/quotes/${q2.id}/convert`, { _csrf: tok(html) });
  const bookingId = Number(r.location.split('/').pop());
  html = (await admin.get(`/admin/quotes/${q2.id}`)).text;
  assert.match(html, /will be kept/);
  r = await admin.post(`/admin/quotes/${q2.id}/delete`, { _csrf: tok(html) });
  const b = db.get().prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
  assert.ok(b, 'booking kept');
  assert.equal(b.quote_id, null);
  assert.equal((await admin.get(`/admin/bookings/${bookingId}`)).status, 200);
  assert.equal((await client().form('/track', '/track', { ref: b.ref })).status, 200);
});

test('pet forms collect pet details only', async () => {
  const pub = client();
  const r = await pub.get('/quote');
  assert.match(r.text, /name="pet_type"/);
  assert.match(r.text, /name="pet_age"/);
  assert.match(r.text, /value="domestic_ground" checked/, 'a service is pre-selected');
  assert.doesNotMatch(r.text, /name="package_type"|name="declared_value"/);

  const admin = await login();
  const tok = (h) => h.match(/name="_csrf" value="([^"]+)"/)[1];
  let html = (await admin.get('/admin/bookings/new')).text;
  // An item service can't be booked through the pet form
  let res = await admin.post('/admin/bookings/new', { _csrf: tok(html), name: 'Mix', email: 'mix@example.com', service_type: 'ocean_freight', pet_type: 'dog', origin: 'A', destination: 'B' });
  assert.equal(res.status, 422);
  // Pet booking saves pet fields only
  res = await admin.post('/admin/bookings/new', { _csrf: tok(html), name: 'Pet Owner', email: 'petowner@example.com', service_type: 'domestic_ground',
    pet_type: 'cat', pet_name: 'Kit', pet_age: '2 years', cargo_description: 'should be ignored', origin: 'A', destination: 'B' });
  const pet = db.get().prepare('SELECT * FROM bookings WHERE id = ?').get(Number(res.location.split('/').pop()));
  assert.equal(pet.pet_age, '2 years');
  assert.equal(pet.cargo_description, null);
  html = (await admin.get(`/admin/bookings/${pet.id}`)).text;
  assert.doesNotMatch(html, /name="package_type"|Item \(no longer offered\)/);
  // Lists no longer have a pet/item filter
  assert.doesNotMatch((await admin.get('/admin/bookings')).text, /Pets &amp; items|Items only/);
});

test('admin can create a pet quote request', async () => {
  const admin = await login();
  const tok = (h) => h.match(/name="_csrf" value="([^"]+)"/)[1];
  let html = (await admin.get('/admin/quotes')).text;
  assert.match(html, /href="\/admin\/quotes\/new"/);
  html = (await admin.get('/admin/quotes/new')).text;
  assert.match(html, /New pet quote/);
  const before = db.get().prepare("SELECT COUNT(*) n FROM email_log WHERE template = 'quote_admin_notify'").get().n;
  let r = await admin.post('/admin/quotes/new', { _csrf: tok(html), name: 'Phone Caller', email: 'caller@example.com', service_type: 'domestic_air',
    pet_type: 'dog', pet_name: 'Bo', breed: 'Lab', origin: 'Lancaster', destination: 'Miami' });
  assert.equal(r.status, 302);
  const q = db.get().prepare("SELECT * FROM quote_requests ORDER BY id DESC").get();
  assert.equal(r.location, `/admin/quotes/${q.id}`);
  assert.equal(q.pet_name, 'Bo');
  assert.equal(db.get().prepare("SELECT COUNT(*) n FROM email_log WHERE template = 'quote_admin_notify'").get().n, before, 'no staff notification for staff-entered quotes');
  assert.equal(db.get().prepare("SELECT COUNT(*) n FROM email_log WHERE quote_id = ?").get(q.id).n, 0, 'customer not emailed unless ticked');
  html = (await admin.get('/admin/quotes/new')).text;
  r = await admin.post('/admin/quotes/new', { _csrf: tok(html), name: '', email: 'x', service_type: 'domestic_air' });
  assert.equal(r.status, 422);
  assert.match(r.text, /Please choose the type of pet/);
});

test('lists show a page size choice and next/previous pages', async () => {
  const admin = await login();
  const pc = svc.upsertCustomer({ name: 'Pager', email: 'pager@example.com' });
  while (db.get().prepare('SELECT COUNT(*) n FROM bookings').get().n < 12) svc.createBooking({ customer_id: pc.id, service_type: 'domestic_ground', pet_type: 'dog', origin: 'A', destination: 'B' });
  const total = db.get().prepare('SELECT COUNT(*) n FROM bookings').get().n;
  assert.ok(total > 10, `need more than 10 bookings for this test (have ${total})`);
  let html = (await admin.get('/admin/bookings?per=10')).text;
  assert.match(html, new RegExp(`Showing <strong>1–10</strong> of <strong>${total}</strong>`));
  assert.match(html, /rel="next"/);
  assert.match(html, /<option value="25"/);
  html = (await admin.get('/admin/bookings?page=2')).text; // per-page remembered
  assert.match(html, new RegExp(`Showing <strong>11–${Math.min(20, total)}</strong>`));
  assert.match(html, /rel="prev"/);
  // Page beyond the end goes to the last page
  html = (await admin.get('/admin/bookings?page=999')).text;
  assert.match(html, /aria-current="page"/);
  assert.doesNotMatch(html, /No bookings match/);
  // Filters are kept in paging links
  html = (await admin.get('/admin/bookings?type=pet&per=10')).text;
  if (/rel="next"/.test(html)) assert.match(html, /href="\?type=pet&amp;page=2"/);
  // Bigger page size shows everything
  html = (await admin.get('/admin/bookings?per=100')).text;
  assert.match(html, new RegExp(`Showing <strong>1–${total}</strong>`));
  assert.match(html, /is-disabled[^>]*>[^<]*<i class="fa-solid fa-chevron-left"><\/i> Previous/);
  // Quotes list has the pager too
  assert.match((await admin.get('/admin/quotes')).text, /Showing <strong>1–/);
});

test('new forms show pre-selected documents and allow "no documents needed"', async () => {
  const admin = await login();
  const tok = (h) => h.match(/name="_csrf" value="([^"]+)"/)[1];
  const docsOf = (id) => db.get().prepare('SELECT COUNT(*) n FROM booking_documents WHERE booking_id = ?').get(id).n;

  let html = (await admin.get('/admin/bookings/new')).text;
  assert.match(html, /<option value="domestic_ground" selected>/);
  assert.match(html, /<div data-docs-for="domestic_ground" >/);
  assert.match(html, /name="docs_domestic_ground" value="rabies" checked/);
  assert.match(html, /name="docs_none"/);
  html = (await admin.get('/admin/bookings/new?service=domestic_air')).text;
  assert.match(html, /<option value="domestic_air" selected>/);
  assert.match(html, /<div data-docs-for="domestic_air" >/);

  let r = await admin.post('/admin/bookings/new', { _csrf: tok(html), docs_present: '1', docs_none: 'on', docs_domestic_air: ['rabies'],
    name: 'No Docs', email: 'nodocs@example.com', service_type: 'domestic_air', pet_type: 'cat', origin: 'A', destination: 'B' });
  const id = Number(r.location.split('/').pop());
  assert.equal(docsOf(id), 0);
  html = (await admin.get(`/admin/bookings/${id}`)).text;
  assert.match(html, /No documents needed<\/strong> for this shipment/);
  const ref = db.get().prepare('SELECT ref FROM bookings WHERE id = ?').get(id).ref;
  assert.match((await client().get(`/track?ref=${ref}`)).text, /No documents needed for this trip/);

  const q = await svc.createQuote({ name: 'Conv None', email: 'convnone@example.com' }, { service_type: 'domestic_air', pet_type: 'dog', origin: 'A', destination: 'B' }, { notifyCustomer: false, notifyStaff: false });
  html = (await admin.get(`/admin/quotes/${q.id}`)).text;
  assert.match(html, /name="docs_none"/);
  r = await admin.post(`/admin/quotes/${q.id}/convert`, { _csrf: tok(html), docs_present: '1', docs_none: 'on' });
  assert.equal(docsOf(Number(r.location.split('/').pop())), 0);

  const cust = svc.upsertCustomer({ name: 'Clear Docs', email: 'cleardocs@example.com' });
  const b = svc.createBooking({ customer_id: cust.id, service_type: 'domestic_ground', pet_type: 'dog', origin: 'A', destination: 'B' });
  assert.equal(docsOf(b.id), 4);
  html = (await admin.get(`/admin/bookings/${b.id}`)).text;
  await admin.post(`/admin/bookings/${b.id}/documents/none`, { _csrf: tok(html) });
  assert.equal(docsOf(b.id), 0);
  html = (await admin.get(`/admin/bookings/${b.id}`)).text;
  assert.match(html, /Restore 4 standard documents/);
});

test('pet bookings are never offered item shipping documents', async () => {
  const admin = await login();
  const tok = (h) => h.match(/name="_csrf" value="([^"]+)"/)[1];
  let html = (await admin.get('/admin/bookings/new')).text;
  assert.doesNotMatch(html, /Bill of lading|Commercial invoice|Freight documents|lib_bill_of_lading/);
  assert.match(html, /Pet passport/);
  const r = await admin.post('/admin/bookings/new', { _csrf: tok(html), docs_present: '1',
    docs_domestic_air: ['rabies', 'lib_bill_of_lading', 'ocean_freight__invoice'],
    name: 'Cross', email: 'cross@example.com', service_type: 'domestic_air', pet_type: 'dog', origin: 'A', destination: 'B' });
  const id = Number(r.location.split('/').pop());
  const labels = () => db.get().prepare('SELECT label FROM booking_documents WHERE booking_id = ? ORDER BY id').all(id).map((d) => d.label);
  assert.deepEqual(labels(), ['Current rabies vaccination certificate']);
  html = (await admin.get(`/admin/bookings/${id}`)).text;
  assert.doesNotMatch(html, /name="pick" value="lib_bill_of_lading"/);
  await admin.post(`/admin/bookings/${id}/documents/add`, { _csrf: tok(html), pick: ['lib_bill_of_lading', 'lib_pet_passport'] });
  assert.deepEqual(labels(), ['Current rabies vaccination certificate', 'Pet passport (EU / UK)']);
});

test('admin can delete a shipment', async () => {
  const admin = await login();
  // A booking made from a quote, with notes, documents, history and an email
  // (created directly: the public form's rate limit is already used up by earlier tests)
  const q = await svc.createQuote({ name: 'Del Test', email: 'del@example.com' },
    { service_type: 'cargo_freight', pet_type: 'cargo', cargo_description: '2 pallets', origin: 'A', destination: 'B' });
  let r = await admin.form(`/admin/quotes/${q.id}`, `/admin/quotes/${q.id}/convert`, { notify: 'on' });
  const id = Number(r.location.split('/').pop());
  const { ref } = db.get().prepare('SELECT ref FROM bookings WHERE id = ?').get(id);
  await admin.form(`/admin/bookings/${id}`, '/admin/notes', { entity: 'booking', entity_id: String(id), body: 'to be deleted' });
  assert.equal((await client().form('/track', '/track', { ref })).status, 200);

  // Without a CSRF token: refused
  r = await admin.post(`/admin/bookings/${id}/delete`, {});
  assert.equal(r.status, 403);
  assert.ok(db.get().prepare('SELECT 1 FROM bookings WHERE id = ?').get(id));

  // From the bookings list (keeps the list's filters on return)
  const list = await admin.get('/admin/bookings?service=cargo_freight');
  assert.match(list.text, new RegExp(`/admin/bookings/${id}/delete`));
  const token = list.text.match(/name="_csrf" value="([^"]+)"/)[1];
  r = await admin.post(`/admin/bookings/${id}/delete`, { _csrf: token });
  assert.equal(r.status, 302);

  const count = (sql) => db.get().prepare(sql).get(id).n;
  assert.equal(count('SELECT COUNT(*) n FROM bookings WHERE id = ?'), 0);
  assert.equal(count('SELECT COUNT(*) n FROM booking_documents WHERE booking_id = ?'), 0);
  assert.equal(count('SELECT COUNT(*) n FROM booking_events WHERE booking_id = ?'), 0);
  assert.equal(count(`SELECT COUNT(*) n FROM notes WHERE entity = 'booking' AND entity_id = ?`), 0);
  assert.equal(count('SELECT COUNT(*) n FROM email_log WHERE booking_id = ?'), 0);
  assert.ok(db.get().prepare(`SELECT 1 FROM email_log WHERE to_email = 'del@example.com' AND template = 'booking_confirmed'`).get(), 'email history kept');
  assert.equal(db.get().prepare('SELECT status FROM quote_requests WHERE id = ?').get(q.id).status, 'new', 'quote can be booked again');
  assert.match(db.get().prepare(`SELECT detail FROM audit_log WHERE action = 'booking_deleted' AND entity_id = ?`).get(id).detail, new RegExp(ref));

  // Tracking number no longer works; booking page is gone; activity log shows it as deleted
  assert.equal((await client().form('/track', '/track', { ref })).status, 404);
  assert.equal((await admin.get(`/admin/bookings/${id}`)).status, 404);
  assert.match((await admin.get('/admin/activity')).text, /\(deleted\)/);
  // Deleting again is harmless
  const page = await admin.get('/admin/bookings');
  r = await admin.post(`/admin/bookings/${id}/delete`, { _csrf: page.text.match(/name="_csrf" value="([^"]+)"/)[1] });
  assert.equal(r.location, '/admin/bookings');
});

test('sample data script adds and removes sample shipments', () => {
  const { execFileSync } = require('child_process');
  const env = { ...process.env };
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'sample-data.js')], { env, encoding: 'utf8' });
  assert.match(out, /Added 11 sample shipments/);
  const n = () => db.get().prepare(`SELECT COUNT(*) n FROM customers WHERE notes = 'SAMPLE DATA'`).get().n;
  assert.equal(n(), 14);
  assert.equal(db.get().prepare(`SELECT COUNT(*) n FROM email_log WHERE to_email LIKE '%example.com' AND to_email IN (SELECT email FROM customers WHERE notes = 'SAMPLE DATA')`).get().n, 0, 'no emails to sample customers');
  execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'sample-data.js'), '--remove'], { env, encoding: 'utf8' });
  assert.equal(n(), 0);
});

test('payments: part payment, mark paid, PAID invoice email, remove payment', async () => {
  const admin = await login();
  const customer = svc.upsertCustomer({ name: 'Pay Test', email: 'pay@example.com' });
  const b = svc.createBooking({ customer_id: customer.id, service_type: 'domestic_air', pet_type: 'dog', pet_name: 'Rex',
    pet_count: 1, origin: 'Lancaster, PA', destination: 'Denver, CO', total_amount: 1200, documents: [] });
  const page = `/admin/bookings/${b.id}`;
  const invoices = () => emails().filter((m) => m.template === 'invoice' && m.booking_id === b.id);

  let p = await admin.get(page);
  assert.match(p.text, /id="payments"/);
  assert.match(p.text, /pay-unpaid/);
  assert.match(p.text, /Mark paid \(\$1,200\.00\)/);
  assert.match((await admin.get('/admin/bookings')).text, /pay-unpaid/);

  // Part payment: no invoice yet; invoice page not available
  let r = await admin.form(page, `${page}/payments`, { amount: '200', method: 'card', reference: 'R-1', paid_on: '2026-11-01', send_invoice: 'on' });
  assert.equal(r.location, `${page}#payments`);
  assert.equal(svc.getPaymentSummary(b.id).status, 'partial');
  assert.equal(invoices().length, 0);
  assert.equal((await admin.get(`${page}/invoice`)).status, 302);
  // Invalid amount is rejected
  await admin.form(page, `${page}/payments`, { amount: '-5', method: 'card' });
  assert.equal(svc.getPayments(b.id).length, 1);

  // Mark paid records the balance and emails a PAID invoice
  r = await admin.form(page, `${page}/payments/full`, { method: 'bank_transfer' });
  const s = svc.getPaymentSummary(b.id);
  assert.deepEqual([s.status, s.paid, s.balance], ['paid', 1200, 0]);
  assert.equal(svc.getPayments(b.id)[1].amount, 1000);
  assert.equal(invoices().length, 1);
  const inv = invoices()[0];
  assert.match(inv.subject, /^Invoice INV-\d{4}-\d{4}: paid in full/);
  const row = db.get().prepare('SELECT invoice_number, invoice_sent_at FROM bookings WHERE id = ?').get(b.id);
  assert.ok(row.invoice_number && row.invoice_sent_at);

  p = await admin.get(page);
  assert.match(p.text, /Paid in full\./);
  assert.match(p.text, new RegExp(row.invoice_number));
  const printable = await admin.get(`${page}/invoice`);
  assert.equal(printable.status, 200);
  assert.match(printable.text, />PAID</);
  assert.match(printable.text, /\$1,200\.00/);
  assert.match((await admin.get(`/admin/customers/${customer.id}`)).text, /pay-paid/);

  // Resend keeps the same invoice number
  await admin.form(page, `${page}/invoice/send`, {});
  assert.equal(invoices().length, 2);
  assert.equal(db.get().prepare('SELECT invoice_number FROM bookings WHERE id = ?').get(b.id).invoice_number, row.invoice_number);

  // Removing a payment reopens the balance; invoice can no longer be sent
  const pid = svc.getPayments(b.id)[1].id;
  await admin.form(page, `${page}/payments/${pid}/delete`, {});
  assert.equal(svc.getPaymentSummary(b.id).status, 'partial');
  await admin.form(page, `${page}/invoice/send`, {});
  assert.equal(invoices().length, 2);
  // Payments go with a deleted booking
  svc.deleteBooking(b.id);
  assert.equal(db.get().prepare('SELECT COUNT(*) n FROM payments WHERE booking_id = ?').get(b.id).n, 0);
});

test('ADMIN_EMAIL / ADMIN_PASSWORD give a working owner login on a fresh database', async () => {
  const { ensureAdmin } = require('../src/admin-bootstrap');
  const env = { ADMIN_EMAIL: 'Boss@Example.com', ADMIN_PASSWORD: 'Prod-pass-123' };
  assert.equal(ensureAdmin(env), 'created');
  assert.equal(ensureAdmin(env), 'unchanged');
  let c = client();
  let r = await c.form('/admin/login', '/admin/login', { email: 'boss@example.com', password: 'Prod-pass-123' });
  assert.equal(r.status, 302);
  // Forgotten or changed password and a disabled account are restored from the settings
  db.get().prepare(`UPDATE admins SET password_hash = 'x', active = 0 WHERE email = 'boss@example.com'`).run();
  assert.equal(ensureAdmin(env), 'updated');
  r = await client().form('/admin/login', '/admin/login', { email: 'boss@example.com', password: 'Prod-pass-123' });
  assert.equal(r.status, 302);
  // Missing or unsafe settings do nothing
  assert.equal(ensureAdmin({}), null);
  assert.equal(ensureAdmin({ ADMIN_EMAIL: 'x@example.com', ADMIN_PASSWORD: 'short' }), null);
  assert.equal(db.get().prepare(`SELECT COUNT(*) n FROM admins WHERE email = 'x@example.com'`).get().n, 0);
});

test('owner can add and remove sample data from the dashboard (no emails)', async () => {
  const admin = await login();
  const before = emails().length;
  let page = await admin.get('/admin');
  assert.match(page.text, /Add sample data/);
  let r = await admin.form('/admin', '/admin/samples/add', {});
  assert.equal(r.location, '/admin');
  const n = () => db.get().prepare(`SELECT COUNT(*) n FROM customers WHERE notes = 'SAMPLE DATA'`).get().n;
  assert.equal(n(), 14);
  assert.equal(emails().length, before, 'no emails sent for samples');
  assert.ok(db.get().prepare(`SELECT COUNT(*) n FROM payments WHERE reference = 'SAMPLE'`).get().n >= 5, 'samples include payments');
  page = await admin.get('/admin');
  assert.match(page.text, /Remove sample data/);
  // A second add does nothing
  await admin.form('/admin', '/admin/samples/add', {});
  assert.equal(n(), 14);
  r = await admin.form('/admin', '/admin/samples/remove', {});
  assert.equal(n(), 0);
  assert.equal(db.get().prepare(`SELECT COUNT(*) n FROM payments WHERE reference = 'SAMPLE'`).get().n, 0);
});

test('admin warns when email is not set up and can send a test email', async () => {
  const admin = await login();
  assert.match((await admin.get('/admin')).text, /Emails are not being sent from this server/);
  const page = await admin.get('/admin/emails');
  assert.match(page.text, /SMTP_HOST=smtp\.titan\.email/);
  const r = await admin.form('/admin/emails', '/admin/emails/test', {});
  assert.equal(r.location, '/admin/emails');
  const last = db.get().prepare("SELECT * FROM email_log WHERE template = 'test' ORDER BY id DESC").get();
  assert.equal(last.status, 'saved_to_outbox');
  assert.match((await admin.get('/admin/emails')).text, /only saved, not sent/);
});
