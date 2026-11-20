'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

let db;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner','staff')),
  active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT,
  address TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quote_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  service_type TEXT NOT NULL,
  pet_type TEXT NOT NULL,
  pet_name TEXT,
  breed TEXT,
  weight_lbs REAL,
  pet_count INTEGER NOT NULL DEFAULT 1,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  travel_date TEXT,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  quoted_amount REAL,
  quote_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_quotes_status ON quote_requests(status);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  quote_id INTEGER REFERENCES quote_requests(id),
  service_type TEXT NOT NULL,
  pet_type TEXT NOT NULL,
  pet_name TEXT,
  breed TEXT,
  weight_lbs REAL,
  pet_count INTEGER NOT NULL DEFAULT 1,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  travel_date TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed',
  airline_awb TEXT,
  flight_details TEXT,
  pickup_window TEXT,
  total_amount REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);

CREATE TABLE IF NOT EXISTS booking_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  doc_key TEXT NOT NULL,
  label TEXT NOT NULL,
  received INTEGER NOT NULL DEFAULT 0,
  received_at TEXT,
  UNIQUE (booking_id, doc_key)
);

CREATE TABLE IF NOT EXISTS booking_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  admin_id INTEGER REFERENCES admins(id),
  email_sent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL CHECK (entity IN ('quote','booking','customer')),
  entity_id INTEGER NOT NULL,
  admin_id INTEGER REFERENCES admins(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notes_entity ON notes(entity, entity_id);

CREATE TABLE IF NOT EXISTS contact_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  subject TEXT,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','read','archived')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  template TEXT NOT NULL,
  booking_id INTEGER,
  quote_id INTEGER,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  detail TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function open(file = config.dbFile) {
  if (db) return db;
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Additive migrations for databases created by earlier versions. */
function migrate(d) {
  const has = (table, col) => d.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);
  for (const table of ['quote_requests', 'bookings']) {
    if (!has(table, 'cargo_description')) d.exec(`ALTER TABLE ${table} ADD COLUMN cargo_description TEXT`);
    if (!has(table, 'dimensions')) d.exec(`ALTER TABLE ${table} ADD COLUMN dimensions TEXT`);
    // Pet-only: age. Item-only: package type + declared value. Both: special needs / handling instructions.
    if (!has(table, 'pet_age')) d.exec(`ALTER TABLE ${table} ADD COLUMN pet_age TEXT`);
    if (!has(table, 'package_type')) d.exec(`ALTER TABLE ${table} ADD COLUMN package_type TEXT`);
    if (!has(table, 'declared_value')) d.exec(`ALTER TABLE ${table} ADD COLUMN declared_value REAL`);
    if (!has(table, 'special_needs')) d.exec(`ALTER TABLE ${table} ADD COLUMN special_needs TEXT`);
  }
  d.exec(`CREATE TABLE IF NOT EXISTS subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
}

function get() {
  return db || open();
}

function close() {
  if (db) { db.close(); db = undefined; }
}

/** Run fn inside a transaction; rolls back on throw. */
function tx(fn) {
  const d = get();
  d.exec('BEGIN');
  try {
    const out = fn(d);
    d.exec('COMMIT');
    return out;
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { open, get, close, tx };
