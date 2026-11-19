'use strict';
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { config } = require('../config');

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

pool.on('error', (err) => console.error('[db] idle client error', err.message));

async function query(text, params) {
  return pool.query(text, params);
}

async function one(text, params) {
  const r = await pool.query(text, params);
  return r.rows[0] || null;
}

async function many(text, params) {
  const r = await pool.query(text, params);
  return r.rows;
}

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

async function logEvent(tenantId, leadId, type, data = {}) {
  try {
    await pool.query('INSERT INTO events (tenant_id, lead_id, type, data) VALUES ($1,$2,$3,$4)', [
      tenantId || null,
      leadId || null,
      type,
      data,
    ]);
  } catch (e) {
    console.error('[db] logEvent failed', e.message);
  }
}

module.exports = { pool, query, one, many, migrate, logEvent };
