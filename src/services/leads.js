'use strict';
const db = require('../db');
const { config } = require('../config');
const { sendSms } = require('./twilio');

const URGENCY_RANK = { routine: 1, urgent: 2, emergency: 3 };

// Create or update the lead for (tenant, phone). Only fills fields that are provided.
async function upsertLead(tenantId, phone, fields = {}) {
  const existing = await db.one('SELECT * FROM leads WHERE tenant_id=$1 AND phone=$2', [tenantId, phone]);
  if (!existing) {
    return db.one(
      `INSERT INTO leads (tenant_id, phone, name, email, address, issue, urgency, source, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,'new')) RETURNING *`,
      [tenantId, phone, fields.name || null, fields.email || null, fields.address || null, fields.issue || null, fields.urgency || null, fields.source || 'voice', fields.status || null]
    );
  }
  const next = { ...existing };
  for (const k of ['name', 'email', 'address', 'issue']) if (fields[k]) next[k] = fields[k];
  if (fields.urgency && (URGENCY_RANK[fields.urgency] || 0) >= (URGENCY_RANK[existing.urgency] || 0)) next.urgency = fields.urgency;
  // Status only moves "forward" automatically; booked/won/lost/spam are kept unless explicitly set.
  if (fields.status && (existing.status === 'new' || existing.status === 'contacted' || fields.forceStatus)) next.status = fields.status;
  if (fields.appointment_start) next.appointment_start = fields.appointment_start;
  if (fields.appointment_ref) next.appointment_ref = fields.appointment_ref;
  return db.one(
    `UPDATE leads SET name=$2, email=$3, address=$4, issue=$5, urgency=$6, status=$7, appointment_start=$8, appointment_ref=$9, last_activity_at=now()
     WHERE id=$1 RETURNING *`,
    [existing.id, next.name, next.email, next.address, next.issue, next.urgency, next.status, next.appointment_start, next.appointment_ref]
  );
}

async function isOptedOut(tenantId, phone) {
  return !!(await db.one('SELECT 1 FROM opt_outs WHERE tenant_id=$1 AND phone=$2', [tenantId, phone]));
}

async function recordMessage({ tenantId, leadId, direction, author, body, sid, status }) {
  await db.query(
    `INSERT INTO messages (tenant_id, lead_id, direction, author, body, twilio_sid, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (twilio_sid) DO NOTHING`,
    [tenantId, leadId, direction, author, body, sid || null, status || null]
  );
  if (leadId) await db.query('UPDATE leads SET last_activity_at=now() WHERE id=$1', [leadId]);
}

// Send an SMS to a lead (caller). Honors opt-outs and the tenant's SMS switch.
async function textLead(tenant, lead, body, author = 'system') {
  if (!tenant.sms_enabled) return { skipped: 'sms_disabled' };
  if (await isOptedOut(tenant.id, lead.phone)) return { skipped: 'opted_out' };
  const msg = await sendSms({
    from: tenant.twilio_number,
    to: lead.phone,
    body,
    messagingServiceSid: tenant.messaging_service_sid,
    statusCallback: `${config.publicBaseUrl}/twilio/sms/status`,
  });
  await recordMessage({ tenantId: tenant.id, leadId: lead.id, direction: 'out', author, body, sid: msg.sid, status: msg.status });
  return { sid: msg.sid };
}

function textbackBody(tenant) {
  const linkPart = tenant.booking_link ? ` or book here: ${tenant.booking_link}` : '';
  return String(tenant.textback_template || '')
    .replace(/\{business\}/g, tenant.name)
    .replace(/\{link_part\}/g, linkPart)
    .replace(/\{link\}/g, tenant.booking_link || '');
}

// The "missed call text-back". Sent once per call.
async function sendTextback(tenant, lead, callId) {
  if (callId) {
    const claimed = await db.one('UPDATE calls SET textback_sent=TRUE WHERE id=$1 AND textback_sent=FALSE RETURNING id', [callId]);
    if (!claimed) return { skipped: 'already_sent' };
  }
  // Avoid spamming a repeat caller: one automatic text-back per lead per 12h.
  const recent = await db.one(
    `SELECT 1 FROM messages WHERE lead_id=$1 AND direction='out' AND author='system' AND created_at > now() - interval '12 hours'`,
    [lead.id]
  );
  if (recent) return { skipped: 'recent_textback' };
  const r = await textLead(tenant, lead, textbackBody(tenant), 'system');
  if (r.sid) {
    await upsertLead(tenant.id, lead.phone, { status: 'contacted' });
    await db.logEvent(tenant.id, lead.id, 'textback_sent', { callId });
  }
  return r;
}

module.exports = { upsertLead, isOptedOut, recordMessage, textLead, sendTextback, textbackBody };
