'use strict';
// AI SMS conversation using any OpenAI-compatible chat-completions endpoint with tool calling.
const db = require('../db');
const { config } = require('../config');
const actions = require('../services/actions');
const { smsSystemPrompt } = require('./prompt');

const SMS_TOOLS = ['check_availability', 'book_appointment', 'save_lead_details', 'send_booking_link', 'escalate_emergency'];

function toolDefs() {
  return SMS_TOOLS.map((name) => ({
    type: 'function',
    function: { name, description: actions.TOOL_SCHEMAS[name].description, parameters: actions.TOOL_SCHEMAS[name].parameters },
  }));
}

async function chat(messages) {
  if (config.dryRun && !config.llm.apiKey) {
    return { role: 'assistant', content: 'Thanks for reaching out! What seems to be the problem, and what is the service address?' };
  }
  const r = await fetch(`${config.llm.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.llm.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.llm.model, messages, tools: toolDefs(), temperature: 0.3 }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`LLM error ${r.status}: ${j.error?.message || JSON.stringify(j).slice(0, 200)}`);
  return j.choices[0].message;
}

async function runTool(tenant, lead, name, args) {
  switch (name) {
    case 'check_availability':
      return actions.checkAvailability(tenant, args);
    case 'book_appointment':
      return (await actions.bookAppointment(tenant, lead.phone, args, 'sms')).result;
    case 'save_lead_details':
      return (await actions.saveLeadDetails(tenant, lead.phone, args, 'sms')).result;
    case 'send_booking_link':
      return tenant.booking_link
        ? { link: tenant.booking_link, instructions: 'Include this link in your reply.' }
        : { instructions: 'No booking link configured; offer a callback.' };
    case 'escalate_emergency':
      return (await actions.escalateEmergency(tenant, null, lead.phone, args)).result;
    default:
      return { error: 'unknown tool' };
  }
}

// Returns the reply text to send, or null if the AI should stay quiet.
async function replyToLead(tenant, lead) {
  const history = await db.many(
    `SELECT direction, author, body FROM messages WHERE lead_id=$1 ORDER BY created_at DESC, id DESC LIMIT 20`,
    [lead.id]
  );
  const messages = [{ role: 'system', content: smsSystemPrompt(tenant, lead) }];
  for (const m of history.reverse()) {
    messages.push({ role: m.direction === 'in' ? 'user' : 'assistant', content: m.body });
  }
  for (let round = 0; round < 5; round++) {
    const msg = await chat(messages);
    if (!msg.tool_calls || !msg.tool_calls.length) {
      const text = String(msg.content || '').trim();
      return text ? text.slice(0, 480) : null;
    }
    messages.push(msg);
    for (const tc of msg.tool_calls) {
      let args = {};
      try {
        args = JSON.parse(tc.function.arguments || '{}');
      } catch {}
      let result;
      try {
        result = await runTool(tenant, lead, tc.function.name, args);
      } catch (e) {
        result = { error: e.message };
      }
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
    }
  }
  return null;
}

module.exports = { replyToLead };
