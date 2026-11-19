'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { config } = require('../config');
const { encrypt, toE164, slugify } = require('../lib/util');
const { configureNumber } = require('../services/twilio');
const leads = require('../services/leads');
const booking = require('../services/booking');

const router = express.Router();
router.use(express.json({ limit: '1mb' }));

const COOKIE = 'mca_token';
const cookieOpts = () => ({ httpOnly: true, sameSite: 'lax', secure: config.publicBaseUrl.startsWith('https'), maxAge: 14 * 864e5 });

// ---------- auth ----------
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  const user = await db.one('SELECT * FROM users WHERE lower(email)=lower($1)', [String(email || '')]);
  if (!user || !(await bcrypt.compare(String(password || ''), user.password_hash))) return res.status(401).json({ error: 'Invalid email or password' });
  const token = jwt.sign({ uid: user.id, role: user.role, tid: user.tenant_id }, config.jwtSecret, { expiresIn: '14d' });
  res.cookie(COOKIE, token, cookieOpts()).json({ ok: true });
});

router.post('/logout', (req, res) => res.clearCookie(COOKIE).json({ ok: true }));

function requireAuth(req, res, next) {
  try {
    req.user = jwt.verify(req.cookies[COOKIE] || '', config.jwtSecret);
    next();
  } catch {
    res.status(401).json({ error: 'Not signed in' });
  }
}
const requireAdmin = (req, res, next) => (req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admin only' }));

// Resolves which tenant a request may act on. Clients are locked to their own tenant.
function tenantScope(req, explicit) {
  if (req.user.role === 'client') return req.user.tid;
  const id = Number(explicit ?? req.query.tenant ?? req.params.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

router.use(requireAuth);

router.get('/me', async (req, res) => {
  const u = await db.one('SELECT id, email, name, role, tenant_id FROM users WHERE id=$1', [req.user.uid]);
  if (!u) return res.status(401).json({ error: 'User gone' });
  res.json({ user: u, agencyName: config.agencyName });
});

// ---------- tenants ----------
const PUBLIC_TENANT_COLS = `id, name, slug, industry, timezone, active, twilio_number, mode, ring_number, ring_timeout_sec, transfer_number,
  messaging_service_sid, agent_name, voice_id, services, service_area, business_hours, emergency_policy, pricing_notes, extra_instructions,
  avg_job_value, booking_provider, booking_link, slot_minutes, min_lead_minutes, booking_days_ahead, google_calendar_id,
  (google_tokens_enc IS NOT NULL) AS google_connected, calcom_base_url, (calcom_api_key_enc IS NOT NULL) AS calcom_key_set,
  calcom_event_type_id, sms_enabled, sms_ai_enabled, textback_template, notify_phones, notify_emails, created_at`;

const CLIENT_EDITABLE = [
  'agent_name', 'services', 'service_area', 'business_hours', 'emergency_policy', 'pricing_notes', 'extra_instructions', 'avg_job_value',
  'booking_provider', 'booking_link', 'slot_minutes', 'min_lead_minutes', 'booking_days_ahead', 'google_calendar_id', 'calcom_base_url',
  'calcom_event_type_id', 'sms_ai_enabled', 'textback_template', 'notify_phones', 'notify_emails', 'ring_timeout_sec', 'transfer_number',
];
const ADMIN_EDITABLE = [...CLIENT_EDITABLE, 'name', 'industry', 'timezone', 'active', 'twilio_number', 'mode', 'ring_number', 'messaging_service_sid', 'voice_id', 'sms_enabled'];
const PHONE_FIELDS = ['twilio_number', 'ring_number', 'transfer_number'];

router.get('/tenants', async (req, res) => {
  const where = req.user.role === 'client' ? 'WHERE t.id=$1' : '';
  const params = req.user.role === 'client' ? [req.user.tid] : [];
  const rows = await db.many(
    `SELECT t.id, t.name, t.industry, t.twilio_number, t.active, t.mode, t.booking_provider,
       (SELECT count(*)::int FROM calls c WHERE c.tenant_id=t.id AND c.started_at > now()-interval '30 days') AS calls_30d,
       (SELECT count(*)::int FROM leads l WHERE l.tenant_id=t.id AND l.status IN ('booked','won') AND l.last_activity_at > now()-interval '30 days') AS booked_30d
     FROM tenants t ${where} ORDER BY t.name`,
    params
  );
  res.json(rows);
});

router.post('/tenants', requireAdmin, async (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name required' });
  const slug = slugify(b.slug || b.name) + '-' + Math.random().toString(36).slice(2, 6);
  const t = await db.one(
    `INSERT INTO tenants (name, slug, industry, timezone, twilio_number) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [b.name, slug, b.industry || 'HVAC', b.timezone || 'America/New_York', toE164(b.twilio_number)]
  );
  res.json(await db.one(`SELECT ${PUBLIC_TENANT_COLS} FROM tenants WHERE id=$1`, [t.id]));
});

router.get('/tenants/:id', async (req, res) => {
  const id = tenantScope(req);
  const t = await db.one(`SELECT ${PUBLIC_TENANT_COLS} FROM tenants WHERE id=$1`, [id]);
  if (!t) return res.status(404).json({ error: 'Not found' });
  t.webhooks = {
    voice: `${config.publicBaseUrl}/twilio/voice`,
    status: `${config.publicBaseUrl}/twilio/voice/status`,
    sms: `${config.publicBaseUrl}/twilio/sms`,
  };
  res.json(t);
});

router.put('/tenants/:id', async (req, res) => {
  const id = tenantScope(req);
  const allowed = req.user.role === 'admin' ? ADMIN_EDITABLE : CLIENT_EDITABLE;
  const b = req.body || {};
  const sets = [];
  const vals = [id];
  for (const k of allowed) {
    if (!(k in b)) continue;
    let v = b[k];
    if (PHONE_FIELDS.includes(k)) {
      v = v ? toE164(v) : null;
      if (b[k] && !v) return res.status(400).json({ error: `${k} must be a valid US phone number` });
    }
    if (k === 'business_hours' && typeof v === 'string') {
      try {
        v = JSON.parse(v);
      } catch {
        return res.status(400).json({ error: 'business_hours must be JSON' });
      }
    }
    vals.push(v);
    sets.push(`${k}=$${vals.length}`);
  }
  if ('calcom_api_key' in b && b.calcom_api_key) {
    vals.push(encrypt(b.calcom_api_key));
    sets.push(`calcom_api_key_enc=$${vals.length}`);
  }
  if (b.disconnect_google) sets.push('google_tokens_enc=NULL');
  if (!sets.length) return res.json(await db.one(`SELECT ${PUBLIC_TENANT_COLS} FROM tenants WHERE id=$1`, [id]));
  try {
    await db.query(`UPDATE tenants SET ${sets.join(', ')}, updated_at=now() WHERE id=$1`, vals);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'That Twilio number is already assigned to another business' });
    if (e.code === '23514') return res.status(400).json({ error: 'Invalid value for mode or booking provider' });
    throw e;
  }
  res.json(await db.one(`SELECT ${PUBLIC_TENANT_COLS} FROM tenants WHERE id=$1`, [id]));
});

router.post('/tenants/:id/configure-number', requireAdmin, async (req, res) => {
  const t = await db.one('SELECT twilio_number FROM tenants WHERE id=$1', [req.params.id]);
  if (!t?.twilio_number) return res.status(400).json({ error: 'Set the Twilio number first' });
  try {
    await configureNumber(t.twilio_number);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/tenants/:id/users', requireAdmin, async (req, res) => {
  res.json(await db.many('SELECT id, email, name, role, created_at FROM users WHERE tenant_id=$1 ORDER BY id', [req.params.id]));
});

router.post('/tenants/:id/users', requireAdmin, async (req, res) => {
  const { email, name, password } = req.body || {};
  if (!email || !password || password.length < 10) return res.status(400).json({ error: 'email and a 10+ character password required' });
  try {
    const u = await db.one(
      `INSERT INTO users (email, name, password_hash, role, tenant_id) VALUES ($1,$2,$3,'client',$4) RETURNING id, email, name, role`,
      [email.trim(), name || '', await bcrypt.hash(password, 11), req.params.id]
    );
    res.json(u);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Email already in use' });
    throw e;
  }
});

// Sales/demo helper: send this business's text-back to a phone (e.g. your own) as if it was a missed call.
router.post('/tenants/:id/test-textback', async (req, res) => {
  const id = tenantScope(req);
  const phone = toE164(req.body?.phone);
  if (!phone) return res.status(400).json({ error: 'Valid phone required' });
  const tenant = await db.one('SELECT * FROM tenants WHERE id=$1', [id]);
  if (!tenant?.twilio_number) return res.status(400).json({ error: 'Business has no Twilio number yet' });
  const lead = await leads.upsertLead(tenant.id, phone, { source: 'voice' });
  const r = await leads.textLead(tenant, lead, leads.textbackBody(tenant), 'system');
  res.json(r);
});

router.get('/tenants/:id/availability', async (req, res) => {
  const tenant = await db.one('SELECT * FROM tenants WHERE id=$1', [tenantScope(req)]);
  try {
    const slots = await booking.getAvailability(tenant, { days: 3 });
    res.json(slots.slice(0, 12).map((s) => ({ start: s.start.toISO(), end: s.end.toISO() })));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- stats ----------
router.get('/stats', async (req, res) => {
  const id = tenantScope(req);
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
  const tenantFilter = id ? 'AND c.tenant_id=$2' : '';
  const params = id ? [days, id] : [days];
  const c = await db.one(
    `SELECT count(*)::int AS calls,
       count(*) FILTER (WHERE path='answered')::int AS answered_by_team,
       count(*) FILTER (WHERE path='ai')::int AS ai_handled,
       count(*) FILTER (WHERE path IN ('abandoned','ai_failed'))::int AS hung_up,
       count(*) FILTER (WHERE textback_sent)::int AS textbacks,
       count(*) FILTER (WHERE outcome='spam')::int AS spam
     FROM calls c WHERE c.started_at > now() - ($1 || ' days')::interval ${tenantFilter}`,
    params
  );
  const l = await db.one(
    `SELECT count(*) FILTER (WHERE status <> 'spam')::int AS leads,
       count(*) FILTER (WHERE status IN ('booked','won'))::int AS booked,
       count(*) FILTER (WHERE urgency='emergency')::int AS emergencies,
       COALESCE(sum(t.avg_job_value) FILTER (WHERE status IN ('booked','won')),0)::int AS est_revenue
     FROM leads c JOIN tenants t ON t.id=c.tenant_id
     WHERE c.created_at > now() - ($1 || ' days')::interval ${tenantFilter}`,
    params
  );
  const daily = await db.many(
    `SELECT to_char(date_trunc('day', started_at), 'YYYY-MM-DD') AS day, count(*)::int AS calls,
       count(*) FILTER (WHERE path <> 'answered')::int AS missed
     FROM calls c WHERE c.started_at > now() - ($1 || ' days')::interval ${tenantFilter}
     GROUP BY 1 ORDER BY 1`,
    params
  );
  const missed = c.calls - c.answered_by_team;
  res.json({ ...c, ...l, missed, recovery_rate: missed ? Math.round((l.booked / missed) * 100) : 0, daily, days });
});

// ---------- leads ----------
router.get('/leads', async (req, res) => {
  const id = tenantScope(req);
  const params = [];
  const where = [];
  if (id) {
    params.push(id);
    where.push(`l.tenant_id=$${params.length}`);
  }
  if (req.query.status) {
    params.push(req.query.status);
    where.push(`l.status=$${params.length}`);
  }
  if (req.query.q) {
    params.push(`%${req.query.q}%`);
    where.push(`(l.name ILIKE $${params.length} OR l.phone ILIKE $${params.length} OR l.issue ILIKE $${params.length} OR l.address ILIKE $${params.length})`);
  }
  const rows = await db.many(
    `SELECT l.*, t.name AS tenant_name,
       (SELECT body FROM messages m WHERE m.lead_id=l.id ORDER BY created_at DESC LIMIT 1) AS last_message
     FROM leads l JOIN tenants t ON t.id=l.tenant_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY l.last_activity_at DESC LIMIT 300`,
    params
  );
  res.json(rows);
});

async function loadLeadScoped(req) {
  const lead = await db.one('SELECT l.*, t.name AS tenant_name, t.timezone FROM leads l JOIN tenants t ON t.id=l.tenant_id WHERE l.id=$1', [req.params.id]);
  if (!lead) return null;
  if (req.user.role === 'client' && lead.tenant_id !== req.user.tid) return null;
  return lead;
}

router.get('/leads/:id', async (req, res) => {
  const lead = await loadLeadScoped(req);
  if (!lead) return res.status(404).json({ error: 'Not found' });
  const [calls, messages, events, optedOut] = await Promise.all([
    db.many('SELECT * FROM calls WHERE tenant_id=$1 AND (lead_id=$2 OR from_number=$3) ORDER BY started_at DESC', [lead.tenant_id, lead.id, lead.phone]),
    db.many('SELECT * FROM messages WHERE lead_id=$1 ORDER BY created_at, id', [lead.id]),
    db.many('SELECT type, data, created_at FROM events WHERE lead_id=$1 ORDER BY created_at DESC LIMIT 50', [lead.id]),
    leads.isOptedOut(lead.tenant_id, lead.phone),
  ]);
  res.json({ lead, calls, messages, events, optedOut });
});

router.patch('/leads/:id', async (req, res) => {
  const lead = await loadLeadScoped(req);
  if (!lead) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const fields = ['status', 'notes', 'human_takeover', 'name', 'address', 'issue', 'email', 'urgency'];
  const sets = [];
  const vals = [lead.id];
  for (const k of fields) {
    if (k in b) {
      vals.push(b[k]);
      sets.push(`${k}=$${vals.length}`);
    }
  }
  if (!sets.length) return res.json(lead);
  try {
    const updated = await db.one(`UPDATE leads SET ${sets.join(', ')}, last_activity_at=now() WHERE id=$1 RETURNING *`, vals);
    await db.logEvent(lead.tenant_id, lead.id, 'lead_updated', { by: req.user.uid, fields: Object.keys(b) });
    res.json(updated);
  } catch (e) {
    if (e.code === '23514') return res.status(400).json({ error: 'Invalid status' });
    throw e;
  }
});

// A human replies from the dashboard; this also pauses the AI for this lead.
router.post('/leads/:id/sms', async (req, res) => {
  const lead = await loadLeadScoped(req);
  if (!lead) return res.status(404).json({ error: 'Not found' });
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Message required' });
  const tenant = await db.one('SELECT * FROM tenants WHERE id=$1', [lead.tenant_id]);
  try {
    const r = await leads.textLead(tenant, lead, body.slice(0, 1000), 'human');
    if (r.skipped) return res.status(400).json({ error: r.skipped === 'opted_out' ? 'This contact opted out of texts' : 'SMS is disabled for this business' });
    await db.query("UPDATE leads SET human_takeover=TRUE, status=CASE WHEN status='new' THEN 'contacted' ELSE status END WHERE id=$1", [lead.id]);
    res.json(r);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- calls ----------
router.get('/calls', async (req, res) => {
  const id = tenantScope(req);
  const rows = await db.many(
    `SELECT c.id, c.tenant_id, t.name AS tenant_name, c.lead_id, l.name AS lead_name, c.from_number, c.path, c.outcome,
       c.summary, c.duration_sec, c.textback_sent, c.started_at
     FROM calls c JOIN tenants t ON t.id=c.tenant_id LEFT JOIN leads l ON l.id=c.lead_id
     ${id ? 'WHERE c.tenant_id=$1' : ''} ORDER BY c.started_at DESC LIMIT 300`,
    id ? [id] : []
  );
  res.json(rows);
});

// ---------- Google Calendar connect ----------
router.get('/tenants/:id/google/connect', async (req, res) => {
  if (!config.google.clientId) return res.status(400).json({ error: 'GOOGLE_CLIENT_ID is not configured on the server' });
  const id = tenantScope(req);
  const state = jwt.sign({ tid: id, uid: req.user.uid }, config.jwtSecret, { expiresIn: '15m' });
  res.json({ url: booking.googleAuthUrl(state) });
});

module.exports = { router, requireAuth, COOKIE };
