/* Missed Call Agent dashboard - no build step, vanilla JS. */
(function () {
  'use strict';
  const $app = document.getElementById('app');
  const state = { me: null, agency: '', tenants: [], tenantId: null };

  // ---------- helpers ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const phone = (p) => {
    const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(p || '');
    return m ? `(${m[1]}) ${m[2]}-${m[3]}` : p || '';
  };
  const ago = (iso) => {
    if (!iso) return '';
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  const dt = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
  const badge = (v, cls) => (v ? `<span class="badge b-${esc(cls || v)}">${esc(v)}</span>` : '');
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), 2600);
  }

  async function api(path, opts = {}) {
    const r = await fetch('/api' + path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && path !== '/login') {
      state.me = null;
      location.hash = '#/login';
      throw new Error('Signed out');
    }
    if (!r.ok) throw new Error(j.error || 'Request failed');
    return j;
  }

  const isAdmin = () => state.me && state.me.role === 'admin';
  const scope = () => (state.tenantId ? `tenant=${state.tenantId}` : '');

  // ---------- shell ----------
  function shell(active, inner) {
    const nav = [
      ['#/', 'Overview', 'overview'],
      ['#/leads', 'Leads', 'leads'],
      ['#/calls', 'Calls', 'calls'],
      ['#/settings', 'Agent settings', 'settings'],
    ];
    if (isAdmin()) nav.push(['#/clients', 'Clients', 'clients']);
    const picker = isAdmin()
      ? `<select id="tenantPick" aria-label="Business"><option value="">All businesses</option>${state.tenants
          .map((t) => `<option value="${t.id}" ${String(t.id) === String(state.tenantId) ? 'selected' : ''}>${esc(t.name)}</option>`)
          .join('')}</select>`
      : '';
    $app.innerHTML = `<div class="shell">
      <nav class="side">
        <div class="brand">${esc(state.agency)}<small>Missed Call Agent</small></div>
        ${picker}
        ${nav.map(([h, l, k]) => `<a href="${h}" class="${k === active ? 'on' : ''}">${l}</a>`).join('')}
        <div class="spacer"></div>
        <a href="#" id="logout">Sign out</a>
      </nav>
      <main class="main">${inner}</main></div>`;
    const tp = document.getElementById('tenantPick');
    if (tp)
      tp.onchange = () => {
        state.tenantId = tp.value || null;
        try { localStorage.setItem('mca_tenant', state.tenantId || ''); } catch {}
        route();
      };
    document.getElementById('logout').onclick = async (e) => {
      e.preventDefault();
      await api('/logout', { method: 'POST' }).catch(() => {});
      state.me = null;
      location.hash = '#/login';
    };
  }

  function needTenant(active, title) {
    shell(active, `<div class="head"><h1>${esc(title)}</h1></div><div class="panel empty">Pick a business in the sidebar to see this page.</div>`);
  }

  // ---------- views ----------
  function viewLogin() {
    $app.innerHTML = `<div class="login"><form class="panel" id="lf">
      <h1>Sign in</h1><p class="muted">Missed Call Agent dashboard</p>
      <label for="em">Email</label><input id="em" type="email" autocomplete="username" required />
      <label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" required />
      <div style="margin-top:18px"><button type="submit" style="width:100%">Sign in</button></div>
      <p class="hint" id="lerr"></p></form></div>`;
    document.getElementById('lf').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const email = document.getElementById('em').value;
        const password = document.getElementById('pw').value;
        await api('/login', { method: 'POST', body: { email, password } });
        await boot();
        location.hash = '#/';
      } catch (err) {
        document.getElementById('lerr').textContent = err.message;
      }
    };
  }

  async function viewOverview() {
    const [s, leads] = await Promise.all([api('/stats?days=30&' + scope()), api('/leads?' + scope())]);
    // Fill every day in the window so one busy day doesn't stretch across the chart.
    const byDay = Object.fromEntries(s.daily.map((d) => [d.day, d]));
    const series = [];
    for (let i = s.days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 864e5);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      series.push(byDay[key] || { day: key, calls: 0, missed: 0 });
    }
    const max = Math.max(1, ...series.map((d) => d.calls));
    const bars = s.daily.length
      ? `<div class="bars">${series
          .map((d) => `<div title="${d.day}: ${d.calls} calls, ${d.missed} handled by the agent" style="height:${d.calls ? Math.max(4, (d.calls / max) * 100) : 0}%" class="${d.missed ? 'miss' : ''}"></div>`)
          .join('')}</div><div class="row muted" style="justify-content:space-between;font-size:12px;margin-top:6px"><span>${esc(series[0].day)}</span><span>today</span></div><p class="hint">Orange = days with calls the agent caught. Max ${max}/day.</p>`
      : '<div class="empty">No calls yet. Forward missed calls to the Twilio number to start.</div>';
    const recent = leads.slice(0, 8);
    shell('overview', `
      <div class="head"><div><h1>Overview</h1><div class="muted">Last 30 days${state.tenantId ? '' : ' · all businesses'}</div></div></div>
      <div class="kpis">
        <div class="kpi hero"><div class="v">$${Number(s.est_revenue).toLocaleString()}</div><div class="l">Est. revenue recovered</div></div>
        <div class="kpi"><div class="v">${s.missed}</div><div class="l">Missed calls caught</div></div>
        <div class="kpi"><div class="v">${s.ai_handled}</div><div class="l">Answered by AI</div></div>
        <div class="kpi"><div class="v">${s.booked}</div><div class="l">Jobs booked</div></div>
        <div class="kpi"><div class="v">${s.recovery_rate}%</div><div class="l">Missed → booked</div></div>
        <div class="kpi"><div class="v">${s.textbacks}</div><div class="l">Text-backs sent</div></div>
        <div class="kpi"><div class="v">${s.emergencies}</div><div class="l">Emergencies flagged</div></div>
      </div>
      <div class="grid g2">
        <div class="panel"><h2>Calls per day</h2>${bars}</div>
        <div class="panel"><h2>Latest leads</h2>${
          recent.length
            ? `<table><tbody>${recent
                .map((l) => `<tr class="click" data-href="#/leads/${l.id}"><td><b>${esc(l.name || phone(l.phone))}</b><div class="muted">${esc((l.issue || '').slice(0, 70))}</div></td><td>${badge(l.urgency === 'emergency' ? 'emergency' : '')} ${badge(l.status)}</td><td class="muted">${ago(l.last_activity_at)}</td></tr>`)
                .join('')}</tbody></table>`
            : '<div class="empty">No leads yet.</div>'
        }</div>
      </div>`);
    bindRowLinks();
  }

  async function viewLeads(params) {
    const status = params.get('status') || '';
    const q = params.get('q') || '';
    const rows = await api(`/leads?${scope()}&status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`);
    const opts = ['', 'new', 'contacted', 'booked', 'won', 'lost', 'spam'];
    shell('leads', `
      <div class="head"><h1>Leads</h1></div>
      <form class="toolbar" id="lfilter">
        <input name="q" placeholder="Search name, phone, issue" value="${esc(q)}" />
        <select name="status">${opts.map((o) => `<option value="${o}" ${o === status ? 'selected' : ''}>${o || 'All statuses'}</option>`).join('')}</select>
        <button class="ghost" type="submit">Filter</button>
      </form>
      <div class="panel tablewrap">${
        rows.length
          ? `<table><thead><tr><th>Caller</th><th>Issue</th>${state.tenantId ? '' : '<th>Business</th>'}<th>Status</th><th>Appointment</th><th>Last activity</th></tr></thead><tbody>
        ${rows
          .map(
            (l) => `<tr class="click" data-href="#/leads/${l.id}">
          <td><b>${esc(l.name || 'Unknown')}</b><div class="muted mono">${esc(phone(l.phone))}</div></td>
          <td>${esc((l.issue || l.last_message || '').slice(0, 90))} ${l.urgency === 'emergency' ? badge('emergency') : l.urgency === 'urgent' ? badge('urgent') : ''}</td>
          ${state.tenantId ? '' : `<td>${esc(l.tenant_name)}</td>`}
          <td>${badge(l.status)} ${l.human_takeover ? '<span class="badge">human</span>' : ''}</td>
          <td>${l.appointment_start ? esc(dt(l.appointment_start)) : '<span class="muted">-</span>'}</td>
          <td class="muted">${ago(l.last_activity_at)}</td></tr>`
          )
          .join('')}</tbody></table>`
          : '<div class="empty">No leads match.</div>'
      }</div>`);
    document.getElementById('lfilter').onsubmit = (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      location.hash = `#/leads?status=${encodeURIComponent(f.get('status'))}&q=${encodeURIComponent(f.get('q'))}`;
    };
    bindRowLinks();
  }

  async function viewLead(id) {
    const d = await api('/leads/' + id);
    const l = d.lead;
    const statuses = ['new', 'contacted', 'booked', 'won', 'lost', 'spam'];
    const calls = d.calls
      .map(
        (c) => `<div class="callcard">
        <div class="row" style="justify-content:space-between"><b>${esc(dt(c.started_at))}</b>
          <span>${badge(c.path === 'ai' ? 'AI answered' : c.path, c.path === 'ai' ? 'ai' : c.path)} ${badge(c.outcome)} <span class="muted mono">${c.duration_sec ? c.duration_sec + 's' : ''}</span></span></div>
        ${c.summary ? `<p>${esc(c.summary)}</p>` : ''}
        ${c.textback_sent ? '<div class="hint">Text-back sent</div>' : ''}
        ${c.recording_url ? `<audio controls preload="none" src="${esc(c.recording_url)}"></audio>` : ''}
        ${c.transcript ? `<details><summary>Transcript</summary><pre>${esc(c.transcript)}</pre></details>` : ''}
      </div>`
      )
      .join('');
    const msgs = d.messages
      .map((m) => `<div class="bubble ${m.direction}">${esc(m.body)}<div class="meta">${m.direction === 'in' ? 'Customer' : m.author === 'ai' ? 'AI' : m.author === 'human' ? 'Team' : 'Auto'} · ${esc(dt(m.created_at))}${m.status && m.direction === 'out' ? ' · ' + esc(m.status) : ''}</div></div>`)
      .join('');
    shell('leads', `
      <div class="head"><div><a href="#/leads">← Leads</a><h1>${esc(l.name || phone(l.phone))}</h1>
        <div class="muted"><span class="mono">${esc(phone(l.phone))}</span> · ${esc(l.tenant_name)} ${l.urgency ? badge(l.urgency) : ''} ${d.optedOut ? badge('opted out', 'lost') : ''}</div></div>
        <div class="row"><select id="st">${statuses.map((s) => `<option ${s === l.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <a class="btn" href="tel:${esc(l.phone)}">Call back</a></div></div>
      <div class="grid g2">
        <div>
          <div class="panel" style="margin-bottom:16px"><h2>Details</h2>
            <form id="lf">
              <label>Name</label><input name="name" value="${esc(l.name)}" />
              <label>Service address</label><input name="address" value="${esc(l.address)}" />
              <label>Issue</label><textarea name="issue">${esc(l.issue)}</textarea>
              <label>Email</label><input name="email" value="${esc(l.email)}" />
              <label>Internal notes</label><textarea name="notes">${esc(l.notes)}</textarea>
              ${l.appointment_start ? `<p><b>Appointment:</b> ${esc(dt(l.appointment_start))}</p>` : ''}
              <div style="margin-top:12px"><button>Save</button></div>
            </form></div>
          <div class="panel"><h2>Calls</h2>${calls || '<div class="empty">No calls.</div>'}</div>
        </div>
        <div class="panel"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Text messages</h2>
            <label class="check" style="margin:0"><input type="checkbox" id="ht" ${l.human_takeover ? 'checked' : ''}/> Pause AI replies</label></div>
          <div class="thread" id="thread" style="margin:12px 0">${msgs || '<div class="empty">No texts yet.</div>'}</div>
          <form id="sf" class="row" style="flex-wrap:nowrap"><input name="body" placeholder="${d.optedOut ? 'Contact opted out' : 'Reply as the team (pauses the AI)'}" ${d.optedOut ? 'disabled' : ''} style="flex:1" /><button ${d.optedOut ? 'disabled' : ''}>Send</button></form>
        </div>
      </div>`);
    const th = document.getElementById('thread');
    th.scrollTop = th.scrollHeight;
    document.getElementById('st').onchange = async (e) => {
      await api('/leads/' + id, { method: 'PATCH', body: { status: e.target.value } });
      toast('Status updated');
    };
    document.getElementById('ht').onchange = async (e) => {
      await api('/leads/' + id, { method: 'PATCH', body: { human_takeover: e.target.checked } });
      toast(e.target.checked ? 'AI paused for this lead' : 'AI replies resumed');
    };
    document.getElementById('lf').onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      await api('/leads/' + id, { method: 'PATCH', body: f });
      toast('Saved');
    };
    document.getElementById('sf').onsubmit = async (e) => {
      e.preventDefault();
      const body = e.target.body.value.trim();
      if (!body) return;
      try {
        await api(`/leads/${id}/sms`, { method: 'POST', body: { body } });
        toast('Sent');
        viewLead(id);
      } catch (err) {
        toast(err.message);
      }
    };
  }

  async function viewCalls() {
    const rows = await api('/calls?' + scope());
    const label = { ai: 'AI answered', answered: 'Team answered', abandoned: 'Hung up', ai_failed: 'AI unavailable', ringing: 'Ringing' };
    shell('calls', `<div class="head"><h1>Calls</h1></div><div class="panel tablewrap">${
      rows.length
        ? `<table><thead><tr><th>When</th><th>Caller</th>${state.tenantId ? '' : '<th>Business</th>'}<th>Handled</th><th>Outcome</th><th>Summary</th></tr></thead><tbody>${rows
            .map(
              (c) => `<tr class="${c.lead_id ? 'click' : ''}" ${c.lead_id ? `data-href="#/leads/${c.lead_id}"` : ''}>
          <td class="muted">${esc(dt(c.started_at))}</td><td><b>${esc(c.lead_name || '')}</b><div class="mono muted">${esc(phone(c.from_number))}</div></td>
          ${state.tenantId ? '' : `<td>${esc(c.tenant_name)}</td>`}
          <td>${badge(label[c.path] || c.path, c.path === 'ai' ? 'ai' : c.path)}${c.textback_sent ? '<div class="hint">texted back</div>' : ''}</td>
          <td>${badge(c.outcome, c.outcome === 'booked' ? 'booked' : c.outcome)}</td><td>${esc((c.summary || '').slice(0, 140))}</td></tr>`
            )
            .join('')}</tbody></table>`
        : '<div class="empty">No calls yet.</div>'
    }</div>`);
    bindRowLinks();
  }

  const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  async function viewSettings(params) {
    const id = isAdmin() ? state.tenantId : state.me.tenant_id;
    if (!id) return needTenant('settings', 'Agent settings');
    const t = await api('/tenants/' + id);
    const adm = isAdmin();
    const f = (name, label, opts = {}) => {
      const v = t[name] ?? '';
      const dis = opts.admin && !adm ? 'disabled' : '';
      if (opts.area) return `<label>${label}</label><textarea name="${name}" ${dis}>${esc(v)}</textarea>${opts.hint ? `<div class="hint">${opts.hint}</div>` : ''}`;
      if (opts.select)
        return `<label>${label}</label><select name="${name}" ${dis}>${opts.select.map(([val, txt]) => `<option value="${val}" ${String(v) === val ? 'selected' : ''}>${txt}</option>`).join('')}</select>${opts.hint ? `<div class="hint">${opts.hint}</div>` : ''}`;
      if (opts.check) return `<label class="check"><input type="checkbox" name="${name}" ${v ? 'checked' : ''} ${dis}/> ${label}</label>`;
      return `<label>${label}</label><input name="${name}" type="${opts.type || 'text'}" value="${esc(v)}" ${dis} />${opts.hint ? `<div class="hint">${opts.hint}</div>` : ''}`;
    };
    const hoursRows = DAYS.map((d) => {
      const h = (t.business_hours || {})[d];
      return `<span>${d}</span><input type="time" data-h="${d}-o" value="${h ? h[0] : '08:00'}" /><input type="time" data-h="${d}-c" value="${h ? h[1] : '17:00'}" /><label class="check" style="margin:0"><input type="checkbox" data-h="${d}-on" ${h ? 'checked' : ''}/> open</label>`;
    }).join('');
    const notice = params.get('google') ? '<div class="panel" style="margin-bottom:16px;background:var(--ok-soft)">Google Calendar connected.</div>' : params.get('google_error') ? `<div class="panel" style="margin-bottom:16px;background:var(--danger-soft)">Google error: ${esc(params.get('google_error'))}</div>` : '';
    shell('settings', `
      <div class="head"><div><h1>${esc(t.name)}</h1><div class="muted">What the AI knows and how it books</div></div><button id="save">Save changes</button></div>
      ${notice}
      <form id="sf" class="grid g2">
        <div class="panel"><h2>Business & agent</h2>
          ${f('name', 'Business name', { admin: true })}
          ${f('industry', 'Industry', { admin: true })}
          ${f('agent_name', 'Agent name', { hint: 'The name the AI introduces itself with.' })}
          ${f('services', 'Services offered', { area: true })}
          ${f('service_area', 'Service area', { hint: 'Cities / ZIPs you cover.' })}
          ${f('emergency_policy', 'What counts as an emergency', { area: true })}
          ${f('pricing_notes', 'Pricing guidance', { area: true })}
          ${f('extra_instructions', 'Extra instructions', { area: true, hint: 'Promos, brands you service, financing, anything the AI should mention.' })}
          ${f('avg_job_value', 'Average job value (USD)', { type: 'number', hint: 'Used for the revenue-recovered estimate.' })}
        </div>
        <div>
          <div class="panel" style="margin-bottom:16px"><h2>Business hours</h2>
            ${f('timezone', 'Time zone', { admin: true, select: [['America/New_York', 'Eastern'], ['America/Chicago', 'Central'], ['America/Denver', 'Mountain'], ['America/Phoenix', 'Arizona'], ['America/Los_Angeles', 'Pacific'], ['America/Anchorage', 'Alaska'], ['Pacific/Honolulu', 'Hawaii'], ['America/Toronto', 'Toronto'], ['America/Vancouver', 'Vancouver']] })}
            <div class="hours" style="margin-top:12px">${hoursRows}</div></div>
          <div class="panel" style="margin-bottom:16px"><h2>Booking</h2>
            ${f('booking_provider', 'How the AI books', { select: [['none', 'Take details, team calls back'], ['google', 'Google Calendar (live booking)'], ['calcom', 'Cal.com API (live booking)'], ['link', 'Text a booking link (cal.id, Calendly...)']] })}
            ${f('booking_link', 'Booking link', { hint: 'e.g. https://cal.id/your-page. Also added to text-backs.' })}
            <div class="row" style="margin-top:12px" id="gwrap">${t.google_connected ? '<span class="badge b-booked">Google connected</span> <button type="button" class="ghost" id="gdis">Disconnect</button>' : '<button type="button" class="ghost" id="gcon">Connect Google Calendar</button>'}</div>
            ${f('google_calendar_id', 'Google calendar ID', { hint: '"primary" or a specific calendar ID.' })}
            ${f('calcom_base_url', 'Cal.com API base URL')}
            <label>Cal.com API key</label><input name="calcom_api_key" type="password" placeholder="${t.calcom_key_set ? '•••••• saved' : 'cal_live_...'}" />
            ${f('calcom_event_type_id', 'Cal.com event type ID')}
            <div class="grid g3">${f('slot_minutes', 'Window (min)', { type: 'number' })}${f('min_lead_minutes', 'Notice (min)', { type: 'number' })}${f('booking_days_ahead', 'Days ahead', { type: 'number' })}</div>
            <div class="row" style="margin-top:12px"><button type="button" class="ghost" id="avail">Preview open slots</button></div><div id="availOut" class="hint"></div>
          </div>
        </div>
        <div class="panel"><h2>Text messages & alerts</h2>
          ${f('sms_enabled', 'Send texts to callers', { check: true, admin: true })}
          ${f('sms_ai_enabled', 'Let the AI reply to texts', { check: true })}
          ${f('textback_template', 'Missed-call text-back', { area: true, hint: 'Placeholders: {business}, {link_part}, {link}. Keep "Reply STOP to opt out".' })}
          ${f('notify_phones', 'Alert these phones', { hint: 'Comma-separated, e.g. +15125550100' })}
          ${f('notify_emails', 'Alert these emails', { hint: 'Comma-separated' })}
          <label>Send a test text-back to</label><div class="row" style="flex-wrap:nowrap"><input id="testPhone" placeholder="+1 512 555 0100" style="flex:1" /><button type="button" class="ghost" id="testTb">Send test</button></div>
        </div>
        <div class="panel"><h2>Phone routing</h2>
          ${f('twilio_number', 'Agent phone number (Twilio)', { admin: true })}
          ${f('mode', 'Routing mode', { admin: true, select: [['forward', 'Business forwards unanswered calls here (AI answers immediately)'], ['ring_first', 'Callers dial this number; ring the team first, AI picks up if unanswered']] })}
          ${f('ring_number', 'Team phone to ring first', { admin: true })}
          ${f('ring_timeout_sec', 'Ring seconds before AI picks up', { type: 'number', hint: 'Keep shorter than the team phone voicemail (usually 20-25s).' })}
          ${f('transfer_number', 'Emergency live-transfer number', { hint: 'Optional on-call tech cell. Leave blank to alert by text only.' })}
          ${f('messaging_service_sid', 'Twilio Messaging Service SID (A2P)', { admin: true, hint: 'Optional per-business service; falls back to the global one.' })}
          ${f('voice_id', 'Retell voice override', { admin: true, hint: 'Optional, e.g. retell-Cimo' })}
          ${f('active', 'Active', { check: true, admin: true })}
          ${adm ? `<div class="row" style="margin-top:12px"><button type="button" class="ghost" id="cfgNum">Point Twilio number at this app</button></div>
          <div class="hint" style="margin-top:8px">Webhooks: <div class="copy">${esc(t.webhooks.voice)}</div><div class="copy" style="margin-top:4px">${esc(t.webhooks.sms)}</div></div>` : ''}
        </div>
      </form>`);

    const collect = () => {
      const form = document.getElementById('sf');
      const out = {};
      for (const el of form.elements) {
        if (!el.name || el.disabled) continue;
        if (el.type === 'checkbox') out[el.name] = el.checked;
        else if (el.type === 'number') out[el.name] = el.value === '' ? null : Number(el.value);
        else if (el.name === 'calcom_api_key') {
          if (el.value) out.calcom_api_key = el.value;
        } else out[el.name] = el.value;
      }
      const bh = {};
      for (const d of DAYS) {
        const on = document.querySelector(`[data-h="${d}-on"]`).checked;
        bh[d] = on ? [document.querySelector(`[data-h="${d}-o"]`).value, document.querySelector(`[data-h="${d}-c"]`).value] : null;
      }
      out.business_hours = bh;
      return out;
    };
    const save = async () => {
      try {
        await api('/tenants/' + id, { method: 'PUT', body: collect() });
        toast('Saved');
        await loadTenants();
      } catch (e) {
        toast(e.message);
      }
    };
    document.getElementById('save').onclick = save;
    document.getElementById('sf').onsubmit = (e) => {
      e.preventDefault();
      save();
    };
    const gcon = document.getElementById('gcon');
    if (gcon)
      gcon.onclick = async () => {
        try {
          const r = await api(`/tenants/${id}/google/connect`);
          location.href = r.url;
        } catch (e) {
          toast(e.message);
        }
      };
    const gdis = document.getElementById('gdis');
    if (gdis)
      gdis.onclick = async () => {
        await api('/tenants/' + id, { method: 'PUT', body: { disconnect_google: true } });
        toast('Disconnected');
        viewSettings(new URLSearchParams());
      };
    document.getElementById('avail').onclick = async () => {
      const out = document.getElementById('availOut');
      out.textContent = 'Checking…';
      try {
        const s = await api(`/tenants/${id}/availability`);
        out.textContent = s.length ? s.map((x) => new Date(x.start).toLocaleString()).join(' · ') : 'No open slots found.';
      } catch (e) {
        out.textContent = e.message;
      }
    };
    document.getElementById('testTb').onclick = async () => {
      try {
        const r = await api(`/tenants/${id}/test-textback`, { method: 'POST', body: { phone: document.getElementById('testPhone').value } });
        toast(r.sid ? 'Test text sent' : 'Not sent: ' + r.skipped);
      } catch (e) {
        toast(e.message);
      }
    };
    const cfg = document.getElementById('cfgNum');
    if (cfg)
      cfg.onclick = async () => {
        try {
          await api(`/tenants/${id}/configure-number`, { method: 'POST' });
          toast('Twilio number configured');
        } catch (e) {
          toast(e.message);
        }
      };
  }

  async function viewClients() {
    if (!isAdmin()) return (location.hash = '#/');
    await loadTenants();
    shell('clients', `
      <div class="head"><h1>Clients</h1></div>
      <div class="grid g2">
        <div class="panel tablewrap"><h2>Businesses</h2>${
          state.tenants.length
            ? `<table><thead><tr><th>Name</th><th>Number</th><th>Calls 30d</th><th>Booked 30d</th></tr></thead><tbody>${state.tenants
                .map((t) => `<tr class="click" data-tenant="${t.id}"><td><b>${esc(t.name)}</b> ${t.active ? '' : badge('inactive', 'lost')}<div class="muted">${esc(t.industry)} · ${esc(t.mode)}</div></td><td class="mono">${esc(phone(t.twilio_number) || '-')}</td><td class="mono">${t.calls_30d}</td><td class="mono">${t.booked_30d}</td></tr>`)
                .join('')}</tbody></table>`
            : '<div class="empty">No clients yet.</div>'
        }</div>
        <div>
          <form class="panel" id="nt" style="margin-bottom:16px"><h2>Add a business</h2>
            <label>Business name</label><input name="name" required placeholder="Lone Star Heating & Air" />
            <label>Industry</label><input name="industry" value="HVAC" />
            <label>Time zone</label><select name="timezone"><option>America/New_York</option><option>America/Chicago</option><option>America/Denver</option><option>America/Phoenix</option><option>America/Los_Angeles</option><option>America/Toronto</option></select>
            <label>Twilio number (optional now)</label><input name="twilio_number" placeholder="+15125550199" />
            <div style="margin-top:14px"><button>Create</button></div></form>
          <form class="panel" id="nu"><h2>Give a client dashboard access</h2>
            <label>Business</label><select name="tenant">${state.tenants.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>
            <label>Name</label><input name="name" />
            <label>Email</label><input name="email" type="email" required />
            <label>Temporary password (10+ chars)</label><input name="password" minlength="10" required />
            <div style="margin-top:14px"><button>Create login</button></div></form>
        </div>
      </div>`);
    document.querySelectorAll('[data-tenant]').forEach((tr) => {
      tr.onclick = () => {
        state.tenantId = tr.dataset.tenant;
        try { localStorage.setItem('mca_tenant', state.tenantId); } catch {}
        location.hash = '#/settings';
      };
    });
    document.getElementById('nt').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const t = await api('/tenants', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
        state.tenantId = String(t.id);
        try { localStorage.setItem('mca_tenant', state.tenantId); } catch {}
        await loadTenants();
        toast('Business created - finish its settings');
        location.hash = '#/settings';
      } catch (err) {
        toast(err.message);
      }
    };
    document.getElementById('nu').onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      try {
        await api(`/tenants/${f.tenant}/users`, { method: 'POST', body: f });
        toast('Login created');
        e.target.reset();
      } catch (err) {
        toast(err.message);
      }
    };
  }

  function bindRowLinks() {
    document.querySelectorAll('tr[data-href]').forEach((tr) => (tr.onclick = () => (location.hash = tr.dataset.href)));
  }

  // ---------- router ----------
  async function loadTenants() {
    state.tenants = await api('/tenants');
  }

  async function boot() {
    const me = await api('/me');
    state.me = me.user;
    state.agency = me.agencyName;
    await loadTenants();
    if (isAdmin()) {
      let saved = '';
      try { saved = localStorage.getItem('mca_tenant') || ''; } catch {}
      state.tenantId = state.tenants.some((t) => String(t.id) === saved) ? saved : null;
    } else state.tenantId = String(state.me.tenant_id);
  }

  async function route() {
    const [path, qs] = (location.hash.slice(1) || '/').split('?');
    const params = new URLSearchParams(qs || '');
    if (path === '/login') return viewLogin();
    if (!state.me) {
      try {
        await boot();
      } catch {
        return viewLogin();
      }
    }
    try {
      const m = /^\/leads\/(\d+)$/.exec(path);
      if (m) return await viewLead(m[1]);
      if (path === '/leads') return await viewLeads(params);
      if (path === '/calls') return await viewCalls();
      if (path === '/settings') return await viewSettings(params);
      if (path === '/clients') return await viewClients();
      return await viewOverview();
    } catch (e) {
      if (e.message !== 'Signed out') shell('', `<div class="panel empty">Something went wrong: ${esc(e.message)}</div>`);
    }
  }

  window.addEventListener('hashchange', route);
  route();
})();
