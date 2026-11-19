import { state, esc, icon, api, $, $$, phone, ago, dt, initials, money, toast, busy, formData } from './lib.js';
import { shell, scopeQS } from './shell.js';

const STATUSES = ['new', 'contacted', 'booked', 'won', 'lost', 'spam'];

export async function viewLeads(params) {
  const status = params.get('status') || '';
  const q = params.get('q') || '';
  const rows = await api(`/leads?${scopeQS()}&status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`);
  const all = !state.tenantId;
  const content = shell(
    'leads',
    `<div class="ph"><div><h1>Leads</h1><div class="sub">Everyone who called or texted and didn't reach the team</div></div>
      <div class="actions"><a class="btn" href="/api/leads.csv?${scopeQS()}&status=${encodeURIComponent(status)}" download>${icon('download', 15)} Export CSV</a></div></div>
    <div class="row" style="justify-content:space-between;margin-bottom:14px">
      <div class="tabs">${['', ...STATUSES].map((s) => `<a href="#/leads?status=${s}&q=${encodeURIComponent(q)}" class="${s === status ? 'on' : ''}">${s ? s[0].toUpperCase() + s.slice(1) : 'All'}</a>`).join('')}</div>
      <form id="lq" class="search" style="width:280px">${icon('search', 15)}<input name="q" value="${esc(q)}" placeholder="Name, phone, issue, address" aria-label="Search leads" /></form>
    </div>
    <div class="card">${
      rows.length
        ? `<div class="tw"><table><thead><tr><th>Caller</th><th>Issue</th>${all ? '<th>Business</th>' : ''}<th>Status</th><th>Urgency</th><th>Appointment</th><th>Last activity</th></tr></thead><tbody>
      ${rows
        .map(
          (l) => `<tr class="click" data-href="#/leads/${l.id}">
        <td><div class="who"><div class="avatar av-sm">${esc(initials(l.name))}</div><div><b>${esc(l.name || 'Unknown caller')}</b><span class="muted small tnum">${esc(phone(l.phone))}</span></div></div></td>
        <td><div class="clip">${esc(l.issue || l.last_message || '—')}</div></td>
        ${all ? `<td>${esc(l.tenant_name)}</td>` : ''}
        <td><span class="tag t-${esc(l.status)}">${esc(l.status)}</span>${l.human_takeover ? ' <span class="tag plain">team</span>' : ''}</td>
        <td>${l.urgency ? `<span class="tag t-${esc(l.urgency)}">${esc(l.urgency)}</span>` : '<span class="muted">—</span>'}</td>
        <td class="tnum">${l.appointment_start ? esc(dt(l.appointment_start)) : '<span class="muted">—</span>'}</td>
        <td class="muted">${ago(l.last_activity_at)}</td></tr>`
        )
        .join('')}</tbody></table></div>`
        : `<div class="empty">${icon('users', 26)}<div>No leads match.</div></div>`
    }</div>`
  );
  $('#lq').onsubmit = (e) => {
    e.preventDefault();
    location.hash = `#/leads?status=${encodeURIComponent(status)}&q=${encodeURIComponent(e.target.q.value.trim())}`;
  };
  $$('[data-href]', content).forEach((tr) => (tr.onclick = () => (location.hash = tr.dataset.href)));
}

export async function viewLead(id) {
  const d = await api('/leads/' + id);
  const l = d.lead;
  const pathLabel = { ai: 'AI answered', answered: 'Team answered', abandoned: 'Hung up', ai_failed: 'AI unavailable', ringing: 'Ringing' };
  const calls = d.calls
    .map(
      (c) => `<div class="callcard"><div class="row" style="justify-content:space-between"><b class="tnum">${esc(dt(c.started_at))}</b>
        <span class="row" style="gap:6px"><span class="tag ${c.path === 'ai' ? 't-ai' : ''}">${esc(pathLabel[c.path] || c.path)}</span>${c.outcome ? `<span class="tag plain">${esc(c.outcome.replace(/_/g, ' '))}</span>` : ''}<span class="muted small tnum">${c.duration_sec ? c.duration_sec + 's' : ''}</span></span></div>
        ${c.summary ? `<p style="margin:8px 0 0">${esc(c.summary)}</p>` : ''}
        ${c.textback_sent ? `<div class="muted small" style="margin-top:6px">${icon('message', 12)} Text-back sent</div>` : ''}
        ${c.recording_url && /^https:\/\//.test(c.recording_url) ? `<audio controls preload="none" src="${esc(c.recording_url)}"></audio>` : ''}
        ${c.transcript ? `<details><summary>Transcript</summary><pre>${esc(c.transcript)}</pre></details>` : ''}</div>`
    )
    .join('');
  const who = { ai: 'AI', human: 'Team', system: 'Auto' };
  const msgs = d.messages
    .map((m) => `<div class="bub ${m.direction} ${m.author === 'human' ? 'human' : ''}">${esc(m.body)}<div class="meta">${m.direction === 'in' ? 'Customer' : who[m.author] || 'Auto'} · ${esc(dt(m.created_at))}${m.direction === 'out' && m.status ? ' · ' + esc(m.status) : ''}</div></div>`)
    .join('');
  const content = shell(
    'leads',
    `<div class="ph"><div><a href="#/leads" class="small">${icon('chevronLeft', 13)} Leads</a>
        <div class="row" style="margin-top:6px"><div class="avatar" style="cursor:default">${esc(initials(l.name))}</div><div><h1>${esc(l.name || phone(l.phone))}</h1>
        <div class="sub tnum">${esc(phone(l.phone))} · ${esc(l.tenant_name)} ${l.urgency ? `<span class="tag t-${esc(l.urgency)}">${esc(l.urgency)}</span>` : ''} ${d.optedOut ? '<span class="tag t-lost">opted out</span>' : ''}</div></div></div></div>
      <div class="actions"><select class="in" id="st" style="width:150px" aria-label="Status">${STATUSES.map((s) => `<option value="${s}" ${s === l.status ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select>
        <a class="btn primary" href="tel:${esc(l.phone)}">${icon('phone', 15)} Call back</a></div></div>
    ${l.appointment_start ? `<div class="banner ok">${icon('calendarCheck')}<div><b>Appointment booked:</b> ${esc(dt(l.appointment_start))}${l.appointment_ref ? ` <span class="muted small">(ref ${esc(l.appointment_ref)})</span>` : ''}</div></div>` : ''}
    <div class="ld"><div class="col">
      <div class="card"><div class="card-h"><h2>Details</h2></div>
        <form id="lf"><div class="grid2"><div><label class="f">Name</label><input class="in" name="name" value="${esc(l.name)}" maxlength="120" /></div>
          <div><label class="f">Email</label><input class="in" name="email" type="email" value="${esc(l.email)}" /></div></div>
          <label class="f">Service address</label><input class="in" name="address" value="${esc(l.address)}" />
          <label class="f">Issue</label><textarea class="in" name="issue">${esc(l.issue)}</textarea>
          <label class="f">Internal notes</label><textarea class="in" name="notes" placeholder="Only your team sees this">${esc(l.notes)}</textarea>
          <div style="margin-top:14px"><button class="btn primary">Save</button></div></form></div>
      <div class="card"><div class="card-h"><h2>Calls</h2><span class="muted small">${d.calls.length}</span></div>${calls || `<div class="empty">No calls.</div>`}</div>
    </div>
    <div class="card"><div class="card-h"><h2>Text messages</h2>
        <label class="row small" style="gap:8px;cursor:pointer">Pause AI <span class="switch"><input type="checkbox" id="ht" ${l.human_takeover ? 'checked' : ''}/><span></span></span></label></div>
      <div class="thread" id="thread">${msgs || `<div class="empty">${icon('message', 24)}<div>No texts yet.</div></div>`}</div>
      <form id="sf" class="ask" style="margin-top:12px"><input name="body" maxlength="1000" placeholder="${d.optedOut ? 'This contact opted out of texts' : 'Reply as the team (pauses the AI)'}" ${d.optedOut ? 'disabled' : ''} aria-label="Message" />
        <button class="go" ${d.optedOut ? 'disabled' : ''} aria-label="Send">${icon('send', 15)}</button></form></div></div>`
  );
  const th = $('#thread');
  th.scrollTop = th.scrollHeight;
  $('#st').onchange = async (e) => {
    await api('/leads/' + id, { method: 'PATCH', body: { status: e.target.value } }).then(() => toast('Status updated'), (er) => toast(er.message, 'err'));
  };
  $('#ht').onchange = async (e) => {
    await api('/leads/' + id, { method: 'PATCH', body: { human_takeover: e.target.checked } });
    toast(e.target.checked ? 'AI paused for this lead' : 'AI replies resumed');
  };
  $('#lf').onsubmit = (e) => {
    e.preventDefault();
    busy(e.submitter || $('button', e.target), async () => {
      await api('/leads/' + id, { method: 'PATCH', body: formData(e.target) });
      toast('Saved');
    });
  };
  $('#sf').onsubmit = (e) => {
    e.preventDefault();
    const body = e.target.body.value.trim();
    if (!body) return;
    busy($('.go', e.target), async () => {
      await api(`/leads/${id}/sms`, { method: 'POST', body: { body } });
      toast('Sent');
      viewLead(id);
    });
  };
}

export async function viewCalls() {
  const rows = await api('/calls?' + scopeQS());
  const label = { ai: 'AI answered', answered: 'Team answered', abandoned: 'Hung up', ai_failed: 'AI unavailable', ringing: 'Ringing' };
  const all = !state.tenantId;
  const content = shell(
    'calls',
    `<div class="ph"><div><h1>Calls</h1><div class="sub">Every call that reached the agent number</div></div></div>
    <div class="card">${
      rows.length
        ? `<div class="tw"><table><thead><tr><th>When</th><th>Caller</th>${all ? '<th>Business</th>' : ''}<th>Handled</th><th>Outcome</th><th>Summary</th></tr></thead><tbody>${rows
            .map(
              (c) => `<tr class="${c.lead_id ? 'click' : ''}" ${c.lead_id ? `data-href="#/leads/${c.lead_id}"` : ''}>
          <td class="muted tnum">${esc(dt(c.started_at))}</td>
          <td><div class="who"><div class="avatar av-sm">${esc(initials(c.lead_name))}</div><div><b>${esc(c.lead_name || phone(c.from_number) || 'Unknown')}</b>${c.lead_name ? `<span class="muted small tnum">${esc(phone(c.from_number))}</span>` : ''}</div></div></td>
          ${all ? `<td>${esc(c.tenant_name)}</td>` : ''}
          <td><span class="tag ${c.path === 'ai' ? 't-ai' : c.path === 'answered' ? 't-ok' : 't-new'}">${esc(label[c.path] || c.path)}</span>${c.channel === 'web' ? ' <span class="tag plain">web</span>' : ''}${c.textback_sent ? `<div class="muted small" style="margin-top:4px">texted back</div>` : ''}</td>
          <td>${c.outcome ? `<span class="tag ${c.outcome === 'booked' ? 't-booked' : 'plain'}">${esc(c.outcome.replace(/_/g, ' '))}</span>` : '<span class="muted">—</span>'}</td>
          <td><div class="clip" style="max-width:360px">${esc(c.summary || '')}</div></td></tr>`
            )
            .join('')}</tbody></table></div>`
        : `<div class="empty">${icon('phone', 26)}<div>No calls yet.</div></div>`
    }</div>`
  );
  $$('[data-href]', content).forEach((tr) => (tr.onclick = () => (location.hash = tr.dataset.href)));
}
