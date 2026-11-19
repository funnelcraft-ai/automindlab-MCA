#!/usr/bin/env node
'use strict';
// Creates (or updates) the shared Retell LLM + voice agent used by every client business.
// Usage: node scripts/setup-retell.js           -> create new, prints RETELL_LLM_ID / RETELL_AGENT_ID
//        RETELL_LLM_ID=... RETELL_AGENT_ID=... node scripts/setup-retell.js   -> update existing in place
const { config } = require('../src/config');
const { getClient } = require('../src/services/retell');
const { TOOL_SCHEMAS } = require('../src/services/actions');
const { VOICE_PROMPT, VOICE_BEGIN_MESSAGE, POST_CALL_ANALYSIS } = require('../src/agent/prompt');

const VOICE_TOOLS = {
  check_availability: { during: 'Let me check the schedule.' },
  book_appointment: { during: 'One moment while I book that.' },
  save_lead_details: { during: '' },
  send_booking_link: { during: 'Sending that text now.' },
  escalate_emergency: { during: "I'm alerting our on-call technician right now." },
};

function tools() {
  const base = config.publicBaseUrl;
  const headers = config.retell.toolSecret ? { 'x-tool-secret': config.retell.toolSecret } : undefined;
  const list = Object.entries(VOICE_TOOLS).map(([name, o]) => ({
    type: 'custom',
    name,
    description: TOOL_SCHEMAS[name].description,
    url: `${base}/retell/tools/${name}`,
    method: 'POST',
    parameters: TOOL_SCHEMAS[name].parameters,
    speak_during_execution: !!o.during,
    ...(o.during ? { execution_message_description: o.during } : {}),
    speak_after_execution: true,
    args_at_root: false,
    timeout_ms: 15000,
    ...(headers ? { headers } : {}),
  }));
  list.push({ type: 'end_call', name: 'end_call', description: 'End the call after saying goodbye, or for spam/robocalls.' });
  return list;
}

async function main() {
  if (!config.publicBaseUrl.startsWith('https://')) {
    console.warn('WARNING: PUBLIC_BASE_URL is not https. Retell must reach your tool URLs over the public internet.');
  }
  const retell = getClient();
  const llmBody = {
    model_config: { type: 'cascading', primary: { model: config.retell.model }, temperature: 0.2 },
    start_speaker: 'agent',
    begin_message: VOICE_BEGIN_MESSAGE,
    general_prompt: VOICE_PROMPT,
    general_tools: tools(),
    default_dynamic_variables: {
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
    },
  };

  let llmId = config.retell.llmId;
  if (llmId) {
    await retell.llm.update(llmId, llmBody);
    console.log('Updated Retell LLM', llmId);
  } else {
    const llm = await retell.llm.create(llmBody);
    llmId = llm.llm_id;
    console.log('Created Retell LLM', llmId);
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

  let agentId = config.retell.agentId;
  if (agentId) {
    await retell.agent.update(agentId, agentBody);
    console.log('Updated Retell agent', agentId);
  } else {
    const agent = await retell.agent.create(agentBody);
    agentId = agent.agent_id;
    console.log('Created Retell agent', agentId);
  }
  console.log(`\nAdd these to your environment:\nRETELL_LLM_ID=${llmId}\nRETELL_AGENT_ID=${agentId}\n`);
}

main().catch((e) => {
  console.error('Retell setup failed:', e.status || '', e.message);
  if (e.error) console.error(JSON.stringify(e.error, null, 2));
  process.exit(1);
});
