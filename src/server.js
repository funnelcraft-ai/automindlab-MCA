'use strict';
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { config, assertProductionConfig } = require('./config');
const db = require('./db');
const { encrypt } = require('./lib/util');
const booking = require('./services/booking');
const twilioRoutes = require('./routes/twilio');
const retellRoutes = require('./routes/retell');
const api = require('./routes/api');

assertProductionConfig();

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(cookieParser());

app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.use('/twilio', twilioRoutes.router);
app.use('/retell', retellRoutes.router);
app.use('/api', api.router);

// Google OAuth callback (state is a short-lived signed token naming the tenant)
app.get('/oauth/google/callback', async (req, res) => {
  try {
    const { tid } = jwt.verify(String(req.query.state || ''), config.jwtSecret);
    if (req.query.error) throw new Error(String(req.query.error));
    const tokens = await booking.googleExchangeCode(String(req.query.code || ''));
    if (!tokens.refresh_token) throw new Error('Google did not return a refresh token. Remove the app from your Google account permissions and try again.');
    await db.query("UPDATE tenants SET google_tokens_enc=$2, booking_provider='google', updated_at=now() WHERE id=$1", [tid, encrypt(JSON.stringify(tokens))]);
    res.redirect('/#/settings?google=connected');
  } catch (e) {
    console.error('[oauth/google]', e.message);
    res.redirect('/#/settings?google_error=' + encodeURIComponent(e.message));
  }
});

app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html', maxAge: '1h' }));

app.use((err, req, res, next) => {
  console.error('[error]', req.method, req.originalUrl, err);
  res.status(500).json({ error: 'Internal error' });
});

async function seedAdmin() {
  if (!config.adminEmail || !config.adminPassword) return;
  const exists = await db.one('SELECT 1 FROM users WHERE lower(email)=lower($1)', [config.adminEmail]);
  if (exists) return;
  await db.query(`INSERT INTO users (email, name, password_hash, role) VALUES ($1,'Admin',$2,'admin')`, [
    config.adminEmail,
    await bcrypt.hash(config.adminPassword, 11),
  ]);
  console.log('[seed] admin user created:', config.adminEmail);
}

// Safety net: AI calls that ended >10 min ago with no Retell analysis and no text-back -> text the caller.
async function sweepStaleCalls() {
  try {
    const stale = await db.many(
      `SELECT * FROM calls WHERE path='ai' AND analysis IS NULL AND textback_sent=FALSE
         AND ended_at IS NOT NULL AND ended_at < now() - interval '10 minutes' AND ended_at > now() - interval '24 hours' LIMIT 20`
    );
    for (const call of stale) {
      const tenant = await db.one('SELECT * FROM tenants WHERE id=$1', [call.tenant_id]);
      await db.query("UPDATE calls SET path='ai_failed' WHERE id=$1", [call.id]);
      await twilioRoutes.handleUnreachedCaller(tenant, call, 'ai_failed');
    }
  } catch (e) {
    console.error('[sweeper]', e.message);
  }
}

async function start() {
  await db.migrate();
  await seedAdmin();
  setInterval(sweepStaleCalls, 60_000).unref();
  app.listen(config.port, () => console.log(`Missed Call Agent listening on :${config.port} (${config.publicBaseUrl})`));
}

if (require.main === module) {
  start().catch((e) => {
    console.error('Startup failed:', e);
    process.exit(1);
  });
}

module.exports = { app, start, sweepStaleCalls };
