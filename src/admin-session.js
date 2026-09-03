'use strict';

/**
 * Sign-in for the manual refresh page — the admin half of E7.
 *
 * WHY A SESSION AND NOT JUST THE PASSWORD ON EVERY REQUEST
 *
 * The gate used to be a random 24-byte token, and a token can safely live in
 * the browser: it is meaningless anywhere else and nobody memorises it. A
 * password is different in two ways that both have to be answered here.
 *
 * 1. People reuse passwords. Keeping one in localStorage, replayed on every
 *    poll, means a stored plaintext credential that may also open something
 *    else. So the password is sent exactly once, exchanged for a random session
 *    id, and never stored by the page at all.
 *
 * 2. People choose guessable passwords. A 24-byte token cannot be brute-forced;
 *    "letmein" can, and the refresh button is worth guessing at — it makes our
 *    server hammer the state's. So failed attempts are counted per address and
 *    locked out, which a token never needed.
 *
 * Sessions live in memory. A restart signs you out, which is correct: the
 * alternative is persisting credentials to the disk that holds the public
 * database, to save one person one password entry a week.
 */

const crypto = require('node:crypto');

/** How long a sign-in lasts. Long enough for a work session, not a month. */
const SESSION_TTL = 12 * 60 * 60 * 1000;

/** Failed attempts allowed from one address before it is locked out. */
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW = 15 * 60 * 1000;
const LOCKOUT = 15 * 60 * 1000;

const COOKIE = 'safe_eats_admin';

/**
 * Constant-time comparison over digests. Comparing the strings directly leaks
 * the password's length through timingSafeEqual's own length check, and leaks
 * its prefix through `===`'s early return.
 */
function sameSecret(given, expected) {
  const digest = (v) => crypto.createHash('sha256').update(String(v)).digest();
  return crypto.timingSafeEqual(digest(given), digest(expected));
}

/** One cookie out of a request header. Not worth a dependency. */
function readCookie(header, name = COOKIE) {
  for (const part of (header || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

function createAdminSessions({ now = Date.now, ttl = SESSION_TTL } = {}) {
  /** id → expiry. */
  const sessions = new Map();
  /** address → { failures, since, lockedUntil }. */
  const attempts = new Map();

  const configured = () => Boolean(process.env.SAFE_EATS_ADMIN_PASSWORD);

  function sweep(t) {
    for (const [id, expires] of sessions) if (expires <= t) sessions.delete(id);
    for (const [key, record] of attempts) {
      const idle = Math.max(record.since + ATTEMPT_WINDOW, record.lockedUntil ?? 0);
      if (idle <= t) attempts.delete(key);
    }
  }

  /**
   * @returns {{ok: true, id: string, expires: number}
   *          | {ok: false, reason: string, retryAfter?: number}}
   */
  function signIn(address, password) {
    const t = now();
    sweep(t);

    const expected = process.env.SAFE_EATS_ADMIN_PASSWORD || '';
    if (!expected) return { ok: false, reason: 'No admin password is configured.' };

    const key = String(address || 'unknown');
    const record = attempts.get(key);

    if (record?.lockedUntil > t) {
      return {
        ok: false,
        reason: 'Too many failed attempts. Try again later.',
        retryAfter: Math.ceil((record.lockedUntil - t) / 1000),
      };
    }

    if (!password || !sameSecret(password, expected)) {
      const failures = (record?.since > t - ATTEMPT_WINDOW ? record.failures : 0) + 1;
      const since = record?.since > t - ATTEMPT_WINDOW ? record.since : t;
      attempts.set(key, {
        failures,
        since,
        lockedUntil: failures >= MAX_ATTEMPTS ? t + LOCKOUT : undefined,
      });
      return {
        ok: false,
        reason:
          failures >= MAX_ATTEMPTS
            ? 'Too many failed attempts. Try again later.'
            : 'That password is not right.',
        retryAfter: failures >= MAX_ATTEMPTS ? Math.ceil(LOCKOUT / 1000) : undefined,
      };
    }

    // A correct password clears the count — a lockout is for a stranger
    // guessing, not for the operator who mistyped twice and then got it right.
    attempts.delete(key);

    const id = crypto.randomBytes(32).toString('base64url');
    const expires = t + ttl;
    sessions.set(id, expires);
    return { ok: true, id, expires };
  }

  function isValid(id) {
    if (!id) return false;
    const expires = sessions.get(id);
    if (!expires) return false;
    if (expires <= now()) {
      sessions.delete(id);
      return false;
    }
    return true;
  }

  return {
    configured,
    signIn,
    isValid,
    signOut: (id) => sessions.delete(id),
    fromRequest: (req) => readCookie(req.headers?.cookie),
    /** Tests and diagnostics; never exposed over HTTP. */
    size: () => sessions.size,
  };
}

module.exports = {
  createAdminSessions,
  readCookie,
  COOKIE,
  SESSION_TTL,
  MAX_ATTEMPTS,
  LOCKOUT,
};
