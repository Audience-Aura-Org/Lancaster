'use strict';
/** Data for the admin dashboard and the admin-wide search. */
const db = require('./db');
const { BOOKING_STATUSES, SERVICE_TYPES, isAir, itemName } = require('./domain');

const ACTIVE = `b.status NOT IN ('completed','cancelled')`;
// Whole days from today (UTC) to the travel date; negative = in the past.
const DAYS = `CAST(julianday(b.travel_date) - julianday(date('now')) AS INTEGER)`;

function daysLabel(days) {
  if (days == null) return 'date to be confirmed';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

function getDashboard() {
  const d = db.get();
  const n = (sql, ...p) => d.prepare(sql).get(...p).n;

  // Bookings with document progress, used by several sections.
  const withDocs = `SELECT b.*, c.name customer_name, ${DAYS} AS days,
      (SELECT COUNT(*) FROM booking_documents x WHERE x.booking_id = b.id) AS docs_total,
      (SELECT COUNT(*) FROM booking_documents x WHERE x.booking_id = b.id AND x.received = 1) AS docs_received
    FROM bookings b JOIN customers c ON c.id = b.customer_id`;

  const stats = {
    active: n(`SELECT COUNT(*) n FROM bookings b WHERE ${ACTIVE}`),
    departingWeek: n(`SELECT COUNT(*) n FROM bookings b WHERE ${ACTIVE} AND b.travel_date IS NOT NULL AND ${DAYS} BETWEEN 0 AND 7`),
    newQuotes: n(`SELECT COUNT(*) n FROM quote_requests WHERE status = 'new'`),
    docsWaiting: n(`SELECT COUNT(DISTINCT b.id) n FROM bookings b JOIN booking_documents x ON x.booking_id = b.id WHERE x.received = 0 AND ${ACTIVE}`),
    newMessages: n(`SELECT COUNT(*) n FROM contact_messages WHERE status = 'new'`),
    failedEmails: n(`SELECT COUNT(*) n FROM email_log WHERE status = 'failed' AND created_at > datetime('now','-7 days')`),
  };

  /* ---- Needs attention: most urgent first ---- */
  const attention = [];
  const active = d.prepare(`${withDocs} WHERE ${ACTIVE} ORDER BY (b.travel_date IS NULL), b.travel_date`).all();
  for (const b of active) {
    const missing = b.docs_total - b.docs_received;
    const link = `/admin/bookings/${b.id}`;
    const who = `${b.ref} · ${itemName(b)}`;
    if (b.days != null && b.days < 0) {
      attention.push({ level: 'critical', icon: 'fa-calendar-xmark', title: `${who} travel date has passed`,
        detail: `Was due ${daysLabel(b.days)} and is still "${BOOKING_STATUSES[b.status].label}". Mark it delivered or update the date.`, link, action: 'Update' });
    } else if (b.days != null && b.days <= 7 && missing > 0) {
      attention.push({ level: b.days <= 3 ? 'critical' : 'warning', icon: 'fa-file-circle-exclamation', title: `${who} departs ${daysLabel(b.days)}`,
        detail: `${missing} of ${b.docs_total} documents still missing.`, link: `${link}#documents`, action: 'Documents' });
    } else if (b.days != null && b.days <= 3 && b.status !== 'scheduled') {
      attention.push({ level: 'warning', icon: 'fa-calendar-day', title: `${who} departs ${daysLabel(b.days)}`,
        detail: isAir(b.service_type) && !b.airline_awb ? 'Not scheduled yet, and no air waybill added.' : 'Not marked as scheduled yet.', link, action: 'Schedule' });
    }
  }
  if (stats.newQuotes) {
    attention.push({ level: 'info', icon: 'fa-file-signature', title: `${stats.newQuotes} new quote request${stats.newQuotes > 1 ? 's' : ''} to review`,
      detail: 'Customers are waiting for a price.', link: '/admin/quotes?status=new', action: 'Review' });
  }
  const followUps = n(`SELECT COUNT(*) n FROM quote_requests WHERE status = 'quoted' AND updated_at < datetime('now','-3 days')`);
  if (followUps) {
    attention.push({ level: 'info', icon: 'fa-phone', title: `Follow up on ${followUps} quote${followUps > 1 ? 's' : ''}`,
      detail: 'Sent over 3 days ago with no booking yet.', link: '/admin/quotes?status=quoted', action: 'Follow up' });
  }
  if (stats.newMessages) {
    attention.push({ level: 'info', icon: 'fa-inbox', title: `${stats.newMessages} new website message${stats.newMessages > 1 ? 's' : ''}`,
      detail: 'From the contact form.', link: '/admin/messages?status=new', action: 'Read' });
  }
  if (stats.failedEmails) {
    attention.push({ level: 'critical', icon: 'fa-envelope-circle-check', title: `${stats.failedEmails} email${stats.failedEmails > 1 ? 's' : ''} failed to send this week`,
      detail: 'Check your email (SMTP) settings, then re-send from the booking.', link: '/admin/emails', action: 'View' });
  }
  const order = { critical: 0, warning: 1, info: 2 };
  attention.sort((a, b) => order[a.level] - order[b.level]);

  /* ---- Upcoming departures (next 30 days + undated), with document progress ---- */
  const upcoming = active.filter((b) => b.days == null || (b.days >= 0 && b.days <= 30)).slice(0, 8)
    .map((b) => ({ ...b, when: daysLabel(b.days), service: SERVICE_TYPES[b.service_type] }));

  return { stats, attention, upcoming };
}

/* ------------------------------------------------------------- search */

function search(q) {
  const d = db.get();
  const like = `%${q}%`;
  const bookings = d.prepare(`SELECT b.*, c.name customer_name, c.email customer_email FROM bookings b JOIN customers c ON c.id = b.customer_id
    WHERE b.ref LIKE ? OR c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ? OR b.pet_name LIKE ? OR b.cargo_description LIKE ?
      OR b.airline_awb LIKE ? OR b.origin LIKE ? OR b.destination LIKE ?
    ORDER BY b.id DESC LIMIT 20`).all(...Array(9).fill(like));
  const quotes = d.prepare(`SELECT q.*, c.name customer_name, c.email customer_email FROM quote_requests q JOIN customers c ON c.id = q.customer_id
    WHERE q.ref LIKE ? OR c.name LIKE ? OR c.email LIKE ? OR q.pet_name LIKE ? OR q.cargo_description LIKE ?
    ORDER BY q.id DESC LIMIT 20`).all(...Array(5).fill(like));
  const customers = d.prepare(`SELECT * FROM customers WHERE name LIKE ? OR email LIKE ? OR phone LIKE ? ORDER BY id DESC LIMIT 20`).all(like, like, like);
  return { bookings, quotes, customers };
}

module.exports = { getDashboard, search, daysLabel };
