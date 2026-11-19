'use strict';
// Creates or updates the shared Retell voice agent (one LLM + one agent serve every business).
const crypto = require('crypto');
const { config } = require('../config');
const { getClient } = require('./retell');
const { TOOL_SCHEMAS } = require('./actions');
const { VOICE_PROMPT, VOICE_BEGIN_MESSAGE, POST_CALL_ANALYSIS } = require('../agent/prompt');

const VOICE_TOOLS = {
  check_availability: 'Let me check the schedule.',
  book_appointment: 'One moment while I book that.',
  save_lead_details: '',
  send_booking_link: 'Sending that text now.',
  escalate_emergency: "I'm alerting our on-call technician right now.",
};

function toolList() {
  const base = config.publicBaseUrl;
  const headers = config.retell.toolSecret ? { 'x-tool-secret': config.retell.toolSecret } : undefined;
  const list = Object.entries(VOICE_TOOLS).map(([name, during]) => ({
    type: 'custom',
    name,
    description: TOOL_SCHEMAS[name].description,
    url: `${base}/retell/tools/${name}`,
    method: 'POST',
    parameters: TOOL_SCHEMAS[name].parameters,
    speak_during_execution: !!during,
    ...(during ? { execution_message_description: during } : {}),
    speak_after_execution: true,
    args_at_root: false,
    timeout_ms: 15000,
    ...(headers ? { headers } : {}),
  }));
  list.push({ type: 'end_call', name: 'end_call', description: 'End the call after saying goodbye, or for spam/robocalls.' });
  return list;
}

const DEFAULT_VARS = {
  business_name: 'our office',
  agent_name: 'Ava',
  industry: 'HVAC',
  services: 'heating and cooling service',
  service_area: 'not specified',
  business_hours: 'Mon-Fri 8am-5pm',
  timezone: 'America/New_York',
  current_time: 'unknown',
  today_iso: '',
  open_status: 'unknown',
  booking_mode: 'Take details and promise a callback.',
  pricing_notes: 'Do not quote prices.',
  emergency_policy: 'Gas smell or CO alarm: tell them to leave and call 911.',
  caller_number_pretty: 'unknown',
  known_caller: 'nothing yet (new caller)',
  extra_instructions: '',
};

// Returns { llmId, agentId, created: boolean }. Pass existing IDs to update in place.
async function provisionRetell({ llmId, agentId } = {}) {
  if (config.dryRun) {
    return { llmId: llmId || 'llm_dry', agentId: agentId || 'agent_dry', created: !agentId };
  }
  const retell = getClient();
  const llmBody = {
    model_config: { type: 'cascading', primary: { model: config.retell.model }, temperature: 0.2 },
    start_speaker: 'agent',
    begin_message: VOICE_BEGIN_MESSAGE,
    general_prompt: VOICE_PROMPT,
    general_tools: toolList(),
    default_dynamic_variables: DEFAULT_VARS,
  };
  let created = false;
  if (llmId) {
    try {
      await retell.llm.update(llmId, llmBody);
    } catch (e) {
      if (e.status !== 404) throw e;
      llmId = null; // deleted in Retell: recreate
    }
  }
  if (!llmId) {
    llmId = (await retell.llm.create(llmBody)).llm_id;
    created = true;
  }
  const agentBody = {
    agent_name: `${config.agencyName} Missed Call Agent`,
    response_engine: { type: 'retell-llm', llm_id: llmId },
    voice_id: config.retell.voiceId,
    language: 'en-US',
    webhook_url: `${config.publicBaseUrl}/retell/webhook`,
    post_call_analysis_data: POST_CALL_ANALYSIS,
    post_call_analysis_model: 'gpt-4.1-mini',
    end_call_after_silence_ms: 30000,
    max_call_duration_ms: 900000,
    interruption_sensitivity: 0.8,
    enable_backchannel: true,
    data_storage_setting: 'everything',
  };
  if (agentId) {
    try {
      await retell.agent.update(agentId, agentBody);
    } catch (e) {
      if (e.status !== 404) throw e;
      agentId = null;
    }
  }
  if (!agentId) {
    agentId = (await retell.agent.create(agentBody)).agent_id;
    created = true;
  }
  return { llmId, agentId, created };
}

function newToolSecret() {
  return crypto.randomBytes(24).toString('base64url');
}

module.exports = { provisionRetell, newToolSecret };
