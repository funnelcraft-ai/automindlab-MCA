import { state, esc, icon, api, $, $$, phone, num, toast, busy, modal, copyText, formData, ago } from './lib.js';
import { shell, isAdmin, setTenant } from './shell.js';
import { reloadTenants } from './main.js';

const INDUSTRIES = ['HVAC', 'Plumbing', 'Electrical', 'Roofing', 'Garage doors', 'Pest control', 'Appliance repair', 'Landscaping', 'Cleaning', 'Auto repair', 'Med spa', 'Other'];
const SERVICE_PRESETS = {
  HVAC: ['AC repair', 'Furnace repair', 'Heat pumps', 'Maintenance tune-ups', 'New system installs', 'Ductwork', 'Indoor air quality', 'Thermostats'],
  Plumbing: ['Leak repair', 'Drain cleaning', 'Water heaters', 'Sewer lines', 'Toilets & faucets', 'Repiping', 'Sump pumps'],
  Electrical: ['Panel upgrades', 'Outlets & wiring', 'Lighting', 'EV chargers', 'Generators', 'Troubleshooting'],
  Roofing: ['Roof repair', 'Roof replacement', 'Inspections', 'Storm damage', 'Gutters'],
};
const TZ = [['America/New_York', 'Eastern'], ['America/Chicago', 'Central'], ['America/Denver', 'Mountain'], ['America/Phoenix', 'Arizona'], ['America/Los_Angeles', 'Pacific'], ['America/Anchorage', 'Alaska'], ['Pacific/Honolulu', 'Hawaii'], ['America/Toronto', 'Toronto'], ['America/Vancouver', 'Vancouver']];
const DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];
const STEPS = [
  ['business', 'Business details', 'Who the agent answers for'],
  ['services', 'Services & hours', 'What the agent knows'],
  ['booking', 'Booking', 'How jobs get scheduled'],
  ['phone', 'Phone number', 'Where missed calls go'],
  ['alerts', 'Alerts & texts', 'Who gets notified'],
  ['golive', 'Test & go live', 'Checks, forwarding, invite'],
];

// ---------------- list ----------------
export async function viewBusinesses(params) {
  await reloadTenants();
  const rows = state.tenants;
  const content = shell(
    'businesses',
    `<div class="ph"><div><h1>Businesses</h1><div class="sub">${num(rows.filter((t) => t.active).length)} live · ${num(rows.filter((t) => !t.active).length)} onboarding or paused</div></div>
      <div class="actions"><button class="btn primary" id="newBiz">${icon('plus', 15)} New business</button></div></div>
    <div class="card">${
      rows.length
        ? `<div class="tw"><table><thead><tr><th>Business</th><th>Status</th><th>Agent number</th><th>Booking</th><th>Calls (30d)</th><th>Booked (30d)</th><th></th></tr></thead><tbody>
      ${rows
        .map((t) => {
          const pct = Math.round(((t.active ? 6 : Math.max(0, t.onboarding_step - 1)) / 6) * 100);
          return `<tr class="click" data-href="#/businesses/${t.id}">
          <td><div class="who"><div class="ilogo" style="width:32px;height:32px">${icon('building', 15)}</div><div><b>${esc(t.name)}</b><span class="muted small">${esc(t.industry)}</span></div></div></td>
          <td>${t.active ? '<span class="tag t-live">Live</span>' : t.go_live_at ? '<span class="tag t-paused">Paused</span>' : `<div style="min-width:120px"><span class="tag t-new">Onboarding · ${pct}%</span><div class="progress" style="margin-top:6px;height:5px"><i style="width:${pct}%"></i></div></div>`}</td>
          <td class="tnum">${t.twilio_number ? esc(phone(t.twilio_number)) : '<span class="muted">Not assigned</span>'}</td>
          <td>${esc({ none: 'Callback', google: 'Google Calendar', calcom: 'Cal.com', link: 'Booking link' }[t.booking_provider] || '')}</td>
          <td class="tnum">${num(t.calls_30d)}</td><td class="tnum">${num(t.booked_30d)}</td>
          <td>${icon('chevronRight', 16, 'muted')}</td></tr>`;
        })
        .join('')}</tbody></table></div>`
        : `<div class="empty">${icon('rocket', 28)}<h3 style="margin:6px 0">Onboard your first business</h3><div style="margin-bottom:14px">You'll set up their script, booking, phone number and alerts, then test before going live.</div><button class="btn primary" id="newBiz2">${icon('plus', 15)} New business</button></div>`
    }</div>`
  );
  $$('[data-href]', content).forEach((tr) => (tr.onclick = () => (location.hash = tr.dataset.href)));
  const open = () => newBusinessModal();
  $('#newBiz').onclick = open;
  if ($('#newBiz2')) $('#newBiz2').onclick = open;
  if (params?.get('new') === '1') open();
}

export function newBusinessModal() {
  modal({
    title: 'New business',
    confirm: 'Create & start onboarding',
    body: `<form id="nb"><label class="f" style="margin-top:0">Business name</label><input class="in" name="name" required maxlength="120" placeholder="Lone Star Heating & Air" autofocus />
      <div class="grid2"><div><label class="f">Industry</label><select class="in" name="industry">${INDUSTRIES.map((i) => `<option>${i}</option>`).join('')}</select></div>
      <div><label class="f">Time zone</label><select class="in" name="timezone">${TZ.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div></div>
      <p class="hint" style="margin-top:12px">The business stays in <b>test mode</b> until you go live: only the owner's phones reach the agent.</p></form>`,
    onConfirm: async (wrap) => {
      const f = formData($('#nb', wrap));
      if (!f.name.trim()) throw new Error('Enter the business name');
      const t = await api('/tenants', { method: 'POST', body: f });
      await reloadTenants();
      setTenant(t.id);
      location.hash = `#/businesses/${t.id}`;
    },
  });
}

// ---------------- business page (wizard while onboarding, tabs once live) ----------------
export async function viewBusiness(id, params) {
  const t = await api('/tenants/' + id);
  const adm = isAdmin();
  const onboarding = !t.active && !t.go_live_at;
  const maxStep = Math.min(6, Math.max(1, t.onboarding_step || 1));
  let key = params.get('step') || (onboarding ? STEPS[maxStep - 1][0] : 'business');
  if (!STEPS.some((s) => s[0] === key)) key = 'business';
  const idx = STEPS.findIndex((s) => s[0] === key);
  const status = t.active ? '<span class="tag t-live">Live</span>' : t.go_live_at ? '<span class="tag t-paused">Paused</span>' : '<span class="tag t-new">Test mode</span>';

  const content = shell(
    'businesses',
    `<div class="ph"><div>${adm ? `<a href="#/businesses" class="small">${icon('chevronLeft', 13)} Businesses</a>` : ''}
        <div class="row" style="margin-top:4px"><h1>${esc(t.name)}</h1>${status}</div>
        <div class="sub">${onboarding ? `Onboarding · step ${idx + 1} of 6` : esc(t.industry) + (t.twilio_number ? ' · ' + esc(phone(t.twilio_number)) : '')}</div></div>
      <div class="actions">${params.get('google') ? `<span class="tag t-ok">Google Calendar connected</span>` : ''}<button class="btn" id="talkBtn">${icon('mic', 15)} Talk to the agent</button></div></div>
    ${onboarding ? `<div class="progress" style="margin:-6px 0 18px"><i style="width:${Math.round(((maxStep - 1) / 6) * 100)}%"></i></div>` : ''}
    <div class="wiz">
      <div class="card steps" style="padding:8px">${STEPS.map(
        ([k, l, s], i) => `<a class="step ${k === key ? 'on' : ''} ${onboarding && i + 1 < maxStep ? 'done' : ''}" href="#/businesses/${id}?step=${k}" style="text-decoration:none;color:inherit">
          <span class="sn">${onboarding && i + 1 < maxStep && k !== key ? icon('check', 13) : i + 1}</span><div><b>${l}</b><span>${s}</span></div></a>`
      ).join('')}</div>
      <div class="card" id="stepCard"></div></div>`
  );

  $('#talkBtn').onclick = () => openCallModal(t);
  const card = $('#stepCard');
  const ctx = { t, id, adm, onboarding, key, idx, card, reload: () => viewBusiness(id, new URLSearchParams(`step=${key}`)) };
  await SECTIONS[key](ctx);
  // Shared footer: Back / Save & continue (wizard) or Save (settings)
  const form = $('form.sec', card);
  if (form) {
    form.insertAdjacentHTML(
      'beforeend',
      `<div class="wiz-f"><div>${idx > 0 ? `<a class="btn" href="#/businesses/${id}?step=${STEPS[idx - 1][0]}">${icon('chevronLeft', 14)} Back</a>` : ''}</div>
       <div class="row"><span class="muted small" id="saveNote"></span><button class="btn primary" type="submit">${onboarding && idx < 5 ? `Save & continue ${icon('arrowRight', 14)}` : 'Save changes'}</button></div></div>`
    );
    form.onsubmit = (e) => {
      e.preventDefault();
      busy($('button[type=submit]', form), async () => {
        const body = ctx.collect ? ctx.collect(form) : formData(form);
        if (onboarding && adm) body.onboarding_step = Math.max(maxStep, idx + 2);
        await api('/tenants/' + id, { method: 'PUT', body });
        await reloadTenants();
        toast('Saved');
        if (onboarding && idx < 5) location.hash = `#/businesses/${id}?step=${STEPS[idx + 1][0]}`;
        else ctx.reload();
      });
    };
  }
}

const field = (t, name, label, { type = 'text', ph = '', hint = '', dis = false, req = false, max = 200 } = {}) =>
  `<label class="f" for="f_${name}">${label}${req ? ' <span style="color:var(--red)">*</span>' : ''}</label><input class="in" id="f_${name}" name="${name}" type="${type}" value="${esc(t[name] ?? '')}" placeholder="${esc(ph)}" ${dis ? 'disabled' : ''} ${req ? 'required' : ''} maxlength="${max}" />${hint ? `<div class="hint">${hint}</div>` : ''}`;
const area = (t, name, label, { hint = '', ph = '', rows = 3 } = {}) =>
  `<label class="f" for="f_${name}">${label}</label><textarea class="in" id="f_${name}" name="${name}" rows="${rows}" placeholder="${esc(ph)}" maxlength="4000">${esc(t[name] ?? '')}</textarea>${hint ? `<div class="hint">${hint}</div>` : ''}`;

const SECTIONS = {
  // 1 ---------------------------------------------------------------
  async business({ t, adm, card }) {
    card.innerHTML = `<form class="sec"><div class="card-h"><div><h2>Business details</h2><div class="muted small">The agent introduces itself on behalf of this business.</div></div></div>
      <div class="grid2"><div>${field(t, 'name', 'Business name', { req: true, dis: !adm, max: 120 })}</div>
      <div><label class="f">Industry</label><select class="in" name="industry" ${adm ? '' : 'disabled'}>${INDUSTRIES.map((i) => `<option ${i === t.industry ? 'selected' : ''}>${i}</option>`).join('')}</select></div></div>
      <div class="grid2"><div>${field(t, 'website', 'Website', { ph: 'https://lonestarair.com', type: 'url' })}</div>
      <div><label class="f">Time zone</label><select class="in" name="timezone" ${adm ? '' : 'disabled'}>${TZ.map(([v, l]) => `<option value="${v}" ${v === t.timezone ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <h3 style="margin-top:22px">Owner contact</h3><div class="hint">Used for test mode, alerts and the dashboard invite.</div>
      <div class="grid3"><div>${field(t, 'owner_name', 'Name', { ph: 'Mike Johnson' })}</div><div>${field(t, 'owner_phone', 'Mobile', { type: 'tel', ph: '(512) 555-0100' })}</div><div>${field(t, 'owner_email', 'Email', { type: 'email', ph: 'mike@lonestarair.com' })}</div></div>
      <h3 style="margin-top:22px">Voice agent</h3>
      <div class="grid2"><div>${field(t, 'agent_name', 'Agent name', { hint: 'The name it introduces itself with, e.g. "This is Ava"', max: 40 })}</div><div></div></div></form>`;
  },

  // 2 ---------------------------------------------------------------
  async services(ctx) {
    const { t, card } = ctx;
    const presets = SERVICE_PRESETS[t.industry] || [];
    const hours = t.business_hours || {};
    card.innerHTML = `<form class="sec"><div class="card-h"><div><h2>Services & hours</h2><div class="muted small">Everything here is spoken knowledge for the agent. Plain English works best.</div></div></div>
      ${area(t, 'services', 'Services offered', { ph: 'AC repair, furnace repair, heat pumps…' })}
      ${presets.length ? `<div class="row" style="margin-top:8px;gap:6px">${presets.map((p) => `<button type="button" class="btn xs" data-svc="${esc(p)}">${icon('plus', 11)} ${esc(p)}</button>`).join('')}</div>` : ''}
      ${field(t, 'service_area', 'Service area', { ph: 'Austin, Round Rock, Cedar Park, Pflugerville', hint: 'Cities, counties or ZIP codes. The agent flags callers outside it.', max: 600 })}
      <label class="f">Business hours (${esc(t.timezone)})</label>
      <div class="inner" style="padding:6px 14px">${DAYS.map(([k, label]) => {
        const h = hours[k];
        return `<div class="row" style="padding:7px 0;border-bottom:1px solid var(--line);flex-wrap:nowrap"><span style="width:96px;font-weight:550">${label}</span>
          <label class="switch"><input type="checkbox" data-h="${k}-on" ${h ? 'checked' : ''}/><span></span></label>
          <input class="in" type="time" data-h="${k}-o" value="${h ? h[0] : '08:00'}" style="width:130px;height:34px" aria-label="${label} open" />
          <span class="muted">to</span><input class="in" type="time" data-h="${k}-c" value="${h ? h[1] : '17:00'}" style="width:130px;height:34px" aria-label="${label} close" /></div>`;
      }).join('')}</div>
      <div class="hint">After hours the agent still answers, books the next open window, and escalates emergencies.</div>
      ${area(t, 'emergency_policy', 'What counts as an emergency')}
      ${area(t, 'pricing_notes', 'Pricing guidance', { hint: 'E.g. "$89 diagnostic fee, waived with repair". Leave the default to avoid quoting.' })}
      ${area(t, 'extra_instructions', 'Anything else the agent should know', { ph: 'Financing available. We service Trane, Carrier, Lennox. 10% off for veterans.' })}
      <div class="grid2"><div>${field(t, 'avg_job_value', 'Average job value (USD)', { type: 'number', hint: 'Powers the revenue-recovered estimate.' })}</div></div></form>`;
    $$('[data-svc]', card).forEach(
      (b) =>
        (b.onclick = () => {
          const ta = $('#f_services');
          const cur = ta.value.split(',').map((s) => s.trim()).filter(Boolean);
          if (!cur.includes(b.dataset.svc)) ta.value = [...cur, b.dataset.svc].join(', ');
          b.disabled = true;
        })
    );
    ctx.collect = (form) => {
      const f = formData(form);
      const bh = {};
      for (const [k] of DAYS) bh[k] = $(`[data-h="${k}-on"]`).checked ? [$(`[data-h="${k}-o"]`).value, $(`[data-h="${k}-c"]`).value] : null;
      f.business_hours = bh;
      return f;
    };
  },

  // 3 ---------------------------------------------------------------
  async booking(ctx) {
    const { t, card, id } = ctx;
    const opt = (v, title, desc, extra = '') =>
      `<label><input type="radio" name="booking_provider" value="${v}" ${t.booking_provider === v ? 'checked' : ''}/><div><b>${title}</b><span>${desc}</span>${extra}</div></label>`;
    card.innerHTML = `<form class="sec"><div class="card-h"><div><h2>Booking</h2><div class="muted small">How the agent turns a caller into a scheduled job.</div></div></div>
      <div class="choice">
        ${opt('google', 'Google Calendar', 'Books live into open windows on their calendar.', t.google_connected ? ' <span class="tag t-ok" style="margin-top:6px">Connected</span>' : '')}
        ${opt('calcom', 'Cal.com', 'Books live through a Cal.com event type.', t.calcom_key_set ? ' <span class="tag t-ok" style="margin-top:6px">Key saved</span>' : '')}
        ${opt('link', 'Booking link', 'Texts their booking page (cal.id, Calendly, Housecall Pro…).')}
        ${opt('none', 'Team calls back', 'Agent captures details; the owner gets an alert to call back.')}
      </div>
      <div id="bk-google" class="bk"><div class="inner" style="margin-top:14px">
        ${t.google_connected ? `<div class="row" style="justify-content:space-between"><span class="status ok">Google Calendar connected</span><button type="button" class="btn sm danger" id="gdis">Disconnect</button></div>` : t.googleAvailable ? `<button type="button" class="btn primary" id="gcon">${icon('calendar', 15)} Connect Google Calendar</button><div class="hint">The business owner can also do this from their own login.</div>` : `<div class="banner warn" style="margin:0">${icon('alert')}<div>Google Calendar isn't enabled on the platform yet.${isAdmin() ? ' Add the Google keys under <a href="#/integrations">Integrations</a>.' : ''}</div></div>`}
        ${field(t, 'google_calendar_id', 'Calendar ID', { hint: '"primary" or a specific calendar (e.g. a shared "Service visits" calendar).' })}</div></div>
      <div id="bk-calcom" class="bk"><div class="inner" style="margin-top:14px">
        <label class="f" style="margin-top:0">Cal.com API key</label><input class="in" name="calcom_api_key" type="password" autocomplete="off" placeholder="${t.calcom_key_set ? '•••••••• saved - type to replace' : 'cal_live_…'}" />
        <div class="grid2"><div>${field(t, 'calcom_event_type_id', 'Event type ID', { ph: '123456' })}</div><div>${field(t, 'calcom_base_url', 'API base URL', { hint: 'Leave as https://api.cal.com unless self-hosted.' })}</div></div></div></div>
      <div id="bk-link" class="bk"><div class="inner" style="margin-top:14px">${field(t, 'booking_link', 'Booking page link', { type: 'url', ph: 'https://cal.id/lonestar-air', hint: 'Also added to the missed-call text-back.', max: 300 })}</div></div>
      <div id="bk-slots" class="bk"><h3 style="margin-top:20px">Appointment windows</h3>
        <div class="grid3"><div>${field(t, 'slot_minutes', 'Window length (min)', { type: 'number' })}</div><div>${field(t, 'min_lead_minutes', 'Minimum notice (min)', { type: 'number' })}</div><div>${field(t, 'booking_days_ahead', 'Book up to (days)', { type: 'number' })}</div></div>
        <div class="row" style="margin-top:14px"><button type="button" class="btn sm" id="avail">${icon('clock', 14)} Preview open windows</button><span class="muted small" id="availOut"></span></div></div></form>`;
    const sync = () => {
      const v = $('input[name=booking_provider]:checked', card)?.value || 'none';
      $('#bk-google').style.display = v === 'google' ? '' : 'none';
      $('#bk-calcom').style.display = v === 'calcom' ? '' : 'none';
      $('#bk-link').style.display = v === 'link' || v === 'none' ? '' : 'none';
      $('#bk-slots').style.display = v === 'google' || v === 'calcom' ? '' : 'none';
    };
    $$('input[name=booking_provider]', card).forEach((r) => (r.onchange = sync));
    sync();
    const gcon = $('#gcon');
    if (gcon) gcon.onclick = () => busy(gcon, async () => (location.href = (await api(`/tenants/${id}/google/connect`)).url));
    const gdis = $('#gdis');
    if (gdis) gdis.onclick = () => busy(gdis, async () => (await api('/tenants/' + id, { method: 'PUT', body: { disconnect_google: true } }), ctx.reload()));
    $('#avail').onclick = (e) =>
      busy(e.currentTarget, async () => {
        const out = $('#availOut');
        try {
          const s = await api(`/tenants/${id}/availability`);
          out.textContent = s.length ? s.slice(0, 4).map((x) => new Date(x.start).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: t.timezone })).join(' · ') : 'No open windows found.';
        } catch (er) {
          out.textContent = er.message + ' (save first if you just changed settings)';
        }
      });
    ctx.collect = (form) => {
      const f = formData(form);
      if (!f.calcom_api_key) delete f.calcom_api_key;
      return f;
    };
  },

  // 4 ---------------------------------------------------------------
  async phone(ctx) {
    const { t, card, adm, id } = ctx;
    const modeOpt = (v, title, desc) => `<label><input type="radio" name="mode" value="${v}" ${t.mode === v ? 'checked' : ''} ${adm ? '' : 'disabled'}/><div><b>${title}</b><span>${desc}</span></div></label>`;
    card.innerHTML = `<form class="sec"><div class="card-h"><div><h2>Phone number</h2><div class="muted small">The agent answers on a dedicated number. Missed calls reach it by forwarding.</div></div></div>
      <div class="inner"><div class="row" style="justify-content:space-between"><div><div class="muted small">Agent number</div>
        <div style="font-size:20px;font-weight:650" class="tnum">${t.twilio_number ? esc(phone(t.twilio_number)) : '<span class="muted" style="font-size:15px">Not assigned yet</span>'}</div></div>
        ${t.twilio_number && adm ? `<button type="button" class="btn sm" id="recfg">${icon('refresh', 14)} Re-sync webhooks</button>` : ''}</div>
        ${adm ? `<div id="numPicker" style="margin-top:14px"></div>` : `<div class="hint" style="margin-top:8px">Your agency manages the phone number.</div>`}</div>
      <h3 style="margin-top:22px">How calls reach the agent</h3>
      <div class="choice">${modeOpt('forward', 'Forward missed calls (recommended)', 'They keep their number and forward unanswered calls here. The AI answers instantly.')}
        ${modeOpt('ring_first', 'Ring the team first', 'This number is published. It rings their phone, and the AI picks up if nobody answers.')}</div>
      <div id="ringBox" class="grid2"><div>${field(t, 'ring_number', 'Team phone to ring first', { type: 'tel', dis: !adm, ph: '(512) 555-0100' })}</div>
        <div>${field(t, 'ring_timeout_sec', 'Seconds before AI picks up', { type: 'number', hint: 'Keep it shorter than their voicemail (usually 20–25s).' })}</div></div>
      ${field(t, 'transfer_number', 'Emergency live-transfer number (optional)', { type: 'tel', ph: 'On-call tech mobile', hint: 'For gas leaks, no heat in freezing weather, etc. The agent alerts this person and connects the caller. Leave blank to alert by text only.' })}</form>`;
    const sync = () => ($('#ringBox').style.display = $('input[name=mode]:checked', card)?.value === 'ring_first' ? '' : 'none');
    $$('input[name=mode]', card).forEach((r) => (r.onchange = sync));
    sync();
    if ($('#recfg')) $('#recfg').onclick = (e) => busy(e.currentTarget, async () => (await api(`/tenants/${id}/configure-number`, { method: 'POST' }), toast('Webhooks synced')));
    if (adm) numberPicker($('#numPicker'), t, ctx);
  },

  // 5 ---------------------------------------------------------------
  async alerts(ctx) {
    const { t, card, adm, id } = ctx;
    card.innerHTML = `<form class="sec"><div class="card-h"><div><h2>Alerts & texts</h2><div class="muted small">Who hears about new leads, and what callers receive by text.</div></div></div>
      <div class="grid2"><div>${field(t, 'notify_phones', 'Alert these mobiles', { ph: '(512) 555-0100, (512) 555-0101', hint: 'Comma-separated. They get a text for every lead, booking and emergency.', max: 400 })}</div>
      <div>${field(t, 'notify_emails', 'Alert these emails', { ph: 'office@lonestarair.com', hint: 'Comma-separated.', max: 400 })}</div></div>
      <div class="grid2" style="margin-top:6px;align-items:start"><div>
        ${area(t, 'textback_template', 'Missed-call text-back', { rows: 4, hint: 'Placeholders: {business}, {link_part}, {link}. Keep "Reply STOP to opt out" - US carriers require it.' })}
        <label class="check"><span class="switch"><input type="checkbox" name="sms_ai_enabled" ${t.sms_ai_enabled ? 'checked' : ''}/><span></span></span><div><b>AI replies to texts</b><div class="hint" style="margin:2px 0 0">When a caller texts back, the AI continues the conversation and can book. The team can take over any thread.</div></div></label>
        ${adm ? `<label class="check"><span class="switch"><input type="checkbox" name="sms_enabled" ${t.sms_enabled ? 'checked' : ''}/><span></span></span><div><b>Texting enabled</b><div class="hint" style="margin:2px 0 0">Turn off until A2P registration is approved if you want voice-only.</div></div></label>` : ''}
      </div><div><label class="f">Preview</label><div class="phone-prev"><div class="muted small" style="text-align:center;margin-bottom:8px">${esc(t.twilio_number ? phone(t.twilio_number) : 'Agent number')}</div><div class="bub in" id="pv"></div></div>
        <label class="f">Send a test text-back to</label><div class="ask" style="border-radius:10px"><input id="tp" type="tel" placeholder="${esc(phone(t.owner_phone) || '(512) 555-0100')}" value="${esc(t.owner_phone ? phone(t.owner_phone) : '')}" aria-label="Test phone" /><button type="button" class="btn sm primary" id="tsend">Send test</button></div>
        <div class="hint">${adm ? 'Any mobile.' : 'Must be an owner or alert phone.'} Texts only deliver once A2P registration is approved.</div></div></div></form>`;
    const ta = $('#f_textback_template');
    const render = () => {
      const link = t.booking_link ? ` or book here: ${t.booking_link}` : '';
      $('#pv').textContent = ta.value.replace(/\{business\}/g, t.name).replace(/\{link_part\}/g, link).replace(/\{link\}/g, t.booking_link || '');
    };
    ta.oninput = render;
    render();
    $('#tsend').onclick = (e) =>
      busy(e.currentTarget, async () => {
        const r = await api(`/tenants/${id}/test-textback`, { method: 'POST', body: { phone: $('#tp').value } });
        toast(r.sid ? 'Test text sent' : `Not sent: ${r.skipped}`, r.sid ? '' : 'err');
      });
  },

  // 6 ---------------------------------------------------------------
  async golive(ctx) {
    const { t, card, adm, id } = ctx;
    const ck = await api(`/tenants/${id}/checklist`);
    const reqLeft = ck.items.filter((i) => i.required && !i.ok);
    const num10 = (t.twilio_number || '').replace('+1', '');
    card.innerHTML = `<div class="card-h"><div><h2>Test & go live</h2><div class="muted small">${t.active ? 'This business is live.' : 'Until you go live, only the owner, alert and team phones reach the agent (test mode).'}</div></div>
        ${adm ? (t.active ? `<button class="btn danger" id="pause">${icon('pause', 14)} Pause agent</button>` : `<button class="btn primary" id="golive" ${reqLeft.length ? 'disabled' : ''}>${icon('rocket', 15)} Go live</button>`) : ''}</div>
      ${reqLeft.length ? `<div class="banner warn">${icon('alert')}<div>Before going live: ${reqLeft.map((i) => esc(i.label)).join(', ')}.</div></div>` : !t.active ? `<div class="banner ok">${icon('checkCircle')}<div>All required checks pass. Run a test call, then go live.</div></div>` : ''}
      <div class="grid2" style="gap:16px;align-items:start">
        <div><h3>Launch checklist</h3><div class="checklist" id="ckl">${ckHtml(ck.items)}</div></div>
        <div><h3>1. Test call</h3><p class="muted small" style="margin-top:6px">From ${t.owner_phone ? esc(phone(t.owner_phone)) : 'an owner/alert phone'}, call <b class="tnum">${t.twilio_number ? esc(phone(t.twilio_number)) : 'the agent number'}</b>. Pretend you're a customer with a broken AC.</p>
          <div class="inner row" id="callWatch" style="gap:10px">${icon('phone', 16)} <span class="muted">Waiting for a test call…</span></div>
          <div class="row" style="margin-top:8px"><span class="muted small">No phone handy?</span><button class="btn xs" id="browserTest">${icon('mic', 12)} Talk to it in your browser</button></div>
          ${adm ? `<h3 style="margin-top:20px">Live demo page</h3><p class="muted small" style="margin-top:6px">A public page where prospects talk to this agent in their browser. Rate-limited, no login needed.</p>
          <label class="check" style="margin-top:8px"><span class="switch"><input type="checkbox" id="demoToggle" ${t.demo_enabled ? 'checked' : ''}/><span></span></span><div><b>Demo page ${t.demo_enabled ? 'on' : 'off'}</b></div></label>
          ${t.demo_enabled ? `<div class="copybox" style="margin-top:8px"><code>${esc(location.origin + '/#/demo/' + t.slug)}</code><button class="btn xs" data-copy="${esc(location.origin + '/#/demo/' + t.slug)}">${icon('copy', 12)}</button><a class="btn xs" href="/#/demo/${esc(t.slug)}" target="_blank" rel="noopener">${icon('external', 12)}</a></div>` : ''}` : ''}
          <h3 style="margin-top:20px">2. Forward missed calls</h3>
          ${t.twilio_number ? (t.mode === 'ring_first' ? `<p class="muted small" style="margin-top:6px">Ring-first mode: publish <b>${esc(phone(t.twilio_number))}</b> on the website, Google Business Profile and ads. No forwarding needed.</p>` : `<p class="muted small" style="margin-top:6px">On the business line, turn on <b>no-answer / busy</b> forwarding to the agent number. Common codes (confirm with the carrier):</p>
          <div class="codes">${[
            ['Verizon', `*71${num10}`, 'Cancel: *73'],
            ['AT&T / T-Mobile', `**004*${num10}#`, 'Cancel: ##004#'],
            ['Office VoIP / PBX', 'Admin portal', 'RingCentral, Google Voice, Ooma: "forward unanswered calls"'],
          ]
            .map(([c, code, note]) => `<div class="code"><div class="muted small">${c}</div><div class="mono ${code === 'Admin portal' ? 'plain' : ''}">${esc(code)}${code !== 'Admin portal' ? `<button class="icon-btn" style="width:28px;height:28px;border:0" data-copy="${esc(code)}" aria-label="Copy">${icon('copy', 14)}</button>` : ''}</div><div class="hint">${esc(note)}</div></div>`)
            .join('')}</div>`) : '<p class="muted small">Assign a number first.</p>'}
          ${adm ? `<h3 style="margin-top:20px">3. Invite the owner</h3><div id="team"></div>` : ''}</div></div>`;
    $$('[data-copy]', card).forEach((b) => (b.onclick = () => copyText(b.dataset.copy)));
    $('#browserTest').onclick = () => openCallModal(t);
    if ($('#demoToggle'))
      $('#demoToggle').onchange = (e) =>
        busy(e.target, async () => {
          await api('/tenants/' + id, { method: 'PUT', body: { demo_enabled: e.target.checked } });
          toast(e.target.checked ? 'Demo page is live' : 'Demo page turned off');
          ctx.reload();
        });
    if ($('#golive'))
      $('#golive').onclick = (e) =>
        modal({
          title: `Go live with ${t.name}?`,
          confirm: 'Go live',
          body: `<p>Every call to <b>${esc(phone(t.twilio_number))}</b> will be answered by the AI and callers will be texted back.</p><p class="muted small">Make sure call forwarding is on and A2P texting is registered for this business.</p>`,
          onConfirm: async () => {
            await api(`/tenants/${id}/go-live`, { method: 'POST' });
            await reloadTenants();
            toast(`${t.name} is live`);
            ctx.reload();
          },
        });
    if ($('#pause'))
      $('#pause').onclick = () =>
        modal({
          title: 'Pause the agent?',
          danger: true,
          confirm: 'Pause',
          body: `<p>Calls to ${esc(phone(t.twilio_number))} will hear "not in service" until you resume. Turn off call forwarding first.</p>`,
          onConfirm: async () => (await api(`/tenants/${id}/pause`, { method: 'POST' }), await reloadTenants(), ctx.reload()),
        });
    if (t.go_live_at && !t.active && adm) {
      card.querySelector('.card-h').insertAdjacentHTML('beforeend', `<button class="btn primary" id="resume">${icon('play', 14)} Resume</button>`);
      $('#resume').onclick = (e) => busy(e.currentTarget, async () => (await api(`/tenants/${id}/go-live`, { method: 'POST' }), await reloadTenants(), ctx.reload()));
    }
    if (adm) renderTeam($('#team'), t);
    // Live-watch for the test call
    const started = Date.now();
    const poll = async () => {
      if (!document.body.contains(card)) return;
      try {
        const calls = await api(`/calls?tenant=${id}`);
        const latest = calls[0];
        const w = $('#callWatch');
        if (latest && w) {
          w.innerHTML = `${icon('checkCircle', 16)} <div><b>Call received ${ago(latest.started_at)}</b><div class="muted small">${esc(latest.summary || latest.path)}${latest.lead_id ? ` · <a href="#/leads/${latest.lead_id}">open</a>` : ''}</div></div>`;
          w.style.color = 'var(--green)';
        }
        const fresh = await api(`/tenants/${id}/checklist`);
        if ($('#ckl')) $('#ckl').innerHTML = ckHtml(fresh.items);
      } catch {}
      if (Date.now() - started < 15 * 60 * 1000) setTimeout(poll, 6000);
    };
    poll();
  },
};

function ckHtml(items) {
  return items
    .map((i) => `<div class="ci ${i.ok ? 'ok' : 'no'} ${i.required ? 'req' : ''}">${icon(i.ok ? 'checkCircle' : i.required ? 'alert' : 'circle', 17)}<div><b>${esc(i.label)}</b>${!i.required ? '<span> · optional</span>' : ''}${i.hint && !i.ok ? `<span style="display:block">${esc(i.hint)}</span>` : ''}</div></div>`)
    .join('');
}

// ---- number picker: buy new or use owned ----
function numberPicker(el, t, ctx) {
  let tab = t.twilio_number ? 'none' : 'buy';
  const draw = () => {
    el.innerHTML = `<div class="row" style="justify-content:space-between"><div class="tabs"><button type="button" data-tab="buy" class="${tab === 'buy' ? 'on' : ''}">Buy a new number</button><button type="button" data-tab="own" class="${tab === 'own' ? 'on' : ''}">Use a number I own</button>${t.twilio_number ? `<button type="button" data-tab="none" class="${tab === 'none' ? 'on' : ''}">Keep current</button>` : ''}</div></div><div id="npBody"></div>`;
    $$('[data-tab]', el).forEach((b) => (b.onclick = () => ((tab = b.dataset.tab), draw())));
    const body = $('#npBody', el);
    if (tab === 'buy') {
      const ac = (t.owner_phone || t.ring_number || '').replace('+1', '').slice(0, 3);
      body.innerHTML = `<div class="row" style="margin-top:12px;flex-wrap:nowrap"><input class="in" id="ac" placeholder="Area code, e.g. 512" maxlength="3" inputmode="numeric" value="${esc(ac)}" style="width:170px" aria-label="Area code" />
        <input class="in" id="contains" placeholder="Contains digits (optional)" maxlength="7" style="width:200px" aria-label="Contains" /><button type="button" class="btn" id="srch">${icon('search', 14)} Search</button></div>
        <div class="hint">Local numbers in the business's area code get answered more often. Twilio bills the number monthly to your account.</div><div id="results"></div>`;
      const search = (btn) =>
        busy(btn, async () => {
          const list = await api(`/numbers/search?areaCode=${encodeURIComponent($('#ac').value)}&contains=${encodeURIComponent($('#contains').value)}`);
          $('#results').innerHTML = list.length
            ? `<div class="numgrid">${list.map((n) => `<div class="numcard"><div><b>${esc(phone(n.phoneNumber))}</b><div class="muted small">${esc([n.locality, n.region].filter(Boolean).join(', '))}</div></div><button type="button" class="btn xs primary" data-buy="${esc(n.phoneNumber)}">Select</button></div>`).join('')}</div>`
            : `<div class="empty">No numbers found. Try a nearby area code.</div>`;
          $$('[data-buy]', el).forEach(
            (b) =>
              (b.onclick = () =>
                modal({
                  title: 'Buy this number?',
                  confirm: 'Buy & assign',
                  body: `<p>Purchase <b class="tnum">${esc(phone(b.dataset.buy))}</b> on your Twilio account and assign it to <b>${esc(t.name)}</b>?</p><p class="muted small">Twilio charges a monthly fee per number. Its voice and SMS webhooks are set up automatically.</p>`,
                  onConfirm: async () => {
                    await api(`/tenants/${t.id}/number`, { method: 'POST', body: { phoneNumber: b.dataset.buy, buy: true, confirm: b.dataset.buy } });
                    toast('Number purchased and connected');
                    location.hash = `#/businesses/${t.id}?step=phone&n=${Date.now()}`;
                  },
                }))
          );
        });
      $('#srch').onclick = (e) => search(e.currentTarget);
      if (/^\d{3}$/.test(ac)) search($('#srch'));
    } else if (tab === 'own') {
      body.innerHTML = `<div id="owned" class="empty">Loading your Twilio numbers…</div>`;
      api('/numbers/owned').then(
        (list) => {
          $('#owned').outerHTML = list.length
            ? `<div class="numgrid">${list
                .map(
                  (n) => `<div class="numcard ${n.assignedTo && n.phoneNumber !== t.twilio_number ? 'taken' : ''}"><div><b>${esc(phone(n.phoneNumber))}</b><div class="muted small">${esc(n.assignedTo ? 'Used by ' + n.assignedTo : n.friendlyName || 'Unassigned')}</div></div>
              ${n.phoneNumber === t.twilio_number ? '<span class="tag t-ok">Current</span>' : n.assignedTo ? '' : `<button type="button" class="btn xs primary" data-use="${esc(n.phoneNumber)}">Use</button>`}</div>`
                )
                .join('')}</div>`
            : `<div class="empty">No numbers in your Twilio account yet. Buy one instead.</div>`;
          $$('[data-use]', el).forEach(
            (b) =>
              (b.onclick = () =>
                busy(b, async () => {
                  await api(`/tenants/${t.id}/number`, { method: 'POST', body: { phoneNumber: b.dataset.use } });
                  toast('Number assigned and webhooks set');
                  location.hash = `#/businesses/${t.id}?step=phone&n=${Date.now()}`;
                }))
          );
        },
        (e) => ($('#owned').textContent = e.message)
      );
    } else body.innerHTML = '';
  };
  draw();
}

// ---- team & invites ----
async function renderTeam(el, t) {
  const draw = async () => {
    const d = await api(`/tenants/${t.id}/users`);
    el.innerHTML = `${d.users.length ? d.users.map((u) => `<div class="ci ok">${icon('checkCircle', 17)}<div style="flex:1"><b>${esc(u.name || u.email)}</b><span>${esc(u.email)} · ${u.last_login_at ? 'last seen ' + ago(u.last_login_at) : 'never signed in'}</span></div><button class="btn xs danger" data-rm="${u.id}">Remove</button></div>`).join('') : ''}
      ${d.invites.map((i) => `<div class="ci no">${icon('mail', 17)}<div style="flex:1"><b>${esc(i.email)}</b><span>Invite pending · expires ${new Date(i.expires_at).toLocaleDateString('en-US')}</span></div><button class="btn xs" data-rv="${i.id}">Revoke</button></div>`).join('')}
      <form id="inv" class="row" style="margin-top:10px;flex-wrap:nowrap"><input class="in" name="email" type="email" required placeholder="owner@business.com" value="${d.users.length ? '' : esc(t.owner_email || '')}" aria-label="Email" /><button class="btn primary">${icon('mail', 14)} Invite</button></form>
      <div class="hint">They get a secure one-time link (7 days) to set their own password. They'll only see this business.</div><div id="invOut"></div>`;
    $('#inv', el).onsubmit = (e) => {
      e.preventDefault();
      busy($('button', e.target), async () => {
        const r = await api(`/tenants/${t.id}/invites`, { method: 'POST', body: { email: e.target.email.value, name: t.owner_name || '' } });
        await draw();
        $('#invOut', el).innerHTML = `<div class="copybox" style="margin-top:10px"><code>${esc(r.link)}</code><button class="btn xs" id="cpy">${icon('copy', 12)} Copy</button></div><div class="hint">${r.emailed ? 'Also emailed to them.' : 'Email alerts are not set up, so send this link yourself. It is shown only once.'}</div>`;
        $('#cpy', el).onclick = () => copyText(r.link);
      });
    };
    $$('[data-rm]', el).forEach(
      (b) => (b.onclick = () => modal({ title: 'Remove access?', danger: true, confirm: 'Remove', body: '<p>They will be signed out immediately.</p>', onConfirm: async () => (await api(`/users/${b.dataset.rm}`, { method: 'DELETE' }), draw()) }))
    );
    $$('[data-rv]', el).forEach((b) => (b.onclick = () => busy(b, async () => (await api(`/invites/${b.dataset.rv}`, { method: 'DELETE' }), draw()))));
  };
  draw().catch((e) => (el.textContent = e.message));
}

// ---- talk to the agent in the browser ----
export async function openCallModal(t) {
  const { mountWebCall } = await import('./webcall.js');
  let widget = null;
  const m = modal({
    title: `Talk to ${t.name}'s agent`,
    confirm: 'Done',
    cancel: 'Close',
    body: `<div id="wcm"></div><label class="f">Text the summary & confirmation to (optional)</label><input class="in" id="wcPhone" type="tel" placeholder="Your mobile" value="${esc(t.owner_phone ? phone(t.owner_phone) : '')}" />
      <div class="hint">Leave blank to skip texts. Everything else (lead, transcript, booking, alerts) works the same as a phone call.</div>`,
    onConfirm: () => widget?.end(),
  });
  // Any way of closing the dialog also hangs up.
  m.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', () => widget?.end()));
  m.addEventListener('click', (e) => e.target === m && widget?.end());
  const onKey = (e) => {
    if (e.key === 'Escape') widget?.end();
    if (!document.body.contains(m)) document.removeEventListener('keydown', onKey);
  };
  document.addEventListener('keydown', onKey);
  widget = mountWebCall(m.querySelector('#wcm'), {
    business: t.name,
    agentName: t.agent_name,
    start: () => api(`/tenants/${t.id}/web-call`, { method: 'POST', body: m.querySelector('#wcPhone').value.trim() ? { phone: m.querySelector('#wcPhone').value.trim() } : {} }),
  });
}
