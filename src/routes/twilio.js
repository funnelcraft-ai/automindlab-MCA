'use strict';
const express = require('express');
const db = require('../db');
const { config } = require('../config');
const { toE164 } = require('../lib/util');
const { VoiceResponse, MessagingResponse, validateTwilio } = require('../services/twilio');
const retell = require('../services/retell');
const leads = require('../services/leads');
const { notifyOwner } = require('../services/notify');
const { dynamicVariables } = require('../agent/prompt');
const { replyToLead } = require('../agent/sms-agent');

const router = express.Router();
router.use(express.urlencoded({ extended: false }));
router.use(validateTwilio);

const base = () => config.publicBaseUrl;

function sendTwiml(res, vr) {
  res.type('text/xml').send(vr.toString());
}

async function tenantByNumber(num) {
  const n = toE164(num);
  if (!n) return null;
  return db.one('SELECT * FROM tenants WHERE twilio_number=$1 AND active=TRUE', [n]);
}

// Caller ID can be blocked/anonymous; only real E.164 numbers become leads.
function callerPhone(from) {
  return toE164(from);
}

// Hand the live call to the Retell voice agent over SIP.
async function connectAi(tenant, call, req) {
  const vr = new VoiceResponse();
  const phone = callerPhone(call.from_number);
  try {
    const lead = phone ? await db.one('SELECT * FROM leads WHERE tenant_id=$1 AND phone=$2', [tenant.id, phone]) : null;
    const reg = await retell.registerPhoneCall({
      agentId: config.retell.agentId,
      from: call.from_number,
      to: call.to_number,
      metadata: { tenant_id: String(tenant.id), call_row_id: String(call.id), twilio_call_sid: call.twilio_call_sid },
      dynamicVariables: dynamicVariables(tenant, phone || call.from_number, lead),
      voiceId: tenant.voice_id || undefined,
    });
    await db.query("UPDATE calls SET path='ai', retell_call_id=$2 WHERE id=$1", [call.id, reg.call_id]);
    const dial = vr.dial({ action: `${base()}/twilio/voice/ai-done`, method: 'POST', answerOnBridge: true });
    dial.sip(retell.sipUri(reg.call_id));
  } catch (e) {
    console.error('[voice] retell connect failed', e.message);
    await db.query("UPDATE calls SET path='ai_failed' WHERE id=$1", [call.id]);
    vr.say({ voice: 'Polly.Joanna' }, `Sorry we missed your call at ${tenant.name}. We'll text you right away to help.`);
    vr.hangup();
    handleUnreachedCaller(tenant, call, 'ai_failed').catch((err) => console.error('[voice] fallback failed', err.message));
  }
  return vr;
}

// Caller never got a real conversation: text them back and tell the owner.
async function handleUnreachedCaller(tenant, call, reason) {
  const phone = callerPhone(call.from_number);
  if (!phone) return;
  const lead = await leads.upsertLead(tenant.id, phone, { source: 'voice' });
  await db.query('UPDATE calls SET lead_id=$2 WHERE id=$1', [call.id, lead.id]);
  await leads.sendTextback(tenant, lead, call.id);
  await notifyOwner(tenant, lead, 'abandoned', { summary: reason === 'ai_failed' ? 'AI agent unavailable - caller was texted.' : 'Caller hung up before talking - they were texted.' });
}

// ---------- Voice ----------
router.post('/voice', async (req, res) => {
  const { CallSid, From, To } = req.body;
  const tenant = await tenantByNumber(To);
  const vr = new VoiceResponse();
  if (!tenant) {
    vr.say('Sorry, this number is not in service.');
    vr.hangup();
    return sendTwiml(res, vr);
  }
  const inserted = await db.one(
    `INSERT INTO calls (tenant_id, twilio_call_sid, from_number, to_number) VALUES ($1,$2,$3,$4)
     ON CONFLICT (twilio_call_sid) DO NOTHING RETURNING *`,
    [tenant.id, CallSid, From, To]
  );
  const call = inserted || (await db.one('SELECT * FROM calls WHERE twilio_call_sid=$1', [CallSid]));
  // Twilio can retry the webhook; reuse the existing Retell registration instead of creating a second one.
  if (!inserted && call.retell_call_id) {
    const dial = vr.dial({ action: `${base()}/twilio/voice/ai-done`, method: 'POST', answerOnBridge: true });
    dial.sip(retell.sipUri(call.retell_call_id));
    return sendTwiml(res, vr);
  }
  await db.logEvent(tenant.id, null, 'call_received', { CallSid, From, mode: tenant.mode });

  const ringNumber = toE164(tenant.ring_number);
  if (tenant.mode === 'ring_first' && ringNumber) {
    const dial = vr.dial({
      timeout: tenant.ring_timeout_sec || 18,
      action: `${base()}/twilio/voice/after-ring`,
      method: 'POST',
      callerId: From && toE164(From) ? From : To,
      answerOnBridge: true,
    });
    dial.number(ringNumber);
    return sendTwiml(res, vr);
  }
  return sendTwiml(res, await connectAi(tenant, call, req));
});

// ring_first: the team's phone rang out (or was busy) -> AI takes over.
router.post('/voice/after-ring', async (req, res) => {
  const { CallSid, DialCallStatus, CallStatus } = req.body;
  const call = await db.one('SELECT * FROM calls WHERE twilio_call_sid=$1', [CallSid]);
  const vr = new VoiceResponse();
  if (!call) {
    vr.hangup();
    return sendTwiml(res, vr);
  }
  if (DialCallStatus === 'completed') {
    await db.query("UPDATE calls SET path='answered' WHERE id=$1", [call.id]);
    vr.hangup();
    return sendTwiml(res, vr);
  }
  if (CallStatus === 'completed' || CallStatus === 'canceled') {
    // Caller already hung up while it was ringing; the status callback sends the text-back.
    vr.hangup();
    return sendTwiml(res, vr);
  }
  const tenant = await db.one('SELECT * FROM tenants WHERE id=$1', [call.tenant_id]);
  return sendTwiml(res, await connectAi(tenant, call, req));
});

router.post('/voice/ai-done', (req, res) => {
  const vr = new VoiceResponse();
  vr.hangup();
  sendTwiml(res, vr);
});

router.post('/voice/transfer-done', async (req, res) => {
  const vr = new VoiceResponse();
  if (req.body.DialCallStatus !== 'completed') {
    vr.say({ voice: 'Polly.Joanna' }, "Sorry, our technician couldn't pick up just now. They've been alerted and will call you right back.");
  }
  vr.hangup();
  sendTwiml(res, vr);
});

// Number-level status callback (final call status).
router.post('/voice/status', async (req, res) => {
  res.status(204).end();
  try {
    const { CallSid, CallStatus, CallDuration } = req.body;
    if (!['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(CallStatus)) return;
    const call = await db.one(
      'UPDATE calls SET ended_at=COALESCE(ended_at, now()), duration_sec=COALESCE(duration_sec,$2) WHERE twilio_call_sid=$1 RETURNING *',
      [CallSid, Number(CallDuration) || 0]
    );
    if (!call) return;
    const tenant = await db.one('SELECT * FROM tenants WHERE id=$1', [call.tenant_id]);
    // Hung up while ringing the team, or before the AI leg connected.
    if (call.path === 'ringing' || (call.path === 'ai' && (Number(CallDuration) || 0) <= 3)) {
      await db.query("UPDATE calls SET path='abandoned', outcome='hung_up_early' WHERE id=$1", [call.id]);
      await handleUnreachedCaller(tenant, call, 'abandoned');
    }
  } catch (e) {
    console.error('[voice/status]', e);
  }
});

// ---------- SMS ----------
const OPT_OUT = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'optout', 'revoke']);
const OPT_IN = new Set(['start', 'unstop', 'yes']);
const HELP = new Set(['help', 'info']);
const leadLocks = new Map(); // serialize AI replies per lead (single instance)

async function withLeadLock(leadId, fn) {
  const prev = leadLocks.get(leadId) || Promise.resolve();
  const next = prev.then(fn, fn).finally(() => {
    if (leadLocks.get(leadId) === next) leadLocks.delete(leadId);
  });
  leadLocks.set(leadId, next);
  return next;
}

async function handleInboundSms(tenant, phone, body, sid) {
  const keyword = body.trim().toLowerCase().replace(/[^a-z]/g, '');
  const lead = await leads.upsertLead(tenant.id, phone, { source: 'sms' });
  await leads.recordMessage({ tenantId: tenant.id, leadId: lead.id, direction: 'in', author: 'caller', body, sid });

  // Twilio's default opt-out handling sends the STOP/START/HELP confirmations; we mirror the state.
  if (OPT_OUT.has(keyword)) {
    await db.query('INSERT INTO opt_outs (tenant_id, phone) VALUES ($1,$2) ON CONFLICT DO NOTHING', [tenant.id, phone]);
    await db.logEvent(tenant.id, lead.id, 'opted_out', {});
    return;
  }
  if (OPT_IN.has(keyword)) {
    await db.query('DELETE FROM opt_outs WHERE tenant_id=$1 AND phone=$2', [tenant.id, phone]);
    return;
  }
  if (HELP.has(keyword)) return;
  if (await leads.isOptedOut(tenant.id, phone)) return;

  // First inbound text in 24h -> tell the owner the lead engaged.
  const inCount = await db.one(
    `SELECT count(*)::int AS n FROM messages WHERE lead_id=$1 AND direction='in' AND created_at > now() - interval '24 hours'`,
    [lead.id]
  );
  if (inCount.n === 1 || lead.human_takeover || !tenant.sms_ai_enabled) {
    notifyOwner(tenant, { ...lead, issue: lead.issue || body }, 'sms', { summary: `Text: "${body.slice(0, 200)}"` }).catch(() => {});
  }
  if (lead.human_takeover || !tenant.sms_ai_enabled) return;

  const aiToday = await db.one(
    `SELECT count(*)::int AS n FROM messages WHERE lead_id=$1 AND author='ai' AND created_at > now() - interval '24 hours'`,
    [lead.id]
  );
  if (aiToday.n >= config.llm.maxAiRepliesPerDay) return;

  await withLeadLock(lead.id, async () => {
    const fresh = await db.one('SELECT * FROM leads WHERE id=$1', [lead.id]);
    const reply = await replyToLead(tenant, fresh);
    if (reply) await leads.textLead(tenant, fresh, reply, 'ai');
  });
}

router.post('/sms', async (req, res) => {
  sendTwiml(res, new MessagingResponse()); // reply asynchronously so Twilio never times out
  try {
    const { From, To, Body, MessageSid } = req.body;
    const tenant = await tenantByNumber(To);
    const phone = toE164(From);
    if (!tenant || !phone) return;
    await handleInboundSms(tenant, phone, String(Body || ''), MessageSid);
  } catch (e) {
    console.error('[sms]', e);
  }
});

router.post('/sms/status', async (req, res) => {
  res.status(204).end();
  try {
    const { MessageSid, MessageStatus, ErrorCode, To } = req.body;
    const m = await db.one('UPDATE messages SET status=$2 WHERE twilio_sid=$1 RETURNING tenant_id', [MessageSid, MessageStatus]);
    // 21610 = recipient has replied STOP
    if (m && String(ErrorCode) === '21610' && toE164(To)) {
      await db.query('INSERT INTO opt_outs (tenant_id, phone) VALUES ($1,$2) ON CONFLICT DO NOTHING', [m.tenant_id, toE164(To)]);
    }
  } catch (e) {
    console.error('[sms/status]', e);
  }
});

module.exports = { router, handleUnreachedCaller, handleInboundSms };
