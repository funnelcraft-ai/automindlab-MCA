import { state, esc, icon, api, $, $$, toast, busy, copyText, formData, pwStrength } from './lib.js';
import { shell } from './shell.js';
import { boot } from './main.js';

// ---------------- auth layout ----------------
function authLayout(inner) {
  document.getElementById('app').innerHTML = `<div class="auth"><div class="auth-l"><div class="auth-card">
      <div class="brand-n">${icon('logo', 24)} ${esc(state.agency || 'Missed Call Agent')}</div>${inner}</div></div>
    <div class="auth-r"><div class="floating">
      <div class="fc"><div class="row" style="gap:8px">${icon('phoneMissed', 16)}<b>Missed call · (512) 555-0123</b></div><div class="muted" style="margin-top:6px">AI answered in 1 ring · AC blowing warm air</div></div>
      <div class="fc"><div class="row" style="gap:8px;color:var(--green)">${icon('calendarCheck', 16)}<b style="color:var(--ink)">Job booked · Tue 10am–12pm</b></div><div class="muted" style="margin-top:6px">Confirmation texted · owner alerted</div></div>
    </div><h2>Never lose another job to voicemail.</h2><p>Your AI receptionist answers missed calls, books the visit, texts the caller and tells you, around the clock.</p></div></div>`;
}

function meter(input, out) {
  input.addEventListener('input', () => {
    const s = pwStrength(input.value);
    out.className = 'meter s' + (input.value ? Math.max(1, s) : 0);
  });
}

export function viewLogin() {
  authLayout(`<h1>Welcome back</h1><p class="muted">Sign in to your dashboard.</p>
    <form id="lf"><label class="f" for="em">Email</label><input class="in" id="em" type="email" autocomplete="username" required />
      <label class="f" for="pw">Password</label><input class="in" id="pw" type="password" autocomplete="current-password" required />
      <button class="btn primary" style="width:100%;justify-content:center;margin-top:20px;height:40px">Sign in</button><div class="err-t" id="err"></div></form>`);
  $('#lf').onsubmit = (e) => {
    e.preventDefault();
    busy($('button', e.target), async () => {
      try {
        await api('/login', { method: 'POST', body: { email: $('#em').value, password: $('#pw').value } });
        await boot();
        location.hash = '#/';
      } catch (er) {
        $('#err').textContent = er.message;
      }
    });
  };
}

export function viewSetup(info) {
  authLayout(`<h1>Set up your workspace</h1><p class="muted">Create the admin account. This screen only works once.</p>
    <form id="sf" autocomplete="off">
      <label class="f" for="sc">Setup code</label><input class="in mono" id="sc" name="setupCode" required placeholder="From your server logs" style="letter-spacing:.12em;text-transform:uppercase" />
      <div class="hint">Railway → your service → Deployments → View logs. Look for "FIRST-TIME SETUP".</div>
      <label class="f">Agency name</label><input class="in" name="agencyName" value="${esc(info.agencyName || '')}" maxlength="60" />
      <div class="grid2"><div><label class="f">Your name</label><input class="in" name="name" maxlength="80" /></div><div><label class="f">Email</label><input class="in" name="email" type="email" required autocomplete="username" /></div></div>
      <label class="f">Password</label><input class="in" name="password" type="password" required minlength="10" autocomplete="new-password" id="np" /><div class="meter" id="m"><i></i><i></i><i></i><i></i></div>
      <div class="hint">10+ characters, mixing letters with numbers or symbols.</div>
      <button class="btn primary" style="width:100%;justify-content:center;margin-top:20px;height:40px">Create admin account</button><div class="err-t" id="err"></div></form>`);
  meter($('#np'), $('#m'));
  $('#sf').onsubmit = (e) => {
    e.preventDefault();
    busy($('button', e.target), async () => {
      try {
        await api('/setup', { method: 'POST', body: formData(e.target) });
        await boot();
        location.hash = '#/integrations?welcome=1';
      } catch (er) {
        $('#err').textContent = er.message;
      }
    });
  };
}

export async function viewInvite(token) {
  let inv;
  try {
    inv = await api('/invite/' + encodeURIComponent(token));
  } catch (e) {
    authLayout(`<h1>Invite not valid</h1><p class="muted">${esc(e.message)}</p><a class="btn" href="#/login">Go to sign in</a>`);
    return;
  }
  authLayout(`<h1>Join ${esc(inv.business)}</h1><p class="muted">Create a password for <b>${esc(inv.email)}</b> to see your calls, bookings and texts.</p>
    <form id="ivf"><input type="email" value="${esc(inv.email)}" autocomplete="username" hidden />
      <label class="f">Your name</label><input class="in" name="name" value="${esc(inv.name)}" maxlength="80" />
      <label class="f">Password</label><input class="in" name="password" type="password" required minlength="10" autocomplete="new-password" id="np" /><div class="meter" id="m"><i></i><i></i><i></i><i></i></div>
      <button class="btn primary" style="width:100%;justify-content:center;margin-top:20px;height:40px">Create account</button><div class="err-t" id="err"></div></form>`);
  meter($('#np'), $('#m'));
  $('#ivf').onsubmit = (e) => {
    e.preventDefault();
    busy($('button', e.target), async () => {
      try {
        await api('/invite/' + encodeURIComponent(token), { method: 'POST', body: formData(e.target) });
        history.replaceState(null, '', '/#/');
        await boot();
        location.hash = '#/';
      } catch (er) {
        $('#err').textContent = er.message;
      }
    });
  };
}

// ---------------- integrations (paste API keys) ----------------
const PROVIDERS = [
  {
    id: 'app', title: 'App address', logo: icon('link', 18), test: null, required: true,
    desc: 'The public https address of this dashboard. Twilio and Retell send calls here.',
    fields: [['public_base_url', 'Public URL', 'https://calls.yourdomain.com'], ['agency_name', 'Agency name', 'Automindlab']],
  },
  {
    id: 'twilio', title: 'Twilio', logo: 'Tw', test: 'twilio', required: true,
    desc: 'Phone numbers, call routing and texts. Console → Account info.',
    link: 'https://console.twilio.com/',
    fields: [['twilio_account_sid', 'Account SID', 'AC…'], ['twilio_auth_token', 'Auth Token', ''], ['twilio_messaging_service_sid', 'A2P Messaging Service SID (optional)', 'MG…']],
  },
  {
    id: 'retell', title: 'Retell AI', logo: 'Re', test: 'retell', required: true,
    desc: 'The voice agent. Use the API key with the webhook badge. A card must be on file.',
    link: 'https://dashboard.retellai.com/apiKey',
    fields: [['retell_api_key', 'API key', 'key_…'], ['retell_voice_id', 'Voice', 'retell-Cimo'], ['retell_model', 'Voice LLM', 'gpt-4.1']],
  },
  {
    id: 'llm', title: 'SMS AI', logo: icon('sparkles', 18), test: 'llm', required: false,
    desc: 'Answers caller texts and powers the dashboard assistant. Any OpenAI-compatible API.',
    link: 'https://platform.openai.com/api-keys',
    fields: [['llm_api_key', 'API key', 'sk-…'], ['llm_base_url', 'Base URL', 'https://api.openai.com/v1'], ['llm_model', 'Model', 'gpt-4.1-mini']],
  },
  {
    id: 'smtp', title: 'Email alerts', logo: icon('mail', 18), test: 'smtp', required: false,
    desc: 'Lead alerts and dashboard invites by email (Zoho, Google Workspace, Hostinger…).',
    fields: [['smtp_host', 'SMTP host', 'smtp.zoho.com'], ['smtp_port', 'Port', '465'], ['smtp_user', 'Username', 'alerts@yourdomain.com'], ['smtp_pass', 'Password', ''], ['smtp_from', 'From', 'Alerts <alerts@yourdomain.com>']],
  },
  {
    id: 'google', title: 'Google Calendar', logo: icon('calendar', 18), test: 'google', required: false,
    desc: 'Lets businesses connect their calendar for live booking. Google Cloud → OAuth client (Web).',
    link: 'https://console.cloud.google.com/apis/credentials',
    fields: [['google_client_id', 'Client ID', '….apps.googleusercontent.com'], ['google_client_secret', 'Client secret', '']],
  },
];

const LLM_PRESETS = [
  { label: 'Gemini (free tier)', base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.6-flash', key: 'Gemini API key from aistudio.google.com' },
  { label: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', key: 'sk-…' },
  { label: 'Groq', base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', key: 'gsk_…' },
  { label: 'OpenRouter', base: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4.1-mini', key: 'sk-or-…' },
];

export async function viewIntegrations(params) {
  const d = await api('/integrations');
  const S = d.settings;
  const req = d.readiness.filter((r) => r.required);
  const done = req.filter((r) => r.ok).length;
  const configured = (p) => p.fields.filter(([k]) => !k.includes('messaging') && !['retell_voice_id', 'retell_model', 'llm_base_url', 'llm_model', 'smtp_port', 'smtp_from', 'agency_name'].includes(k)).every(([k]) => S[k]?.set);
  const content = shell(
    'integrations',
    `<div class="ph"><div><h1>Integrations</h1><div class="sub">Paste your API keys. They're encrypted before they're stored and never shown again.</div></div></div>
    ${params.get('welcome') ? `<div class="banner">${icon('sparkles')}<div><b>Welcome!</b> Connect Twilio and Retell, create the voice agent, then onboard your first business.</div></div>` : ''}
    ${d.dryRun ? `<div class="banner warn">${icon('alert')}<div>DRY_RUN is on: texts, calls and purchases are simulated.</div></div>` : ''}
    <div class="card" style="margin-bottom:16px"><div class="row" style="justify-content:space-between"><h2>Platform readiness</h2><span class="muted small">${done}/${req.length} required</span></div>
      <div class="progress" style="margin:12px 0 4px"><i style="width:${(done / req.length) * 100}%"></i></div>
      <div class="grid2" style="gap:0 24px">${d.readiness.map((r) => `<div class="ci ${r.ok ? 'ok' : 'no'} ${r.required ? 'req' : ''}">${icon(r.ok ? 'checkCircle' : r.required ? 'alert' : 'circle', 17)}<div><b>${esc(r.label)}</b>${r.required ? '' : '<span> · optional</span>'}${r.hint && !r.ok ? `<span style="display:block">${esc(r.hint)}</span>` : ''}</div></div>`).join('')}</div>
      ${done === req.length ? `<div class="row" style="margin-top:12px"><a class="btn primary" href="#/businesses?new=1">${icon('rocket', 15)} Onboard a business</a></div>` : ''}</div>
    <div class="integ">${PROVIDERS.map((p) => {
      const ok = p.id === 'app' ? d.readiness.find((r) => r.key === 'url').ok : configured(p);
      return `<form class="card" data-p="${p.id}" autocomplete="off"><div class="card-h"><div class="ihead"><div class="ilogo">${p.logo}</div><div><h2>${esc(p.title)}${p.required ? '' : ' <span class="muted small" style="font-weight:500">optional</span>'}</h2><div class="muted small">${esc(p.desc)}</div></div></div>
          <span class="status ${ok ? 'ok' : 'no'}">${ok ? 'Connected' : 'Not set'}</span></div>
        ${p.fields
          .map(([k, label, ph]) => {
            const s = S[k] || {};
            const env = s.fromEnv ? '<span class="env-note">set in environment</span>' : '';
            if (s.secret)
              return `<label class="f">${esc(label)}${env}</label><input class="in" type="password" name="${k}" autocomplete="new-password" spellcheck="false" placeholder="${s.set ? esc(s.value) + ' (saved - type to replace)' : esc(ph)}" ${s.fromEnv ? 'disabled' : ''} />`;
            return `<label class="f">${esc(label)}${env}</label><input class="in" name="${k}" value="${esc(s.value ?? '')}" placeholder="${esc(ph)}" spellcheck="false" ${s.fromEnv ? 'disabled' : ''} />`;
          })
          .join('')}
        ${p.id === 'llm' ? `<div class="row" style="margin-top:10px;gap:6px"><span class="muted small">Presets:</span>${LLM_PRESETS.map((x, i) => `<button type="button" class="btn xs" data-preset="${i}">${esc(x.label)}</button>`).join('')}</div>` : ''}
        ${p.id === 'app' ? `<div class="hint">Webhooks this app exposes:</div><div class="copybox" style="margin-top:6px"><code>${esc(d.webhooks.voice)}</code><button type="button" class="btn xs" data-copy="${esc(d.webhooks.voice)}">${icon('copy', 12)}</button></div>` : ''}
        ${p.id === 'google' ? `<div class="hint">Authorized redirect URI:</div><div class="copybox" style="margin-top:6px"><code>${esc(d.webhooks.googleRedirect)}</code><button type="button" class="btn xs" data-copy="${esc(d.webhooks.googleRedirect)}">${icon('copy', 12)}</button></div>` : ''}
        ${p.id === 'twilio' && S.twilio_messaging_service_sid?.set ? `<div class="hint">Set the Messaging Service's incoming webhook to <b>${esc(d.webhooks.sms)}</b></div>` : ''}
        ${p.id === 'retell' ? `<div class="inner row" style="margin-top:14px;justify-content:space-between"><div><b>Voice agent</b><div class="muted small">${S.retell_agent_id?.set ? 'Created: ' + esc(S.retell_agent_id.value) : 'One shared agent serves every business.'}</div></div><button type="button" class="btn ${S.retell_agent_id?.set ? '' : 'primary'} sm" id="prov" ${S.retell_api_key?.set ? '' : 'disabled'}>${icon(S.retell_agent_id?.set ? 'refresh' : 'zap', 14)} ${S.retell_agent_id?.set ? 'Update agent' : 'Create voice agent'}</button></div>` : ''}
        <div class="result" style="display:none"></div>
        <div class="row" style="margin-top:16px;justify-content:space-between">${p.link ? `<a href="${p.link}" target="_blank" rel="noopener noreferrer" class="small">${icon('external', 12)} Where do I find these?</a>` : '<span></span>'}
          <button class="btn primary sm">${p.test ? 'Save & test' : 'Save'}</button></div></form>`;
    }).join('')}</div>`
  );
  $$('[data-copy]', content).forEach((b) => (b.onclick = () => copyText(b.dataset.copy)));
  $$('[data-preset]', content).forEach(
    (b) =>
      (b.onclick = () => {
        const x = LLM_PRESETS[Number(b.dataset.preset)];
        const f = b.closest('form');
        f.elements.llm_base_url.value = x.base;
        f.elements.llm_model.value = x.model;
        f.elements.llm_api_key.placeholder = x.key;
        f.elements.llm_api_key.focus();
        toast(`${x.label} selected - paste its key, then Save & test`);
      })
  );
  $$('form[data-p]', content).forEach((form) => {
    const p = PROVIDERS.find((x) => x.id === form.dataset.p);
    form.onsubmit = (e) => {
      e.preventDefault();
      const btn = $('button.primary.sm:not(#prov)', form) || $('button[type=submit],button:not([type])', form);
      busy(e.submitter || btn, async () => {
        const values = {};
        for (const el of form.elements) {
          if (!el.name || el.disabled) continue;
          const isSecret = S[el.name]?.secret;
          if (isSecret && !el.value) continue; // empty secret = keep existing
          values[el.name] = el.value;
        }
        const r = await api('/integrations', { method: 'PUT', body: { values } });
        let res = { ok: true, detail: 'Saved.' + (r.reprovisioned ? ' Voice agent updated with the new address.' : '') };
        if (p.test) res = await api(`/integrations/${p.test}/test`, { method: 'POST' });
        showResult(form, res);
        if (res.ok) setTimeout(() => viewIntegrations(new URLSearchParams()), 900);
      });
    };
  });
  const prov = $('#prov');
  if (prov)
    prov.onclick = () =>
      busy(prov, async () => {
        const r = await api('/integrations/retell/provision', { method: 'POST' });
        toast(r.created ? 'Voice agent created' : 'Voice agent updated');
        viewIntegrations(new URLSearchParams());
      });
}

function showResult(form, r) {
  const el = $('.result', form);
  el.style.display = '';
  el.className = 'result ' + (r.ok ? 'ok' : 'bad');
  el.textContent = r.detail;
}

// ---------------- account ----------------
export function viewAccount() {
  const content = shell(
    'account',
    `<div class="ph"><div><h1>Account & security</h1><div class="sub">${esc(state.me.email)} · ${state.me.role === 'admin' ? 'Agency admin' : 'Business owner'}</div></div></div>
    <div class="grid2" style="gap:16px;align-items:start">
      <form class="card" id="pwf"><h2>Change password</h2><p class="muted small" style="margin-top:4px">Changing it signs out every other device.</p>
        <input type="email" value="${esc(state.me.email)}" autocomplete="username" hidden />
        <label class="f">Current password</label><input class="in" name="current" type="password" autocomplete="current-password" required />
        <label class="f">New password</label><input class="in" name="next" type="password" autocomplete="new-password" required minlength="10" id="np" /><div class="meter" id="m"><i></i><i></i><i></i><i></i></div>
        <div style="margin-top:16px"><button class="btn primary">Update password</button></div></form>
      <div class="card"><h2>Sessions</h2><p class="muted small" style="margin-top:4px">Lost a laptop or shared your login? Sign out everywhere, including this browser.</p>
        <button class="btn danger" id="soa">${icon('logout', 14)} Sign out of all devices</button>
        <h2 style="margin-top:24px">How your data is protected</h2>
        <div class="checklist" style="margin-top:6px">${[
          'API keys and calendar tokens are encrypted (AES-256-GCM)',
          'Webhooks from Twilio and Retell are signature-verified',
          'Each business sees only its own calls and leads',
          'Accounts lock for 15 minutes after 5 failed sign-ins',
          'Callers who reply STOP are never texted again',
        ]
          .map((x) => `<div class="ci ok">${icon('shield', 16)}<div>${x}</div></div>`)
          .join('')}</div></div></div>`
  );
  meter($('#np'), $('#m'));
  $('#pwf').onsubmit = (e) => {
    e.preventDefault();
    busy($('button', e.target), async () => {
      await api('/me/password', { method: 'POST', body: formData(e.target) });
      e.target.reset();
      toast('Password updated');
    });
  };
  $('#soa').onclick = (e) =>
    busy(e.currentTarget, async () => {
      await api('/me/signout-all', { method: 'POST' });
      state.me = null;
      location.hash = '#/login';
    });
}

export function viewHelp() {
  shell(
    'help',
    `<div class="ph"><div><h1>Help & Support</h1><div class="sub">How the missed call agent works</div></div></div>
    <div class="grid2" style="gap:16px;align-items:start">
      <div class="card"><h2>What happens on a missed call</h2><div class="checklist" style="margin-top:8px">${[
        ['phoneMissed', 'Nobody picks up', 'The business line forwards the call to the agent number (or the agent number rings the team first).'],
        ['bot', 'The AI answers', 'It finds out what is wrong, gets name and address, and books a visit or arranges a callback.'],
        ['alert', 'Emergencies escalate', 'Gas smell, CO alarm or no heat in a freeze: safety advice, then the on-call tech is alerted or connected live.'],
        ['message', 'Everyone gets a text', 'Booked callers get a confirmation; others get a follow-up; hang-ups get the missed-call text-back.'],
        ['bell', 'The owner is alerted', 'A text and/or email with the summary, plus the full transcript here.'],
      ]
        .map(([ic, b, s]) => `<div class="ci ok">${icon(ic, 17)}<div><b>${b}</b><span>${s}</span></div></div>`)
        .join('')}</div></div>
      <div class="card"><h2>Common questions</h2>
        <details open><summary>Why aren't texts delivering?</summary><p class="muted small" style="margin-top:6px">US carriers block business texts from numbers without A2P 10DLC registration. Register each business's brand and campaign in Twilio and attach the number to the Messaging Service.</p></details>
        <details><summary>Callers say "not in service"</summary><p class="muted small" style="margin-top:6px">The business is in test mode or paused. Only owner, alert and team phones work until you press Go live.</p></details>
        <details><summary>The team phone's voicemail answers first</summary><p class="muted small" style="margin-top:6px">In ring-first mode, set the ring time below the voicemail pickup (usually 20–25 seconds), or switch to forwarding mode.</p></details>
        <details><summary>Can the business owner change the script?</summary><p class="muted small" style="margin-top:6px">Yes. Services, hours, emergency rules, pricing guidance, booking and alerts can all be edited from their login. Phone routing stays with the agency.</p></details>
        <details><summary>Is the call recorded?</summary><p class="muted small" style="margin-top:6px">Yes. The greeting says so, which covers states that require all-party consent. Recordings and transcripts appear on each lead.</p></details>
        ${state.me.role === 'admin' ? '' : `<p class="small" style="margin-top:14px">Need a change you can't make here? Contact ${esc(state.agency)}.</p>`}</div></div>`
  );
}

// ---------------- public live-demo page (no login) ----------------
export async function viewDemo(slug) {
  const { mountWebCall } = await import('./webcall.js');
  const app = document.getElementById('app');
  let d;
  try {
    d = await api('/demo/' + encodeURIComponent(slug));
  } catch (e) {
    app.innerHTML = `<div class="auth"><div class="auth-l"><div class="auth-card"><h1>Demo unavailable</h1><p class="muted">${esc(e.message)}</p></div></div><div class="auth-r"></div></div>`;
    return;
  }
  document.title = `Talk to ${d.name}'s AI receptionist`;
  app.innerHTML = `<div class="demo-wrap">
    <div class="demo-l"><div class="demo-card">
      <div class="brand-n">${icon('logo', 22)} ${esc(d.agency)}</div>
      <h1>Call ${esc(d.name)}'s AI receptionist</h1>
      <p class="muted">This is the agent that answers when the team can't pick up. Talk to it like a customer would: it will help, book a visit and text you a confirmation.</p>
      <div class="card" style="margin-top:18px">
        ${d.ready ? '<div id="wc"></div>' : '<div class="empty">The demo agent is being set up. Please check back soon.</div>'}
        <details style="margin-top:12px"><summary>Get the text messages too (optional)</summary>
          <label class="f">Your US/Canada mobile</label><input class="in" id="dPhone" type="tel" placeholder="(512) 555-0123" autocomplete="tel" />
          <label class="check"><input type="checkbox" id="dConsent" /> <span class="small">I agree to receive demo texts about this call from ${esc(d.name)}. Msg & data rates may apply. Reply STOP to opt out.</span></label></details>
        <div class="err-t" id="dErr"></div>
      </div>
      <p class="hint" style="margin-top:12px">Calls are recorded and handled by an AI assistant.</p></div></div>
    <div class="auth-r"><div class="floating">
      <div class="fc"><div class="row" style="gap:8px">${icon('bot', 16)}<b>Answers in 1 ring, 24/7</b></div><div class="muted" style="margin-top:6px">${esc(d.services || '').slice(0, 90)}</div></div>
      <div class="fc"><div class="row" style="gap:8px;color:var(--green)">${icon('calendarCheck', 16)}<b style="color:var(--ink)">Books the job · texts the caller</b></div><div class="muted" style="margin-top:6px">Owner alerted with a summary</div></div></div>
      <h2>Things to try</h2>
      <div class="try">
        <div><b>A routine job</b>"Hi, I'd like to schedule an AC tune-up next week."</div>
        <div><b>Something urgent</b>"My furnace stopped working and it's freezing in here."</div>
        <div><b>A safety emergency</b>"I smell gas near my water heater."</div>
        <div><b>Just a question</b>"Do you service ${esc((d.service_area || 'my area').split(',')[0])}? What are your hours?"</div>
      </div></div></div>`;
  if (!d.ready) return;
  mountWebCall(document.getElementById('wc'), {
    business: d.name,
    agentName: d.agent_name,
    start: async () => {
      document.getElementById('dErr').textContent = '';
      const phoneVal = document.getElementById('dPhone').value.trim();
      try {
        return await api(`/demo/${encodeURIComponent(slug)}/call`, { method: 'POST', body: phoneVal ? { phone: phoneVal, consent: document.getElementById('dConsent').checked } : {} });
      } catch (e) {
        document.getElementById('dErr').textContent = e.message;
        throw e;
      }
    },
  });
}
