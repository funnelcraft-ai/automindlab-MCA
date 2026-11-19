'use strict';
const express = require('express');
const db = require('../db');
const { config } = require('../config');
const { toE164 } = require('../lib/util');
const { retellAuth } = require('../services/retell');
const leads = require('../services/leads');
const actions = require('../services/actions');
const { notifyOwner } = require('../services/notify');

const router = express.Router();
router.use(express.raw({ type: '*/*', limit: '2mb' }), retellAuth());

async function callByRetellId(retellCall) {
  if (!retellCall) return null;
  let row = retellCall.call_id ? await db.one('SELECT * FROM calls WHERE retell_call_id=$1', [retellCall.call_id]) : null;
  if (!row && retellCall.metadata?.call_row_id) row = await db.one('SELECT * FROM calls WHERE id=$1', [Number(retellCall.metadata.call_row_id)]);
  return row;
}

function followupBody(tenant, lead) {
  const link = tenant.booking_link ? ` You can also grab a time here: ${tenant.booking_link}.` : '';
  return `Thanks for calling ${tenant.name}${lead.name ? ', ' + lead.name.split(' ')[0] : ''}! We have your details and the team will reach out shortly.${link} Reply here anytime. Reply STOP to opt out.`;
}

async function onCallAnalyzed(call, c) {
  const tenant = await db.one('SELECT * FROM tenants WHERE id=$1', [call.tenant_id]);
  const analysis = c.call_analysis || {};
  const data = analysis.custom_analysis_data || {};
  const outcome = data.lead_outcome || null;
  const urgency = ['emergency', 'urgent', 'routine'].includes(data.urgency) ? data.urgency : undefined;
  const durationSec = c.duration_ms ? Math.round(c.duration_ms / 1000) : call.duration_sec || 0;

  await db.query('UPDATE calls SET analysis=$2, summary=$3, outcome=COALESCE(outcome,$4) WHERE id=$1', [
    call.id,
    analysis,
    analysis.call_summary || null,
    outcome,
  ]);

  const phone = toE164(call.from_number);
  if (!phone) return; // anonymous caller: nothing to text
  const lead = await leads.upsertLead(tenant.id, phone, {
    name: data.caller_name || undefined,
    address: data.service_address || undefined,
    issue: data.issue_summary || undefined,
    urgency,
    status: outcome === 'spam' ? 'spam' : undefined,
    source: 'voice',
  });
  await db.query('UPDATE calls SET lead_id=$2 WHERE id=$1', [call.id, lead.id]);
  await db.logEvent(tenant.id, lead.id, 'call_analyzed', { outcome, urgency, callId: call.id });

  if (outcome === 'spam' || call.outcome === 'transferred') return;
  if (lead.status === 'booked' && outcome === 'booked') return; // book_appointment already confirmed + notified

  const earlyHangup = outcome === 'hung_up_early' || durationSec < config.shortCallSeconds;
  if (earlyHangup) {
    await leads.sendTextback(tenant, lead, call.id);
    await notifyOwner(tenant, lead, 'abandoned', { summary: analysis.call_summary });
    return;
  }
  // Real conversation, not booked: follow-up text + owner alert with the summary.
  const claimed = await db.one('UPDATE calls SET textback_sent=TRUE WHERE id=$1 AND textback_sent=FALSE RETURNING id', [call.id]);
  if (claimed) {
    const sent = await leads.textLead(tenant, lead, followupBody(tenant, lead), 'system');
    if (sent.sid) await leads.upsertLead(tenant.id, lead.phone, { status: 'contacted' });
  }
  const escalated = await db.one(
    `SELECT 1 FROM events WHERE lead_id=$1 AND type='emergency_escalated' AND created_at > now() - interval '30 minutes'`,
    [lead.id]
  );
  if (!escalated) await notifyOwner(tenant, lead, urgency === 'emergency' ? 'emergency' : 'lead', { summary: analysis.call_summary });
}

router.post('/webhook', async (req, res) => {
  res.status(204).end(); // Retell times out after 10s; do the work after acknowledging
  const { event, call: c } = req.body || {};
  try {
    const call = await callByRetellId(c);
    if (!call) return console.warn('[retell] webhook for unknown call', c?.call_id, event);
    if (event === 'call_started') {
      await db.query("UPDATE calls SET path='ai' WHERE id=$1 AND path IN ('ringing','ai')", [call.id]);
    } else if (event === 'call_ended') {
      await db.query(
        `UPDATE calls SET transcript=$2, recording_url=$3, disconnection_reason=$4,
           duration_sec=COALESCE($5, duration_sec), ended_at=COALESCE(ended_at, now()) WHERE id=$1`,
        [call.id, c.transcript || null, c.recording_url || null, c.disconnection_reason || null, c.duration_ms ? Math.round(c.duration_ms / 1000) : null]
      );
      // Registered but never connected (caller hung up first) -> text-back now; no analysis will follow.
      if (['registered_call_timeout', 'dial_failed', 'dial_no_answer'].includes(c.disconnection_reason)) {
        const { handleUnreachedCaller } = require('./twilio');
        const tenant = await db.one('SELECT * FROM tenants WHERE id=$1', [call.tenant_id]);
        await db.query("UPDATE calls SET path='abandoned', outcome='hung_up_early' WHERE id=$1", [call.id]);
        await handleUnreachedCaller(tenant, call, 'abandoned');
      }
    } else if (event === 'call_analyzed') {
      await onCallAnalyzed(call, c);
    }
  } catch (e) {
    console.error('[retell/webhook]', event, e);
  }
});

// Custom tools invoked by the voice agent mid-call.
router.post('/tools/:name', async (req, res) => {
  const name = req.params.name;
  const body = req.body || {};
  const args = body.args || body; // supports args_at_root
  try {
    const call = await callByRetellId(body.call);
    if (!call) return res.json({ error: 'call not found', instructions: 'Continue the conversation and take their details.' });
    const tenant = await db.one('SELECT * FROM tenants WHERE id=$1', [call.tenant_id]);
    const phone = toE164(args.callback_number) || toE164(call.from_number);
    if (!phone && name !== 'check_availability') {
      return res.json({ error: 'no caller number', instructions: "Ask for the best callback number, then try again with callback_number." });
    }
    let out;
    switch (name) {
      case 'check_availability':
        out = await actions.checkAvailability(tenant, args);
        break;
      case 'book_appointment':
        out = (await actions.bookAppointment(tenant, phone, args, 'voice')).result;
        break;
      case 'save_lead_details': {
        const r = await actions.saveLeadDetails(tenant, phone, args, 'voice');
        await db.query('UPDATE calls SET lead_id=$2 WHERE id=$1', [call.id, r.lead.id]);
        out = r.result;
        break;
      }
      case 'send_booking_link':
        out = (await actions.sendBookingLink(tenant, phone)).result;
        break;
      case 'escalate_emergency':
        out = (await actions.escalateEmergency(tenant, call, phone, args)).result;
        break;
      default:
        return res.status(404).json({ error: 'unknown tool' });
    }
    res.json(out);
  } catch (e) {
    console.error('[retell/tools]', name, e);
    res.json({ error: 'internal error', instructions: 'Apologize briefly, take their details, and promise a callback.' });
  }
});

module.exports = { router, onCallAnalyzed };
