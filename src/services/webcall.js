'use strict';
// Starts a Retell web call (talk to the agent in the browser) and records it like a phone call,
// so tools, webhooks, leads, texts and alerts all behave exactly as on a real call.
const crypto = require('crypto');
const db = require('../db');
const { config } = require('../config');
const retell = require('./retell');
const { dynamicVariables } = require('../agent/prompt');

async function startWebCall(tenant, { phone, source }) {
  if (!config.retell.apiKey || !config.retell.agentId) {
    const e = new Error('The voice agent is not set up yet (Integrations > Retell).');
    e.status = 400;
    throw e;
  }
  const sid = 'WEB' + crypto.randomBytes(12).toString('hex');
  const call = await db.one(
    `INSERT INTO calls (tenant_id, twilio_call_sid, from_number, to_number, path, channel) VALUES ($1,$2,$3,$4,'ai','web') RETURNING *`,
    [tenant.id, sid, phone || null, tenant.twilio_number || null]
  );
  const lead = phone ? await db.one('SELECT * FROM leads WHERE tenant_id=$1 AND phone=$2', [tenant.id, phone]) : null;
  try {
    const r = await retell.createWebCall({
      agentId: config.retell.agentId,
      metadata: { tenant_id: String(tenant.id), call_row_id: String(call.id), channel: 'web', source },
      dynamicVariables: dynamicVariables(tenant, phone || null, lead),
      voiceId: tenant.voice_id || undefined,
    });
    await db.query('UPDATE calls SET retell_call_id=$2 WHERE id=$1', [call.id, r.call_id]);
    await db.logEvent(tenant.id, null, 'web_call_started', { source, callId: call.id });
    return { callId: r.call_id, accessToken: r.access_token, transport: r.transport || 'gateway', iceServers: r.ice_servers || [], expiresAt: r.expires_at };
  } catch (e) {
    await db.query("UPDATE calls SET path='ai_failed', ended_at=now() WHERE id=$1", [call.id]);
    const err = new Error(e.status === 402 ? 'Retell needs a payment method or more credit for live calls.' : `Retell said: ${e.message}`);
    err.status = 400;
    throw err;
  }
}

module.exports = { startWebCall };
