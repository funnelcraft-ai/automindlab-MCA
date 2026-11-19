#!/usr/bin/env node
'use strict';
// Creates a demo HVAC business with ~45 days of realistic calls, leads, texts and bookings.
// Great for sales demos. Usage: npm run seed:demo   (safe to re-run; replaces the previous demo business)
const db = require('../src/db');

const NAMES = ['Maria Lopez', 'Dave Kim', 'Sarah Whitfield', 'James Carter', 'Priya Patel', 'Tom Ray', 'Linda Nguyen', 'Robert Hayes', 'Emily Chen', 'Marcus Johnson', 'Ashley Brooks', 'Kevin Murphy', 'Rachel Green', 'Daniel Ortiz', 'Megan Foster', 'Chris Walker', 'Olivia Martin', 'Jason Lee', 'Hannah Scott', 'Brian Cooper'];
const ISSUES = [
  ['AC blowing warm air', 'urgent'], ['Furnace won\'t ignite', 'urgent'], ['Wants a spring AC tune-up', 'routine'], ['Strange rattling from outdoor unit', 'routine'],
  ['No heat, elderly parent at home', 'emergency'], ['Thermostat blank screen', 'routine'], ['Water leaking from indoor unit', 'urgent'], ['Quote for new heat pump', 'routine'],
  ['Burning smell when heat turns on', 'urgent'], ['AC frozen coil', 'urgent'], ['Carbon monoxide alarm went off', 'emergency'], ['Duct cleaning estimate', 'routine'],
];
const STREETS = ['Elm St', 'Oak Ave', 'Barton Springs Rd', 'Cedar Ln', 'Riverside Dr', 'Lamar Blvd', 'Pecan St', 'Magnolia Way'];
const CITIES = ['Austin', 'Round Rock', 'Cedar Park', 'Pflugerville', 'Georgetown'];
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];

(async () => {
  await db.migrate();
  await db.query("DELETE FROM tenants WHERE slug='demo-lone-star'");
  const t = await db.one(
    `INSERT INTO tenants (name, slug, industry, timezone, active, twilio_number, mode, booking_provider, booking_link, notify_phones, notify_emails,
       owner_name, owner_phone, owner_email, service_area, avg_job_value, onboarding_step, go_live_at)
     VALUES ('Lone Star Heating & Air','demo-lone-star','HVAC','America/Chicago',TRUE,'+15125550142','forward','link','https://cal.id/lonestar-air',
       '+15125550100','office@lonestarair.example','Mike Johnson','+15125550100','mike@lonestarair.example','Austin, Round Rock, Cedar Park, Pflugerville',
       425, 6, now() - interval '50 days') RETURNING *`
  );
  let made = 0;
  for (let d = 44; d >= 0; d--) {
    const perDay = 2 + rnd(5) + ([1, 2].includes(new Date(Date.now() - d * 864e5).getDay()) ? 3 : 0);
    for (let i = 0; i < perDay; i++) {
      const at = new Date(Date.now() - d * 864e5 - rnd(10 * 3600e3) - 3600e3);
      const phone = `+1512555${String(1000 + rnd(8999))}`;
      const roll = Math.random();
      const path = roll < 0.18 ? 'answered' : roll < 0.28 ? 'abandoned' : 'ai';
      const [issue, urgency] = pick(ISSUES);
      const name = pick(NAMES);
      let outcome = null, status = 'new';
      if (path === 'ai') {
        const o = Math.random();
        outcome = o < 0.42 ? 'booked' : o < 0.72 ? 'callback_requested' : o < 0.84 ? 'info_only' : o < 0.94 ? 'hung_up_early' : 'spam';
        status = outcome === 'booked' ? (d > 7 && Math.random() < 0.6 ? 'won' : 'booked') : outcome === 'spam' ? 'spam' : Math.random() < 0.5 ? 'contacted' : 'new';
      } else if (path === 'abandoned') {
        outcome = 'hung_up_early';
        status = 'contacted';
      }
      if (path === 'answered') {
        await db.query(`INSERT INTO calls (tenant_id, twilio_call_sid, from_number, to_number, path, started_at, ended_at, duration_sec) VALUES ($1,$2,$3,$4,'answered',$5,$5,$6)`, [t.id, `CAdemo${d}_${i}_${rnd(1e9)}`, phone, t.twilio_number, at, 120 + rnd(300)]);
        continue;
      }
      const known = outcome !== 'hung_up_early' && outcome !== 'spam';
      const appt = outcome === 'booked' ? new Date(at.getTime() + (1 + rnd(3)) * 864e5) : null;
      const lead = await db.one(
        `INSERT INTO leads (tenant_id, phone, name, address, issue, urgency, status, source, appointment_start, created_at, last_activity_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'voice',$8,$9,$9) ON CONFLICT (tenant_id, phone) DO NOTHING RETURNING id`,
        [t.id, phone, known ? name : null, known ? `${100 + rnd(9800)} ${pick(STREETS)}, ${pick(CITIES)}` : null, known ? issue : null, known ? urgency : null, status, appt, at]
      );
      if (!lead) continue;
      const summary = {
        booked: `${name.split(' ')[0]} reported "${issue.toLowerCase()}". Booked a visit and sent a confirmation text.`,
        callback_requested: `${name.split(' ')[0]} needs help with ${issue.toLowerCase()} and asked for a callback.`,
        info_only: `${name.split(' ')[0]} asked about service area and hours.`,
        hung_up_early: 'Caller hung up before sharing details. Text-back sent.',
        spam: 'Robocall about business listings.',
      }[outcome];
      await db.query(
        `INSERT INTO calls (tenant_id, lead_id, twilio_call_sid, retell_call_id, from_number, to_number, path, outcome, summary, duration_sec, textback_sent, started_at, ended_at, transcript, analysis)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,$13,'{"demo":true}')`,
        [t.id, lead.id, `CAdemo${d}_${i}_${rnd(1e9)}`, path === 'ai' ? `call_demo_${d}_${i}_${rnd(1e9)}` : null, phone, t.twilio_number, path, outcome, summary,
          path === 'ai' ? (outcome === 'hung_up_early' ? 6 : 70 + rnd(180)) : 8, outcome !== 'booked' && outcome !== 'spam', at,
          known ? `Agent: Hi, thanks for calling Lone Star Heating & Air! This is Ava, the virtual assistant. How can I help?\nUser: Hi, ${issue.toLowerCase()}.\nAgent: I'm sorry to hear that. Can I get your name and the service address?\nUser: ${name}, ${pick(CITIES)}.\nAgent: Thanks, ${name.split(' ')[0]}. ${outcome === 'booked' ? 'I have tomorrow between 10 and noon, does that work?\nUser: Perfect.\nAgent: You are booked. You will get a text confirmation shortly.' : 'I have passed this to the team and they will call you back shortly.'}` : null]
      );
      if (outcome === 'booked') await db.query(`INSERT INTO events (tenant_id, lead_id, type, data, created_at) VALUES ($1,$2,'appointment_booked','{}',$3)`, [t.id, lead.id, at]);
      if (outcome !== 'booked' && outcome !== 'spam') {
        await db.query(`INSERT INTO messages (tenant_id, lead_id, direction, author, body, status, created_at) VALUES ($1,$2,'out','system',$3,'delivered',$4)`, [
          t.id, lead.id, outcome === 'hung_up_early' ? "Hi, this is Lone Star Heating & Air - sorry we missed your call! How can we help? Reply here to get scheduled or book here: https://cal.id/lonestar-air. Reply STOP to opt out." : `Thanks for calling Lone Star Heating & Air, ${name.split(' ')[0]}! We have your details and the team will reach out shortly. Reply here anytime. Reply STOP to opt out.`, new Date(at.getTime() + 60e3)]);
        await db.query(`INSERT INTO events (tenant_id, lead_id, type, created_at) VALUES ($1,$2,'textback_sent',$3)`, [t.id, lead.id, at]);
        if (Math.random() < 0.35) {
          await db.query(`INSERT INTO messages (tenant_id, lead_id, direction, author, body, created_at) VALUES ($1,$2,'in','caller',$3,$4),($1,$2,'out','ai',$5,$6)`, [
            t.id, lead.id, 'Can someone come out tomorrow morning?', new Date(at.getTime() + 600e3), 'Absolutely - I can text you our open windows. What is the service address?', new Date(at.getTime() + 640e3)]);
        }
      }
      if (urgency === 'emergency' && known) await db.query(`INSERT INTO events (tenant_id, lead_id, type, created_at) VALUES ($1,$2,'emergency_escalated',$3)`, [t.id, lead.id, at]);
      made++;
    }
  }
  console.log(`Demo business "${t.name}" (id ${t.id}) seeded with ${made} leads.`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
