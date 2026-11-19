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
const settings = require('./services/settings');
const twilioRoutes = require('./routes/twilio');
const retellRoutes = require('./routes/retell');
const api = require('./routes/api');

assertProductionConfig();

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Security headers for every response.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; " +
      "media-src 'self' https: blob: mediastream:; connect-src 'self' https://api.retellai.com wss://api.retellai.com https://*.retellai.com wss://*.retellai.com https://*.livekit.cloud wss://*.livekit.cloud; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'"
  );
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
app.use(cookieParser());

app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});

app.use('/twilio', twilioRoutes.router);
app.use('/retell', retellRoutes.router);
app.use('/api', api.router);

// Google OAuth callback. The state is a short-lived signed token naming the business and the user who started it.
app.get('/oauth/google/callback', async (req, res) => {
  try {
    const st = jwt.verify(String(req.query.state || ''), config.jwtSecret);
    if (st.p !== 'google') throw new Error('Invalid state');
    const user = await db.one('SELECT role, tenant_id FROM users WHERE id=$1', [st.uid]);
    if (!user || (user.role === 'client' && user.tenant_id !== st.tid)) throw new Error('Not allowed');
    if (req.query.error) throw new Error(String(req.query.error));
    const tokens = await booking.googleExchangeCode(String(req.query.code || ''));
    if (!tokens.refresh_token) throw new Error('Google did not return a refresh token. Remove the app under myaccount.google.com/permissions and connect again.');
    await db.query("UPDATE tenants SET google_tokens_enc=$2, booking_provider='google', updated_at=now() WHERE id=$1", [st.tid, encrypt(JSON.stringify(tokens))]);
    await db.logEvent(st.tid, null, 'google_connected', { by: st.uid });
    res.redirect(`/#/businesses/${st.tid}?google=connected`);
  } catch (e) {
    console.error('[oauth/google]', e.message);
    res.redirect('/#/?google_error=' + encodeURIComponent(e.message.slice(0, 200)));
  }
});

// Inter font served locally (no third-party requests from the dashboard).
app.use('/fonts', express.static(path.join(__dirname, '..', 'node_modules', '@fontsource-variable', 'inter', 'files'), { maxAge: '30d', immutable: true }));
app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html', maxAge: '5m' }));

app.use((err, req, res, next) => {
  console.error('[error]', req.method, req.originalUrl, err.message);
  if (res.headersSent) return;
  res.status(err.status || 500).json({ error: err.status && err.status < 500 ? err.message : 'Something went wrong. Please try again.' });
});

async function seedAdminFromEnv() {
  if (!config.adminEmail || !config.adminPassword) return;
  if (await db.one('SELECT 1 FROM users WHERE lower(email)=lower($1)', [config.adminEmail])) return;
  await db.query(`INSERT INTO users (email, name, password_hash, role) VALUES ($1,'Admin',$2,'admin')`, [config.adminEmail.toLowerCase(), await bcrypt.hash(config.adminPassword, 12)]);
  console.log('[seed] admin user created from ADMIN_EMAIL');
}

// Safety net: AI calls that ended >10 min ago with no Retell analysis and no text-back -> text the caller.
async function sweepStaleCalls() {
  try {
    const stale = await db.many(
      `SELECT * FROM calls WHERE path='ai' AND analysis IS NULL AND textback_sent=FALSE
         AND ended_at IS NOT NULL AND ended_at < now() - interval '10 minutes' AND ended_at > now() - interval '24 hours'
         AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.id=calls.lead_id AND l.status IN ('booked','won','spam')) LIMIT 20`
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
  await settings.load();
  await seedAdminFromEnv();
  const code = await api.prepareSetupCode();
  if (code) {
    const line = '='.repeat(64);
    console.log(`\n${line}\n  FIRST-TIME SETUP\n  Open ${config.publicBaseUrl} and enter this setup code:  ${code}\n${line}\n`);
  }
  setInterval(sweepStaleCalls, 60_000).unref();
  return new Promise((resolve) => {
    const server = app.listen(config.port, () => {
      console.log(`Missed Call Agent listening on :${config.port} (${config.publicBaseUrl})`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  start().catch((e) => {
    console.error('Startup failed:', e.message);
    process.exit(1);
  });
}

module.exports = { app, start, sweepStaleCalls };
