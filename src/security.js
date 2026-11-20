'use strict';
const crypto = require('crypto');
const db = require('./db');

/** Per-session CSRF token; every POST must echo it back as `_csrf`. */
function csrf(req, res, next) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  res.locals.csrfToken = req.session.csrfToken;
  if (req.method === 'POST') {
    const sent = (req.body && req.body._csrf) || req.get('x-csrf-token') || '';
    const a = Buffer.from(String(sent));
    const b = Buffer.from(req.session.csrfToken);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      const err = new Error('Your form session expired. Please reload the page and try again.');
      err.status = 403;
      return next(err);
    }
  }
  next();
}

/** One-shot flash messages stored in the session. */
function flash(req, res, next) {
  res.locals.flash = req.session.flash || [];
  delete req.session.flash;
  req.flash = (type, message) => {
    req.session.flash = req.session.flash || [];
    req.session.flash.push({ type, message });
  };
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.adminId) {
    // Only come back to real pages after signing in. A button action (POST) would
    // otherwise be re-opened as a page and show "Not found"; go to its parent page instead.
    req.session.returnTo = req.method === 'GET'
      ? req.originalUrl
      : req.originalUrl.replace(/^(\/admin\/(?:quotes|bookings|customers)\/\d+)\/.*$/, '$1').replace(/^\/admin\/(?!quotes\/\d|bookings\/\d|customers\/\d).*/, '/admin');
    return res.redirect('/admin/login');
  }
  const admin = db.get().prepare('SELECT id, email, name, role, active FROM admins WHERE id = ?').get(req.session.adminId);
  if (!admin || !admin.active) {
    return req.session.regenerate(() => res.redirect('/admin/login'));
  }
  req.admin = admin;
  res.locals.admin = admin;
  next();
}

function requireOwner(req, res, next) {
  if (req.admin && req.admin.role === 'owner') return next();
  const err = new Error('Only the account owner can do that.');
  err.status = 403;
  next(err);
}

function audit(req, action, entity, entityId, detail) {
  db.get().prepare(
    'INSERT INTO audit_log (admin_id, action, entity, entity_id, detail, ip) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.admin ? req.admin.id : null, action, entity || null, entityId || null, detail ? String(detail).slice(0, 500) : null, req.ip || null);
}

/** Human-friendly, hard-to-guess reference such as LPM-Q-7K3M9P. */
function makeRef(kind) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const bytes = crypto.randomBytes(8);
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return `LPM-${kind}-${s}`;
}

module.exports = { csrf, flash, requireAdmin, requireOwner, audit, makeRef };
