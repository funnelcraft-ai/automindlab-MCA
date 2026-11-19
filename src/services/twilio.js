'use strict';
const twilio = require('twilio');
const { config } = require('../config');

let client = null;
function getClient() {
  if (!client) {
    if (!config.twilio.accountSid || !config.twilio.authToken) throw new Error('Twilio credentials not set');
    client = twilio(config.twilio.accountSid, config.twilio.authToken);
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
  const base = config.publicBaseUrl;
  const list = await getClient().incomingPhoneNumbers.list({ phoneNumber: e164, limit: 1 });
  if (!list.length) throw new Error(`Number ${e164} not found in this Twilio account`);
  const update = {
    voiceUrl: `${base}/twilio/voice`,
    voiceMethod: 'POST',
    statusCallback: `${base}/twilio/voice/status`,
    statusCallbackMethod: 'POST',
  };
  // When a Messaging Service is used, inbound SMS routing is set on the service instead.
  if (!config.twilio.messagingServiceSid) {
    update.smsUrl = `${base}/twilio/sms`;
    update.smsMethod = 'POST';
  }
  await getClient().incomingPhoneNumbers(list[0].sid).update(update);
  return list[0].sid;
}

// Redirect a live call to new TwiML (used for live transfer).
async function updateCallTwiml(callSid, twimlString) {
  if (config.dryRun) {
    console.log(`[dry-run call update] ${callSid}: ${twimlString}`);
    return;
  }
  await getClient().calls(callSid).update({ twiml: twimlString });
}

module.exports = { getClient, VoiceResponse, MessagingResponse, validateTwilio, sendSms, configureNumber, updateCallTwiml };
