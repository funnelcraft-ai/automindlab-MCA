import { state, api, esc, icon } from './lib.js';
import { shell, isAdmin, setTenant } from './shell.js';
import { viewDashboard } from './dashboard.js';
import { viewLeads, viewLead, viewCalls } from './leads.js';
import { viewBusinesses, viewBusiness } from './business.js';
import { viewLogin, viewSetup, viewInvite, viewIntegrations, viewAccount, viewHelp, viewDemo } from './admin.js';

export async function reloadTenants() {
  state.tenants = await api('/tenants');
}

export async function boot() {
  const me = await api('/me');
  state.me = me.user;
  state.agency = me.agencyName;
  await reloadTenants();
  if (isAdmin()) {
    let saved = '';
    try {
      saved = localStorage.getItem('mca_tenant') || '';
    } catch {}
    state.tenantId = state.tenants.some((t) => String(t.id) === saved) ? saved : null;
    try {
      const d = await api('/integrations');
      const missing = d.readiness.filter((r) => r.required && !r.ok);
      state.readinessBanner = missing.length
        ? `<div class="banner warn">${icon('alert')}<div><b>Finish platform setup:</b> ${missing.map((m) => esc(m.label)).join(', ')}. <a href="#/integrations">Open Integrations</a></div></div>`
        : '';
    } catch {
      state.readinessBanner = '';
    }
  } else {
    state.tenantId = String(state.me.tenant_id);
    const t = state.tenants[0];
    state.readinessBanner = t && !t.active ? `<div class="banner">${icon('clock')}<div>Your agent is being set up and isn't live yet. Calls from your own phone work for testing.</div></div>` : '';
  }
  await refreshBadges();
}

async function refreshBadges() {
  try {
    const [newLeads, notes] = await Promise.all([api(`/leads?status=new${state.tenantId ? '&tenant=' + state.tenantId : ''}`), api('/notifications')]);
    state.newLeads = newLeads.length;
    let seen = 0;
    try {
      seen = Number(localStorage.getItem('mca_seen') || 0);
    } catch {}
    state.unread = notes.some((n) => new Date(n.created_at).getTime() > seen);
  } catch {}
}

let routing = 0;
async function route() {
  const ticket = ++routing;
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  const params = new URLSearchParams(qs || '');
  if (path.startsWith('/invite/')) return viewInvite(path.slice(8));
  if (path.startsWith('/demo/')) return viewDemo(path.slice(6));
  if (path === '/login' || path === '/setup' || !state.me) {
    let status = { needsSetup: false };
    try {
      status = await api('/setup/status');
      state.agency = status.agencyName;
    } catch {}
    if (status.needsSetup) return viewSetup(status);
    if (path === '/login') return viewLogin();
    try {
      await boot();
    } catch {
      return viewLogin();
    }
  }
  if (ticket !== routing) return;
  document.getElementById('side')?.classList.remove('open');
  try {
    let m;
    if ((m = /^\/leads\/(\d+)$/.exec(path))) return await viewLead(m[1]);
    if (path === '/leads') return await viewLeads(params);
    if (path === '/calls') return await viewCalls();
    if (path === '/businesses/new') return (location.hash = '#/businesses?new=1');
    if ((m = /^\/businesses\/(\d+)$/.exec(path))) {
      if (isAdmin()) setTenant(m[1]);
      return await viewBusiness(m[1], params);
    }
    if (path === '/businesses') return isAdmin() ? await viewBusinesses(params) : (location.hash = `#/businesses/${state.me.tenant_id}`);
    if (path === '/integrations') return isAdmin() ? await viewIntegrations(params) : (location.hash = '#/');
    if (path === '/account') return viewAccount();
    if (path === '/help') return viewHelp();
    if (params.get('google_error')) setTimeout(() => import('./lib.js').then((l) => l.toast('Google: ' + params.get('google_error'), 'err')), 300);
    return await viewDashboard();
  } catch (e) {
    if (state.me) shell('', `<div class="card empty">${icon('alert', 26)}<div>Something went wrong: ${esc(e.message)}</div><div style="margin-top:12px"><a class="btn" href="#/">Back to dashboard</a></div></div>`);
  }
}

// Live updates: new bookings, calls and emergencies pop up without refreshing (great during live demos).
const LIVE_TEXT = {
  appointment_booked: (n) => `New job booked${n.lead_name ? ' for ' + n.lead_name : ''}`,
  emergency_escalated: (n) => `Emergency call${n.lead_name ? ' from ' + n.lead_name : ''}`,
  call_analyzed: (n) => `AI finished a call${n.lead_name ? ' with ' + n.lead_name : ''}`,
  textback_sent: (n) => `Text-back sent${n.lead_name ? ' to ' + n.lead_name : ''}`,
  web_call_started: () => 'Web call started',
};
let lastNoteId = null;
async function pollLive() {
  if (!state.me || document.hidden) return;
  try {
    const notes = await api('/notifications' + (state.tenantId ? '?tenant=' + state.tenantId : ''));
    const newest = notes[0]?.id || 0;
    if (lastNoteId === null) {
      lastNoteId = newest;
      return;
    }
    if (newest > lastNoteId) {
      const fresh = notes.filter((n) => n.id > lastNoteId);
      lastNoteId = newest;
      const top = fresh.find((n) => LIVE_TEXT[n.type]);
      if (top) {
        const { toast } = await import('./lib.js');
        toast(LIVE_TEXT[top.type](top));
      }
      state.unread = true;
      const bell = document.getElementById('bellBtn');
      if (bell && !bell.querySelector('.dot')) bell.insertAdjacentHTML('beforeend', '<span class="dot"></span>');
      const [path] = (location.hash.slice(1) || '/').split('?');
      const busyUi = document.querySelector('.overlay, .drawer') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
      if (!busyUi && ['/', '/leads', '/calls'].includes(path)) route();
    }
  } catch {}
}
setInterval(pollLive, 8000);

window.addEventListener('hashchange', route);
route();
