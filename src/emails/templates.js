'use strict';
/**
 * All customer and staff emails. Each builder returns { subject, html, text }.
 *
 * Design: one email-safe layout (tables + inline styles, 600px, Poppins with system
 * fallbacks) themed per shipment kind:
 *   pet  -> warm red header, 🐾, "Pet transport"
 *   item -> deep navy header, 📦, "Item shipment"
 * Content changes by service type and booking status. Templates are fixed on
 * purpose: staff pick a status, they do not type free-form messages.
 */
const config = require('../config');
const { SERVICE_TYPES, ITEM_LABELS, PACKAGE_TYPES, BOOKING_STATUSES, BOOKING_FLOW, label, isFreight, isAir } = require('../domain');
const awb = require('../awb');

/* ------------------------------------------------------------- helpers */

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const B = () => config.business;
const FONT = "'Poppins','Segoe UI',Helvetica,Arial,sans-serif";
const HFONT = FONT; // headings use Poppins too

/** "Biscuit's trip" for pets, "your shipment" for items. */
const tripName = (x) => (isFreight(x.service_type) ? 'your shipment' : `${x.pet_name || 'your pet'}'s trip`);
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || 'there';

function money(n) {
  return n == null ? '' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d) {
  if (!d) return 'To be confirmed';
  const dt = new Date(d + 'T12:00:00Z');
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function statusUrl(booking) {
  return `${config.baseUrl}/track?ref=${encodeURIComponent(booking.ref)}`;
}

/* -------------------------------------------------------------- themes */

const THEMES = {
  pet: {
    kindLabel: 'Pet transport', emoji: '&#128062;', // 🐾
    accent: '#ef233c', accentDark: '#b3152b', tint: '#fff5f6', tintBorder: '#fbd3d9', soft: '#fde7ea',
    hero: '#d81f36', hero2: '#9e1226', detailsTitle: 'Full trip details',
  },
  item: {
    kindLabel: 'Item shipment', emoji: '&#128230;', // 📦
    accent: '#1d4ed8', accentDark: '#1e3a8a', tint: '#f3f6fe', tintBorder: '#d5e0fb', soft: '#e3eafc',
    hero: '#1e3a8a', hero2: '#0f1d47', detailsTitle: 'Full shipment details',
  },
  general: {
    kindLabel: '', emoji: '&#9993;&#65039;', // ✉️
    accent: '#ef233c', accentDark: '#b3152b', tint: '#f7f7f9', tintBorder: '#e6e7eb', soft: '#eef0f3',
    hero: '#20252d', hero2: '#0f1318', detailsTitle: 'Details',
  },
};
const themeFor = (serviceType) => (serviceType ? (isFreight(serviceType) ? THEMES.item : THEMES.pet) : THEMES.general);

const safetyText = (t) => `${B().name} will never ask you to pay with gift cards, cryptocurrency or money-transfer apps, and will never ask for extra payment to "release" ${t === THEMES.item ? 'a shipment' : 'a pet'} while it is travelling. If you get a message like that, do not pay. Contact us using the details on our website.`;

/* ---------------------------------------------------------- components */

const P = (html, extra = '') => `<p style="margin:0 0 14px;font-family:${FONT};font-size:13px;line-height:1.65;color:#374151;${extra}">${html}</p>`;

/** Section title */
const H2 = (text, t) => `<h2 style="margin:26px 0 12px;font-family:${HFONT};font-size:14px;font-weight:600;color:#111827;">
  <span style="display:inline-block;width:4px;height:16px;background:${t.accent};border-radius:2px;vertical-align:-2px;margin-right:8px;"></span>${esc(text)}</h2>`;

/** "At a glance": the key facts in a two-column grid (stacks on phones). */
function glance(rows, t) {
  const items = rows.filter(([, v]) => v != null && v !== '');
  const cells = items.map(([k, v]) => `<td class="glance-cell" width="50%" style="padding:12px 16px;vertical-align:top;">
      <div style="font-family:${FONT};font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#6b7280;">${esc(k)}</div>
      <div style="margin-top:4px;font-family:${FONT};font-size:14px;font-weight:600;color:#111827;line-height:1.35;">${esc(v)}</div>
    </td>`);
  const trs = [];
  for (let i = 0; i < cells.length; i += 2) trs.push(`<tr>${cells[i]}${cells[i + 1] || '<td class="glance-cell" width="50%"></td>'}</tr>`);
  return `<table role="presentation" class="glance" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 4px;background:${t.tint};border:1px solid ${t.tintBorder};border-radius:16px;">
    <tr><td style="padding:8px 4px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${trs.join('')}</table></td></tr></table>`;
}

/** Full details, leaving out anything already shown "at a glance" */
const without = (rows, labels) => rows.filter(([k]) => !labels.includes(k));

/** Label/value card */
function detailsCard(rows, t, title) {
  const body = rows.filter(([, v]) => v != null && v !== '').map(([k, v], i) => `
    <tr>
      <td style="padding:11px 0;${i ? 'border-top:1px solid ' + t.tintBorder + ';' : ''}font-family:${FONT};font-size:12px;color:#6b7280;width:38%;vertical-align:top;">${esc(k)}</td>
      <td style="padding:11px 0;${i ? 'border-top:1px solid ' + t.tintBorder + ';' : ''}font-family:${FONT};font-size:13px;font-weight:600;color:#111827;text-align:right;vertical-align:top;">${esc(v)}</td>
    </tr>`).join('');
  return `${title ? H2(title, t) : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${t.tint};border:1px solid ${t.tintBorder};border-radius:14px;">
    <tr><td style="padding:6px 20px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${body}</table></td></tr>
  </table>`;
}

/** Bulletproof button */
function button(url, text, t) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px auto 8px;">
    <tr><td align="center" bgcolor="${t.accent}" style="border-radius:999px;background:${t.accent};">
      <a href="${esc(url)}" style="display:inline-block;padding:15px 34px;font-family:${FONT};font-size:13px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">${esc(text)} &rarr;</a>
    </td></tr>
  </table>
  <p style="margin:0;text-align:center;font-family:${FONT};font-size:11px;color:#9ca3af;">Or open: <a href="${esc(url)}" style="color:${t.accent};word-break:break-all;">${esc(url)}</a></p>`;
}

/** Document checklist: received = green tick, outstanding = accent ring */
function checklist(docs, t) {
  const rows = docs.map((d, i) => `
    <tr>
      <td width="34" style="padding:10px 0;${i ? 'border-top:1px solid #eef0f3;' : ''}vertical-align:top;">
        ${d.received
    ? `<span style="display:inline-block;width:22px;height:22px;line-height:22px;border-radius:50%;background:#16a34a;color:#ffffff;font-size:12px;text-align:center;font-family:${FONT};">&#10003;</span>`
    : `<span style="display:inline-block;width:18px;height:18px;border-radius:50%;border:2px solid ${t.accent};"></span>`}
      </td>
      <td style="padding:10px 0;${i ? 'border-top:1px solid #eef0f3;' : ''}font-family:${FONT};font-size:13px;line-height:1.5;color:${d.received ? '#6b7280' : '#111827'};">
        ${esc(d.label)}${d.received ? ' <span style="color:#16a34a;font-size:11px;font-weight:600;">Received</span>' : ' <span style="color:' + t.accent + ';font-size:11px;font-weight:600;">Needed</span>'}
      </td>
    </tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:14px;">
    <tr><td style="padding:6px 18px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr></table>`;
}

/** Coloured callout box */
function callout(html, t, icon = '') {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 0;background:${t.soft};border-radius:14px;">
    <tr><td style="padding:18px 20px;font-family:${FONT};font-size:13px;line-height:1.6;color:#1f2937;">${icon ? `<span style="font-size:15px;margin-right:6px;">${icon}</span>` : ''}${html}</td></tr></table>`;
}

/** Progress tracker for booking emails (steps not actually reached are shown as skipped). */
function tracker(status, reached, t) {
  if (status === 'cancelled') return '';
  const SHORT = { confirmed: 'Confirmed', documents_pending: 'Documents', documents_complete: 'Docs ready', scheduled: 'Scheduled', completed: 'Delivered' };
  const idx = BOOKING_FLOW.indexOf(status);
  const cells = BOOKING_FLOW.map((s, i) => {
    const done = i < idx && (!reached || reached.has(s));
    const current = i === idx;
    const circle = current
      ? `background:${t.accent};color:#ffffff;border:3px solid ${t.soft};`
      : done ? `background:${t.accentDark};color:#ffffff;border:3px solid #ffffff;` : 'background:#ffffff;color:#9ca3af;border:2px solid #d1d5db;';
    return `<td width="20%" align="center" style="padding:0 2px;vertical-align:top;">
      <div style="width:30px;height:30px;line-height:30px;border-radius:50%;${circle}font-family:${FONT};font-size:12px;font-weight:700;margin:0 auto;">${done ? '&#10003;' : i + 1}</div>
      <div style="margin-top:6px;font-family:${FONT};font-size:11px;line-height:1.3;color:${current ? '#111827' : '#6b7280'};font-weight:${current ? 600 : 400};">${SHORT[s]}</div>
    </td>`;
  }).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 22px;"><tr>${cells}</tr></table>`;
}

/* -------------------------------------------------------------- layout */

/**
 * layout({ theme, preheader, eyebrow, heading, intro, body, cta, staff })
 *   body: inner HTML; cta: { url, label }; staff: true for internal notifications
 */
function layout({ theme: t, preheader = '', eyebrow = '', heading, intro = '', body = '', cta, staff = false }) {
  const b = B();
  const site = config.baseUrl;
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(heading)}</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  body, table, td, p, a, span, div, h1, h2 { font-family: ${FONT}; }
  a { text-decoration: none; }
  @media only screen and (max-width: 620px) {
    .container { width: 100% !important; }
    .px { padding-left: 22px !important; padding-right: 22px !important; }
    .hero-title { font-size: 19px !important; }
    .stack { display: block !important; width: 100% !important; text-align: left !important; }
    .glance td { display: block !important; width: 100% !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#eef0f4;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef0f4;">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;">

  <!-- Brand bar -->
  <tr><td style="padding:0 6px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td class="stack" style="vertical-align:middle;">
        <a href="${esc(site)}" style="text-decoration:none;">
          <span style="display:inline-block;width:38px;height:38px;line-height:38px;border-radius:11px;background:#ef233c;text-align:center;font-family:${FONT};font-size:16px;font-weight:700;color:#ffffff;vertical-align:middle;">L</span>
          <span style="display:inline-block;vertical-align:middle;margin-left:10px;font-family:${FONT};">
            <span style="display:block;font-size:15px;font-weight:700;color:#111827;line-height:1.1;">Lancaster</span>
            <span style="display:block;font-size:10px;font-weight:600;letter-spacing:3px;color:#ef233c;">PET MOVERS</span>
          </span>
        </a>
      </td>
    </tr></table>
  </td></tr>

  <!-- Card -->
  <tr><td style="background:#ffffff;border-radius:22px;overflow:hidden;box-shadow:0 10px 30px rgba(17,24,39,.08);">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">

      <!-- Hero -->
      <tr><td bgcolor="${t.hero}" class="px" style="background:${t.hero};background-image:linear-gradient(135deg,${t.hero} 0%,${t.hero2} 100%);padding:34px 40px 32px;border-radius:22px 22px 0 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="vertical-align:top;">
            ${eyebrow ? `<p style="margin:0 0 10px;font-family:${FONT};font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,.8);">${esc(eyebrow)}</p>` : ''}
            <h1 class="hero-title" style="margin:0;font-family:${HFONT};font-size:22px;line-height:1.2;font-weight:700;color:#ffffff;">${esc(heading)}</h1>
            ${intro ? `<p style="margin:12px 0 0;font-family:${FONT};font-size:13px;line-height:1.6;color:rgba(255,255,255,.9);">${esc(intro)}</p>` : ''}
          </td>
          <td width="74" align="right" style="vertical-align:top;">
            <div style="width:60px;height:60px;line-height:60px;border-radius:50%;background:#ffffff;text-align:center;font-size:22px;">${t.emoji}</div>
          </td>
        </tr></table>
      </td></tr>

      <!-- Body -->
      <tr><td class="px" style="padding:32px 40px 34px;">
        ${body}
        ${cta ? button(cta.url, cta.label, t) : ''}
      </td></tr>

      ${staff ? '' : `<!-- Help strip -->
      <tr><td class="px" style="padding:0 40px 30px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eef0f3;"><tr>
          <td style="padding-top:22px;font-family:${FONT};font-size:13px;line-height:1.6;color:#374151;">
            <strong style="color:#111827;">Need help?</strong> Just reply to this email${b.phone ? ` or call us on <a href="tel:${esc(b.phone.replace(/[^\d+]/g, ''))}" style="color:${t.accent};font-weight:600;">${esc(b.phone)}</a>` : ''}. A real person on our team will get back to you.
          </td>
        </tr></table>
      </td></tr>`}
    </table>
  </td></tr>

  ${staff ? '' : `<!-- Safety -->
  <tr><td style="padding:18px 6px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;"><tr>
      <td width="44" style="padding:16px 0 16px 18px;vertical-align:top;font-size:17px;">&#128737;&#65039;</td>
      <td style="padding:16px 18px 16px 8px;font-family:${FONT};font-size:12.5px;line-height:1.6;color:#4b5563;"><strong style="color:#111827;">Staying safe.</strong> ${esc(safetyText(t))}</td>
    </tr></table>
  </td></tr>`}

  <!-- Footer -->
  <tr><td style="padding:18px 6px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#20252d" style="background:#20252d;border-radius:18px;"><tr>
      <td class="px" style="padding:26px 30px;font-family:${FONT};font-size:12px;line-height:1.7;color:#c7cbd3;">
        <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#ffffff;">${esc(b.name)}</p>
        <p style="margin:0 0 14px;">Safe, caring pet transport by road and air. Every pet travels like family.</p>
        <p style="margin:0 0 14px;">
          <a href="${esc(site)}" style="color:#ffffff;font-weight:600;">Website</a>
          &nbsp;&middot;&nbsp; <a href="${esc(site)}/track" style="color:#ffffff;font-weight:600;">${t === THEMES.item ? 'Track a shipment' : 'Track your pet'}</a>
          &nbsp;&middot;&nbsp; <a href="${esc(site)}/contact.html" style="color:#ffffff;font-weight:600;">Contact</a>
        </p>
        <p style="margin:0;font-size:11px;color:#9aa1ad;">${esc(b.address)} &middot; <a href="mailto:${esc(b.email)}" style="color:#9aa1ad;">${esc(b.email)}</a>${b.phone ? ' &middot; ' + esc(b.phone) : ''}</p>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:16px 6px 0;text-align:center;font-family:${FONT};font-size:11px;color:#9ca3af;">
    ${staff ? 'Internal notification from your website.' : `You are receiving this email about your request or booking with ${esc(b.name)}.`}
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

/* ---------------------------------------------------------- plain text */

function textFooter(t = THEMES.general) {
  const b = B();
  return `\n\n--\nNeed help? Reply to this email${b.phone ? ' or call ' + b.phone : ''}.\nStaying safe: ${safetyText(t)}\n${b.name} | ${b.address} | ${b.email}${b.phone ? ' | ' + b.phone : ''}`;
}
function detailsText(rows) {
  return rows.filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${v}`).join('\n');
}

/* --------------------------------------------------------- data rows */

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

/* ------------------------------------------------------------------ quotes */

function quoteReceived({ customer, quote }) {
  const t = themeFor(quote.service_type);
  const item = t === THEMES.item;
  const next = {
    domestic_ground: 'We will check driver availability for your route and come back with a quote, usually within one business day.',
    domestic_air: 'We will check airline pet policies and space on your route and come back with a quote, usually within one business day.',
    international_air: 'International moves depend on destination rules. We will review your destination\'s import requirements and come back with a quote and a document timeline, usually within two business days.',
  }[quote.service_type] || 'We will review your shipment details, route and timing and come back with a quote, usually within one business day.';
  const subject = `We received your quote request (${quote.ref})`;
  const html = layout({
    theme: t,
    preheader: item ? 'Thanks for your shipping request. Here is what happens next.' : 'Thanks for reaching out about your pet\'s move. Here is what happens next.',
    eyebrow: `Quote request · ${quote.ref}`,
    heading: `Thanks, ${firstName(customer.name)}!`,
    intro: item ? 'Your shipping request is in. A coordinator is reviewing it now.' : 'Your pet travel request is in. A coordinator is reviewing it now.',
    body: `${P(`Hi ${esc(firstName(customer.name))},`)}
      ${P(`Thank you for choosing ${esc(B().name)}. We have your request and a coordinator is reviewing it now.`)}
      ${glance([['Reference', quote.ref], ['Service', label(SERVICE_TYPES, quote.service_type)], [item ? 'Ship date' : 'Travel date', fmtDate(quote.travel_date)], ['Status', 'Under review']], t)}
      ${callout(`<strong>What happens next:</strong> ${esc(next)}`, t, '&#9203;')}
      ${detailsCard(without(tripRows(quote), ['Reference', 'Service', 'Travel date', 'Ship date']), t, t.detailsTitle)}
      ${P(`Keep your reference <strong style="color:#111827;">${esc(quote.ref)}</strong> handy if you contact us.`, 'margin-top:20px;')}`,
  });
  const text = `Hi ${customer.name},\n\nWe received your quote request and a coordinator is reviewing it.\n\n${detailsText(tripRows(quote))}\n\n${next}${textFooter(t)}`;
  return { subject, html, text };
}

function quoteAdminNotify({ customer, quote }) {
  const t = themeFor(quote.service_type);
  const item = t === THEMES.item;
  const url = `${config.baseUrl}/admin/quotes/${quote.id}`;
  const extra = item
    ? [['Dimensions', quote.dimensions], ['Declared value', quote.declared_value != null ? money(quote.declared_value) : ''], ['Handling', quote.special_needs]]
    : [['Breed', quote.breed], ['Weight (lbs)', quote.weight_lbs], ['Health / temperament', quote.special_needs]];
  const rows = [...tripRows(quote), ...extra];
  const contact = [['Name', customer.name], ['Email', customer.email], ['Phone', customer.phone], ['Message', quote.message]];
  return {
    subject: `New ${item ? 'item' : 'pet'} quote request ${quote.ref} - ${label(SERVICE_TYPES, quote.service_type)}`,
    html: layout({
      theme: t, staff: true,
      preheader: `${customer.name} · ${quote.origin} to ${quote.destination}`,
      eyebrow: `New ${item ? 'item' : 'pet'} quote request`,
      heading: customer.name,
      intro: `${label(SERVICE_TYPES, quote.service_type)} · ${quote.origin} → ${quote.destination}`,
      body: `${glance([['Customer', customer.name], ['Service', label(SERVICE_TYPES, quote.service_type)], ['Route', `${quote.origin} → ${quote.destination}`], ['Travel date', fmtDate(quote.travel_date)]], t)}
        ${detailsCard(contact, THEMES.general, 'Contact')}${detailsCard(without(rows, ['Service', 'From', 'To', 'Travel date', 'Ship date']), t, 'Request details')}`,
      cta: { url, label: 'Open in admin' },
    }),
    text: `New quote request\n\n${detailsText([...rows, ...contact])}\n\n${url}`,
  };
}

function quoteReady({ customer, quote }) {
  const t = themeFor(quote.service_type);
  const item = t === THEMES.item;
  const html = layout({
    theme: t,
    preheader: `Your quote for ${tripName(quote)} is ready: ${money(quote.quoted_amount)}.`,
    eyebrow: `Your quote · ${quote.ref}`,
    heading: item ? 'Your shipping quote is ready' : 'Your pet travel quote is ready',
    intro: `Here is our price for ${tripName(quote)}.`,
    body: `${P(`Hi ${esc(firstName(customer.name))},`)}
      ${P('Thank you for your patience. Here is your written quote.')}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 4px;background:${t.tint};border:1px solid ${t.tintBorder};border-radius:16px;">
        <tr><td align="center" style="padding:24px 20px;">
          <p style="margin:0;font-family:${FONT};font-size:11px;font-weight:600;letter-spacing:2px;text-transform:uppercase;color:#6b7280;">Quoted price</p>
          <p style="margin:6px 0 0;font-family:${FONT};font-size:30px;font-weight:700;line-height:1.1;color:${t.accentDark};">${esc(money(quote.quoted_amount))}</p>
          <p style="margin:6px 0 0;font-family:${FONT};font-size:12px;color:#6b7280;">${esc(label(SERVICE_TYPES, quote.service_type))}</p>
        </td></tr>
      </table>
      ${glance([['Reference', quote.ref], [item ? 'Ship date' : 'Travel date', fmtDate(quote.travel_date)]], t)}
      ${quote.quote_notes ? `${H2("What's included", t)}${P(esc(quote.quote_notes).replace(/\n/g, '<br>'))}` : ''}
      ${detailsCard(without(tripRows(quote), ['Reference', 'Service', 'Travel date', 'Ship date']), t, t.detailsTitle)}
      ${callout('<strong>Ready to go ahead?</strong> Reply to this email or call us. We will only send a booking confirmation once we have talked it through with you.', t, '&#128172;')}`,
  });
  const text = `Hi ${customer.name},\n\nHere is your quote: ${money(quote.quoted_amount)}\n\n${detailsText(tripRows(quote))}\n\n${quote.quote_notes || ''}\n\nReply to this email or call us to ask questions or confirm.${textFooter(t)}`;
  return { subject: `Your ${item ? 'shipping' : 'pet travel'} quote (${quote.ref})`, html, text };
}

/* ---------------------------------------------------------------- contact */

function contactAdminNotify({ msg }) {
  const t = THEMES.general;
  const rows = [['Name', msg.name], ['Email', msg.email], ['Phone', msg.phone], ['Subject', msg.subject]];
  return {
    subject: `Website message: ${msg.subject || 'General enquiry'}`,
    html: layout({
      theme: t, staff: true,
      preheader: `${msg.name}: ${String(msg.message).slice(0, 90)}`,
      eyebrow: 'New website message', heading: msg.name, intro: msg.subject || 'General enquiry',
      body: `${detailsCard(rows, t, 'From')}${H2('Message', t)}${callout(esc(msg.message).replace(/\n/g, '<br>'), t)}`,
      cta: { url: `${config.baseUrl}/admin/messages`, label: 'Open messages' },
    }),
    text: `${detailsText(rows)}\n\n${msg.message}`,
  };
}

function contactReceived({ msg }) {
  const t = THEMES.general;
  return {
    subject: `Thanks for contacting ${B().name}`,
    html: layout({
      theme: t,
      preheader: 'We got your message and will reply within one business day.',
      eyebrow: 'Message received', heading: `Thanks, ${firstName(msg.name)}!`, intro: 'We got your message and will reply within one business day.',
      body: `${P(`Hi ${esc(firstName(msg.name))}, thanks for getting in touch with ${esc(B().name)}.`)}
        ${H2('Your message', t)}${callout(esc(msg.message).replace(/\n/g, '<br>'), t)}
        ${P('Looking for a price? Our quote form is the quickest way to get one.', 'margin-top:20px;')}`,
      cta: { url: `${config.baseUrl}/quote`, label: 'Request a quote' },
    }),
    text: `Hi ${msg.name},\n\nThanks for getting in touch. We reply to messages within one business day.${textFooter(t)}`,
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

/** Short hero line per status, per kind. */
const HERO = {
  confirmed: { pet: 'Your pet\'s journey is booked.', item: 'Your shipment is booked.' },
  documents_pending: { pet: 'A few documents are still needed.', item: 'A few documents are still needed.' },
  documents_complete: { pet: 'All paperwork is in order.', item: 'All paperwork is in order.' },
  scheduled: { pet: 'Travel is scheduled.', item: 'Transport is scheduled.' },
  completed: { pet: 'Safely arrived. Welcome home!', item: 'Delivered. Thank you!' },
  cancelled: { pet: 'This booking has been cancelled.', item: 'This booking has been cancelled.' },
};

function bookingStatus({ customer, booking, documents = [], reached = null }) {
  const status = booking.status;
  const st = BOOKING_STATUSES[status];
  const svc = booking.service_type;
  const t = themeFor(svc);
  const kind = t === THEMES.item ? 'item' : 'pet';
  const copy = (STATUS_COPY[status] || {})[svc] || (STATUS_COPY[status] || {})._freight || st.customer;
  const outstanding = documents.filter((d) => !d.received);
  const rows = tripRows(booking);
  let extraHtml = '';
  let extraText = '';

  // Document checklist while documents matter
  if (['confirmed', 'documents_pending'].includes(status)) {
    if (documents.length) {
      const got = documents.length - outstanding.length;
      extraHtml += `${H2(`Document checklist · ${got} of ${documents.length} received`, t)}${checklist(documents, t)}`;
      if (outstanding.length) {
        extraHtml += P('Send documents by replying to this email with them attached.', 'margin-top:14px;font-size:12px;color:#6b7280;');
        extraText += `\n\nDocuments we still need:\n- ${outstanding.map((d) => d.label).join('\n- ')}`;
      }
    } else {
      extraHtml += callout('<strong>No documents needed</strong> for this shipment.', t, '&#9989;');
    }
  }

  // Transport details when scheduled
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
          extraHtml += `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 0;background:#111827;border-radius:16px;">
            <tr><td style="padding:22px 24px;font-family:${FONT};color:#ffffff;">
              <p style="margin:0;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#9ca3af;">&#9992;&#65039; Track the flight with ${esc(a.airline.name)}</p>
              <p style="margin:8px 0 4px;font-size:20px;font-weight:700;letter-spacing:1px;">${esc(a.formatted)}</p>
              <p style="margin:0 0 14px;font-size:12px;color:#d1d5db;">Enter this air waybill number on the airline's cargo site for live flight status.</p>
              <a href="${esc(a.airline.url)}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#ffffff;color:#111827;font-size:12px;font-weight:600;">Open ${esc(a.airline.name)} &rarr;</a>
            </td></tr>
          </table>`;
          extraText += `\n\nTrack the flight directly with ${a.airline.name} (${a.airline.url}) using air waybill ${a.formatted}.`;
        }
      }
    }
  }

  if (status === 'completed') {
    extraHtml += callout(kind === 'pet'
      ? '<strong>How did it go?</strong> Reply and tell us about the trip. Your feedback helps other pet owners, and we always love a homecoming photo!'
      : '<strong>How did we do?</strong> Reply and tell us how the delivery went. Your feedback helps us improve.', t, '&#11088;');
  }
  if (status === 'cancelled') {
    extraHtml += callout('If you did not expect this, or would like to rebook, just reply to this email.', t, '&#8505;&#65039;');
  }

  const subject = `${st.label}: ${tripName(booking)} (${booking.ref})`;
  const html = layout({
    theme: t,
    preheader: copy,
    eyebrow: `${kind === 'pet' ? 'Pet booking' : 'Shipment'} update · ${booking.ref}`,
    heading: st.label,
    intro: HERO[status] ? HERO[status][kind] : '',
    body: `${tracker(status, reached, t)}
      ${P(`Hi ${esc(firstName(customer.name))},`)}
      ${P(esc(copy))}
      ${glance([['Reference', booking.ref], ['Status', st.label], [kind === 'item' ? 'Ship date' : 'Travel date', fmtDate(booking.travel_date)], ['Service', label(SERVICE_TYPES, svc)]], t)}
      ${extraHtml}
      ${detailsCard(without(rows, ['Reference', 'Service', 'Travel date', 'Ship date']), t, t.detailsTitle)}`,
    cta: status === 'cancelled' ? null : { url: statusUrl(booking), label: 'Track this booking' },
  });
  const text = `Hi ${customer.name},\n\n${copy}\n\n${detailsText(rows)}${extraText}\n\nTrack this booking: ${statusUrl(booking)}${textFooter(t)}`;
  return { subject, html, text };
}

function documentsReminder({ customer, booking, documents }) {
  const t = themeFor(booking.service_type);
  const outstanding = documents.filter((d) => !d.received);
  const intro = STATUS_COPY.documents_pending[booking.service_type] || STATUS_COPY.documents_pending._freight;
  const subject = `Reminder: documents needed for ${tripName(booking)} (${booking.ref})`;
  const html = layout({
    theme: t,
    preheader: `${outstanding.length} document${outstanding.length === 1 ? '' : 's'} still needed for ${tripName(booking)}.`,
    eyebrow: `Documents reminder · ${booking.ref}`,
    heading: `${outstanding.length} document${outstanding.length === 1 ? '' : 's'} still needed`,
    intro: `For ${tripName(booking)}.`,
    body: `${P(`Hi ${esc(firstName(customer.name))},`)}
      ${P(esc(intro))}
      ${glance([['Documents needed', String(outstanding.length)], [isFreight(booking.service_type) ? 'Ship date' : 'Travel date', fmtDate(booking.travel_date)], ['Reference', booking.ref], ['Service', label(SERVICE_TYPES, booking.service_type)]], t)}
      ${H2('Still needed', t)}${checklist(outstanding, t)}
      ${P('Reply to this email with the documents attached, or contact us if you have questions.', 'margin-top:14px;font-size:12px;color:#6b7280;')}
      ${detailsCard(without(tripRows(booking), ['Reference', 'Service', 'Travel date', 'Ship date']), t, t.detailsTitle)}`,
    cta: { url: statusUrl(booking), label: 'View full checklist' },
  });
  const text = `Hi ${customer.name},\n\n${intro}\n\n- ${outstanding.map((d) => d.label).join('\n- ')}\n\n${detailsText(tripRows(booking))}${textFooter(t)}`;
  return { subject, html, text };
}

/* ---------------------------------------------------------------- invoice */

/**
 * Invoice for a booking that has been paid in full. Sent automatically when the last
 * payment is recorded; the same HTML is the printable invoice in the admin.
 */
function invoice({ customer, booking, payments, summary, invoiceNumber }) {
  const t = themeFor(booking.service_type);
  const item = t === THEMES.item;
  const { PAYMENT_METHODS } = require('../domain');
  const lastPaid = payments.length ? payments[payments.length - 1].paid_on : null;
  const description = item
    ? `${label(SERVICE_TYPES, booking.service_type)}: ${booking.cargo_description || 'shipment'}`
    : `${label(SERVICE_TYPES, booking.service_type)}: ${booking.pet_name ? booking.pet_name + (booking.pet_type ? ' (' + label(ITEM_LABELS, booking.pet_type) + ')' : '') : label(ITEM_LABELS, booking.pet_type)}`;
  const route = `${booking.origin} → ${booking.destination}${booking.travel_date ? ', ' + fmtDate(booking.travel_date) : ''}`;
  const cell = 'padding:12px 0;border-top:1px solid #eef0f3;font-family:' + FONT + ';font-size:13px;';
  const payRows = payments.map((p) => `<tr>
      <td style="${cell}color:#374151;">${esc(fmtDate(p.paid_on))}</td>
      <td style="${cell}color:#374151;">${esc(PAYMENT_METHODS[p.method] || p.method)}${p.reference ? ` <span style="color:#6b7280;">· ${esc(p.reference)}</span>` : ''}</td>
      <td align="right" style="${cell}font-weight:600;color:#111827;">${esc(money(p.amount))}</td></tr>`).join('');

  const body = `
    ${P(`Hi ${esc(firstName(customer.name))},`)}
    ${P(`Thank you for your payment. This is your invoice for ${esc(tripName(booking))}. No further payment is due.`)}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 10px;background:#ecfdf3;border:1px solid #b7ebcd;border-radius:16px;">
      <tr><td align="center" style="padding:22px 20px;">
        <span style="display:inline-block;padding:6px 18px;border:2px solid #16a34a;border-radius:8px;font-family:${FONT};font-size:14px;font-weight:700;letter-spacing:4px;color:#16a34a;">PAID</span>
        <p style="margin:12px 0 0;font-family:${FONT};font-size:28px;font-weight:700;line-height:1.1;color:#14532d;">${esc(money(summary.paid))}</p>
        <p style="margin:6px 0 0;font-family:${FONT};font-size:12px;color:#166534;">Paid in full${lastPaid ? ' on ' + esc(fmtDate(lastPaid)) : ''}</p>
      </td></tr>
    </table>

    ${glance([['Invoice number', invoiceNumber], ['Booking reference', booking.ref], ['Invoice date', fmtDate(new Date().toISOString().slice(0, 10))], ['Status', 'Paid in full']], t)}

    ${H2('Invoice', t)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="padding:0 0 8px;font-family:${FONT};font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#6b7280;">Description</td>
        <td align="right" style="padding:0 0 8px;font-family:${FONT};font-size:11px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#6b7280;">Amount</td>
      </tr>
      <tr>
        <td style="${cell}color:#111827;"><strong>${esc(description)}</strong><br><span style="color:#6b7280;font-size:12px;">${esc(route)}</span></td>
        <td align="right" style="${cell}font-weight:600;color:#111827;vertical-align:top;">${esc(money(summary.total != null ? summary.total : summary.paid))}</td>
      </tr>
      <tr><td style="${cell}color:#6b7280;">Total</td><td align="right" style="${cell}font-weight:700;color:#111827;">${esc(money(summary.total != null ? summary.total : summary.paid))}</td></tr>
      <tr><td style="${cell}color:#6b7280;">Paid</td><td align="right" style="${cell}font-weight:700;color:#16a34a;">${esc(money(summary.paid))}</td></tr>
      <tr><td style="${cell}color:#111827;font-weight:600;">Balance due</td><td align="right" style="${cell}font-size:14px;font-weight:700;color:#111827;">${esc(money(summary.balance || 0))}</td></tr>
    </table>

    ${payments.length ? `${H2('Payments received', t)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${payRows}</table>` : ''}

    ${H2('Billed to', t)}
    ${P(`${esc(customer.name)}<br>${esc(customer.email)}${customer.phone ? '<br>' + esc(customer.phone) : ''}${customer.address ? '<br>' + esc(customer.address).replace(/\n/g, '<br>') : ''}`, 'font-size:13px;')}
    ${P('Please keep this invoice for your records.', 'font-size:12px;color:#6b7280;')}`;

  const subject = `Invoice ${invoiceNumber}: paid in full (${booking.ref})`;
  const html = layout({
    theme: t,
    preheader: `Invoice ${invoiceNumber}: ${money(summary.paid)} paid in full. Thank you!`,
    eyebrow: `Invoice · ${invoiceNumber}`,
    heading: 'Payment received, thank you',
    intro: `Your invoice for ${tripName(booking)} is paid in full.`,
    body,
  });
  const text = `Hi ${customer.name},\n\nThank you for your payment. Invoice ${invoiceNumber} for ${tripName(booking)} is PAID IN FULL.\n\n`
    + `Invoice number: ${invoiceNumber}\nBooking reference: ${booking.ref}\n${description}\n${route}\n\n`
    + `Total: ${money(summary.total != null ? summary.total : summary.paid)}\nPaid: ${money(summary.paid)}\nBalance due: ${money(summary.balance || 0)}\n\n`
    + (payments.length ? 'Payments received:\n' + payments.map((p) => `- ${fmtDate(p.paid_on)}  ${PAYMENT_METHODS[p.method] || p.method}${p.reference ? ' (' + p.reference + ')' : ''}  ${money(p.amount)}`).join('\n') : '')
    + textFooter(t);
  return { subject, html, text };
}

module.exports = {
  invoice,
  quoteReceived, quoteAdminNotify, quoteReady, contactAdminNotify, contactReceived,
  bookingStatus, documentsReminder, STATUS_COPY, esc, fmtDate, money, THEMES,
};
