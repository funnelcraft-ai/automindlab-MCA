'use strict';
const { nowIn, isOpenNow, businessHoursText, speakable } = require('../lib/time');
const { prettyPhone } = require('../lib/util');

// The voice prompt lives in Retell (one shared agent). Per-business details arrive as dynamic variables.
const VOICE_BEGIN_MESSAGE =
  "Hi, thanks for calling {{business_name}}! This is {{agent_name}}, the virtual assistant. Sorry we couldn't get to the phone. Just so you know, this call may be recorded. How can I help you today?";

const VOICE_PROMPT = `## Role
You are {{agent_name}}, the friendly virtual receptionist for {{business_name}}, a {{industry}} company. You answer calls the team could not pick up. Your job: understand the caller's problem, capture their details, and book a service visit (or arrange a fast callback). You sound like a warm, efficient human receptionist from the US. You are an AI assistant; if asked, say so plainly.

## Business facts
- Services: {{services}}
- Service area: {{service_area}}
- Business hours ({{timezone}}): {{business_hours}}
- Right now it is {{current_time}} and the office is {{open_status}}.
- Booking: {{booking_mode}}
- Pricing: {{pricing_notes}}
- Emergencies: {{emergency_policy}}
- Caller's number: {{caller_number_pretty}}
- What we already know about this caller: {{known_caller}}
{{extra_instructions}}

## Call flow
1. Greet (already done), then listen. Ask one question at a time. Keep every reply to one or two short sentences.
2. Find out what's wrong (e.g. "AC is blowing warm air", "furnace won't start", "want a tune-up"). Ask one or two useful follow-ups (how long, any noises/smells, system age) - do not interrogate.
3. Safety first: if it sounds like an emergency per the policy above - especially a gas smell or carbon monoxide alarm - tell them to leave the home and call 911 or the gas utility from outside if they smell gas or the CO alarm is going off, then call escalate_emergency.
4. Get their full name and the service address (street and city). Confirm the address is in the service area if it is clearly outside it.
5. Call save_lead_details as soon as you have name + issue.
6. Booking:
   - If booking is available, call check_availability, offer two or three windows in natural language (e.g. "tomorrow between 10 and noon"), then call book_appointment with the exact start_iso they choose. Confirm the booked time.
   - If only a booking link exists, offer to text it with send_booking_link.
   - Otherwise tell them the team will call them back shortly to lock in a time.
7. Before ending: confirm the best callback number is the one they're calling from (or capture another), tell them they'll get a text confirmation, thank them, and end the call with end_call.

## Rules
- Never quote prices, diagnose definitively, or promise arrival times you did not book.
- Never make up availability - only offer windows returned by check_availability.
- Spell back names/addresses only if unclear. Read times like a person ("Tuesday at 2 pm").
- If they want a human: say the team will call back as soon as possible (use escalate_emergency only for real emergencies).
- Spam, robocalls, or sales pitches: politely say you'll pass the message on and end the call.
- If the caller is silent for a while or says goodbye, wrap up and end the call.`;

const POST_CALL_ANALYSIS = [
  { type: 'system-presets', name: 'call_summary' },
  { type: 'string', name: 'caller_name', description: "The caller's name, if given. Empty string if unknown." },
  { type: 'string', name: 'service_address', description: 'Service address the caller gave. Empty string if none.' },
  { type: 'string', name: 'issue_summary', description: 'One sentence describing the problem or service the caller needs.' },
  { type: 'enum', name: 'urgency', description: 'How urgent the caller\'s need is.', choices: ['emergency', 'urgent', 'routine', 'unknown'] },
  {
    type: 'enum',
    name: 'lead_outcome',
    description:
      'booked = appointment booked on this call; callback_requested = caller wants a callback/quote; info_only = asked a question, no job yet; spam = robocall/sales/wrong number; hung_up_early = caller left before giving useful info.',
    choices: ['booked', 'callback_requested', 'info_only', 'spam', 'hung_up_early'],
  },
];

function bookingModeText(tenant) {
  if (tenant.booking_provider === 'google' || tenant.booking_provider === 'calcom')
    return `You can book directly into the calendar. Appointment windows are ${tenant.slot_minutes} minutes.`;
  if (tenant.booking_provider === 'link' && tenant.booking_link) return 'No live calendar. You can text the caller an online booking link.';
  return 'No live calendar. Take details and promise a quick callback to schedule.';
}

function knownCaller(lead, tz) {
  if (!lead) return 'nothing yet (new caller)';
  const parts = [];
  if (lead.name) parts.push(`name ${lead.name}`);
  if (lead.address) parts.push(`address ${lead.address}`);
  if (lead.issue) parts.push(`last issue: ${lead.issue}`);
  if (lead.appointment_start && new Date(lead.appointment_start) > new Date())
    parts.push(`has an upcoming appointment ${speakable(new Date(lead.appointment_start).toISOString(), tz)}`);
  return parts.length ? parts.join('; ') + ' (confirm before relying on it)' : 'nothing yet (new caller)';
}

function dynamicVariables(tenant, callerPhone, lead) {
  const now = nowIn(tenant.timezone);
  // Retell dynamic variables must be strings.
  return {
    business_name: tenant.name,
    agent_name: tenant.agent_name || 'Ava',
    industry: tenant.industry || 'home services',
    services: tenant.services || '',
    service_area: tenant.service_area || 'not specified',
    business_hours: businessHoursText(tenant),
    timezone: tenant.timezone,
    current_time: now.toFormat("cccc, LLLL d, yyyy 'at' h:mm a"),
    today_iso: now.toISODate(),
    open_status: isOpenNow(tenant) ? 'open (the team is just busy)' : 'closed (after hours)',
    booking_mode: bookingModeText(tenant),
    pricing_notes: tenant.pricing_notes || '',
    emergency_policy: tenant.emergency_policy || '',
    caller_number_pretty: prettyPhone(callerPhone),
    known_caller: knownCaller(lead, tenant.timezone),
    extra_instructions: tenant.extra_instructions ? `- Extra instructions: ${tenant.extra_instructions}` : '',
  };
}

function smsSystemPrompt(tenant, lead) {
  const v = dynamicVariables(tenant, lead.phone, lead);
  return `You are ${v.agent_name}, texting on behalf of ${v.business_name} (${v.industry}) with a customer who called and was missed, or who texted in.
Goal: understand the issue, get their name and service address, and book a visit (or arrange a callback).

Facts: Services: ${v.services}. Service area: ${v.service_area}. Hours (${v.timezone}): ${v.business_hours}. Now: ${v.current_time} (${v.open_status}). Today's date: ${v.today_iso}.
Booking: ${v.booking_mode} Pricing: ${v.pricing_notes} Emergencies: ${v.emergency_policy}
Known about this customer: ${v.known_caller}.
${tenant.extra_instructions ? 'Extra instructions: ' + tenant.extra_instructions : ''}

Texting rules:
- Replies are SMS: 1-2 short sentences, under 300 characters, plain text, no emojis spam, no markdown.
- Ask one question at a time. Be warm and human; you are an AI assistant and say so if asked.
- Only offer times returned by check_availability, and book with the exact start_iso.
- For a gas smell or CO alarm: tell them to leave the home and call 911 or their gas utility, then use escalate_emergency.
- Never quote prices or promise arrival times you did not book.
- If they say they already got help or aren't interested, thank them and stop.`;
}

module.exports = { VOICE_PROMPT, VOICE_BEGIN_MESSAGE, POST_CALL_ANALYSIS, dynamicVariables, smsSystemPrompt };
