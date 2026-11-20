'use strict';
const session = require('express-session');
const db = require('./db');

/** express-session store backed by the app's SQLite database. */
class SqliteStore extends session.Store {
  constructor() {
    super();
    this.timer = setInterval(() => this.prune(), 15 * 60 * 1000);
    this.timer.unref();
  }

  ttl(sess) {
    const maxAge = sess && sess.cookie && sess.cookie.maxAge;
    return Date.now() + (typeof maxAge === 'number' ? maxAge : 86400000);
  }

  get(sid, cb) {
    try {
      const row = db.get().prepare('SELECT sess, expires FROM sessions WHERE sid = ?').get(sid);
      if (!row) return cb(null, null);
      if (row.expires < Date.now()) { this.destroy(sid, () => {}); return cb(null, null); }
      cb(null, JSON.parse(row.sess));
    } catch (e) { cb(e); }
  }

  set(sid, sess, cb) {
    try {
      db.get().prepare(
        'INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires'
      ).run(sid, JSON.stringify(sess), this.ttl(sess));
      cb && cb(null);
    } catch (e) { cb && cb(e); }
  }

  touch(sid, sess, cb) {
    try {
      db.get().prepare('UPDATE sessions SET expires = ? WHERE sid = ?').run(this.ttl(sess), sid);
      cb && cb(null);
    } catch (e) { cb && cb(e); }
  }

  destroy(sid, cb) {
    try {
      db.get().prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      cb && cb(null);
    } catch (e) { cb && cb(e); }
  }

  prune() {
    try { db.get().prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now()); } catch { /* db closed */ }
  }
}

module.exports = SqliteStore;
