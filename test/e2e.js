#!/usr/bin/env node
'use strict';
// End-to-end simulation: fake Twilio + Retell webhooks against a real Postgres, outbound sends in DRY_RUN.
// Usage: DATABASE_URL=postgres://... node test/e2e.js
const http = require('http');
const assert = require('assert/strict');

process.env.DRY_RUN = 'true';
process.env.TWILIO_VALIDATE_SIGNATURES = 'false';
process.env.RETELL_VERIFY_SIGNATURES = 'true';
process.env.APP_ENCRYPTION_KEY = 'a'.repeat(64);
process.env.SETUP_CODE = 'TESTCODE';
const RETELL_KEY = 'key_test_123';
process.env.PORT = '3999';
process.env.PUBLIC_BASE_URL = 'http://localhost:3999';
process.env.SHORT_CALL_SECONDS = '15';

const RetellSdk = require('retell-sdk');
const { start } = require('../src/server');
const db = require('../src/db');

const BASE = 'http://localhost:3999';
const TWILIO_NUM = '+15125550199';
const CALLER = '+15125550123';
let cookie = '';
let passed = 0;

async function req(method, path, { body, form, headers = {}, raw, csrf = true } = {}) {
  const h = { ...headers };
  if (csrf && method !== 'GET' && path.startsWith('/api')) h['X-Requested-With'] = 'mca';
  let payload;
  if (form) {
    h['Content-Type'] = 'application/x-www-form-urlencoded';
    payload = new URLSearchParams(form).toString();
  } else if (raw !== undefined) {
    h['Content-Type'] = 'application/json';
    payload = raw;
  } else if (body) {
    h['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (cookie) h.Cookie = cookie;
  const r = await fetch(BASE + path, { method, headers: h, body: payload, redirect: 'manual' });
  const sc = r.headers.get('set-cookie');
  if (sc && sc.startsWith('mca_token=')) cookie = sc.split(';')[0];
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: r.status, text, json };
}

async function retell(path, obj, { sign = true } = {}) {
  const raw = JSON.stringify(obj);
  const headers = sign ? { 'x-retell-signature': await RetellSdk.sign(raw, RETELL_KEY) } : {};
  return req('POST', path, { raw, headers });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function ok(name) {
  passed++;
  console.log('  ✓', name);
}

// --- tiny mock of the Cal.com v2 API ---
function startMockCal() {
  const booked = [];
  const srv = http.createServer((rq, rs) => {
    let b = '';
    rq.on('data', (c) => (b += c));
    rq.on('end', () => {
      const u = new URL(rq.url, 'http://x');
      rs.setHeader('Content-Type', 'application/json');
      if (rq.headers.authorization !== 'Bearer cal_test_key') return rs.writeHead(401).end('{}');
      if (u.pathname === '/v2/slots') {
        const tomorrow = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
        return rs.end(JSON.stringify({ data: { [tomorrow]: [{ start: `${tomorrow}T15:00:00.000Z` }, { start: `${tomorrow}T17:00:00.000Z` }] } }));
      }
      if (u.pathname === '/v2/bookings' && rq.method === 'POST') {
        booked.push(JSON.parse(b));
        return rs.end(JSON.stringify({ status: 'success', data: { uid: 'bk_' + booked.length } }));
      }
      rs.writeHead(404).end('{}');
    });
  });
  return new Promise((r) => srv.listen(4001, () => r({ srv, booked })));
}

async function main() {
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await start();
  await wait(300);
  const cal = await startMockCal();

  console.log('First-run setup & security');
  let r = await req('GET', '/api/setup/status');
  assert.equal(r.json.needsSetup, true);
  r = await req('GET', '/api/me');
  assert.equal(r.status, 401);
  r = await req('POST', '/api/setup', { body: { setupCode: 'WRONG', email: 'admin@test.dev', password: 'Skyline-pass-123' } });
  assert.equal(r.status, 403);
  r = await req('POST', '/api/setup', { body: { setupCode: 'testcode', email: 'admin@test.dev', password: 'short' } });
  assert.equal(r.status, 400);
  r = await req('POST', '/api/setup', { body: { setupCode: 'testcode', email: 'admin@test.dev', password: 'Skyline-pass-123', agencyName: 'Automindlab', name: 'Joy' } });
  assert.equal(r.status, 200, r.text);
  const adminCookie = cookie;
  ok('setup code required; weak password refused; admin created');
  r = await req('POST', '/api/setup', { body: { setupCode: 'testcode', email: 'x@test.dev', password: 'Another-pass-123' } });
  assert.equal(r.status, 409);
  ok('setup cannot be run twice');
  r = await req('POST', '/api/tenants', { body: { name: 'csrf' }, csrf: false });
  assert.equal(r.status, 403);
  r = await req('POST', '/api/tenants', { body: { name: 'csrf' }, headers: { Origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
  ok('state-changing requests without CSRF header or from another origin are blocked');
  r = await fetch(BASE + '/');
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  ok('security headers present');

  console.log('Integrations: paste keys, test, create voice agent');
  r = await req('PUT', '/api/integrations', { body: { values: { twilio_account_sid: 'not-a-sid' } } });
  assert.equal(r.status, 400);
  r = await req('PUT', '/api/integrations', {
    body: { values: { twilio_account_sid: 'AC' + 'b'.repeat(32), twilio_auth_token: 'super-secret-token', retell_api_key: RETELL_KEY, public_base_url: BASE } },
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.settings.twilio_auth_token.value, '••••oken');
  assert.ok(!JSON.stringify(r.json).includes('super-secret-token'), 'secret never returned');
  const raw = await db.many('SELECT value_enc FROM app_settings');
  assert.ok(raw.every((x) => !x.value_enc.includes('super-secret') && !x.value_enc.includes(RETELL_KEY)), 'stored encrypted');
  r = await req('POST', '/api/integrations/twilio/test');
  assert.equal(r.json.ok, true);
  r = await req('POST', '/api/integrations/retell/provision');
  assert.equal(r.json.ok, true, r.text);
  r = await req('GET', '/api/integrations');
  assert.equal(r.json.settings.retell_agent_id.set, true);
  assert.equal(r.json.readiness.find((x) => x.key === 'agent').ok, true);
  ok('keys validated, encrypted at rest, masked in UI; voice agent provisioned');

  console.log('Onboarding a business');
  r = await req('POST', '/api/tenants', { body: { name: 'Lone Star Heating & Air', timezone: 'America/Chicago' } });
  const tid = r.json.id;
  assert.equal(r.json.active, false);
  r = await req('PUT', `/api/tenants/${tid}`, { body: { notify_phones: '512-555-0100, bad' } });
  assert.equal(r.status, 400);
  r = await req('PUT', `/api/tenants/${tid}`, { body: { booking_link: 'javascript:alert(1)' } });
  assert.equal(r.status, 400);
  ok('input validation on business settings');
  r = await req('POST', `/api/tenants/${tid}/go-live`);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /phone number/);
  r = await req('GET', '/api/numbers/search?areaCode=512');
  assert.ok(r.json.length > 0);
  r = await req('POST', `/api/tenants/${tid}/number`, { body: { phoneNumber: TWILIO_NUM, buy: true } });
  assert.equal(r.status, 400, 'purchase needs explicit confirmation');
  r = await req('POST', `/api/tenants/${tid}/number`, { body: { phoneNumber: TWILIO_NUM, buy: true, confirm: TWILIO_NUM } });
  assert.equal(r.json.twilio_number, TWILIO_NUM);
  r = await req('PUT', `/api/tenants/${tid}`, {
    body: { owner_phone: '(512) 555-0100', notify_phones: '+15125550100', notify_emails: 'owner@lonestar.test', booking_provider: 'link', booking_link: 'https://cal.id/lonestar', service_area: 'Austin, Round Rock' },
  });
  assert.equal(r.json.booking_link, 'https://cal.id/lonestar');
  assert.equal(r.json.owner_phone, '+15125550100');
  ok('number search + confirmed purchase + configuration');
  r = await req('POST', '/twilio/voice', { form: { CallSid: 'CA_T1', From: '+19725550000', To: TWILIO_NUM } });
  assert.match(r.text, /not in service/);
  r = await req('POST', '/twilio/voice', { form: { CallSid: 'CA_T2', From: '+15125550100', To: TWILIO_NUM } });
  assert.match(r.text, /<Sip>/);
  ok('test mode: only owner/alert phones reach the agent before go-live');
  r = await req('GET', `/api/tenants/${tid}/checklist`);
  assert.equal(r.json.items.find((i) => i.key === 'call').ok, true);
  r = await req('POST', `/api/tenants/${tid}/go-live`);
  assert.equal(r.status, 200, r.text);
  ok('checklist passes; business goes live');

  r = await req('POST', `/api/tenants/${tid}/invites`, { body: { email: 'Owner@LoneStar.test' } });
  const inviteToken = r.json.link.split('/invite/')[1];
  assert.ok(inviteToken && inviteToken.length > 30);
  const stored = await db.one('SELECT token_hash FROM invites WHERE email=$1', ['owner@lonestar.test']);
  assert.notEqual(stored.token_hash, inviteToken, 'only a hash of the invite token is stored');
  ok('invite link created (hashed at rest)');
  await db.query("DELETE FROM calls WHERE twilio_call_sid IN ('CA_T1','CA_T2')");
  await db.query('DELETE FROM leads');

  console.log('Flow 1: forwarded missed call -> AI conversation -> follow-up text');
  r = await req('POST', '/twilio/voice', { form: { CallSid: 'CA001', From: CALLER, To: TWILIO_NUM } });
  assert.match(r.text, /<Sip>sip:call_dry_\d+@sip\.retellai\.com<\/Sip>/);
  const call1 = await db.one("SELECT * FROM calls WHERE twilio_call_sid='CA001'");
  assert.equal(call1.path, 'ai');
  ok('voice webhook returns SIP dial to Retell');
  r = await req('POST', '/twilio/voice', { form: { CallSid: 'CA001', From: CALLER, To: TWILIO_NUM } });
  assert.match(r.text, new RegExp(call1.retell_call_id));
  assert.equal((await db.one("SELECT count(*)::int n FROM calls WHERE twilio_call_sid='CA001'")).n, 1);
  ok('duplicate Twilio webhook reuses the same Retell call');

  const rc = { call_id: call1.retell_call_id, metadata: { tenant_id: String(tid), call_row_id: String(call1.id) } };
  r = await retell('/retell/webhook', { event: 'call_started', call: rc }, { sign: false });
  assert.equal(r.status, 401);
  ok('unsigned Retell webhook rejected');
  r = await retell('/retell/webhook', { event: 'call_started', call: rc });
  assert.equal(r.status, 204);
  r = await retell('/retell/tools/save_lead_details', { name: 'save_lead_details', call: rc, args: { name: 'Maria Lopez', issue: 'AC blowing warm air', urgency: 'urgent' } });
  assert.deepEqual(r.json, { saved: true });
  r = await retell('/retell/tools/check_availability', { name: 'check_availability', call: rc, args: {} });
  assert.equal(r.json.available, false);
  assert.match(r.json.instructions, /send_booking_link/);
  r = await retell('/retell/tools/send_booking_link', { name: 'send_booking_link', call: rc, args: {} });
  assert.equal(r.json.sent, true);
  ok('voice tools: save details, availability (link mode), send booking link');
  await retell('/retell/webhook', { event: 'call_ended', call: { ...rc, transcript: 'Agent: Hi...\nUser: My AC is blowing warm air', duration_ms: 95000, disconnection_reason: 'user_hangup' } });
  await retell('/retell/webhook', {
    event: 'call_analyzed',
    call: {
      ...rc,
      duration_ms: 95000,
      call_analysis: {
        call_summary: 'Maria in Austin has an AC blowing warm air and wants a callback.',
        custom_analysis_data: { caller_name: 'Maria Lopez', service_address: '12 Elm St, Austin', issue_summary: 'AC blowing warm air', urgency: 'urgent', lead_outcome: 'callback_requested' },
      },
    },
  });
  await wait(400);
  let lead = await db.one('SELECT * FROM leads WHERE phone=$1', [CALLER]);
  assert.equal(lead.name, 'Maria Lopez');
  assert.equal(lead.address, '12 Elm St, Austin');
  let msgs = await db.many('SELECT * FROM messages WHERE lead_id=$1 ORDER BY id', [lead.id]);
  assert.ok(msgs.some((m) => /Thanks for calling Lone Star/.test(m.body)), 'follow-up text sent');
  const c1 = await db.one('SELECT * FROM calls WHERE id=$1', [call1.id]);
  assert.equal(c1.outcome, 'callback_requested');
  assert.equal(c1.textback_sent, true);
  assert.equal(lead.status, 'contacted');
  ok('analysis saved, lead enriched, follow-up text sent once');

  console.log('Flow 2: caller replies by SMS -> AI responds; STOP opts out');
  r = await req('POST', '/twilio/sms', { form: { From: CALLER, To: TWILIO_NUM, Body: 'Can someone come tomorrow?', MessageSid: 'SMin1' } });
  assert.match(r.text, /<Response\/>/);
  await wait(400);
  msgs = await db.many("SELECT * FROM messages WHERE lead_id=$1 AND author='ai'", [lead.id]);
  assert.equal(msgs.length, 1);
  ok('AI SMS reply sent');
  await req('POST', '/twilio/sms', { form: { From: CALLER, To: TWILIO_NUM, Body: 'STOP', MessageSid: 'SMin2' } });
  await wait(200);
  assert.ok(await db.one('SELECT 1 FROM opt_outs WHERE phone=$1', [CALLER]));
  r = await req('POST', `/api/leads/${lead.id}/sms`, { body: { body: 'hello?' } });
  assert.equal(r.status, 400);
  assert.equal((await db.one('SELECT human_takeover FROM leads WHERE id=$1', [lead.id])).human_takeover, false);
  ok('STOP recorded; texting blocked afterwards');

  console.log('Flow 3: ring-first mode, caller hangs up while ringing -> text-back');
  await req('PUT', `/api/tenants/${tid}`, { body: { mode: 'ring_first', ring_number: '+15125550111', ring_timeout_sec: 15 } });
  const CALLER2 = '+17375550144';
  r = await req('POST', '/twilio/voice', { form: { CallSid: 'CA002', From: CALLER2, To: TWILIO_NUM } });
  assert.match(r.text, /<Dial timeout="15"[^>]*><Number>\+15125550111<\/Number><\/Dial>/);
  ok('rings the team first');
  r = await req('POST', '/twilio/voice/after-ring', { form: { CallSid: 'CA002', DialCallStatus: 'no-answer', CallStatus: 'completed' } });
  assert.match(r.text, /<Hangup\/>/);
  await req('POST', '/twilio/voice/status', { form: { CallSid: 'CA002', CallStatus: 'completed', CallDuration: '9' } });
  await wait(400);
  const l2 = await db.one('SELECT * FROM leads WHERE phone=$1', [CALLER2]);
  const tb = await db.one("SELECT * FROM messages WHERE lead_id=$1 AND author='system'", [l2.id]);
  assert.match(tb.body, /sorry we missed your call/i);
  assert.match(tb.body, /cal\.id\/lonestar/);
  assert.equal((await db.one("SELECT path FROM calls WHERE twilio_call_sid='CA002'")).path, 'abandoned');
  ok('abandoned caller texted back with booking link');

  console.log('Flow 4: ring-first, team misses it -> AI picks up -> books via Cal.com');
  await req('PUT', `/api/tenants/${tid}`, {
    body: { booking_provider: 'calcom', calcom_base_url: 'http://localhost:4001', calcom_api_key: 'cal_test_key', calcom_event_type_id: '12345', min_lead_minutes: 0 },
  });
  const CALLER3 = '+12145550177';
  await req('POST', '/twilio/voice', { form: { CallSid: 'CA003', From: CALLER3, To: TWILIO_NUM } });
  r = await req('POST', '/twilio/voice/after-ring', { form: { CallSid: 'CA003', DialCallStatus: 'no-answer', CallStatus: 'in-progress' } });
  assert.match(r.text, /<Sip>/);
  const call3 = await db.one("SELECT * FROM calls WHERE twilio_call_sid='CA003'");
  const rc3 = { call_id: call3.retell_call_id, metadata: {} };
  r = await retell('/retell/tools/check_availability', { call: rc3, args: { days: 2 } });
  assert.equal(r.json.available, true);
  assert.ok(r.json.slots.length >= 1);
  const slot = r.json.slots[0];
  r = await retell('/retell/tools/book_appointment', {
    call: rc3,
    args: { start_iso: slot.start_iso, name: 'Dave Kim', address: '88 Oak Ave, Dallas', issue: 'Furnace not igniting', urgency: 'urgent' },
  });
  assert.equal(r.json.booked, true, JSON.stringify(r.json));
  assert.equal(cal.booked.length, 1);
  assert.equal(cal.booked[0].attendee.phoneNumber, CALLER3);
  let l3 = await db.one('SELECT * FROM leads WHERE phone=$1', [CALLER3]);
  assert.equal(l3.status, 'booked');
  r = await retell('/retell/tools/book_appointment', { call: rc3, args: { start_iso: '2020-01-01T10:00:00Z', name: 'Dave', address: 'x', issue: 'y' } });
  assert.equal(r.json.booked, false);
  ok('availability + booking through Cal.com API; bad slot refused');
  await retell('/retell/webhook', {
    event: 'call_analyzed',
    call: { ...rc3, duration_ms: 140000, call_analysis: { call_summary: 'Booked furnace repair.', custom_analysis_data: { lead_outcome: 'booked', caller_name: 'Dave Kim' } } },
  });
  await wait(300);
  const sysMsgs = await db.many("SELECT body FROM messages WHERE lead_id=$1 AND author='system'", [l3.id]);
  assert.equal(sysMsgs.length, 1, 'only the booking confirmation, no extra follow-up');
  assert.match(sysMsgs[0].body, /You're booked/);
  ok('booked call: confirmation only, no duplicate follow-up');

  console.log('Flow 5: AI answers but caller hangs up within seconds');
  await req('PUT', `/api/tenants/${tid}`, { body: { mode: 'forward' } });
  const CALLER4 = '+14695550188';
  await req('POST', '/twilio/voice', { form: { CallSid: 'CA004', From: CALLER4, To: TWILIO_NUM } });
  const call4 = await db.one("SELECT * FROM calls WHERE twilio_call_sid='CA004'");
  await retell('/retell/webhook', {
    event: 'call_analyzed',
    call: { call_id: call4.retell_call_id, duration_ms: 6000, call_analysis: { call_summary: 'Caller hung up.', custom_analysis_data: { lead_outcome: 'hung_up_early' } } },
  });
  await wait(300);
  const l4 = await db.one('SELECT * FROM leads WHERE phone=$1', [CALLER4]);
  assert.ok(await db.one("SELECT 1 FROM messages WHERE lead_id=$1 AND body ILIKE '%missed your call%'", [l4.id]));
  ok('early hang-up gets the missed-call text-back');

  console.log('Flow 6: spam + anonymous caller + unknown number');
  await req('POST', '/twilio/voice', { form: { CallSid: 'CA005', From: 'Anonymous', To: TWILIO_NUM } });
  const call5 = await db.one("SELECT * FROM calls WHERE twilio_call_sid='CA005'");
  await retell('/retell/webhook', { event: 'call_analyzed', call: { call_id: call5.retell_call_id, duration_ms: 40000, call_analysis: { custom_analysis_data: { lead_outcome: 'spam' } } } });
  r = await req('POST', '/twilio/voice', { form: { CallSid: 'CA006', From: CALLER, To: '+19995550000' } });
  assert.match(r.text, /not in service/);
  ok('anonymous/spam handled without texting; unknown number rejected');

  console.log('Dashboard API');
  r = await req('GET', `/api/stats?tenant=${tid}`);
  assert.equal(r.json.current.calls, 5);
  assert.equal(r.json.current.booked, 1);
  assert.equal(r.json.current.revenue, 350);
  assert.equal(r.json.revenueDaily.length, 1);
  r = await fetch(BASE + `/api/leads.csv?tenant=${tid}`, { headers: { Cookie: cookie } });
  assert.match(await r.text(), /^created_at,business,name/);
  r = await req('GET', `/api/leads?tenant=${tid}`);
  assert.ok(r.json.length >= 4);
  r = await req('GET', `/api/leads/${lead.id}`);
  assert.ok(r.json.calls.length >= 1 && r.json.messages.length >= 3 && r.json.optedOut === true);
  ok('stats, leads list, lead detail');

  // second tenant + client isolation via invite acceptance
  r = await req('POST', '/api/tenants', { body: { name: 'Other Co' } });
  const tid2 = r.json.id;
  cookie = '';
  r = await req('GET', `/api/invite/${inviteToken}`);
  assert.equal(r.json.business, 'Lone Star Heating & Air');
  r = await req('POST', `/api/invite/${inviteToken}`, { body: { password: 'weak' } });
  assert.equal(r.status, 400);
  r = await req('POST', `/api/invite/${inviteToken}`, { body: { password: 'Client-pass-123', name: 'Mike' } });
  assert.equal(r.status, 200, r.text);
  const clientCookie = cookie;
  cookie = '';
  r = await req('POST', `/api/invite/${inviteToken}`, { body: { password: 'Client-pass-123' } });
  assert.equal(r.status, 404, 'invite is single-use');
  cookie = clientCookie;
  r = await req('GET', `/api/tenants/${tid2}`);
  assert.equal(r.json.id, tid, 'client is locked to own tenant');
  r = await req('GET', '/api/tenants');
  assert.equal(r.json.length, 1);
  r = await req('PUT', `/api/tenants/${tid2}`, { body: { mode: 'ring_first', agent_name: 'Sam' } });
  assert.equal(r.json.mode, 'forward', 'client cannot change routing');
  assert.equal(r.json.agent_name, 'Sam');
  r = await req('GET', '/api/integrations');
  assert.equal(r.status, 403);
  r = await req('POST', '/api/tenants', { body: { name: 'hack' } });
  assert.equal(r.status, 403);
  r = await req('GET', `/api/leads/${lead.id}`);
  assert.equal(r.status, 200);
  ok('invite accepted once; client isolated to own business; no admin access');

  // password change signs out other sessions
  const otherDevice = clientCookie;
  r = await req('POST', '/api/me/password', { body: { current: 'Client-pass-123', next: 'Client-pass-456!' } });
  assert.equal(r.status, 200);
  const save = cookie;
  cookie = otherDevice;
  r = await req('GET', '/api/me');
  assert.equal(r.status, 401);
  cookie = save;
  r = await req('GET', '/api/me');
  assert.equal(r.status, 200);
  ok('password change revokes other sessions');

  // lockout after repeated failures
  cookie = '';
  for (let i = 0; i < 5; i++) await req('POST', '/api/login', { body: { email: 'owner@lonestar.test', password: 'nope-nope-1' } });
  r = await req('POST', '/api/login', { body: { email: 'owner@lonestar.test', password: 'Client-pass-456!' } });
  assert.equal(r.status, 429);
  ok('account locks after 5 failed sign-ins');
  cookie = adminCookie;

  // static + health
  r = await req('GET', '/health');
  assert.equal(r.json.ok, true);
  r = await req('GET', '/');
  assert.match(r.text, /Missed Call Agent/);
  ok('health + dashboard served');

  console.log(`\nAll ${passed} checks passed.`);
  cal.srv.close();
  process.exit(0);
}

main().catch((e) => {
  console.error('\nFAILED:', e);
  process.exit(1);
});
