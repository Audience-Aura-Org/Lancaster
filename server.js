'use strict';
const config = require('./src/config');
const { createApp } = require('./src/app');
const db = require('./src/db');

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`${config.business.name} running at http://localhost:${config.port}`);
  if (!config.smtp.host) console.log('SMTP not configured: emails are saved to data/outbox/ instead of being sent.');
  const admins = db.get().prepare('SELECT COUNT(*) AS n FROM admins').get().n;
  if (!admins) console.log('No admin account yet. Create one with: npm run create-admin -- --email you@example.com --name "Your Name"');
});

function shutdown() {
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
