'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const env = process.env;
const isProd = env.NODE_ENV === 'production';

if (isProd && (!env.SESSION_SECRET || env.SESSION_SECRET === 'change-me' || env.SESSION_SECRET.length < 32)) {
  throw new Error('SESSION_SECRET must be set to a long random value (32+ chars) in production.');
}

module.exports = {
  isProd,
  port: Number(env.PORT) || 3000,
  baseUrl: (env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  sessionSecret: env.SESSION_SECRET || 'dev-only-secret-change-me',
  trustProxy: env.TRUST_PROXY === '1',
  dbFile: path.resolve(__dirname, '..', env.DB_FILE || 'data/app.db'),
  business: {
    name: env.BUSINESS_NAME || 'Lancaster Pet Movers',
    email: env.BUSINESS_EMAIL || 'info@lancasterpetmovers.com',
    phone: env.BUSINESS_PHONE || '',
    address: env.BUSINESS_ADDRESS || 'Lancaster, PA',
    notifyEmail: env.NOTIFY_EMAIL || env.BUSINESS_EMAIL || 'info@lancasterpetmovers.com',
  },
  smtp: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT) || 587,
    secure: env.SMTP_SECURE === 'true',
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.MAIL_FROM || `${env.BUSINESS_NAME || 'Lancaster Pet Movers'} <${env.BUSINESS_EMAIL || 'info@lancasterpetmovers.com'}>`,
  },
  // Tawk.to live chat property (Dashboard > Administration > Chat Widget). Set TAWK_PROPERTY to override, or TAWK_PROPERTY=off to hide the chat.
  tawkProperty: (() => {
    const t = env.TAWK_PROPERTY ? env.TAWK_PROPERTY : '6b000f4e09b9513c8f6ff222/1k7s3njkc';
    return /^[A-Za-z0-9]+\/[A-Za-z0-9]+$/.test(t) ? t : '';
  })(),
  outboxDir: path.resolve(__dirname, '..', env.OUTBOX_DIR || 'data/outbox'),
};
