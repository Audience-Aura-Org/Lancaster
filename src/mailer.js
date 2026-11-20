'use strict';
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const config = require('./config');
const db = require('./db');

let transport;

function getTransport() {
  if (transport) return transport;
  if (config.smtp.host) {
    transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
      connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
    });
  } else {
    // No SMTP configured: write each message as an .eml file to data/outbox for review.
    transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  }
  return transport;
}

/**
 * Send an email and record it in email_log. Never throws: a mail failure must
 * not break the request that triggered it. Returns true when sent/queued.
 */
async function send({ to, subject, html, text, template, bookingId = null, quoteId = null, replyTo }) {
  const logRow = (status, error) => db.get().prepare(
    'INSERT INTO email_log (to_email, subject, template, booking_id, quote_id, status, error) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(to, subject, template, bookingId, quoteId, status, error ? String(error).slice(0, 500) : null);

  try {
    const info = await getTransport().sendMail({
      from: config.smtp.from,
      to,
      subject,
      html,
      text,
      replyTo: replyTo || config.business.email,
    });
    if (!config.smtp.host && info.message) {
      fs.mkdirSync(config.outboxDir, { recursive: true });
      const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${template}.eml`;
      fs.writeFileSync(path.join(config.outboxDir, name), info.message);
      logRow('saved_to_outbox');
    } else {
      logRow('sent');
    }
    return true;
  } catch (err) {
    console.error(`[mail] failed to send "${subject}" to ${to}:`, err.message);
    logRow('failed', err.message);
    return false;
  }
}

/** For tests. */
function _reset() { transport = undefined; }

/** Is real email sending set up (SMTP_HOST, SMTP_USER and SMTP_PASS)? */
function isConfigured() { return Boolean(config.smtp.host && config.smtp.user && config.smtp.pass); }

module.exports = { send, isConfigured, _reset };
