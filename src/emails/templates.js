'use strict';
/**
 * All customer and staff emails. Each builder returns { subject, html, text }.
 * Content changes by service type (ground / domestic air / international) and
 * by booking status. Templates are fixed on purpose: staff pick a status, they
 * do not type free-form messages that look like they come from the system.
 */
const config = require('../config');
const { SERVICE_TYPES, ITEM_LABELS, PACKAGE_TYPES, BOOKING_STATUSES, label, isFreight, isAir } = require('../domain');

/** "Biscuit's trip" for pets, "your shipment" for freight. */
const tripName = (x) => (isFreight(x.service_type) ? 'your shipment' : `${x.pet_name || 'your pet'}'s trip`);
const awb = require('../awb');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const B = () => config.business;

function money(n) {
  return n == null ? '' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d) {
  if (!d) return 'To be confirmed';
  const dt = new Date(d + 'T12:00:00Z');
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

const SAFETY_NOTE = () =>
  `${B().name} will never ask you to pay with gift cards, cryptocurrency or money-transfer apps, and will never ask for extra payment to "release" a pet while it is travelling. If you get a message like that, do not pay. Contact us using the details on our website.`;

/** Branded HTML wrapper (inline styles for email client support). */
function layout({ preheader = '', heading, bodyHtml, cta }) {
  const b = B();
  const ctaHtml = cta
    ? `<p style="margin:28px 0 8px"><a href="${esc(cta.url)}" style="background:#e07a2f;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px;display:inline-block">${esc(cta.label)}</a></p>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(heading)}</title></head>
<body style="margin:0;background:#f4f1ec;font-family:Poppins,Segoe UI,Arial,sans-serif;color:#1f2a2e">
<span style="display:none;max-height:0;overflow:hidden">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ec;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:#14454f;padding:22px 28px;color:#ffffff;font-size:20px;font-weight:700">&#128062; ${esc(b.name)}</td></tr>
<tr><td style="padding:28px;font-size:15px;line-height:1.6">
<h1 style="font-size:22px;margin:0 0 16px;color:#14454f">${esc(heading)}</h1>
${bodyHtml}
${ctaHtml}
</td></tr>
<tr><td style="padding:18px 28px;background:#faf7f2;font-size:12px;line-height:1.5;color:#5b6b70">
<p style="margin:0 0 8px"><strong>Staying safe:</strong> ${esc(SAFETY_NOTE())}</p>
<p style="margin:0">${esc(b.name)} &middot; ${esc(b.address)} &middot; ${esc(b.email)}${b.phone ? ' &middot; ' + esc(b.phone) : ''}</p>
</td></tr></table></td></tr></table></body></html>`;
}

function textFooter() {
  const b = B();
  return `\n\n--\nStaying safe: ${SAFETY_NOTE()}\n${b.name} | ${b.address} | ${b.email}${b.phone ? ' | ' + b.phone : ''}`;
}

function detailsTable(rows) {
  const tr = rows.filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#5b6b70;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;font-weight:600">${esc(v)}</td></tr>`).join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:12px 0 4px;font-size:14px">${tr}</table>`;
}
function detailsText(rows) {
  return rows.filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${v}`).join('\n');
}

function list(items) {
  return `<ul style="padding-left:20px;margin:8px 0">${items.map((i) => `<li style="margin:4px 0">${esc(i)}</li>`).join('')}</ul>`;
}

function tripRows(x) {
  const item = isFreight(x.service_type);
  const rows = [
    ['Reference', x.ref],
    ['Service', label(SERVICE_TYPES, x.service_type)],
  ];
  if (item) {
    rows.push(['Item', [x.cargo_description, x.pet_count > 1 ? `${x.pet_count} pieces` : '', x.weight_lbs ? `${x.weight_lbs} lbs` : ''].filter(Boolean).join(' - ')]);
    if (x.package_type && PACKAGE_TYPES[x.package_type]) rows.push(['Packaging', PACKAGE_TYPES[x.package_type]]);
  } else {
    rows.push(['Pet', [x.pet_name, label(ITEM_LABELS, x.pet_type), x.pet_age].filter(Boolean).join(' - ') + (x.pet_count > 1 ? ` (+${x.pet_count - 1} more)` : '')]);
  }
  rows.push(['From', x.origin], ['To', x.destination], [item ? 'Ship date' : 'Travel date', fmtDate(x.travel_date)]);
  return rows;
}

function statusUrl(booking) {
  return `${config.baseUrl}/track?ref=${encodeURIComponent(booking.ref)}`;
}

/* ------------------------------------------------------------------ quotes */

function quoteReceived({ customer, quote }) {
  const svc = quote.service_type;
  const next = {
    domestic_ground: 'We will check driver availability for your route and come back with a quote, usually within one business day.',
    domestic_air: 'We will check airline pet policies and space on your route and come back with a quote, usually within one business day.',
    international_air: 'International moves depend on destination rules. We will review your destination\'s import requirements and come back with a quote and a document timeline, usually within two business days.',
  }[svc] || 'We will review your shipment details, route and timing and come back with a quote, usually within one business day.';
  const subject = `We received your quote request (${quote.ref})`;
  const html = layout({
    preheader: 'Thanks for reaching out about your pet\'s move.',
    heading: `Thanks, ${customer.name.split(' ')[0]}!`,
    bodyHtml: `<p>We received your request and a pet travel coordinator is reviewing it now.</p>${detailsTable(tripRows(quote))}<p>${esc(next)}</p><p>Keep your reference number handy for any questions.</p>`,
  });
  const text = `Hi ${customer.name},\n\nWe received your quote request and a coordinator is reviewing it.\n\n${detailsText(tripRows(quote))}\n\n${next}${textFooter()}`;
  return { subject, html, text };
}

function quoteAdminNotify({ customer, quote }) {
  const url = `${config.baseUrl}/admin/quotes/${quote.id}`;
  const rows = [...tripRows(quote), ['Customer', customer.name], ['Email', customer.email], ['Phone', customer.phone], ['Breed', quote.breed], ['Weight (lbs)', quote.weight_lbs], ['Message', quote.message]];
  return {
    subject: `New quote request ${quote.ref} - ${label(SERVICE_TYPES, quote.service_type)}`,
    html: layout({ heading: 'New quote request', bodyHtml: detailsTable(rows), cta: { url, label: 'Open in admin' } }),
    text: `New quote request\n\n${detailsText(rows)}\n\n${url}`,
  };
}

function quoteReady({ customer, quote }) {
  const rows = [...tripRows(quote), ['Quoted price', money(quote.quoted_amount)]];
  const html = layout({
    preheader: `Your quote for ${tripName(quote)} is ready.`,
    heading: 'Your pet travel quote',
    bodyHtml: `<p>Hi ${esc(customer.name)}, here is your quote.</p>${detailsTable(rows)}${quote.quote_notes ? `<p style="white-space:pre-line">${esc(quote.quote_notes)}</p>` : ''}<p>Reply to this email or call us to ask questions or confirm. We will only send a booking confirmation once we have talked it through with you.</p>`,
  });
  const text = `Hi ${customer.name},\n\nHere is your quote.\n\n${detailsText(rows)}\n\n${quote.quote_notes || ''}\n\nReply to this email or call us to ask questions or confirm.${textFooter()}`;
  return { subject: `Your pet travel quote (${quote.ref})`, html, text };
}

/* ---------------------------------------------------------------- contact */

function contactAdminNotify({ msg }) {
  const rows = [['Name', msg.name], ['Email', msg.email], ['Phone', msg.phone], ['Subject', msg.subject], ['Message', msg.message]];
  return {
    subject: `Website message: ${msg.subject || 'General enquiry'}`,
    html: layout({ heading: 'New website message', bodyHtml: detailsTable(rows), cta: { url: `${config.baseUrl}/admin/messages`, label: 'Open messages' } }),
    text: detailsText(rows),
  };
}

function contactReceived({ msg }) {
  return {
    subject: `Thanks for contacting ${B().name}`,
    html: layout({ heading: 'We got your message', bodyHtml: `<p>Hi ${esc(msg.name)}, thanks for getting in touch. We reply to messages within one business day.</p>` }),
    text: `Hi ${msg.name},\n\nThanks for getting in touch. We reply to messages within one business day.${textFooter()}`,
  };
}

/* --------------------------------------------------------------- bookings */

/** Service-specific paragraph for each status. */
const STATUS_COPY = {
  confirmed: {
    _freight: "Next, we will confirm collection details and the transport plan. Please start on the document checklist below so there are no delays.",
    domestic_ground: 'Next, we will confirm the pickup address and agree a pickup window with you. Our drivers make regular comfort stops and send you updates during the drive.',
    domestic_air: 'Next, we will book your pet\'s space with the airline. Airlines need the crate size and the health certificate timing, so please start the checklist below.',
    international_air: 'International moves run on strict timelines. Please start the checklist below now: microchip, rabies vaccination and any titer test must be done in the right order and within the required time windows.',
  },
  documents_pending: {
    _freight: "We are still waiting on the items below. Missing or inconsistent paperwork is the most common cause of delays, so please send them as soon as you can.",
    domestic_ground: 'We are still waiting on the items below. Send them by replying to this email.',
    domestic_air: 'We are still waiting on the items below. The airline cannot accept your pet without them.',
    international_air: 'We are still waiting on the items below. Destination authorities can refuse entry if documents are missing or out of date, so please send them as soon as you can.',
  },
  documents_complete: {
    _freight: "All documents are in and reviewed. We will confirm the transport schedule next.",
    domestic_ground: 'All documents are in. We will confirm your pickup window shortly.',
    domestic_air: 'All documents are in and reviewed. We will confirm your flight next.',
    international_air: 'All documents are in and reviewed. We will confirm the flight and arrival plan next.',
  },
  scheduled: {
    _freight: "Your shipment is scheduled. The transport details are below. For air shipments, you can check the flight directly with the airline using the air waybill number.",
    domestic_ground: 'Your pet\'s trip is scheduled. Please have food, any medications and a familiar blanket or toy ready at pickup.',
    domestic_air: 'Your pet\'s flight is booked. You can check the flight status directly with the airline using the air waybill number below.',
    international_air: 'Your pet\'s flight is booked. You can check the flight status directly with the airline using the air waybill number below. On arrival, your pet will go through the destination country\'s official inspection before release.',
  },
  completed: {
    _freight: "Your shipment has been delivered. Thank you for choosing us. We would love to hear how it went.",
    domestic_ground: 'Your pet has arrived. We hope the trip went smoothly! We would love to hear how it went.',
    domestic_air: 'Your pet has arrived. We hope the trip went smoothly! We would love to hear how it went.',
    international_air: 'Your pet has arrived in their new home country. Welcome to the next chapter! We would love to hear how it went.',
  },
  cancelled: {
    _freight: "Your booking has been cancelled. If you did not expect this, please contact us.",
    domestic_ground: 'Your booking has been cancelled. If you did not expect this, please contact us.',
    domestic_air: 'Your booking has been cancelled. If you did not expect this, please contact us.',
    international_air: 'Your booking has been cancelled. If you did not expect this, please contact us.',
  },
};

function bookingStatus({ customer, booking, documents = [] }) {
  const status = booking.status;
  const st = BOOKING_STATUSES[status];
  const svc = booking.service_type;
  const copy = (STATUS_COPY[status] || {})[svc] || (STATUS_COPY[status] || {})._freight || st.customer;
  const outstanding = documents.filter((d) => !d.received).map((d) => d.label);

  const rows = tripRows(booking);
  let extraHtml = '';
  let extraText = '';

  if ((status === 'confirmed' || status === 'documents_pending') && outstanding.length) {
    extraHtml += `<h2 style="font-size:16px;margin:20px 0 4px;color:#14454f">Documents we still need</h2>${list(outstanding)}`;
    extraText += `\n\nDocuments we still need:\n- ${outstanding.join('\n- ')}`;
  }

  if (status === 'scheduled') {
    if (!isAir(svc)) {
      if (booking.pickup_window) rows.push(['Pickup window', booking.pickup_window]);
      if (booking.flight_details) rows.push(['Transport details', booking.flight_details]);
    } else {
      if (booking.flight_details) rows.push(['Flight', booking.flight_details]);
      const a = booking.airline_awb ? awb.parse(booking.airline_awb) : null;
      if (a && a.valid) {
        rows.push(['Air waybill', a.formatted]);
        if (a.airline) {
          rows.push(['Airline', a.airline.name]);
          extraHtml += `<p>Track the flight directly with <a href="${esc(a.airline.url)}">${esc(a.airline.name)}</a> using air waybill <strong>${esc(a.formatted)}</strong>.</p>`;
          extraText += `\n\nTrack the flight directly with ${a.airline.name} (${a.airline.url}) using air waybill ${a.formatted}.`;
        }
      }
    }
  }

  if (status === 'completed') {
    extraHtml += `<p>If you have a minute, reply and tell us how the trip went. Your feedback helps other pet owners.</p>`;
  }

  const subject = `${st.label}: ${tripName(booking)} (${booking.ref})`;
  const html = layout({
    preheader: copy,
    heading: st.label,
    bodyHtml: `<p>Hi ${esc(customer.name)},</p><p>${esc(copy)}</p>${detailsTable(rows)}${extraHtml}`,
    cta: status === 'cancelled' ? null : { url: statusUrl(booking), label: 'View booking status' },
  });
  const text = `Hi ${customer.name},\n\n${copy}\n\n${detailsText(rows)}${extraText}\n\nView booking status: ${statusUrl(booking)}${textFooter()}`;
  return { subject, html, text };
}

function documentsReminder({ customer, booking, documents }) {
  const outstanding = documents.filter((d) => !d.received).map((d) => d.label);
  const intro = STATUS_COPY.documents_pending[booking.service_type] || STATUS_COPY.documents_pending._freight;
  const subject = `Reminder: documents needed for ${tripName(booking)} (${booking.ref})`;
  const html = layout({
    heading: 'A quick reminder about documents',
    bodyHtml: `<p>Hi ${esc(customer.name)},</p><p>${esc(intro)}</p>${list(outstanding)}${detailsTable(tripRows(booking))}`,
    cta: { url: statusUrl(booking), label: 'View checklist' },
  });
  const text = `Hi ${customer.name},\n\n${intro}\n\n- ${outstanding.join('\n- ')}\n\n${detailsText(tripRows(booking))}${textFooter()}`;
  return { subject, html, text };
}

module.exports = {
  quoteReceived, quoteAdminNotify, quoteReady, contactAdminNotify, contactReceived,
  bookingStatus, documentsReminder, STATUS_COPY, esc, fmtDate, money,
};
