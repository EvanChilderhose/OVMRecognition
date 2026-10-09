// Each employee has a personal profile page at /me/<token>. The token is a
// random code (about 72 bits) so links can't be guessed; resetting it from the
// dashboard makes the old link stop working.
const crypto = require('crypto');
const pool = require('../db/pool');

function newProfileToken() {
  return crypto.randomBytes(9).toString('base64url'); // 12 URL-safe characters
}

// Makes sure an employee has a token, creating one the first time it's needed.
// Returns the employee row (with profile_token filled in).
async function ensureProfileToken(employee) {
  if (!employee || employee.profile_token) return employee;
  const result = await pool.query(
    `UPDATE employees SET profile_token = COALESCE(profile_token, $1) WHERE id = $2 RETURNING *`,
    [newProfileToken(), employee.id]
  );
  return result.rows[0] || employee;
}

// The app's public address. Set APP_URL in Render (e.g. https://ovm-recognition.onrender.com);
// Render also provides RENDER_EXTERNAL_URL automatically, which is used as a fallback.
function appUrl() {
  const url = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || '';
  return url.replace(/\/+$/, '');
}

// Full profile link for an employee, or null if the app's address isn't known
function profileUrl(employee) {
  const base = appUrl();
  if (!base || !employee || !employee.profile_token) return null;
  return `${base}/me/${employee.profile_token}`;
}

module.exports = { newProfileToken, ensureProfileToken, profileUrl, appUrl };
