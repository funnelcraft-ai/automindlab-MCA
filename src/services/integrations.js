'use strict';
// "Test connection" checks for each integration. Each returns { ok, detail }.
const { config } = require('../config');
const { getClient: twilioClient } = require('./twilio');
const { getClient: retellClient } = require('./retell');
const { mailer } = require('./notify');

async function testTwilio() {
  if (!config.twilio.accountSid || !config.twilio.authToken) return { ok: false, detail: 'Account SID and Auth Token are required.' };
  if (!/^AC[0-9a-f]{32}$/i.test(config.twilio.accountSid)) return { ok: false, detail: 'Account SID should start with "AC" followed by 32 characters.' };
  if (config.dryRun) return { ok: true, detail: 'Dry run: credentials look valid.' };
  try {
    const acct = await twilioClient().api.v2010.accounts(config.twilio.accountSid).fetch();
    let ms = '';
    if (config.twilio.messagingServiceSid) {
      const svc = await twilioClient().messaging.v1.services(config.twilio.messagingServiceSid).fetch();
      ms = ` Messaging Service "${svc.friendlyName}" found.`;
    }
    return { ok: acct.status === 'active', detail: `Connected to "${acct.friendlyName}" (${acct.status}, ${acct.type}).${ms}` };
  } catch (e) {
    return { ok: false, detail: e.status === 401 ? 'Twilio rejected these credentials.' : e.message };
  }
}

async function testRetell() {
  if (!config.retell.apiKey) return { ok: false, detail: 'API key is required.' };
  if (config.dryRun) return { ok: true, detail: 'Dry run: key accepted.' };
  try {
    const agents = await retellClient().agent.list({ limit: 5 });
    const n = Array.isArray(agents) ? agents.length : agents?.data?.length ?? 0;
    const agentOk = config.retell.agentId ? ' Voice agent is set up.' : ' Next: create the voice agent.';
    return { ok: true, detail: `Key works (${n}+ agents visible).${agentOk}` };
  } catch (e) {
    return { ok: false, detail: e.status === 401 ? 'Retell rejected this API key.' : e.message };
  }
}

async function testLlm() {
  if (!config.llm.apiKey) return { ok: false, detail: 'API key is required.' };
  if (config.dryRun) return { ok: true, detail: 'Dry run: key accepted.' };
  try {
    const r = await fetch(`${config.llm.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.llm.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.llm.model, messages: [{ role: 'user', content: 'Reply with OK' }], max_tokens: 200, ...require('../agent/sms-agent').llmExtras() }),
      signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, detail: `Provider returned ${r.status}: ${j.error?.message || 'error'}` };
    return { ok: true, detail: `Model ${config.llm.model} responded.` };
  } catch (e) {
    return { ok: false, detail: e.message };
  }
}

async function testSmtp() {
  if (!config.smtp.host) return { ok: false, detail: 'SMTP host is required.' };
  if (config.dryRun) return { ok: true, detail: 'Dry run.' };
  try {
    await mailer().verify();
    return { ok: true, detail: `Signed in to ${config.smtp.host}.` };
  } catch (e) {
    return { ok: false, detail: e.message };
  }
}

async function testGoogle() {
  if (!config.google.clientId || !config.google.clientSecret) return { ok: false, detail: 'Client ID and secret are required.' };
  if (!/\.apps\.googleusercontent\.com$/.test(config.google.clientId)) return { ok: false, detail: 'Client ID should end with .apps.googleusercontent.com' };
  return { ok: true, detail: `Looks right. Authorized redirect URI must be ${config.publicBaseUrl}/oauth/google/callback` };
}

const TESTS = { twilio: testTwilio, retell: testRetell, llm: testLlm, smtp: testSmtp, google: testGoogle };

// Readiness checklist shown on the dashboard until everything required is green.
function readiness() {
  const https = config.publicBaseUrl.startsWith('https://');
  return [
    { key: 'url', label: 'Public HTTPS address', ok: https, required: true, hint: https ? config.publicBaseUrl : 'Set your Railway/custom domain under Integrations > App' },
    { key: 'twilio', label: 'Twilio connected', ok: !!(config.twilio.accountSid && config.twilio.authToken), required: true },
    { key: 'retell', label: 'Retell connected', ok: !!config.retell.apiKey, required: true },
    { key: 'agent', label: 'Voice agent created', ok: !!config.retell.agentId, required: true },
    { key: 'llm', label: 'SMS AI connected', ok: !!config.llm.apiKey, required: false, hint: 'Without it, texts from callers are forwarded to the business instead of answered by AI' },
    { key: 'a2p', label: 'A2P Messaging Service', ok: !!config.twilio.messagingServiceSid, required: false, hint: 'Required for reliable US texting' },
    { key: 'smtp', label: 'Email alerts', ok: !!config.smtp.host, required: false },
    { key: 'google', label: 'Google Calendar booking', ok: !!config.google.clientId, required: false },
  ];
}

module.exports = { TESTS, readiness };
