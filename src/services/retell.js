'use strict';
const RetellSdk = require('retell-sdk');
const { config } = require('../config');

const Retell = RetellSdk.default || RetellSdk.Retell;
let client = null;
function getClient() {
  if (!client) {
    if (!config.retell.apiKey) throw new Error('RETELL_API_KEY not set');
    client = new Retell({ apiKey: config.retell.apiKey });
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

function sipUri(callId) {
  return `sip:${callId}@${config.retell.sipDomain}`;
}

module.exports = { getClient, verifySignature, retellAuth, registerPhoneCall, sipUri };
