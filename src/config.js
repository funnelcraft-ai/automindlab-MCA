'use strict';
// Central configuration. Every value comes from environment variables (see .env.example).

function bool(v, dflt) {
  if (v === undefined || v === '') return dflt;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

const env = process.env;

const config = {
  port: Number(env.PORT || 3000),
  publicBaseUrl: (env.PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  databaseUrl: env.DATABASE_URL || 'postgres://localhost:5432/missed_call_agent',
  databaseSsl: bool(env.DATABASE_SSL, false),
  jwtSecret: env.JWT_SECRET || '',
  encryptionKey: env.APP_ENCRYPTION_KEY || '', // 64 hex chars (32 bytes)
  agencyName: env.AGENCY_NAME || 'Automindlab',
  adminEmail: env.ADMIN_EMAIL || '',
  adminPassword: env.ADMIN_PASSWORD || '',

  twilio: {
    accountSid: env.TWILIO_ACCOUNT_SID || '',
    authToken: env.TWILIO_AUTH_TOKEN || '',
    messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID || '',
    validateSignatures: bool(env.TWILIO_VALIDATE_SIGNATURES, true),
  },

  retell: {
    apiKey: env.RETELL_API_KEY || '',
    agentId: env.RETELL_AGENT_ID || '',
    // 'latest' = newest draft (no publish step needed); set a number or 'latest_published' to pin a version
    agentVersion: /^\d+$/.test(env.RETELL_AGENT_VERSION || '') ? Number(env.RETELL_AGENT_VERSION) : env.RETELL_AGENT_VERSION || 'latest',
    llmId: env.RETELL_LLM_ID || '',
    model: env.RETELL_LLM_MODEL || 'gpt-4.1',
    voiceId: env.RETELL_VOICE_ID || 'retell-Cimo',
    sipDomain: env.RETELL_SIP_DOMAIN || 'sip.retellai.com',
    verifySignatures: bool(env.RETELL_VERIFY_SIGNATURES, true),
    toolSecret: env.RETELL_TOOL_SECRET || '', // extra shared secret header on tool calls
  },

  // SMS conversations use any OpenAI-compatible chat completions API (OpenAI, OpenRouter, Gemini, Groq...)
  llm: {
    baseUrl: (env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    apiKey: env.LLM_API_KEY || '',
    model: env.LLM_MODEL || 'gpt-4.1-mini',
    maxAiRepliesPerDay: Number(env.SMS_MAX_AI_REPLIES_PER_DAY || 15),
  },

  google: {
    clientId: env.GOOGLE_CLIENT_ID || '',
    clientSecret: env.GOOGLE_CLIENT_SECRET || '',
  },

  smtp: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT || 465),
    secure: bool(env.SMTP_SECURE, true),
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.SMTP_FROM || '',
  },

  // A caller who talks to the AI for less than this is treated as "hung up early" and gets the text-back.
  shortCallSeconds: Number(env.SHORT_CALL_SECONDS || 15),
  noEmailDomain: env.NO_EMAIL_DOMAIN || 'noemail.invalid',
  dryRun: bool(env.DRY_RUN, false), // log outbound SMS/email/API instead of sending (local testing)
};

function assertProductionConfig() {
  const missing = [];
  if (!config.jwtSecret || config.jwtSecret.length < 32) missing.push('JWT_SECRET (32+ chars)');
  if (!/^[0-9a-fA-F]{64}$/.test(config.encryptionKey)) missing.push('APP_ENCRYPTION_KEY (64 hex chars)');
  if (missing.length) {
    throw new Error('Missing/invalid required env: ' + missing.join(', '));
  }
}

module.exports = { config, assertProductionConfig };
