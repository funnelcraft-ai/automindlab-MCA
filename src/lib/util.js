'use strict';
const crypto = require('crypto');
const { config } = require('../config');

// ---- Secret encryption (AES-256-GCM) for tenant OAuth tokens / API keys ----
function key() {
  if (!/^[0-9a-fA-F]{64}$/.test(config.encryptionKey)) throw new Error('APP_ENCRYPTION_KEY not set');
  return Buffer.from(config.encryptionKey, 'hex');
}

function encrypt(plain) {
  if (plain === null || plain === undefined || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

function decrypt(blob) {
  if (!blob) return null;
  const [iv, tag, data] = blob.split('.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

// ---- Phone helpers (US/Canada focused) ----
function toE164(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\+[1-9]\d{6,14}$/.test(s)) return s;
  const digits = s.replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return null;
}

function prettyPhone(e164) {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164 || '');
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164 || '';
}

function splitList(s) {
  return String(s || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

module.exports = { encrypt, decrypt, toE164, prettyPhone, splitList, slugify, sleep, truncate };
