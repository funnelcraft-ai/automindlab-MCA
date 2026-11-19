'use strict';
// Business actions shared by the voice agent (Retell custom tools) and the SMS agent.
const db = require('../db');
const { DateTime } = require('luxon');
const { toE164, prettyPhone } = require('../lib/util');
const { slotsForAgent, speakable } = require('../lib/time');
const booking = require('./booking');
const leads = require('./leads');
const { notifyOwner } = require('./notify');
const { VoiceResponse, updateCallTwiml } = require('./twilio');
const { config } = require('../config');

function clean(s, n = 500) {
  return s === undefined || s === null ? undefined : String(s).trim().slice(0, n) || undefined;
}

async function checkAvailability(tenant, args) {
  if (!booking.canBookDirectly(tenant)) {
    return tenant.booking_link
      ? { available: false, instructions: 'Live calendar booking is not available. Offer to text the caller the booking link using send_booking_link, or take their details for a callback.' }
      : { available: false, instructions: 'Calendar booking is not available. Collect their details with save_lead_details and tell them the team will call back to schedule.' };
  }
  let date = clean(args.date, 20);
  if (date && !DateTime.fromISO(date).isValid) date = undefined;
  try {
    const slots = await booking.getAvailability(tenant, { date, days: Number(args.days) || 3 });
    if (!slots.length) return { available: false, instructions: 'No open windows in that range. Offer a different day, or take details for a callback.' };
    return {
      available: true,
      timezone: tenant.timezone,
      slots: slotsForAgent(slots, tenant.timezone, 6),
      instructions: 'Offer at most two or three of these windows conversationally. When the caller picks one, call book_appointment with its exact start_iso.',
    };
  } catch (e) {
    console.error('[actions] availability error', e.message);
    return { available: false, instructions: 'The calendar could not be reached. Take their details with save_lead_details and promise a quick callback to confirm a time.' };
  }
}

async function saveLeadDetails(tenant, phone, args, source) {
  const lead = await leads.upsertLead(tenant.id, phone, {
    name: clean(args.name, 120),
    email: clean(args.email, 200),
    address: clean(args.address, 300),
    issue: clean(args.issue, 600),
    urgency: ['emergency', 'urgent', 'routine'].includes(args.urgency) ? args.urgency : undefined,
    source,
  });
  await db.logEvent(tenant.id, lead.id, 'lead_details_saved', { source });
  return { lead, result: { saved: true } };
}

async function bookAppointment(tenant, phone, args, source) {
  const { lead } = await saveLeadDetails(tenant, phone, args, source);
  if (!booking.canBookDirectly(tenant)) return { lead, result: { booked: false, instructions: 'Direct booking is not enabled for this business.' } };
  if (!args.start_iso) return { lead, result: { booked: false, instructions: 'Call check_availability first and pass the chosen start_iso.' } };
  try {
    const b = await booking.bookSlot(tenant, { startISO: String(args.start_iso), lead, notes: clean(args.notes, 500) });
    const updated = await leads.upsertLead(tenant.id, phone, {
      status: 'booked',
      forceStatus: true,
      appointment_start: b.start.toUTC().toISO(),
      appointment_ref: b.ref,
    });
    await db.logEvent(tenant.id, updated.id, 'appointment_booked', { start: b.start.toISO(), ref: b.ref, source });
    const when = speakable(b.start, tenant.timezone);
    // Confirmation text to a voice caller (SMS conversations confirm in the AI's own reply) + owner alert.
    if (source === 'voice') {
      leads
        .textLead(tenant, updated, `You're booked with ${tenant.name} for ${when}${updated.address ? ` at ${updated.address}` : ''}. Reply here if anything changes. Reply STOP to opt out.`, 'system')
        .catch((e) => console.error('[actions] confirm sms', e.message));
    }
    notifyOwner(tenant, updated, 'booked').catch((e) => console.error('[actions] notify', e.message));
    return { lead: updated, result: { booked: true, confirmed_time: when, instructions: 'Confirm the time back to the caller and tell them a text confirmation is on its way.' } };
  } catch (e) {
    const msg = e instanceof booking.BookingError ? e.message : 'calendar error';
    console.error('[actions] booking failed', e.message);
    return { lead, result: { booked: false, reason: msg, instructions: 'Apologize, then offer another window from check_availability, or take details for a callback.' } };
  }
}

async function sendBookingLink(tenant, phone) {
  if (!tenant.booking_link) return { result: { sent: false, instructions: 'No booking link is configured. Take details for a callback instead.' } };
  const lead = await leads.upsertLead(tenant.id, phone, {});
  const r = await leads.textLead(tenant, lead, `Here's the link to pick a time with ${tenant.name}: ${tenant.booking_link}\nReply STOP to opt out.`, 'system');
  return { lead, result: r.sid ? { sent: true } : { sent: false, reason: r.skipped } };
}

// Voice only: flag an emergency to the owner and, if a transfer number exists, move the live call to it.
async function escalateEmergency(tenant, call, phone, args) {
  const { lead } = await saveLeadDetails(tenant, phone, { ...args, urgency: 'emergency' }, 'voice');
  if (call?.id) await db.query('UPDATE calls SET lead_id=$2 WHERE id=$1 AND lead_id IS NULL', [call.id, lead.id]);
  await notifyOwner(tenant, lead, 'emergency', { summary: clean(args.issue, 300) });
  await db.logEvent(tenant.id, lead.id, 'emergency_escalated', { callSid: call?.twilio_call_sid });
  const target = toE164(tenant.transfer_number);
  if (!target || !call?.twilio_call_sid || !call.twilio_call_sid.startsWith('CA')) {
    return { result: { transferred: false, instructions: 'The on-call technician has been alerted by text and will call back shortly. Give any safety advice from your instructions, then wrap up.' } };
  }
  const vr = new VoiceResponse();
  vr.say({ voice: 'Polly.Joanna' }, 'Connecting you to our on-call technician now.');
  const dial = vr.dial({ timeout: 25, callerId: call.from_number, action: `${config.publicBaseUrl}/twilio/voice/transfer-done` });
  dial.number(target);
  // Give the agent ~2s to finish its sentence before the SIP leg is replaced.
  setTimeout(() => {
    updateCallTwiml(call.twilio_call_sid, vr.toString())
      .then(() => db.query("UPDATE calls SET outcome='transferred' WHERE id=$1", [call.id]))
      .catch((e) => console.error('[actions] transfer failed', e.message));
  }, 2000);
  return { result: { transferred: true, instructions: `Say: "I'm connecting you to our on-call technician right now, please hold." Then stop talking.` } };
}

// ---- Tool schemas (JSON Schema), shared by Retell and SMS LLM ----
const TOOL_SCHEMAS = {
  check_availability: {
    description: 'Get open appointment windows. Use before offering times.',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'First day to search, YYYY-MM-DD in the business time zone. Omit for the soonest openings.' },
        days: { type: 'number', description: 'How many open days to search (1-7). Default 3.' },
      },
    },
  },
  book_appointment: {
    description: 'Book a service visit in an open window from check_availability. Collect name, service address and the issue first.',
    parameters: {
      type: 'object',
      properties: {
        start_iso: { type: 'string', description: 'Exact start_iso of the chosen slot from check_availability.' },
        name: { type: 'string', description: "Caller's full name." },
        address: { type: 'string', description: 'Service address including city.' },
        issue: { type: 'string', description: 'Short description of the problem or service needed.' },
        urgency: { type: 'string', enum: ['emergency', 'urgent', 'routine'] },
        email: { type: 'string', description: 'Email if the caller offered it.' },
        notes: { type: 'string', description: 'Access notes, gate codes, pets, system age/brand.' },
        callback_number: { type: 'string', description: 'Only if the caller gives a different callback number than the one they are calling from.' },
      },
      required: ['start_iso', 'name', 'address', 'issue'],
    },
  },
  save_lead_details: {
    description: 'Save what the caller told you (call this as soon as you have their name and issue, and again if you learn more).',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        address: { type: 'string' },
        issue: { type: 'string' },
        urgency: { type: 'string', enum: ['emergency', 'urgent', 'routine'] },
        email: { type: 'string' },
        callback_number: { type: 'string', description: 'Only if different from the number they are calling from.' },
      },
    },
  },
  send_booking_link: {
    description: "Text the caller the business's online booking link.",
    parameters: { type: 'object', properties: {} },
  },
  escalate_emergency: {
    description: 'Use for emergencies (gas smell, CO alarm, no heat in freezing weather, flooding, etc.). Alerts the on-call tech and may transfer the call live.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        address: { type: 'string' },
        issue: { type: 'string', description: 'What is happening.' },
      },
      required: ['issue'],
    },
  },
};

module.exports = { checkAvailability, saveLeadDetails, bookAppointment, sendBookingLink, escalateEmergency, TOOL_SCHEMAS, prettyPhone };
