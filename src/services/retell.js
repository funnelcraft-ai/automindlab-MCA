'use strict';
const RetellSdk = require('retell-sdk');
const { config } = require('../config');

const Retell = RetellSdk.default || RetellSdk.Retell;
let client = null;
let clientKey = '';
function getClient() {
  if (!client || clientKey !== config.retell.apiKey) {
    if (!config.retell.apiKey) throw new Error('Retell is not connected yet (add your key under Integrations)');
    client = new Retell({ apiKey: config.retell.apiKey });
    clientKey = config.retell.apiKey;
  }
  return client;
}

async function verifySignature(rawBody, signature) {
  if (!config.retell.verifySignatures) return true;
  if (typeof signature !== 'string' || !signature) return false;
  try {
    return await RetellSdk.verify(rawBody, config.retell.apiKey, signature);
  } catch (e) {
    console.warn('[retell] verify error', e.message);
    return false;
  }
}

// Express middleware for JSON routes that were parsed with express.raw()
function retellAuth() {
  return async (req, res, next) => {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body || {});
    const ok = await verifySignature(raw, req.header('x-retell-signature'));
    if (!ok) {
      // Optional fallback: shared secret header for tool calls (set in Retell tool headers)
      const secret = req.header('x-tool-secret');
      if (!(config.retell.toolSecret && secret && secret === config.retell.toolSecret)) {
        return res.status(401).json({ error: 'unauthorized' });
      }
    }
    try {
      req.body = raw ? JSON.parse(raw) : {};
    } catch {
      return res.status(400).json({ error: 'bad json' });
    }
    next();
  };
}

async function registerPhoneCall({ agentId, from, to, metadata, dynamicVariables, voiceId }) {
  const params = {
    agent_id: agentId,
    agent_version: config.retell.agentVersion,
    from_number: from,
    to_number: to,
    direction: 'inbound',
    metadata,
    retell_llm_dynamic_variables: dynamicVariables,
  };
  if (voiceId) params.agent_override = { agent: { voice_id: voiceId } };
  if (config.dryRun) {
    console.log('[dry-run retell register]', JSON.stringify(params).slice(0, 300));
    return { call_id: 'call_dry_' + Date.now() };
  }
  return getClient().call.registerPhoneCall(params);
}

// Browser call (no phone line needed). The API key stays on the server; the browser only gets a short-lived token.
async function createWebCall({ agentId, metadata, dynamicVariables, voiceId }) {
  const params = { agent_id: agentId, agent_version: config.retell.agentVersion, metadata, retell_llm_dynamic_variables: dynamicVariables };
  if (voiceId) params.agent_override = { agent: { voice_id: voiceId } };
  if (config.dryRun) return { call_id: 'web_dry_' + Date.now(), access_token: 'dry-token', transport: 'gateway', ice_servers: [] };
  return getClient().call.createWebCall(params);
}

function sipUri(callId) {
  return `sip:${callId}@${config.retell.sipDomain}`;
}

module.exports = { getClient, verifySignature, retellAuth, registerPhoneCall, createWebCall, sipUri };
