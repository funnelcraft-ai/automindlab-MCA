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
- SMS brain: any OpenAI-compatible API (OpenAI, OpenRouter, Gemini, Groq) via `LLM_BASE_URL`
- Booking: Google Calendar (OAuth per client), Cal.com API v2, or a booking link (cal.id, Calendly…), or "team calls back"
- Alerts: SMS to owner phones + email over SMTP (Zoho works)
- Dashboard: vanilla JS, no build step (`/public`)

## 1. Deploy (Railway, ~15 min)

1. Push this folder to a private GitHub repo and create a Railway project from it.
2. Add the **PostgreSQL** plugin. Set `DATABASE_URL` to the plugin's URL (`${{Postgres.DATABASE_URL}}`).
3. Copy `.env.example` into Railway variables and fill in the values. Generate the secrets with:
   `openssl rand -hex 32` → `APP_ENCRYPTION_KEY` (do not change it after go-live) · `openssl rand -base64 48` → `JWT_SECRET`
4. Generate a domain (or attach `calls.automindlab.io`) and set `PUBLIC_BASE_URL` to it (https, no trailing slash).
5. Deploy. The schema migrates on boot and the admin login from `ADMIN_EMAIL` / `ADMIN_PASSWORD` is created. `/health` should return `{"ok":true}`.

Keep **one replica**: per-lead SMS locks and the sweeper run in-process.

## 2. Retell (voice)

1. Create a Retell account and **add a payment card**. Dial-to-SIP calls are refused on trial credit.
2. Copy the API key that has the **webhook badge** into `RETELL_API_KEY`. It signs both webhooks and tool calls.
3. With `PUBLIC_BASE_URL` set, run once locally or in a Railway shell:
   ```
   npm run setup:retell
   ```
   This creates one shared LLM + agent (prompt, 5 custom tools, end_call, post-call analysis, webhook URL). Put the printed `RETELL_LLM_ID` and `RETELL_AGENT_ID` into Railway and redeploy.
4. After you change the prompt in `src/agent/prompt.js`, re-run the same command. With both IDs set, it updates the existing LLM and agent in place.

Every business shares this agent. Business name, services, hours, area, booking mode, emergency policy and what is known about the caller are injected per call as dynamic variables. Per-business voice is an optional override in the dashboard.

## 3. Twilio (numbers + SMS)

1. Buy one **local number per client**, in their area code.
2. **US SMS needs A2P 10DLC registration**: since Feb 2025, carriers block unregistered 10DLC traffic. As an agency (ISV), register **each client's brand** plus a campaign (use case: *Customer Care*/*Mixed*), and attach their number to a Messaging Service. Approval can take days to weeks. Toll-free verification is often faster, so a toll-free number is a reasonable stopgap.
   - Message-flow wording for the campaign: *"Customers who call {Business} and are not answered receive one text from the business number offering help with their service request. Customers can reply to continue the conversation; Reply STOP to opt out, HELP for help."*
   - Put the Messaging Service SID on the business (dashboard → Phone routing) or globally in `TWILIO_MESSAGING_SERVICE_SID`. If a Messaging Service is used, set its **incoming message webhook** to `{PUBLIC_BASE_URL}/twilio/sms`.
3. In the dashboard: **Clients → business → Agent settings → "Point Twilio number at this app"**. That sets the number's voice URL, status callback, and (if no Messaging Service is used) its SMS URL.
4. Voice calls work immediately. Texts only deliver reliably once A2P is approved.

## 4. Onboard a client (10 min)

1. **Clients → Add a business** (name, time zone, Twilio number).
2. **Agent settings**: services, service area, hours, emergency policy, pricing guidance, alert phones/emails, average job value.
3. **Booking**, pick one:
   - *Google Calendar*: set `GOOGLE_CLIENT_ID/SECRET` (Web OAuth client, redirect `{PUBLIC_BASE_URL}/oauth/google/callback`, Calendar API enabled), then **Connect Google Calendar**. Windows come from business hours minus busy times.
   - *Cal.com API*: API key + event type ID. The base URL is configurable for Cal.com-compatible hosts.
   - *Booking link*: e.g. `https://cal.id/clientname`. The AI texts the link and adds it to text-backs. **Use this mode for cal.id**: I couldn't confirm a public cal.id booking API, so live booking into cal.id isn't wired up.
   - *None*: the AI collects details and the team calls back.
4. **Routing mode**:
   - *forward* (most common): the client keeps their number and turns on **conditional call forwarding** (no-answer/busy) to the Twilio number. Typical codes are below; confirm with the carrier.
     - Verizon: `*71` + Twilio number (cancel `*73`)
     - AT&T / T-Mobile: `**004*` + Twilio number + `#` (cancel `##004#`)
     - VoIP/PBX (RingCentral, Google Voice, Ooma, etc.): set "forward unanswered calls" in the admin portal.
   - *ring_first*: the Twilio number becomes the public number (website, GBP, ads). It rings the team phone for N seconds, then the AI takes over. Keep N **below the team phone's voicemail pickup** (usually 20–25s). If voicemail answers first, the call counts as answered.
5. Optional **emergency live transfer**: an on-call tech cell. When the AI detects an emergency, it alerts by text and moves the live call to that number.
6. **Send test text-back** to your own phone, then place a real test call and let it ring out.
7. **Clients → Give a client dashboard access** creates their login. Clients only see their own business and can't change phone routing.

## 5. Local development

```
cp .env.example .env    # set DATABASE_URL, secrets; DRY_RUN=true logs texts instead of sending
npm install
npm start               # http://localhost:3000
npm test                # end-to-end simulation (needs a throwaway Postgres DB; it DROPS the public schema)
```
For real calls locally, expose the port with a tunnel (ngrok / cloudflared), set `PUBLIC_BASE_URL` to it, and re-run `npm run setup:retell`.

`npm test` simulates the full flows against real Postgres, with signed Retell webhooks and a mock Cal.com API: forwarded call → AI → follow-up text; SMS AI reply; STOP opt-out; ring-first hang-up → text-back; ring-first → AI → live Cal.com booking (and a refused stale slot); early hang-up; spam/anonymous; dashboard stats; client isolation.

## Compliance notes (not legal advice; have counsel review before launch)

- **AI + recording disclosure** is in the greeting. Some states (e.g. CA, FL, IL, WA, PA) require all-party consent to record. Keep the disclosure, or set Retell's `data_storage_setting` to stop storing recordings.
- **Texting**: only one automatic text per missed call (max one per 12h per caller), always with STOP language. The AI only replies to people who text in, opt-outs are enforced in-app on top of Twilio's own handling, and the AI is capped at `SMS_MAX_AI_REPLIES_PER_DAY` per lead.
- A missed call is not written SMS consent. A text-back responding to the caller's own inquiry is the common industry practice, but the TCPA rules (including the 2025–26 consent-revocation changes) are worth a legal review for your client agreements. **Don't use these numbers for marketing blasts.**
- The emergency flow tells callers to leave and call 911/the gas utility for gas smells or CO alarms. Keep that in any prompt edits.

## Files

```
src/server.js              app, OAuth callback, admin seed, stale-call sweeper
src/routes/twilio.js       voice routing (forward / ring_first / SIP to Retell), status, inbound SMS, STOP
src/routes/retell.js       signed webhooks (call_started/ended/analyzed) + custom tool endpoints
src/routes/api.js          dashboard API: auth, clients, settings, stats, leads, SMS takeover
src/services/actions.js    availability, booking, lead capture, booking link, emergency transfer + tool schemas
src/services/booking.js    Google Calendar, Cal.com v2 providers
src/services/leads.js      lead upsert, opt-outs, text-back
src/services/notify.js     owner SMS + email alerts
src/agent/prompt.js        voice prompt, greeting, post-call analysis fields, SMS prompt
src/agent/sms-agent.js     SMS AI with tool calling
scripts/setup-retell.js    create/update the Retell LLM + agent
public/                    dashboard
test/e2e.js                end-to-end simulation
```

## Known limits / next steps

- Live booking into cal.id isn't supported yet (link mode only) until its API is confirmed.
- Single instance by design. Scaling out needs a shared lock (Postgres advisory locks) and a single sweeper.
- No billing or usage metering per client. Retell and Twilio costs land on the agency account. Per-client minutes can be pulled from the `calls` table (`duration_sec`).
- Outbound "speed-to-lead" callbacks (calling web-form leads) would be a natural add-on using Retell `createPhoneCall`.
