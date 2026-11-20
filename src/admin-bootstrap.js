'use strict';
/**
 * Make sure the owner account from ADMIN_EMAIL / ADMIN_PASSWORD exists and can sign in.
 * Runs at startup, so a fresh production database always has a working admin login.
 *
 * - Account missing: it is created as an owner.
 * - Account exists: it is re-activated, made owner, and its password is set to
 *   ADMIN_PASSWORD (only when it differs, so existing sign-ins are not interrupted).
 *
 * While these settings are present, ADMIN_PASSWORD is the password for that account.
 * To manage the password from the admin instead, remove ADMIN_PASSWORD after signing in.
 */
const bcrypt = require('bcryptjs');
const db = require('./db');

function ensureAdmin(env = process.env) {
  const email = String(env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = env.ADMIN_PASSWORD || '';
  if (!email && !password) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { console.warn('ADMIN_EMAIL is not a valid email; admin account not set up.'); return null; }
  if (password.length < 10) { console.warn('ADMIN_PASSWORD must be at least 10 characters; admin account not set up.'); return null; }

  const d = db.get();
  const name = String(env.ADMIN_NAME || '').trim() || 'Owner';
  const existing = d.prepare('SELECT * FROM admins WHERE email = ?').get(email);
  if (!existing) {
    d.prepare('INSERT INTO admins (email, name, password_hash, role) VALUES (?, ?, ?, ?)').run(email, name, bcrypt.hashSync(password, 12), 'owner');
    d.prepare('INSERT INTO audit_log (action, entity, detail) VALUES (?, ?, ?)').run('admin_bootstrap', 'admin', `Created owner ${email} from ADMIN_EMAIL`);
    console.log(`Admin account created for ${email}.`);
    return 'created';
  }
  const samePassword = bcrypt.compareSync(password, existing.password_hash);
  if (samePassword && existing.active && existing.role === 'owner') return 'unchanged';
  d.prepare('UPDATE admins SET password_hash = ?, active = 1, role = ? WHERE id = ?')
    .run(samePassword ? existing.password_hash : bcrypt.hashSync(password, 12), 'owner', existing.id);
  d.prepare('INSERT INTO audit_log (admin_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)')
    .run(existing.id, 'admin_bootstrap', 'admin', existing.id, 'Sign-in restored from ADMIN_EMAIL / ADMIN_PASSWORD');
  console.log(`Admin account ${email} updated from ADMIN_EMAIL / ADMIN_PASSWORD.`);
  return 'updated';
}

module.exports = { ensureAdmin };
