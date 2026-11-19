// App frame: sidebar, top bar, notifications, theme, search.
import { state, esc, icon, api, $, $$, initials, ago, phone } from './lib.js';

export const isAdmin = () => state.me?.role === 'admin';
export const scopeQS = () => (state.tenantId ? `tenant=${state.tenantId}` : '');

export function setTenant(id) {
  state.tenantId = id ? String(id) : null;
  try {
    localStorage.setItem('mca_tenant', state.tenantId || '');
  } catch {}
}

export function shell(active, inner) {
  const app = document.getElementById('app');
  const newCount = state.newLeads || 0;
  const live = state.tenants.filter((t) => t.active).length;
  const nav = [
    ['#/', 'Dashboard', 'dashboard', 'dashboard'],
    ['#/leads', 'Leads', 'users', 'leads', newCount ? `<span class="count">${newCount}</span>` : ''],
    ['#/calls', 'Calls', 'phone', 'calls'],
  ];
  const mine = !isAdmin() && state.me.tenant_id;
  const bizLinks = isAdmin()
    ? `<a href="#/businesses" class="${active === 'businesses' ? 'on' : ''}">${icon('building')} Businesses <span class="count" style="color:var(--blue);background:var(--blue-soft)">${live}/${state.tenants.length}</span></a>
       <a href="#/integrations" class="${active === 'integrations' ? 'on' : ''}">${icon('plug')} Integrations</a>`
    : `<a href="#/businesses/${mine}" class="${active === 'businesses' ? 'on' : ''}">${icon('building')} My business</a>`;
  const picker = isAdmin()
    ? `<div style="padding:0 2px 14px"><select class="in" id="tenantPick" aria-label="Business" style="height:34px;font-size:12.5px">
        <option value="">All businesses</option>${state.tenants.map((t) => `<option value="${t.id}" ${String(t.id) === String(state.tenantId) ? 'selected' : ''}>${esc(t.name)}${t.active ? '' : ' · test'}</option>`).join('')}</select></div>`
    : '';
  const promo = isAdmin()
    ? `<div class="promo"><div class="pi">${icon('rocket', 16)}</div><b>Onboard a business</b><p>Number, script, booking and go-live checks in about 10 minutes.</p><a class="btn sm" href="#/businesses/new">${icon('plus', 14)} Start onboarding</a></div>`
    : `<div class="promo"><div class="pi">${icon('shield', 16)}</div><b>Your AI receptionist</b><p>Every missed call is answered, texted back and logged here.</p><a class="btn sm" href="#/businesses/${mine}">View setup</a></div>`;
  app.innerHTML = `<div class="shell">
    <aside class="side" id="side">
      <div class="brand"><span class="brand-n">${icon('logo', 22)} ${esc(state.agency || 'Missed Call Agent')}</span></div>
      ${picker}
      <nav class="nav" aria-label="Main">
        ${nav.map(([h, l, ic, k, extra]) => `<a href="${h}" class="${k === active ? 'on' : ''}">${icon(ic)} ${l}${extra || ''}</a>`).join('')}
        <div class="nav-sep"></div>
        ${bizLinks}
      </nav>
      <div class="grow"></div>
      <nav class="nav">
        <a href="#/account" class="${active === 'account' ? 'on' : ''}">${icon('settings')} Settings</a>
        <a href="#/help" class="${active === 'help' ? 'on' : ''}">${icon('help')} Help & Support</a>
      </nav>
      ${promo}
    </aside>
    <div class="main">
      <header class="top">
        <button class="icon-btn menu-btn" id="menuBtn" aria-label="Menu">${icon('list')}</button>
        <form class="search" id="gsearch" role="search">${icon('search', 15)}<input id="gq" placeholder="Search anything…" aria-label="Search" /><span class="kbd">⌘K</span></form>
        <div class="spacer"></div>
        <button class="icon-btn" id="themeBtn" aria-label="Toggle dark mode">${icon(document.documentElement.dataset.theme === 'dark' ? 'moon' : 'sun')}</button>
        <div style="position:relative"><button class="icon-btn" id="bellBtn" aria-label="Notifications">${icon('bell')}${state.unread ? '<span class="dot"></span>' : ''}</button></div>
        <div style="position:relative"><button class="avatar" id="meBtn" aria-label="Account">${esc(initials(state.me.name || state.me.email))}</button></div>
      </header>
      <div class="content" id="content">${inner}</div>
    </div></div>`;

  const tp = $('#tenantPick');
  if (tp) tp.onchange = () => (setTenant(tp.value), window.dispatchEvent(new HashChangeEvent('hashchange')));
  $('#gsearch').onsubmit = (e) => {
    e.preventDefault();
    location.hash = `#/leads?q=${encodeURIComponent($('#gq').value.trim())}`;
  };
  $('#themeBtn').onclick = () => {
    const dark = document.documentElement.dataset.theme !== 'dark';
    if (dark) document.documentElement.dataset.theme = 'dark';
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem('mca_theme', dark ? 'dark' : 'light');
    } catch {}
    $('#themeBtn').innerHTML = icon(dark ? 'moon' : 'sun');
  };
  $('#menuBtn').onclick = () => $('#side').classList.toggle('open');
  $('#bellBtn').onclick = (e) => toggleNotifications(e.currentTarget.parentElement);
  $('#meBtn').onclick = (e) => toggleMeMenu(e.currentTarget.parentElement);
  return $('#content');
}

function closePops() {
  $$('.pop').forEach((p) => p.remove());
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.pop') && !e.target.closest('#bellBtn') && !e.target.closest('#meBtn')) closePops();
});
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    $('#gq')?.focus();
  }
  if (e.key === 'Escape') {
    closePops();
    $$('.overlay, .drawer').forEach((x) => x.remove());
  }
});

const NOTE = {
  appointment_booked: ['calendarCheck', 'var(--green)', 'var(--green-soft)', (n) => `Job booked${n.lead_name ? ' for ' + esc(n.lead_name) : ''}`],
  emergency_escalated: ['alert', 'var(--red)', 'var(--red-soft)', (n) => `Emergency from ${esc(n.lead_name || phone(n.phone))}`],
  call_analyzed: ['bot', 'var(--blue)', 'var(--blue-soft)', (n) => `AI handled a call${n.lead_name ? ' from ' + esc(n.lead_name) : ''}`],
  opted_out: ['x', 'var(--ink-3)', 'var(--panel-2)', (n) => `${esc(n.lead_name || phone(n.phone))} opted out of texts`],
  went_live: ['rocket', 'var(--blue)', 'var(--blue-soft)', (n) => `${esc(n.tenant_name)} is live`],
  textback_sent: ['message', 'var(--orange)', 'var(--orange-soft)', (n) => `Texted back ${esc(n.lead_name || phone(n.phone))}`],
};

async function toggleNotifications(anchor) {
  if ($('.pop', anchor)) return closePops();
  closePops();
  const pop = document.createElement('div');
  pop.className = 'pop';
  pop.innerHTML = `<div class="pop-h">Notifications</div><div class="empty">Loading…</div>`;
  anchor.appendChild(pop);
  try {
    const items = await api('/notifications?' + scopeQS());
    state.unread = 0;
    try {
      localStorage.setItem('mca_seen', String(Date.now()));
    } catch {}
    $('#bellBtn .dot')?.remove();
    pop.innerHTML =
      `<div class="pop-h">Notifications</div>` +
      (items.length
        ? items
            .map((n) => {
              const [ic, c, bg, txt] = NOTE[n.type] || ['bell', 'var(--ink-3)', 'var(--panel-2)', () => n.type];
              return `<div class="pop-i" data-lead="${n.lead_id || ''}"><div class="ni" style="color:${c};background:${bg}">${icon(ic, 15)}</div><div><div>${txt(n)}</div><div class="muted small">${esc(n.tenant_name || '')} · ${ago(n.created_at)}</div></div></div>`;
            })
            .join('')
        : `<div class="empty">Nothing yet.</div>`);
    $$('.pop-i', pop).forEach((el) => (el.onclick = () => el.dataset.lead && (location.hash = `#/leads/${el.dataset.lead}`)));
  } catch (e) {
    pop.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

function toggleMeMenu(anchor) {
  if ($('.pop', anchor)) return closePops();
  closePops();
  const pop = document.createElement('div');
  pop.className = 'pop';
  pop.style.width = '240px';
  pop.innerHTML = `<div class="pop-h">${esc(state.me.name || 'Account')}<div class="muted small" style="font-weight:400">${esc(state.me.email)}</div></div>
    <div class="pop-i" data-go="#/account">${icon('settings', 15)} Account & security</div>
    <div class="pop-i" id="logoutBtn">${icon('logout', 15)} Sign out</div>`;
  anchor.appendChild(pop);
  $('[data-go]', pop).onclick = () => (location.hash = '#/account');
  $('#logoutBtn', pop).onclick = async () => {
    await api('/logout', { method: 'POST' }).catch(() => {});
    state.me = null;
    location.hash = '#/login';
  };
}

export function needBusiness(active, title) {
  const c = shell(active, `<div class="ph"><h1>${esc(title)}</h1></div>
    <div class="card empty">${icon('building', 28)}<div>Pick a business in the sidebar to see this page.</div></div>`);
  return c;
}
