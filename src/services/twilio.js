'use strict';
const twilio = require('twilio');
const { config } = require('../config');

let client = null;
let clientKey = '';
// Rebuilt automatically when the credentials change in the dashboard.
function getClient() {
  const key = config.twilio.accountSid + ':' + config.twilio.authToken;
  if (!client || key !== clientKey) {
    if (!config.twilio.accountSid || !config.twilio.authToken) throw new Error('Twilio is not connected yet (add your keys under Integrations)');
    client = twilio(config.twilio.accountSid, config.twilio.authToken);
    clientKey = key;
  }
  return client;
}

const VoiceResponse = twilio.twiml.VoiceResponse;
const MessagingResponse = twilio.twiml.MessagingResponse;

// Express middleware: reject requests that are not signed by Twilio.
function validateTwilio(req, res, next) {
  if (!config.twilio.validateSignatures) return next();
  const signature = req.header('X-Twilio-Signature');
  const url = config.publicBaseUrl + req.originalUrl;
  const ok = signature && twilio.validateRequest(config.twilio.authToken, signature, url, req.body || {});
  if (!ok) {
    console.warn('[twilio] invalid signature for', url);
    return res.status(403).send('Invalid Twilio signature');
  }
  next();
}

async function sendSms({ from, to, body, messagingServiceSid, statusCallback }) {
  if (config.dryRun) {
    console.log(`[dry-run sms] ${from || messagingServiceSid} -> ${to}: ${body}`);
    return { sid: 'SM_dry_' + Date.now() + Math.floor(Math.random() * 1e6), status: 'dry-run' };
  }
  const params = { to, body, statusCallback };
  const mss = messagingServiceSid || config.twilio.messagingServiceSid;
  if (mss) params.messagingServiceSid = mss;
  else params.from = from;
  return getClient().messages.create(params);
}

// Point a Twilio number's voice + SMS webhooks at this app.
async function configureNumber(e164) {
  if (config.dryRun) return 'PN_dry';
  const list = await getClient().incomingPhoneNumbers.list({ phoneNumber: e164, limit: 1 });
  if (!list.length) throw new Error(`Number ${e164} is not in your Twilio account`);
  // When a Messaging Service is used, inbound SMS routing is set on the service instead.
  await getClient().incomingPhoneNumbers(list[0].sid).update(webhookParams());
  return list[0].sid;
}

function webhookParams() {
  const base = config.publicBaseUrl;
  const p = {
    voiceUrl: `${base}/twilio/voice`,
    voiceMethod: 'POST',
    statusCallback: `${base}/twilio/voice/status`,
    statusCallbackMethod: 'POST',
  };
  if (!config.twilio.messagingServiceSid) {
    p.smsUrl = `${base}/twilio/sms`;
    p.smsMethod = 'POST';
  }
  return p;
}

// Search purchasable US local numbers (voice + SMS capable).
async function searchNumbers({ areaCode, contains, inRegion }) {
  if (config.dryRun) {
    const ac = /^\d{3}$/.test(areaCode || '') ? areaCode : '512';
    return Array.from({ length: 6 }, (_, i) => ({
      phoneNumber: `+1${ac}555${String(100 + i * 7).padStart(4, '0')}`,
      locality: 'Austin',
      region: 'TX',
    }));
  }
  const q = { voiceEnabled: true, smsEnabled: true, limit: 12 };
  if (/^\d{3}$/.test(areaCode || '')) q.areaCode = Number(areaCode);
  if (contains) q.contains = String(contains).replace(/[^0-9*A-Za-z]/g, '').slice(0, 10);
  if (inRegion) q.inRegion = String(inRegion).slice(0, 2).toUpperCase();
  const list = await getClient().availablePhoneNumbers('US').local.list(q);
  return list.map((n) => ({ phoneNumber: n.phoneNumber, locality: n.locality, region: n.region }));
}

async function listOwnedNumbers() {
  if (config.dryRun) return [{ phoneNumber: '+15125550199', friendlyName: 'Demo number', voiceUrl: '' }];
  const list = await getClient().incomingPhoneNumbers.list({ limit: 200 });
  return list.map((n) => ({ phoneNumber: n.phoneNumber, friendlyName: n.friendlyName, voiceUrl: n.voiceUrl }));
}

// Buys a number and points it at this app in one step.
async function buyNumber(phoneNumber, friendlyName) {
  if (config.dryRun) {
    console.log('[dry-run buy number]', phoneNumber);
    return { sid: 'PN_dry_' + phoneNumber.slice(-4), phoneNumber };
  }
  const n = await getClient().incomingPhoneNumbers.create({ phoneNumber, friendlyName: String(friendlyName || '').slice(0, 64), ...webhookParams() });
  return { sid: n.sid, phoneNumber: n.phoneNumber };
}

// Redirect a live call to new TwiML (used for live transfer).
async function updateCallTwiml(callSid, twimlString) {
  if (config.dryRun) {
    console.log(`[dry-run call update] ${callSid}: ${twimlString}`);
    return;
  }
  await getClient().calls(callSid).update({ twiml: twimlString });
}

module.exports = { getClient, VoiceResponse, MessagingResponse, validateTwilio, sendSms, configureNumber, updateCallTwiml, searchNumbers, listOwnedNumbers, buyNumber };
