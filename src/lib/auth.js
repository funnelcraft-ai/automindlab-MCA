'use strict';
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { config } = require('../config');

const COOKIE = 'mca_token';
const SESSION_DAYS = 7;

function cookieOpts() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.publicBaseUrl.startsWith('https'),
    maxAge: SESSION_DAYS * 864e5,
    path: '/',
  };
}

function issueSession(res, user) {
  const token = jwt.sign({ uid: user.id, tv: user.token_version || 0 }, config.jwtSecret, { expiresIn: `${SESSION_DAYS}d` });
  res.cookie(COOKIE, token, cookieOpts());
}

// Loads the user on every request so role changes, deletions and "sign out everywhere" take effect immediately.
async function requireAuth(req, res, next) {
  try {
    const payload = jwt.verify(req.cookies[COOKIE] || '', config.jwtSecret);
    const user = await db.one('SELECT id, email, name, role, tenant_id, token_version FROM users WHERE id=$1', [payload.uid]);
    if (!user || user.token_version !== payload.tv) throw new Error('stale');
    req.user = { uid: user.id, role: user.role, tid: user.tenant_id, email: user.email, name: user.name };
    next();
  } catch {
    res.clearCookie(COOKIE, { path: '/' });
    res.status(401).json({ error: 'Please sign in' });
  }
}

const requireAdmin = (req, res, next) => (req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admins only' }));

// CSRF defence: every state-changing API call must carry a custom header, which browsers
// will not send cross-site without a CORS preflight (and this app allows no CORS).
function requireCsrfHeader(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'mca') return res.status(403).json({ error: 'Missing request header' });
  const origin = req.get('origin');
  if (origin) {
    const host = req.get('x-forwarded-host') || req.get('host');
    try {
      if (new URL(origin).host !== host) return res.status(403).json({ error: 'Cross-origin request blocked' });
    } catch {
      return res.status(403).json({ error: 'Bad origin' });
    }
  }
  next();
}

function passwordProblem(pw, email) {
  const s = String(pw || '');
  if (s.length < 10) return 'Use at least 10 characters.';
  if (s.length > 200) return 'Password is too long.';
  if (!/[a-zA-Z]/.test(s) || !/[0-9\W_]/.test(s)) return 'Mix letters with numbers or symbols.';
  if (email && s.toLowerCase().includes(String(email).split('@')[0].toLowerCase())) return "Don't include your email name in the password.";
  if (/^(password|qwerty|letmein|welcome|admin)/i.test(s)) return 'That password is too easy to guess.';
  return null;
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}
function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = { COOKIE, issueSession, requireAuth, requireAdmin, requireCsrfHeader, passwordProblem, randomToken, sha256, safeEqual, cookieOpts };
