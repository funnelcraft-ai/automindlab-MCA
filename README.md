# Missed Call Agent (US market, multi-client)

AI agent that rescues missed calls for US home-service businesses (HVAC first). It answers calls the team can't pick up, qualifies the caller, books the job, texts the caller back, and alerts the owner. Each client gets their own number, script, booking setup, alerts and dashboard login.

## What happens on a call

```
Caller ──► Client's business line ──(unanswered → conditional forward)──► Twilio number ──► this app
                                                                                │
             mode "forward": AI answers right away ◄────────────────────────────┤
             mode "ring_first": ring team phone N sec, then AI ◄────────────────┘
                                   │
                    Retell voice agent (SIP: sip:{call_id}@sip.retellai.com)
                    tools → this app: check_availability · book_appointment · save_lead_details
                                      send_booking_link · escalate_emergency (alert + live transfer)
                                   │
           Call ends → Retell post-call analysis → this app decides:
             booked ............ confirmation text to caller + "job booked" alert to owner
             conversation ...... follow-up text ("we have your details…") + lead alert with summary
             hung up early ..... missed-call text-back + alert
             spam .............. nothing
           Caller replies by SMS → AI SMS agent keeps the conversation going and can book too
           (team can take over any thread from the dashboard; AI pauses for that lead)
```

Safety nets: hang-ups while ringing get a text-back; Retell failures fall back to a spoken apology plus a text-back; a sweeper texts back any AI call that never received an analysis within 10 minutes. Callers who text STOP are never texted again.

## Stack

- Node 20+ / Express, PostgreSQL (Railway)
- Twilio (numbers, voice routing, SMS) + Retell AI (voice agent, dial-to-SIP)
- SMS brain + dashboard assistant: any OpenAI-compatible API
- Booking: Google Calendar (OAuth per business), Cal.com API v2, a booking link (cal.id, Calendly…), or "team calls back"
- Alerts: SMS to owner phones + email over SMTP
- Dashboard: vanilla JS modules, no build step (`/public`), light + dark, mobile-friendly

## 1. Deploy (Railway, ~10 min)

1. Push this folder to a private GitHub repo and create a Railway project from it. Add the **PostgreSQL** plugin.
2. Set **two** variables on the service:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `APP_ENCRYPTION_KEY` = output of `openssl rand -hex 32`. Keep it safe and never change it.
3. Generate a Railway domain (or attach `calls.automindlab.io`) and deploy.
4. Open **Deployments → View logs** and copy the **FIRST-TIME SETUP** code.
5. Open the app URL. Enter the setup code, your agency name, email and a password. This screen works only once.

## 2. Paste your keys (Integrations page)

Each card has **Save & test**, which confirms the key works before you rely on it. Keys are encrypted (AES-256-GCM) before storage, and only the last 4 characters are ever shown again.

| Card | What to paste | Where to find it |
|---|---|---|
| App address | Public URL (pre-filled on Railway) | Your domain |
| Twilio | Account SID, Auth Token, optional A2P Messaging Service SID | console.twilio.com → Account info |
| Retell AI | API key **with the webhook badge** (card on file required) → then **Create voice agent** | dashboard.retellai.com → API keys |
| SMS AI (optional) | OpenAI-compatible key | platform.openai.com/api-keys |
| Email alerts (optional) | SMTP host/user/password | Zoho / Google Workspace / Hostinger |
| Google Calendar (optional) | OAuth Web client ID + secret (redirect URI shown on the card) | console.cloud.google.com → Credentials |

The readiness bar turns green when Twilio, Retell, the voice agent and an https address are in place. If you later change the app address, the voice agent's webhook and tool URLs update automatically.

## 3. Onboard a business (guided, ~10 min)

**Businesses → New business** opens a 6-step wizard. Progress is saved at every step, so you can stop and resume.

1. **Business details**: name, industry, website, time zone, owner contact, agent name.
2. **Services & hours**: one-click service presets per industry, service area, weekly hours, emergency rules, pricing guidance, extra knowledge, average job value.
3. **Booking**: Google Calendar (connect button), Cal.com, booking link, or callback. **Preview open windows** shows exactly what the agent will offer.
4. **Phone number**: search by area code and **buy a number in one click** (with a confirmation step), or pick one you already own. Webhooks are configured automatically. Then choose *forward missed calls* or *ring the team first*, plus an optional emergency live-transfer number.
5. **Alerts & texts**: alert phones/emails, text-back wording with a live phone preview, AI SMS on/off, **send a test text-back**.
6. **Test & go live**: launch checklist, a **live "waiting for your test call" watcher**, copy-ready carrier forwarding codes for this number (Verizon `*71…`, AT&T/T-Mobile `**004*…#`, VoIP), and **invite the owner** with a secure one-time link. **Go live** is blocked until every required check passes.

**Test mode:** until a business goes live, only its owner, alert and team phones reach the agent; anyone else hears "not in service". You can test end to end without touching real customers. **Pause** takes a live business offline instantly.

Once live, the same page turns into tabbed settings. Business owners can edit their script, hours, booking and alerts from their own login. Phone routing, numbers and go-live stay with the agency.

## 4. Security

- Only `DATABASE_URL` and `APP_ENCRYPTION_KEY` live in the environment. All other secrets are encrypted in the database and never sent back to the browser.
- First-run setup needs a one-time code from the server logs, so whoever finds the URL first can't claim the instance. It works only while no admin exists.
- Sessions: httpOnly, SameSite cookies, 7-day expiry, rechecked against the database on every request. Changing a password or using "sign out everywhere" revokes all other sessions.
- Passwords: 10+ characters, mixed, not containing the email name; bcrypt cost 12. Accounts lock for 15 minutes after 5 failures, and sign-in endpoints are rate limited.
- CSRF: every state-changing call requires a custom header and a same-origin `Origin`. Strict CSP, `frame-ancestors 'none'`, HSTS on https, nosniff, no third-party scripts or fonts.
- Webhooks: Twilio signatures are verified (`X-Twilio-Signature`). Retell webhooks and tool calls are verified with the Retell signature, plus a random shared tool secret.
- Tenancy: business users are hard-scoped to their own business on every query and can't reach admin endpoints.
- Invites: 32-byte random tokens, stored only as SHA-256 hashes, single-use, expire after 7 days.
- Number purchases need explicit confirmation of the exact number. Settings changes, purchases, invites, go-live and lockouts are written to an audit log (`events` table).
- CSV export is protected against spreadsheet formula injection.

## 5. Local development & demo data

```
cp .env.example .env    # DATABASE_URL + APP_ENCRYPTION_KEY; add DRY_RUN=true to simulate texts/calls/purchases
npm install
npm start               # setup code prints in the console
npm run seed:demo       # adds "Lone Star Heating & Air" with 45 days of realistic calls, leads and bookings (great for sales demos)
npm test                # 28 end-to-end checks (needs a throwaway Postgres DB; it DROPS the public schema)
```

The tests cover first-run setup, CSRF/origin blocking, security headers, encrypted key storage and masking, voice-agent provisioning, input validation, number purchase confirmation, test mode, the go-live checklist, hashed single-use invites, client isolation, session revocation, account lockout, and every call/SMS flow (AI conversation, SMS AI, STOP, ring-first hang-up, Cal.com booking, early hang-up, spam).

## Compliance notes (not legal advice; have counsel review before launch)

- **AI + recording disclosure** is in the greeting. Some states (e.g. CA, FL, IL, WA, PA) require all-party consent to record. Keep the disclosure, or set Retell's `data_storage_setting` to stop storing recordings.
- **Texting**: only one automatic text per missed call (max one per 12h per caller), always with STOP language. The AI only replies to people who text in, opt-outs are enforced in-app on top of Twilio's own handling, and the AI is capped at `SMS_MAX_AI_REPLIES_PER_DAY` per lead.
- A missed call is not written SMS consent. A text-back responding to the caller's own inquiry is the common industry practice, but the TCPA rules (including the 2025–26 consent-revocation changes) are worth a legal review for your client agreements. **Don't use these numbers for marketing blasts.**
- The emergency flow tells callers to leave and call 911/the gas utility for gas smells or CO alarms. Keep that in any prompt edits.

## Files (main)

```
src/server.js              app, security headers, OAuth callback, setup code, stale-call sweeper
src/services/settings.js   encrypted in-app key store (env vars override)
src/services/integrations.js  "Save & test" checks + readiness checklist
src/services/provision.js  creates/updates the shared Retell agent
src/lib/auth.js            sessions, CSRF guard, password policy, tokens
src/routes/twilio.js       voice routing (forward / ring_first / SIP to Retell), status, inbound SMS, STOP
src/routes/retell.js       signed webhooks (call_started/ended/analyzed) + custom tool endpoints
src/routes/api.js          setup, auth, integrations, onboarding, numbers, invites, stats, leads, assistant
src/services/actions.js    availability, booking, lead capture, booking link, emergency transfer + tool schemas
src/services/booking.js    Google Calendar, Cal.com v2 providers
src/services/leads.js      lead upsert, opt-outs, text-back
src/services/notify.js     owner SMS + email alerts
src/agent/prompt.js        voice prompt, greeting, post-call analysis fields, SMS prompt
src/agent/sms-agent.js     SMS AI with tool calling
scripts/setup-retell.js    CLI alternative to the "Create voice agent" button
scripts/seed-demo.js       demo business with realistic history
public/js/                 dashboard (main, shell, dashboard, leads, business wizard, admin/integrations)
test/e2e.js                end-to-end simulation
```

## Known limits / next steps

- Live booking into cal.id isn't supported yet (link mode only) until its API is confirmed.
- Keep **one replica**: rate limits, per-lead SMS locks and the sweeper are in-process. Scaling out needs a shared lock (Postgres advisory locks) and a single sweeper.
- No billing or usage metering per client. Retell and Twilio costs land on the agency account. Per-client minutes can be pulled from the `calls` table (`duration_sec`).
- Outbound "speed-to-lead" callbacks (calling web-form leads) would be a natural add-on using Retell `createPhoneCall`.
