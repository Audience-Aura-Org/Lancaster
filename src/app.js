'use strict';
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const config = require('./config');
const db = require('./db');
const SqliteStore = require('./session-store');
const { csrf, flash } = require('./security');
const domain = require('./domain');
const tpl = require('./emails/templates');

function createApp() {
  db.open();
  require('./admin-bootstrap').ensureAdmin(); // ADMIN_EMAIL / ADMIN_PASSWORD -> working owner login
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  // Live chat (Tawk.to) is only allowed through the CSP when it is configured.
  const chat = config.tawkProperty ? ['https://*.tawk.to', 'https://embed.tawk.to', 'wss://*.tawk.to'] : [];
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", ...chat.filter((u) => u.startsWith('https'))],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', ...chat.filter((u) => u.startsWith('https'))],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:', ...chat.filter((u) => u.startsWith('https'))],
        imgSrc: ["'self'", 'data:', ...chat.filter((u) => u.startsWith('https'))],
        connectSrc: ["'self'", ...chat],
        frameSrc: ["'self'", ...chat.filter((u) => u.startsWith('https'))],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.isProd && config.baseUrl.startsWith('https:') ? [] : null,
      },
    },
    hsts: config.isProd && config.baseUrl.startsWith('https:'),
  }));

  const publicDir = path.join(__dirname, '..', 'public');
  const staticOpts = { maxAge: config.isProd ? '7d' : 0, index: false };
  app.use('/static', express.static(publicDir, staticOpts)); // admin assets
  app.use(express.static(publicDir, staticOpts)); // theme assets: /css, /js, /images, /webfonts, /vendor
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

  app.use(session({
    name: 'lpm.sid',
    store: new SqliteStore(),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: config.isProd ? 'auto' : false, maxAge: 8 * 60 * 60 * 1000 },
  }));

  // Only start a session (and set a cookie) on pages that need a form token.
  app.use((req, res, next) => {
    res.locals.business = config.business;
    res.locals.baseUrl = config.baseUrl;
    res.locals.path = req.path;
    res.locals.domain = domain;
    res.locals.fmtDate = tpl.fmtDate;
    res.locals.money = tpl.money;
    res.locals.year = new Date().getFullYear();
    res.locals.title = '';
    res.locals.description = '';
    res.locals.admin = null;
    res.locals.tawkProperty = config.tawkProperty;
    next();
  });
  app.use(flash);
  app.use(csrf);

  app.get('/health', (req, res) => {
    try { db.get().prepare('SELECT 1').get(); res.json({ ok: true }); } catch { res.status(500).json({ ok: false }); }
  });

  app.use('/admin', require('./routes/admin'));
  app.use('/', require('./routes/public'));

  app.use((req, res) => {
    res.status(404).render('pages/message', { title: 'Page not found', heading: 'Page not found', status: 404, message: 'We could not find that page.' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    const message = status >= 500 ? 'Something went wrong on our side. Please try again.' : err.message;
    if (res.headersSent) return;
    if (req.originalUrl.startsWith('/admin') && res.locals.admin) return res.status(status).render('admin/error', { title: 'Error', status, message });
    if (req.xhr) return res.status(status).type('text/plain').send(message);
    res.status(status).render('pages/message', { title: 'Error', heading: status === 403 ? 'Please try again' : 'Something went wrong', status, message, back: '/' });
  });

  return app;
}

module.exports = { createApp };
