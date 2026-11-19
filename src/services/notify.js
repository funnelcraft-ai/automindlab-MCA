'use strict';
const nodemailer = require('nodemailer');
const { config } = require('../config');
const { splitList, prettyPhone, truncate } = require('../lib/util');
const { speakable } = require('../lib/time');
const { sendSms } = require('./twilio');

let transporter = null;
let transporterKey = '';
function mailer() {
  if (!config.smtp.host) return null;
  const key = JSON.stringify(config.smtp);
  if (!transporter || key !== transporterKey) {
    transporterKey = key;
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
  }
  return transporter;
}

async function sendEmail(to, subject, text) {
  if (!to.length) return;
  if (config.dryRun || !mailer()) {
    console.log(`[${config.dryRun ? 'dry-run' : 'no-smtp'} email] to=${to.join(',')} subject=${subject}\n${text}`);
    return;
  }
  await mailer().sendMail({ from: config.smtp.from || config.smtp.user, to: to.join(','), subject, text });
}

function leadLines(tenant, lead, extra = {}) {
  const lines = [];
  lines.push(`Caller: ${lead.name || 'Unknown'} ${prettyPhone(lead.phone)}`);
  if (lead.urgency) lines.push(`Urgency: ${lead.urgency.toUpperCase()}`);
  if (lead.issue) lines.push(`Issue: ${lead.issue}`);
  if (lead.address) lines.push(`Address: ${lead.address}`);
  if (lead.appointment_start) lines.push(`Booked: ${speakable(new Date(lead.appointment_start).toISOString(), tenant.timezone)}`);
  if (extra.summary) lines.push(`Summary: ${extra.summary}`);
  return lines;
}

// Alert the business owner about a lead. kind: 'booked' | 'lead' | 'emergency' | 'sms' | 'abandoned'
async function notifyOwner(tenant, lead, kind, extra = {}) {
  const titles = {
    booked: 'New job booked by AI',
    lead: 'New lead from missed call',
    emergency: 'EMERGENCY call - call back now',
    sms: 'New text from a lead',
    abandoned: 'Missed call - caller hung up',
  };
  const title = titles[kind] || 'Missed call update';
  const lines = leadLines(tenant, lead, extra);
  const dashUrl = `${config.publicBaseUrl}/#/leads/${lead.id}`;
  const smsBody = truncate(`[${tenant.name}] ${title}\n${lines.join('\n')}\n${dashUrl}`, 600);
  const tasks = [];
  for (const phone of splitList(tenant.notify_phones)) {
    tasks.push(
      sendSms({ from: tenant.twilio_number, to: phone, body: smsBody, messagingServiceSid: tenant.messaging_service_sid }).catch((e) =>
        console.error('[notify] owner sms failed', e.message)
      )
    );
  }
  tasks.push(
    sendEmail(splitList(tenant.notify_emails), `${title} - ${lead.name || prettyPhone(lead.phone)}`, `${lines.join('\n')}\n\nOpen in dashboard: ${dashUrl}\n`).catch(
      (e) => console.error('[notify] email failed', e.message)
    )
  );
  await Promise.all(tasks);
}

module.exports = { notifyOwner, sendEmail, mailer };
