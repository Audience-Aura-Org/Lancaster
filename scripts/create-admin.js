'use strict';
/**
 * Create (or reset) an admin account.
 *   npm run create-admin -- --email you@example.com --name "Your Name" [--role owner|staff] [--password "..."]
 * Without --password a strong random password is generated and printed once.
 * The first account created is always an owner.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../src/db');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const email = String(arg('email') || '').trim().toLowerCase();
const name = String(arg('name') || '').trim() || email.split('@')[0];
let role = arg('role') === 'staff' ? 'staff' : 'owner';
let password = arg('password');

if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
  console.error('Usage: npm run create-admin -- --email you@example.com --name "Your Name" [--role owner|staff] [--password "..."]');
  process.exit(1);
}
if (password && password.length < 10) {
  console.error('Password must be at least 10 characters.');
  process.exit(1);
}
const generated = !password;
if (generated) password = crypto.randomBytes(12).toString('base64url');

const d = db.open();
if (d.prepare('SELECT COUNT(*) n FROM admins').get().n === 0) role = 'owner';
const hash = bcrypt.hashSync(password, 12);
const existing = d.prepare('SELECT id FROM admins WHERE email = ?').get(email);
if (existing) {
  d.prepare('UPDATE admins SET password_hash = ?, active = 1, name = ? WHERE id = ?').run(hash, name, existing.id);
  d.prepare(`DELETE FROM sessions WHERE json_extract(sess, '$.adminId') = ?`).run(existing.id);
  console.log(`Password reset for ${email}.`);
} else {
  d.prepare('INSERT INTO admins (email, name, password_hash, role) VALUES (?, ?, ?, ?)').run(email, name, hash, role);
  console.log(`Created ${role} account for ${email}.`);
}
if (generated) console.log(`Password: ${password}\n(Shown once. Sign in at /admin/login and change it under "My account".)`);
db.close();
