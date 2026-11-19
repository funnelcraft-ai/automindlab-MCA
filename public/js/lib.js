// Shared helpers: escaping, formatting, API client, icons, toasts, modals, charts.
export const state = { me: null, tenant: null, agency: '', tenants: [], tenantId: null, days: 30, theme: 'light' };

export const esc = (s) => String(s ?? '').replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const phone = (p) => {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(p || '');
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : p || '';
};
export const num = (n) => Number(n || 0).toLocaleString('en-US');
export const money = (n) => {
  n = Number(n || 0);
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e4) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toLocaleString('en-US');
};
export const ago = (iso) => {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 7 * 86400) return Math.floor(s / 86400) + 'd ago';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
export const dt = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
export const day = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
export const initials = (s) =>
  String(s || '?')
    .replace(/[^A-Za-z ]/g, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '#';

export function delta(cur, prev) {
  if (!prev) return cur ? { pct: 100, up: true } : { pct: 0, up: true };
  const pct = ((cur - prev) / prev) * 100;
  return { pct: Math.abs(pct), up: pct >= 0 };
}
export function deltaPill(cur, prev, { invert = false } = {}) {
  const d = delta(cur, prev);
  const good = invert ? !d.up : d.up;
  return `<span class="pill ${good ? 'pill-up' : 'pill-down'}">${icon(d.up ? 'arrowUp' : 'arrowDown', 10)} ${d.pct.toFixed(1)}%</span>`;
}

// ---------- API ----------
export class ApiError extends Error {}
export async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (method !== 'GET') headers['X-Requested-With'] = 'mca';
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch('/api' + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && !['/login', '/setup', '/me/password'].includes(path) && !path.startsWith('/invite') && !path.startsWith('/demo')) {
    state.me = null;
    if (!location.hash.startsWith('#/login')) location.hash = '#/login';
    throw new ApiError('Please sign in');
  }
  if (!r.ok) throw new ApiError(j.error || 'Request failed');
  return j;
}

// ---------- icons (stroke icons, 24px grid) ----------
const P = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  phoneMissed: '<path d="m22 2-6 6M16 2l6 6"/><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  bot: '<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 8V4M8 4h8"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  calendarCheck: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M9 16l2 2 4-4"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  building: '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v8h4M18 9h2a2 2 0 0 1 2 2v11h-4M10 6h4M10 10h4M10 14h4M10 18h4"/>',
  plug: '<path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  widget: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M17.5 14v7M14 17.5h7"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  arrowDown: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
  arrowRight: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  send: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4"/>',
  clip: '<path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  circle: '<circle cx="12" cy="12" r="10"/>',
  alert: '<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4M12 17h.01"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  sparkles: '<path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2Z"/><path d="M19 3v4M17 5h4"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  trend: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
  pie: '<path d="M21.2 15.9A10 10 0 1 1 8 2.8"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  bars: '<path d="M3 3v18h18"/><path d="M8 17V9M13 17V5M18 17v-6"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  mapPin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  refresh: '<path d="M21 12a9 9 0 0 1-15 6.7L3 16M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M3 21v-5h5"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  play: '<path d="m6 3 14 9-14 9z"/>',
  rocket: '<path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 0 0-2.9-.1z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.9A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22.4 22.4 0 0 1-4 2z"/><path d="M9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  logo: '<path d="M12 2 3 7v10l9 5 9-5V7z" fill="currentColor" stroke="none" opacity=".18"/><path d="M12 2 3 7l9 5 9-5zM3 17l9 5 9-5M12 12v10"/>',
};
// Agency logo (light + dark variants; CSS shows the right one for the theme).
export function brandLogo(height = 30, alt = 'Automindlab') {
  return `<span class="brand-logo" style="--h:${height}px"><img class="logo-l" src="/brand/logo-light-sm.png" alt="${esc(alt)}" height="${height}" /><img class="logo-d" src="/brand/logo-dark-sm.png" alt="" aria-hidden="true" height="${height}" /></span>`;
}

export function icon(name, size = 16, cls = '') {
  return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

// ---------- toast / modal ----------
export function toast(msg, kind = '') {
  const t = document.getElementById('toast');
  t.className = 'show ' + kind;
  t.textContent = msg;
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.className = ''), 3200);
}

export function modal({ title, body, confirm = 'Confirm', cancel = 'Cancel', danger = false, onConfirm }) {
  const wrap = document.createElement('div');
  wrap.className = 'overlay';
  wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-h"><h3>${esc(title)}</h3><button class="icon-btn" data-x aria-label="Close">${icon('x')}</button></div>
    <div class="modal-b">${body}</div>
    <div class="modal-f"><button class="btn ghost" data-x>${esc(cancel)}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(confirm)}</button></div></div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  $$('[data-x]', wrap).forEach((b) => (b.onclick = close));
  wrap.addEventListener('click', (e) => e.target === wrap && close());
  const ok = $('[data-ok]', wrap);
  ok.onclick = async () => {
    ok.disabled = true;
    try {
      if ((await onConfirm?.(wrap)) !== false) close();
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      ok.disabled = false;
    }
  };
  ok.focus();
  return wrap;
}

export async function copyText(s) {
  try {
    await navigator.clipboard.writeText(s);
    toast('Copied');
  } catch {
    toast('Copy failed - select and copy manually', 'err');
  }
}

// Runs an async action on a button with a spinner state.
export async function busy(btn, fn) {
  if (btn.disabled) return;
  const html = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add('loading');
  try {
    return await fn();
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.innerHTML = html;
  }
}

export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') {
      if (el.checked) out[el.name] = el.value;
    } else if (el.type === 'number') out[el.name] = el.value === '' ? null : Number(el.value);
    else out[el.name] = el.value;
  }
  return out;
}

// ---------- charts ----------
// Line chart: current series (solid, filled) vs previous (dashed). Hover shows a tooltip.
export function lineChart(el, { labels, current, previous, format = money }) {
  const W = 560, H = 190, L = 34, R = 8, T = 10, B = 26;
  const max = Math.max(1, ...current, ...previous);
  const nice = Math.ceil(max / 4 / 10 ** Math.floor(Math.log10(max / 4 || 1))) * 10 ** Math.floor(Math.log10(max / 4 || 1)) * 4 || 4;
  const n = labels.length;
  const x = (i) => L + (i * (W - L - R)) / Math.max(1, n - 1);
  const y = (v) => T + (H - T - B) * (1 - v / nice);
  const path = (arr) => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const smooth = (arr) => {
    if (arr.length < 3) return path(arr);
    let d = `M${x(0)},${y(arr[0])}`;
    for (let i = 1; i < arr.length; i++) {
      const xm = (x(i - 1) + x(i)) / 2;
      d += ` C${xm},${y(arr[i - 1])} ${xm},${y(arr[i])} ${x(i)},${y(arr[i])}`;
    }
    return d;
  };
  const grid = [0, 1, 2, 3, 4]
    .map((k) => {
      const v = (nice / 4) * k;
      return `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 3}" text-anchor="end" class="axis">${format(v).replace('$', '')}</text>`;
    })
    .join('');
  const step = Math.max(1, Math.round(n / 5));
  const xl = labels.map((lb, i) => (i % step === 0 || i === n - 1 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" class="axis">${esc(lb)}</text>` : '')).join('');
  const cur = smooth(current);
  el.innerHTML = `<div class="lc"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Revenue trend">
    <defs><linearGradient id="lcg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--blue)" stop-opacity=".22"/><stop offset="1" stop-color="var(--blue)" stop-opacity="0"/></linearGradient></defs>
    ${grid}${xl}
    <path d="${cur} L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z" fill="url(#lcg)"/>
    <path d="${smooth(previous)}" class="prev"/>
    <path d="${cur}" class="cur"/>
    <line class="hover-line" x1="0" x2="0" y1="${T}" y2="${H - B}" style="display:none"/>
    <circle class="hover-dot" r="4.5" style="display:none"/>
    <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" class="hit"/>
  </svg><div class="tip" style="display:none"></div></div>`;
  const svg = $('svg', el), tip = $('.tip', el), hl = $('.hover-line', el), dot = $('.hover-dot', el);
  const hit = $('.hit', el);
  const move = (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1))));
    hl.setAttribute('x1', x(i));
    hl.setAttribute('x2', x(i));
    dot.setAttribute('cx', x(i));
    dot.setAttribute('cy', y(current[i]));
    hl.style.display = dot.style.display = '';
    tip.style.display = '';
    tip.innerHTML = `<b>${esc(labels[i])}</b><div><i class="sw cur"></i>${format(current[i])} <span>this period</span></div><div><i class="sw prev"></i>${format(previous[i])} <span>last period</span></div>`;
    const left = (x(i) / W) * r.width;
    tip.style.left = Math.min(left + 12, r.width - 170) + 'px';
    tip.style.top = Math.max(0, (y(current[i]) / H) * r.height - 30) + 'px';
  };
  hit.addEventListener('mousemove', move);
  hit.addEventListener('mouseleave', () => (tip.style.display = hl.style.display = dot.style.display = 'none'));
}

export function barChart(el, items /* [{label, value}] */) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const top = items.reduce((a, b) => (b.value > a.value ? b : a), items[0]);
  el.innerHTML = `<div class="bc">${items
    .map(
      (it) => `<div class="bc-col ${it === top && top.value ? 'peak' : ''}" title="${esc(it.label)}: ${num(it.value)}">
      <div class="bc-track"><div class="bc-bar" style="height:${Math.max(6, (it.value / max) * 100)}%">${it === top && top.value ? `<span>${num(it.value)}</span>` : ''}</div></div>
      <div class="bc-l">${esc(it.label)}</div></div>`
    )
    .join('')}</div>`;
}

export function gauge(el, pct, { label = '', sub = '' } = {}) {
  const N = 42, cx = 110, cy = 104, r1 = 78, r2 = 98;
  const on = Math.round((Math.min(100, Math.max(0, pct)) / 100) * N);
  const ticks = Array.from({ length: N }, (_, i) => {
    const a = Math.PI * (1 - i / (N - 1));
    const x1 = cx + r1 * Math.cos(a), y1 = cy - r1 * Math.sin(a), x2 = cx + r2 * Math.cos(a), y2 = cy - r2 * Math.sin(a);
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="${i < on ? 'on' : 'off'}" style="--i:${i}"/>`;
  }).join('');
  el.innerHTML = `<div class="gauge"><svg viewBox="0 0 220 116" role="img" aria-label="${esc(label)} ${pct}%">${ticks}</svg>
    <div class="gauge-c"><div class="gauge-v">${Math.round(pct)}%</div><div class="gauge-s">${esc(sub)}</div></div></div>`;
}

export function donut(el, parts /* [{label,value,color}] */) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  const C = 2 * Math.PI * 40;
  let off = 0;
  const segs = parts
    .map((p) => {
      const len = (p.value / total) * C;
      const s = `<circle r="40" cx="60" cy="60" fill="none" stroke="${p.color}" stroke-width="16" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 60 60)"/>`;
      off += len;
      return s;
    })
    .join('');
  el.innerHTML = `<div class="donut"><svg viewBox="0 0 120 120"><circle r="40" cx="60" cy="60" fill="none" stroke="var(--track)" stroke-width="16"/>${segs}
    <text x="60" y="58" text-anchor="middle" class="dv">${num(total === 1 && !parts.some((p) => p.value) ? 0 : total)}</text><text x="60" y="74" text-anchor="middle" class="dl">calls</text></svg>
    <ul>${parts.map((p) => `<li><i style="background:${p.color}"></i>${esc(p.label)}<b>${num(p.value)}</b></li>`).join('')}</ul></div>`;
}

export function pwStrength(pw) {
  let s = 0;
  if (pw.length >= 10) s++;
  if (pw.length >= 14) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(4, s);
}
