'use strict';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function str(v, max = 500) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function email(v) {
  const s = str(v, 254).toLowerCase();
  return EMAIL_RE.test(s) ? s : '';
}

function num(v, { min = -Infinity, max = Infinity } = {}) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

function int(v, opts) {
  const n = num(v, opts);
  return n == null ? null : Math.trunc(n);
}

function date(v) {
  const s = str(v, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) ? null : s;
}

function oneOf(v, map) {
  const s = str(v, 50);
  return Object.prototype.hasOwnProperty.call(map, s) ? s : null;
}

module.exports = { str, email, num, int, date, oneOf };
