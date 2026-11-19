#!/usr/bin/env node
'use strict';
// Optional CLI alternative to the dashboard's "Create voice agent" button.
// Reads keys from env and/or the dashboard settings stored in the database, then creates/updates the agent.
const { config } = require('../src/config');
const settings = require('../src/services/settings');
const { provisionRetell } = require('../src/services/provision');

(async () => {
  await settings.load();
  if (!config.publicBaseUrl.startsWith('https://')) console.warn('WARNING: public URL is not https; Retell must reach it over the internet.');
  const r = await provisionRetell({ llmId: config.retell.llmId, agentId: config.retell.agentId });
  await settings.save({ retell_llm_id: r.llmId, retell_agent_id: r.agentId }, null, { internal: true });
  console.log(`${r.created ? 'Created' : 'Updated'} Retell agent ${r.agentId} (LLM ${r.llmId}). Saved to dashboard settings.`);
  process.exit(0);
})().catch((e) => {
  console.error('Retell setup failed:', e.status || '', e.message);
  process.exit(1);
});
