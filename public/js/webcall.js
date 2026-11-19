// Browser call widget: talk to the voice agent with your microphone (Retell web call).
import { esc, icon } from './lib.js';

let sdkPromise = null;
function loadSdk() {
  if (window.RetellSDK) return Promise.resolve(window.RetellSDK);
  if (!sdkPromise)
    sdkPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/vendor/retell-web.js';
      s.onload = () => resolve(window.RetellSDK);
      s.onerror = () => reject(new Error('Could not load the call library'));
      document.head.appendChild(s);
    });
  return sdkPromise;
}

/**
 * Renders a call widget into `el`.
 * opts.start(): async -> { accessToken, callId, transport, iceServers }
 * opts.agentName, opts.business: labels
 * opts.onEnded(): called after the call finishes
 */
export function mountWebCall(el, opts) {
  let client = null;
  let state = 'idle';
  const lines = [];
  el.innerHTML = `<div class="wc">
      <div class="wc-orb-wrap"><div class="orb wc-orb" id="wcOrb"></div></div>
      <div class="wc-status" id="wcStatus">Ready when you are</div>
      <div class="wc-sub muted small" id="wcSub">Uses your microphone. Talk like a customer calling ${esc(opts.business || 'the business')}.</div>
      <div class="row" style="justify-content:center;margin-top:14px"><button class="btn primary wc-btn" id="wcBtn">${icon('phone', 16)} Start call</button></div>
      <div class="wc-log" id="wcLog" aria-live="polite"></div></div>`;
  const $ = (id) => el.querySelector('#' + id);
  const setStatus = (t, sub) => {
    $('wcStatus').textContent = t;
    if (sub !== undefined) $('wcSub').textContent = sub;
  };
  const render = () => {
    $('wcLog').innerHTML = lines
      .slice(-10)
      .map((l) => `<div class="wc-line ${l.role === 'agent' ? 'agent' : 'user'}"><b>${l.role === 'agent' ? esc(opts.agentName || 'Agent') : 'You'}</b> ${esc(l.content)}</div>`)
      .join('');
    $('wcLog').scrollTop = $('wcLog').scrollHeight;
  };
  const btn = $('wcBtn');

  const end = (msg) => {
    if (state === 'ended') return;
    state = 'ended';
    try {
      client?.stopCall();
    } catch {}
    $('wcOrb').classList.remove('talking', 'live');
    setStatus('Call ended', msg || 'The lead, transcript and summary land in the dashboard within a minute.');
    btn.innerHTML = `${icon('refresh', 15)} Call again`;
    btn.classList.remove('danger');
    btn.classList.add('primary');
    btn.disabled = false;
    opts.onEnded?.();
  };

  btn.onclick = async () => {
    if (state === 'live' || state === 'connecting') return end();
    state = 'connecting';
    lines.length = 0;
    render();
    btn.disabled = true;
    setStatus('Connecting…', 'Allow microphone access if your browser asks.');
    try {
      const [SDK, token] = await Promise.all([loadSdk(), opts.start()]);
      client = new SDK.RetellWebClient();
      client.on('call_started', () => {
        state = 'live';
        $('wcOrb').classList.add('live');
        setStatus('Live: say hello', 'Try: "My AC is blowing warm air, can someone come tomorrow?"');
        btn.disabled = false;
        btn.innerHTML = `${icon('x', 15)} End call`;
        btn.classList.remove('primary');
        btn.classList.add('danger');
      });
      client.on('agent_start_talking', () => $('wcOrb').classList.add('talking'));
      client.on('agent_stop_talking', () => $('wcOrb').classList.remove('talking'));
      client.on('update', (u) => {
        const t = u?.transcript;
        if (Array.isArray(t)) {
          lines.length = 0;
          t.filter((x) => x.role === 'agent' || x.role === 'user').forEach((x) => lines.push(x));
          render();
        }
      });
      client.on('call_ended', () => end());
      client.on('error', (e) => end('Call dropped: ' + (e?.message || e || 'connection error')));
      const guard = setTimeout(() => state === 'connecting' && end("Couldn't connect to the agent. Check your connection and try again."), 25000);
      client.on('call_started', () => clearTimeout(guard));
      await client.startCall({ accessToken: token.accessToken, callId: token.callId, transport: token.transport, iceServers: token.iceServers });
    } catch (e) {
      state = 'idle';
      btn.disabled = false;
      setStatus("Couldn't start the call", /permission|denied|NotAllowed/i.test(e.message) ? 'Microphone access was blocked. Allow it in the address bar and try again.' : e.message);
    }
  };
  return { end };
}
