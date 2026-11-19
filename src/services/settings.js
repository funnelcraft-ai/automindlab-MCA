'use strict';
// Encrypted key/value store for API keys and app settings entered in the dashboard.
const db = require('../db');
const { config, SETTINGS, applyStoredSettings, getPath } = require('../config');
const { encrypt, decrypt } = require('../lib/util');

async function readAll() {
  const rows = await db.many('SELECT key, value_enc FROM app_settings');
  const out = {};
  for (const r of rows) {
    try {
      out[r.key] = decrypt(r.value_enc);
    } catch {
      console.error(`[settings] cannot decrypt "${r.key}" - was APP_ENCRYPTION_KEY changed?`);
    }
  }
  return out;
}

async function load() {
  applyStoredSettings(await readAll());
}

// values: { key: string|null }. Empty string or null deletes the stored value.
async function save(values, userId, { internal = false } = {}) {
  const changed = [];
  for (const [key, raw] of Object.entries(values || {})) {
    const def = SETTINGS[key];
    if (!def) throw Object.assign(new Error(`Unknown setting ${key}`), { status: 400 });
    if (def.internal && !internal) continue;
    if (process.env[def.env]) continue; // env var wins; nothing to store
    const v = raw === undefined ? undefined : raw === null ? '' : String(raw).trim();
    if (v === undefined) continue;
    if (v === '') {
      await db.query('DELETE FROM app_settings WHERE key=$1', [key]);
    } else {
      await db.query(
        `INSERT INTO app_settings (key, value_enc, updated_by) VALUES ($1,$2,$3)
         ON CONFLICT (key) DO UPDATE SET value_enc=EXCLUDED.value_enc, updated_by=EXCLUDED.updated_by, updated_at=now()`,
        [key, encrypt(v), userId || null]
      );
    }
    changed.push(key);
  }
  // Re-read so removals fall back to defaults correctly.
  const stored = await readAll();
  for (const key of changed) {
    if (!(key in stored)) {
      const def = SETTINGS[key];
      if (!process.env[def.env]) resetToDefault(key);
    }
  }
  applyStoredSettings(stored);
  if (changed.length) await db.logEvent(null, null, 'settings_changed', { keys: changed, by: userId || 'system' });
  return changed;
}

const DEFAULTS = {
  retell_voice_id: 'retell-Cimo',
  retell_model: 'gpt-4.1',
  llm_base_url: 'https://api.openai.com/v1',
  llm_model: 'gpt-4.1-mini',
  smtp_port: 465,
  smtp_secure: true,
  agency_name: 'Automindlab',
};
function resetToDefault(key) {
  const def = SETTINGS[key];
  let v = key in DEFAULTS ? DEFAULTS[key] : def.number ? 0 : def.bool ? false : '';
  if (key === 'public_base_url') {
    v = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${config.port}`;
  }
  let o = config;
  for (let i = 0; i < def.path.length - 1; i++) o = o[def.path[i]];
  o[def.path[def.path.length - 1]] = v;
}

function mask(v) {
  const s = String(v || '');
  if (!s) return '';
  return s.length <= 6 ? '••••' : '••••' + s.slice(-4);
}

// Safe view for the dashboard: secrets are never returned, only "set" + last 4 chars.
function publicView() {
  const out = {};
  for (const [key, def] of Object.entries(SETTINGS)) {
    const v = getPath(def.path);
    out[key] = {
      group: def.group,
      secret: !!def.secret,
      fromEnv: !!process.env[def.env],
      set: v !== '' && v !== undefined && v !== null && v !== 0,
      value: def.secret ? mask(v) : v,
    };
  }
  return out;
}

module.exports = { load, save, publicView, readAll };
