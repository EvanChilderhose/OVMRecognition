const crypto = require('crypto');

// Express 4 doesn't catch errors thrown inside async route handlers — the
// request just hangs (or the process crashes). Wrapping a handler in wrap()
// passes any error on to the error handler in server.js instead.
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// An error whose message is safe to show the user, with an HTTP status.
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  return err;
}

// Constant-time string comparison for passcodes/secrets.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

module.exports = { wrap, httpError, safeEqual };
