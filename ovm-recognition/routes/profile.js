// The employee-facing profile page (/me/<token>) and its data.
//
// These routes are NOT behind the dashboard passcode — the random token in the
// link is what identifies the employee, so they only ever see their own data.
// Inactive employees and reset (old) tokens get a "link not valid" message.

const express = require('express');
const path = require('path');
const router = express.Router();
const pool = require('../db/pool');
const { wrap, httpError } = require('../lib/http');
const { requestReward } = require('../lib/redeem');

const TOKEN = /^[A-Za-z0-9_-]{8,64}$/;

// Shift counts start from the first day of Wagepoint data used by the program
const SHIFTS_COUNTED_FROM = process.env.SHIFTS_COUNTED_FROM || '2026-07-14';

// Don't let the link leak to other sites (Referer) or into search engines
function privateHeaders(res) {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Robots-Tag', 'noindex, nofollow');
}

async function employeeForToken(token) {
  if (!TOKEN.test(token || '')) return null;
  const result = await pool.query(
    `SELECT * FROM employees WHERE profile_token = $1 AND status = 'Active'`,
    [token]
  );
  return result.rows[0] || null;
}

// The page itself — a static file that loads its data from the API below
router.get('/me/:token', (req, res) => {
  privateHeaders(res);
  res.sendFile(path.join(__dirname, '..', 'public', 'me.html'));
});

router.get('/profile-api/:token', wrap(async (req, res) => {
  privateHeaders(res);
  const emp = await employeeForToken(req.params.token);
  if (!emp) throw httpError(404, 'This link isn\'t valid anymore. Ask your manager for a new one.');

  const [history, rewards, rules] = await Promise.all([
    pool.query(
      `SELECT type, reason, points, status, created_at, resolved_at
       FROM point_transactions
       WHERE employee_id = $1 AND (type = 'redemption' OR status = 'approved')
       ORDER BY COALESCE(resolved_at, created_at) DESC LIMIT 50`,
      [emp.id]
    ),
    pool.query(`SELECT id, reward, point_cost, dollar_value, description, icon, image_version, (image IS NOT NULL) AS has_image
                FROM rewards WHERE active = true ORDER BY point_cost ASC`),
    pool.query('SELECT event, points, dollar_value FROM recognition_rules WHERE show_on_profile IS NOT FALSE ORDER BY points ASC, event ASC')
  ]);

  res.json({
    employee: {
      name: emp.name,
      first_name: emp.name.split(' ')[0],
      department: emp.department,
      // Month and day only — the page never needs the birth year
      birthday: emp.birthday ? String(emp.birthday).slice(5, 10) : null,
      start_date: emp.start_date,
      shifts_completed: emp.shifts_completed,
      shifts_since: SHIFTS_COUNTED_FROM,
      current_points: emp.current_points,
      lifetime_points: emp.lifetime_points
    },
    history: history.rows,
    rewards: rewards.rows,
    rules: rules.rows
  });
}));

// Request a reward — same as texting REDEEM <reward>
router.post('/profile-api/:token/request', wrap(async (req, res) => {
  privateHeaders(res);
  const emp = await employeeForToken(req.params.token);
  if (!emp) throw httpError(404, 'This link isn\'t valid anymore. Ask your manager for a new one.');
  const rewardId = Number(req.body && req.body.reward_id);
  if (!Number.isInteger(rewardId)) throw httpError(400, 'Pick a reward to request.');

  const result = await requestReward(emp.id, { rewardId });
  if (result.status === 'not_found') throw httpError(404, 'That reward isn\'t available anymore.');
  if (result.status === 'not_enough') {
    throw httpError(400, `${result.reward.reward} costs ${result.reward.point_cost} points and you have ${result.balance}.`);
  }
  res.json({ ok: true, reward: result.reward.reward, balance: result.balance });
}));

module.exports = router;
