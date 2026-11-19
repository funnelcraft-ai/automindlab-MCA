'use strict';
// Booking providers: google (Calendar API via OAuth), calcom (Cal.com API v2 compatible), link (send booking page), none.
const { DateTime } = require('luxon');
const db = require('../db');
const { config } = require('../config');
const { encrypt, decrypt } = require('../lib/util');
const { candidateSlots, removeBusy } = require('../lib/time');

class BookingError extends Error {}

// ---------------- Google Calendar ----------------
const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly'];

function googleAuthUrl(state) {
  const p = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: `${config.publicBaseUrl}/oauth/google/callback`,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: GOOGLE_SCOPES.join(' '),
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

async function googleExchangeCode(code) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: `${config.publicBaseUrl}/oauth/google/callback`,
      grant_type: 'authorization_code',
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new BookingError('Google token exchange failed: ' + (j.error_description || j.error));
  return { refresh_token: j.refresh_token, access_token: j.access_token, expires_at: Date.now() + j.expires_in * 1000 };
}

async function googleAccessToken(tenant) {
  const tokens = tenant.google_tokens_enc ? JSON.parse(decrypt(tenant.google_tokens_enc)) : null;
  if (!tokens || !tokens.refresh_token) throw new BookingError('Google Calendar is not connected');
  if (tokens.access_token && tokens.expires_at > Date.now() + 60_000) return tokens.access_token;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new BookingError('Google token refresh failed: ' + (j.error_description || j.error));
  const next = { ...tokens, access_token: j.access_token, expires_at: Date.now() + j.expires_in * 1000 };
  await db.query('UPDATE tenants SET google_tokens_enc=$2 WHERE id=$1', [tenant.id, encrypt(JSON.stringify(next))]);
  tenant.google_tokens_enc = encrypt(JSON.stringify(next));
  return next.access_token;
}

async function googleFetch(tenant, path, opts = {}) {
  const token = await googleAccessToken(tenant);
  const r = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new BookingError(`Google Calendar error ${r.status}: ${j.error?.message || ''}`);
  return j;
}

const google = {
  async availability(tenant, { date, days }) {
    const slots = candidateSlots(tenant, { fromISO: date, days });
    if (!slots.length) return [];
    const calId = tenant.google_calendar_id || 'primary';
    const fb = await googleFetch(tenant, '/freeBusy', {
      method: 'POST',
      body: JSON.stringify({
        timeMin: slots[0].start.toUTC().toISO(),
        timeMax: slots[slots.length - 1].end.toUTC().toISO(),
        items: [{ id: calId }],
      }),
    });
    const busy = fb.calendars?.[calId]?.busy || [];
    return removeBusy(slots, busy);
  },
  async book(tenant, { start, end, lead, notes }) {
    const calId = encodeURIComponent(tenant.google_calendar_id || 'primary');
    const ev = await googleFetch(tenant, `/calendars/${calId}/events`, {
      method: 'POST',
      body: JSON.stringify({
        summary: `${tenant.industry} visit: ${lead.name || lead.phone}${lead.urgency === 'emergency' ? ' (EMERGENCY)' : ''}`,
        location: lead.address || undefined,
        description: [`Phone: ${lead.phone}`, lead.issue ? `Issue: ${lead.issue}` : '', notes || '', 'Booked by AI missed-call agent'].filter(Boolean).join('\n'),
        start: { dateTime: start.toISO(), timeZone: tenant.timezone },
        end: { dateTime: end.toISO(), timeZone: tenant.timezone },
      }),
    });
    return { ref: ev.id, link: ev.htmlLink };
  },
};

// ---------------- Cal.com API v2 (and Cal.com-compatible hosts) ----------------
async function calFetch(tenant, path, { method = 'GET', body, version } = {}) {
  const key = decrypt(tenant.calcom_api_key_enc);
  if (!key || !tenant.calcom_event_type_id) throw new BookingError('Cal.com API key / event type not configured');
  const base = (tenant.calcom_base_url || 'https://api.cal.com').replace(/\/$/, '');
  const r = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'cal-api-version': version, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new BookingError(`Cal.com error ${r.status}: ${j.error?.message || j.message || ''}`);
  return j;
}

const calcom = {
  async availability(tenant, { date, days }) {
    const tz = tenant.timezone;
    const from = date ? DateTime.fromISO(date, { zone: tz }) : DateTime.now().setZone(tz);
    const to = from.plus({ days: Math.max(1, Math.min(days || 3, 14)) });
    const q = new URLSearchParams({
      eventTypeId: String(tenant.calcom_event_type_id),
      start: from.toISODate(),
      end: to.toISODate(),
      timeZone: tz,
    });
    const j = await calFetch(tenant, `/v2/slots?${q}`, { version: '2024-09-04' });
    const earliest = DateTime.now().plus({ minutes: tenant.min_lead_minutes || 0 });
    const out = [];
    for (const list of Object.values(j.data || {})) {
      for (const s of list) {
        const start = DateTime.fromISO(s.start, { zone: tz });
        if (start >= earliest) out.push({ start, end: start.plus({ minutes: tenant.slot_minutes || 60 }) });
      }
    }
    return out.sort((a, b) => a.start - b.start);
  },
  async book(tenant, { start, lead, notes }) {
    const email = lead.email || `lead+${lead.phone.replace(/\D/g, '')}@${config.noEmailDomain}`;
    const j = await calFetch(tenant, '/v2/bookings', {
      method: 'POST',
      version: '2024-08-13',
      body: {
        start: start.toUTC().toISO(),
        eventTypeId: Number(tenant.calcom_event_type_id),
        attendee: { name: lead.name || 'Caller', email, timeZone: tenant.timezone, phoneNumber: lead.phone },
        bookingFieldsResponses: { notes: [lead.issue, lead.address, notes].filter(Boolean).join(' | ') },
        metadata: { source: 'missed-call-agent', phone: lead.phone },
      },
    });
    return { ref: j.data?.uid || String(j.data?.id || '') };
  },
};

const PROVIDERS = { google, calcom };

function canBookDirectly(tenant) {
  return tenant.booking_provider === 'google' || tenant.booking_provider === 'calcom';
}

async function getAvailability(tenant, { date, days } = {}) {
  const p = PROVIDERS[tenant.booking_provider];
  if (!p) throw new BookingError('Direct booking not enabled');
  return p.availability(tenant, { date, days });
}

async function bookSlot(tenant, { startISO, lead, notes }) {
  const p = PROVIDERS[tenant.booking_provider];
  if (!p) throw new BookingError('Direct booking not enabled');
  const start = DateTime.fromISO(startISO, { setZone: true }).setZone(tenant.timezone);
  if (!start.isValid) throw new BookingError('Invalid start time');
  // Re-check availability around the requested day so we never double-book.
  const open = await p.availability(tenant, { date: start.toISODate(), days: 1 });
  const match = open.find((s) => Math.abs(s.start.toMillis() - start.toMillis()) < 60_000);
  if (!match) throw new BookingError('That time is no longer available');
  const res = await p.book(tenant, { start: match.start, end: match.end, lead, notes });
  return { ...res, start: match.start, end: match.end };
}

module.exports = { BookingError, canBookDirectly, getAvailability, bookSlot, googleAuthUrl, googleExchangeCode };
