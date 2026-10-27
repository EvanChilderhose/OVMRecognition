// Managers who can nominate employees for awards (dashboard Managers tab).
// Adding a manager never texts them; the invite goes out when you click Send invite.

const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { wrap, httpError } = require('../lib/http');
const { normalizePhone } = require('../lib/phone');
const { newProfileToken } = require('../lib/profile');
const { sendInvite } = require('../lib/nominate');

function readManager(body) {
  const { name, phone, status } = body;
  if (!name || !String(name).trim()) throw httpError(400, 'Name is required.');
  const normalized = normalizePhone(phone);
  if (!normalized) throw httpError(400, 'Add their mobile number (10 digits, like 613-555-1234) so they can get texts.');
  return [String(name).trim(), normalized, status === 'Inactive' ? 'Inactive' : 'Active'];
}

// Managers aren't in the rewards program, so their number can't be an employee's
async function notAnEmployee(phone) {
  const emp = (await pool.query('SELECT name FROM employees WHERE phone = $1', [phone])).rows[0];
  if (emp) throw httpError(409, `That number belongs to ${emp.name}, an employee in the rewards program. Managers need their own number.`);
}

function duplicatePhone(err) {
  if (err.code === '23505') return httpError(409, 'That phone number is already used by another manager.');
  return err;
}

router.get('/', wrap(async (req, res) => {
  const result = await pool.query(
    `SELECT m.*,
       (SELECT COUNT(*)::int FROM point_transactions t WHERE t.manager_id = m.id) AS nominations,
       (SELECT COUNT(*)::int FROM point_transactions t WHERE t.manager_id = m.id AND t.status = 'pending') AS pending
     FROM managers m ORDER BY m.name ASC`
  );
  res.json(result.rows);
}));

router.post('/', wrap(async (req, res) => {
  const values = readManager(req.body);
  await notAnEmployee(values[1]);
  try {
    const result = await pool.query(
      'INSERT INTO managers (name, phone, status, token) VALUES ($1, $2, $3, $4) RETURNING *',
      [...values, newProfileToken()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    throw duplicatePhone(err);
  }
}));

router.put('/:id', wrap(async (req, res) => {
  const values = readManager(req.body);
  await notAnEmployee(values[1]);
  let result;
  try {
    result = await pool.query('UPDATE managers SET name = $1, phone = $2, status = $3 WHERE id = $4 RETURNING *', [...values, req.params.id]);
  } catch (err) {
    throw duplicatePhone(err);
  }
  if (!result.rows.length) throw httpError(404, 'Manager not found');
  res.json(result.rows[0]);
}));

// Text the invite (or send it again)
router.post('/:id/invite', wrap(async (req, res) => {
  const manager = (await pool.query('SELECT * FROM managers WHERE id = $1', [req.params.id])).rows[0];
  if (!manager) throw httpError(404, 'Manager not found');
  if (manager.status === 'Inactive') throw httpError(400, 'This manager is set to Inactive. Make them Active first.');
  if (!(await sendInvite(manager))) throw httpError(502, 'The text didn\'t send. Check that texting is set up (GHL_API_KEY in Render).');
  res.json({ ok: true });
}));

// New link (the old one stops working)
router.post('/:id/reset-link', wrap(async (req, res) => {
  const result = await pool.query('UPDATE managers SET token = $1 WHERE id = $2 RETURNING *', [newProfileToken(), req.params.id]);
  if (!result.rows.length) throw httpError(404, 'Manager not found');
  res.json(result.rows[0]);
}));

module.exports = router;
