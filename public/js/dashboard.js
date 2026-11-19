import { state, esc, icon, api, $, $$, num, money, day, deltaPill, lineChart, barChart, gauge, donut, initials, phone, ago, toast } from './lib.js';
import { shell, scopeQS, isAdmin } from './shell.js';

// Widgets the user can add/remove (stored per browser).
const WIDGETS = {
  revenue: { title: 'Revenue recovered', desc: 'Estimated value of jobs the agent booked, vs. the previous period.', tag: 'Revenue', ic: 'trend' },
  busiest: { title: 'Busiest missed-call days', desc: 'Which weekdays the team misses the most calls.', tag: 'Operations', ic: 'bars' },
  recovery: { title: 'Recovery rate', desc: 'Share of missed calls that turned into booked jobs.', tag: 'Performance', ic: 'gauge' },
  outcomes: { title: 'Call outcomes', desc: 'How every missed call ended: booked, callback, hang-up, spam.', tag: 'Audience Insights', ic: 'pie' },
  leads: { title: 'Latest leads', desc: 'The newest callers with status, value and urgency.', tag: 'Pipeline', ic: 'list' },
  assistant: { title: 'AI Assistant', desc: 'Ask questions about your calls and leads in plain English.', tag: 'Strategy', ic: 'sparkles' },
  businesses: { title: 'Business leaderboard', desc: 'Calls and bookings per client business.', tag: 'Agency', ic: 'building', admin: true },
};
const DEFAULT = ['revenue', 'busiest', 'recovery', 'leads', 'assistant', 'outcomes'];

function getLayout() {
  try {
    const v = JSON.parse(localStorage.getItem('mca_widgets') || 'null');
    if (Array.isArray(v)) return v.filter((k) => WIDGETS[k]);
  } catch {}
  return DEFAULT.slice();
}
function setLayout(v) {
  try {
    localStorage.setItem('mca_widgets', JSON.stringify(v));
  } catch {}
}

function kpi(title, ic, cur, prev, { fmt = num, invert = false } = {}) {
  return `<div class="card kpi"><div class="kh">${esc(title)} ${icon(ic, 17)}</div>
    <div class="kv"><b>${fmt(cur)}</b>${deltaPill(cur, prev, { invert })}</div>
    <div class="kf">vs. ${fmt(prev)} last period</div></div>`;
}

const menuBtn = (k) => `<button class="icon-btn" data-wmenu="${k}" aria-label="Widget options">${icon('more')}</button>`;

export async function viewDashboard() {
  const days = state.days;
  const [s, leads] = await Promise.all([api(`/stats?days=${days}&${scopeQS()}`), api(`/leads?${scopeQS()}`)]);
  const layout = getLayout();
  const c = s.current, p = s.previous;
  const end = new Date(), start = new Date(Date.now() - (days - 1) * 864e5);
  const has = (k) => layout.includes(k) && (!WIDGETS[k].admin || isAdmin());

  // Revenue series aligned day by day
  const keyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const cur = Object.fromEntries(s.revenueDaily.map((r) => [r.day, r.revenue]));
  const prv = Object.fromEntries(s.revenueDailyPrev.map((r) => [r.day, r.revenue]));
  const labels = [], seriesC = [], seriesP = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5);
    labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    seriesC.push(cur[keyOf(d)] || 0);
    seriesP.push(prv[keyOf(d)] || 0);
  }
  // Cumulative reads better for a "recovered so far" story
  const cum = (a) => a.reduce((acc, v, i) => (acc.push((acc[i - 1] || 0) + v), acc), []);

  const booked = c.booked, callback = (s.outcomes.find((o) => o.outcome === 'callback_requested') || {}).n || 0, texted = c.textbacks;
  const splitMax = Math.max(1, booked, callback, texted);

  const leftWidgets = [];
  if (has('revenue'))
    leftWidgets.push(`<div class="card" data-w="revenue"><div class="card-h"><h2>Revenue recovered</h2>${menuBtn('revenue')}</div>
      <div class="profit"><div><div class="big">${money(c.revenue)}</div><div class="row">${deltaPill(c.revenue, p.revenue)}<span class="muted small">vs. last period</span></div></div><div id="lc"></div></div>
      <div class="inner" style="margin-top:14px"><div class="card-h" style="margin-bottom:10px"><h3>Missed callers</h3></div>
        <div class="split">
          <div style="--c:var(--blue)"><b>${icon('calendarCheck', 15)} ${num(booked)}</b><div class="muted small">Booked</div><div class="bar" style="width:${(booked / splitMax) * 100}%"></div></div>
          <div style="--c:var(--green)"><b>${icon('phone', 15)} ${num(callback)}</b><div class="muted small">Callback requested</div><div class="bar" style="width:${(callback / splitMax) * 100}%"></div></div>
          <div style="--c:var(--orange)"><b>${icon('message', 15)} ${num(texted)}</b><div class="muted small">Texted back</div><div class="bar" style="width:${(texted / splitMax) * 100}%"></div></div>
        </div></div></div>`);
  if (has('leads')) {
    const rows = leads.slice(0, 6);
    leftWidgets.push(`<div class="card" data-w="leads"><div class="card-h"><h2>Latest leads</h2><div class="row"><a href="#/leads" class="small">View all</a>${menuBtn('leads')}</div></div>
      ${
        rows.length
          ? `<div class="tw"><table class="compact"><thead><tr><th>ID</th><th>Caller</th><th>Issue</th><th>Status</th><th>Value</th><th>Urgency</th></tr></thead><tbody>
        ${rows
          .map(
            (l) => `<tr class="click" data-href="#/leads/${l.id}"><td class="muted tnum">#${String(l.id).padStart(5, '0')}</td>
          <td><div class="who"><div class="avatar av-sm">${esc(initials(l.name))}</div><div><b>${esc(l.name || phone(l.phone))}</b><span class="muted small">${esc(l.name ? phone(l.phone) : ago(l.last_activity_at))}</span></div></div></td>
          <td><div class="clip">${esc(l.issue || l.last_message || '—')}</div></td>
          <td><span class="tag t-${esc(l.status)}">${esc(l.status)}</span></td>
          <td>${['booked', 'won'].includes(l.status) ? `<span class="money-up">${icon('checkCircle', 14)} ${money(l.avg_job_value)}</span>` : '<span class="muted">—</span>'}</td>
          <td>${l.urgency ? `<span class="tag t-${esc(l.urgency)}">${esc(l.urgency)}</span>` : '<span class="muted">—</span>'}</td></tr>`
          )
          .join('')}</tbody></table></div>`
          : `<div class="empty">${icon('users', 26)}<div>No leads yet. They'll appear here as soon as a missed call comes in.</div></div>`
      }</div>`);
  }
  if (has('businesses') && isAdmin() && !state.tenantId) {
    leftWidgets.push(`<div class="card" data-w="businesses"><div class="card-h"><h2>Business leaderboard</h2>${menuBtn('businesses')}</div>
      <div class="tw"><table><thead><tr><th>Business</th><th>Status</th><th>Calls (30d)</th><th>Booked (30d)</th></tr></thead><tbody>
      ${state.tenants
        .slice()
        .sort((a, b) => b.booked_30d - a.booked_30d)
        .map((t) => `<tr class="click" data-href="#/businesses/${t.id}"><td><b>${esc(t.name)}</b></td><td><span class="tag ${t.active ? 't-live' : 't-new'}">${t.active ? 'Live' : 'Onboarding'}</span></td><td class="tnum">${num(t.calls_30d)}</td><td class="tnum">${num(t.booked_30d)}</td></tr>`)
        .join('') || '<tr><td colspan="4" class="empty">No businesses yet.</td></tr>'}</tbody></table></div></div>`);
  }

  const rightWidgets = [];
  if (has('busiest')) rightWidgets.push(`<div class="card" data-w="busiest"><div class="card-h"><h2>Busiest missed-call days</h2>${menuBtn('busiest')}</div><div id="bc"></div></div>`);
  if (has('recovery'))
    rightWidgets.push(`<div class="card" data-w="recovery"><div class="card-h"><h2>Recovery rate</h2>${menuBtn('recovery')}</div><div id="gg"></div>
      <div style="text-align:center;margin-top:8px"><a class="btn xs" href="#/calls">Show details</a></div></div>`);
  if (has('outcomes')) rightWidgets.push(`<div class="card" data-w="outcomes"><div class="card-h"><h2>Call outcomes</h2>${menuBtn('outcomes')}</div><div id="dn"></div></div>`);
  if (has('assistant'))
    rightWidgets.push(`<div class="card ai" data-w="assistant"><div class="card-h"><h2>AI Assistant</h2>${menuBtn('assistant')}</div>
      <div class="ai-log" id="aiLog"></div><div class="orb-wrap" id="orbWrap"><div class="orb"></div></div>
      <form class="ask" id="askForm">${icon('sparkles', 15, 'ic-muted')}<input id="askIn" placeholder="Ask me anything… e.g. who still needs a callback?" maxlength="500" aria-label="Ask the assistant" /><button class="go" aria-label="Send">${icon('send', 15)}</button></form></div>`);

  const content = shell(
    'dashboard',
    `<div class="ph"><div><h1>Dashboard</h1><div class="sub">${state.tenantId ? esc(state.tenants.find((t) => String(t.id) === state.tenantId)?.name || '') : isAdmin() ? 'All businesses' : ''}</div></div>
      <div class="actions">
        <div class="seg">${'<span>' + icon('calendar', 15) + ' ' + day(start) + ' – ' + day(end) + '</span>'}<select id="range" aria-label="Date range">${[7, 30, 90]
          .map((d) => `<option value="${d}" ${d === days ? 'selected' : ''}>Last ${d} days</option>`)
          .join('')}</select></div>
        <button class="btn" id="addW">${icon('widget', 15)} Add widget</button>
        <a class="btn primary" href="/api/leads.csv?${scopeQS()}" download>${icon('download', 15)} Export</a>
      </div></div>
    ${state.readinessBanner || ''}
    <div class="kpis">
      ${kpi('Missed calls', 'phoneMissed', c.missed, p.missed)}
      ${kpi('Answered by AI', 'bot', c.ai_handled, p.ai_handled)}
      ${kpi('Jobs booked', 'calendarCheck', c.booked, p.booked)}
      ${kpi('Text-backs', 'message', c.textbacks, p.textbacks)}
    </div>
    <div class="dash"><div class="col">${leftWidgets.join('') || ''}</div><div class="col">${rightWidgets.join('')}</div></div>`
  );

  if ($('#lc')) lineChart($('#lc'), { labels, current: cum(seriesC), previous: cum(seriesP) });
  if ($('#bc')) {
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    barChart($('#bc'), names.map((n, i) => ({ label: n, value: (s.weekday.find((w) => w.dow === i) || {}).n || 0 })));
  }
  if ($('#gg')) gauge($('#gg'), c.recovery_rate, { label: 'Recovery rate', sub: c.missed ? `${num(c.booked)} of ${num(c.missed)} missed calls booked` : 'No missed calls yet' });
  if ($('#dn')) {
    const o = Object.fromEntries(s.outcomes.map((x) => [x.outcome, x.n]));
    donut($('#dn'), [
      { label: 'Booked', value: o.booked || 0, color: 'var(--blue)' },
      { label: 'Callback', value: o.callback_requested || 0, color: 'var(--green)' },
      { label: 'Info only', value: o.info_only || 0, color: '#8b5cf6' },
      { label: 'Hung up early', value: o.hung_up_early || 0, color: 'var(--orange)' },
      { label: 'Spam', value: o.spam || 0, color: 'var(--ink-3)' },
    ]);
  }
  $('#range').onchange = (e) => {
    state.days = Number(e.target.value);
    viewDashboard();
  };
  $('#addW').onclick = openWidgetDrawer;
  $$('[data-href]', content).forEach((tr) => (tr.onclick = () => (location.hash = tr.dataset.href)));
  $$('[data-wmenu]', content).forEach(
    (b) =>
      (b.onclick = () => {
        const k = b.dataset.wmenu;
        setLayout(getLayout().filter((x) => x !== k));
        toast(`Removed "${WIDGETS[k].title}". Add it back from Add widget.`);
        viewDashboard();
      })
  );
  const askForm = $('#askForm');
  if (askForm)
    askForm.onsubmit = async (e) => {
      e.preventDefault();
      const q = $('#askIn').value.trim();
      if (!q) return;
      $('#askIn').value = '';
      $('#orbWrap').style.display = 'none';
      const log = $('#aiLog');
      log.insertAdjacentHTML('beforeend', `<div class="ai-q">${esc(q)}</div><div class="ai-a muted" id="pending">Thinking…</div>`);
      log.scrollTop = log.scrollHeight;
      try {
        const r = await api(`/assistant?${scopeQS()}`, { method: 'POST', body: { question: q } });
        $('#pending').outerHTML = `<div class="ai-a">${esc(r.answer)}</div>`;
      } catch (err) {
        $('#pending').outerHTML = `<div class="ai-a">${esc(err.message)}</div>`;
      }
      log.scrollTop = log.scrollHeight;
    };
}

function openWidgetDrawer() {
  const layout = getLayout();
  const ov = document.createElement('div');
  ov.className = 'overlay';
  const dr = document.createElement('aside');
  dr.className = 'drawer';
  dr.setAttribute('role', 'dialog');
  dr.setAttribute('aria-label', 'Add widget');
  const list = Object.entries(WIDGETS).filter(([, w]) => !w.admin || isAdmin());
  dr.innerHTML = `<div class="drawer-h"><h2>Add Widget</h2><button class="icon-btn" data-x aria-label="Close">${icon('x')}</button></div>
    <div class="drawer-b">${list
      .map(
        ([k, w]) => `<div class="wcard ${layout.includes(k) ? 'added' : ''}"><div class="wthumb"><div>${icon(w.ic, 30)}</div></div>
        <div><h3>${esc(w.title)}</h3><p>${esc(w.desc)}</p><div class="row"><span class="tag plain">#${esc(w.tag)}</span>
        ${layout.includes(k) ? `<span class="muted small">${icon('check', 13)} Added</span>` : `<button class="btn primary xs" data-add="${k}">Select</button>`}</div></div></div>`
      )
      .join('')}</div>`;
  const close = () => (ov.remove(), dr.remove());
  ov.onclick = close;
  document.body.append(ov, dr);
  $('[data-x]', dr).onclick = close;
  $$('[data-add]', dr).forEach(
    (b) =>
      (b.onclick = () => {
        setLayout([...getLayout(), b.dataset.add]);
        close();
        viewDashboard();
      })
  );
}
