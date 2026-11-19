'use strict';
// Configuration. Only two environment variables are required: DATABASE_URL and APP_ENCRYPTION_KEY.
// Everything else (API keys, URLs, branding) can be entered in the dashboard's setup wizard and is stored
// encrypted in the database. A value set as an environment variable always wins over the dashboard value.
const crypto = require('crypto');

function bool(v, dflt) {
  if (v === undefined || v === '' || v === null) return dflt;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

const env = process.env;

function defaultBaseUrl() {
  if (env.PUBLIC_BASE_URL) return env.PUBLIC_BASE_URL.replace(/\/$/, '');
  if (env.RAILWAY_PUBLIC_DOMAIN) return `https://${env.RAILWAY_PUBLIC_DOMAIN}`;
  return `http://localhost:${env.PORT || 3000}`;
}

const encryptionKey = env.APP_ENCRYPTION_KEY || '';

const config = {
  port: Number(env.PORT || 3000),
  publicBaseUrl: defaultBaseUrl(),
  databaseUrl: env.DATABASE_URL || 'postgres://localhost:5432/missed_call_agent',
  databaseSsl: bool(env.DATABASE_SSL, false),
  encryptionKey,
  // Session signing key: JWT_SECRET if given, otherwise derived from the encryption key.
  jwtSecret: env.JWT_SECRET || (encryptionKey ? crypto.createHmac('sha256', encryptionKey).update('mca-session-v1').digest('hex') : ''),
  agencyName: env.AGENCY_NAME || 'Automindlab',
  adminEmail: env.ADMIN_EMAIL || '',
  adminPassword: env.ADMIN_PASSWORD || '',
  setupCode: env.SETUP_CODE || '',

  twilio: {
    accountSid: env.TWILIO_ACCOUNT_SID || '',
    authToken: env.TWILIO_AUTH_TOKEN || '',
    messagingServiceSid: env.TWILIO_MESSAGING_SERVICE_SID || '',
    validateSignatures: bool(env.TWILIO_VALIDATE_SIGNATURES, true),
  },
  retell: {
    apiKey: env.RETELL_API_KEY || '',
    agentId: env.RETELL_AGENT_ID || '',
    llmId: env.RETELL_LLM_ID || '',
    agentVersion: /^\d+$/.test(env.RETELL_AGENT_VERSION || '') ? Number(env.RETELL_AGENT_VERSION) : env.RETELL_AGENT_VERSION || 'latest',
    model: env.RETELL_LLM_MODEL || 'gpt-4.1',
    voiceId: env.RETELL_VOICE_ID || 'retell-Cimo',
    sipDomain: env.RETELL_SIP_DOMAIN || 'sip.retellai.com',
    verifySignatures: bool(env.RETELL_VERIFY_SIGNATURES, true),
    toolSecret: env.RETELL_TOOL_SECRET || '',
  },
  llm: {
    baseUrl: (env.LLM_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai').replace(/\/$/, ''),
    apiKey: env.LLM_API_KEY || '',
    model: env.LLM_MODEL || 'gemini-3.8-flash',
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
  shortCallSeconds: Number(env.SHORT_CALL_SECONDS || 15),
  noEmailDomain: env.NO_EMAIL_DOMAIN || 'noemail.invalid',
  dryRun: bool(env.DRY_RUN, false),
};

// Map of dashboard-editable settings -> where they live in `config`, which env var overrides them, and whether secret.
const SETTINGS = {
  public_base_url: { path: ['publicBaseUrl'], env: 'PUBLIC_BASE_URL', group: 'app' },
  agency_name: { path: ['agencyName'], env: 'AGENCY_NAME', group: 'app' },
  twilio_account_sid: { path: ['twilio', 'accountSid'], env: 'TWILIO_ACCOUNT_SID', group: 'twilio' },
  twilio_auth_token: { path: ['twilio', 'authToken'], env: 'TWILIO_AUTH_TOKEN', group: 'twilio', secret: true },
  twilio_messaging_service_sid: { path: ['twilio', 'messagingServiceSid'], env: 'TWILIO_MESSAGING_SERVICE_SID', group: 'twilio' },
  retell_api_key: { path: ['retell', 'apiKey'], env: 'RETELL_API_KEY', group: 'retell', secret: true },
  retell_agent_id: { path: ['retell', 'agentId'], env: 'RETELL_AGENT_ID', group: 'retell', internal: true },
  retell_llm_id: { path: ['retell', 'llmId'], env: 'RETELL_LLM_ID', group: 'retell', internal: true },
  retell_tool_secret: { path: ['retell', 'toolSecret'], env: 'RETELL_TOOL_SECRET', group: 'retell', secret: true, internal: true },
  retell_voice_id: { path: ['retell', 'voiceId'], env: 'RETELL_VOICE_ID', group: 'retell' },
  retell_model: { path: ['retell', 'model'], env: 'RETELL_LLM_MODEL', group: 'retell' },
  llm_base_url: { path: ['llm', 'baseUrl'], env: 'LLM_BASE_URL', group: 'llm' },
  llm_api_key: { path: ['llm', 'apiKey'], env: 'LLM_API_KEY', group: 'llm', secret: true },
  llm_model: { path: ['llm', 'model'], env: 'LLM_MODEL', group: 'llm' },
  google_client_id: { path: ['google', 'clientId'], env: 'GOOGLE_CLIENT_ID', group: 'google' },
  google_client_secret: { path: ['google', 'clientSecret'], env: 'GOOGLE_CLIENT_SECRET', group: 'google', secret: true },
  smtp_host: { path: ['smtp', 'host'], env: 'SMTP_HOST', group: 'smtp' },
  smtp_port: { path: ['smtp', 'port'], env: 'SMTP_PORT', group: 'smtp', number: true },
  smtp_secure: { path: ['smtp', 'secure'], env: 'SMTP_SECURE', group: 'smtp', bool: true },
  smtp_user: { path: ['smtp', 'user'], env: 'SMTP_USER', group: 'smtp' },
  smtp_pass: { path: ['smtp', 'pass'], env: 'SMTP_PASS', group: 'smtp', secret: true },
  smtp_from: { path: ['smtp', 'from'], env: 'SMTP_FROM', group: 'smtp' },
};

function setPath(path, value) {
  let o = config;
  for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
  o[path[path.length - 1]] = value;
}
function getPath(path) {
  return path.reduce((o, k) => (o ? o[k] : undefined), config);
}

function coerce(def, v) {
  if (def.number) return Number(v);
  if (def.bool) return bool(v, false);
  if (def.path[0] === 'publicBaseUrl' || def.path[1] === 'baseUrl') return String(v).replace(/\/$/, '');
  return String(v);
}

// Apply DB-stored values (already decrypted) wherever no env var overrides them.
function applyStoredSettings(stored) {
  for (const [key, def] of Object.entries(SETTINGS)) {
    if (env[def.env]) continue;
    if (key === 'public_base_url' && !stored[key] && env.RAILWAY_PUBLIC_DOMAIN) continue;
    if (stored[key] !== undefined && stored[key] !== null && stored[key] !== '') setPath(def.path, coerce(def, stored[key]));
  }
}

function assertProductionConfig() {
  if (!/^[0-9a-fA-F]{64}$/.test(config.encryptionKey)) {
    throw new Error(
      'APP_ENCRYPTION_KEY must be set to 64 hex characters. Generate one with:  openssl rand -hex 32  (or: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))")'
    );
  }
}

module.exports = { config, SETTINGS, applyStoredSettings, getPath, assertProductionConfig, bool };
