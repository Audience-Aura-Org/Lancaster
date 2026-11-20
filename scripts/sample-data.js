'use strict';
/**
 * Sample quotes and shipments for trying out the admin and the Track page.
 *   npm run samples                 add sample data (no emails are sent)
 *   npm run samples -- --remove     delete all sample data again
 * The same buttons are on the admin dashboard for owners.
 */
const db = require('../src/db');
const samples = require('../src/sample-data');

(async () => {
  try {
    db.open();
    if (process.argv.includes('--remove')) {
      const n = samples.remove();
      console.log(n ? `Removed sample data for ${n} customers.` : 'No sample data found.');
      return;
    }
    const r = await samples.add();
    if (r.exists) { console.log('Sample data already exists. Run with --remove first to recreate it.'); return; }
    console.log(`Added ${r.added} sample shipments and ${r.quotes} sample quote requests (no emails sent).\n`);
    console.log('Try them on /track:');
    for (const b of r.bookings) console.log(`  ${b.ref}  ${b.email.padEnd(38)} ${b.service.padEnd(18)} ${b.status}`);
  } finally {
    db.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
