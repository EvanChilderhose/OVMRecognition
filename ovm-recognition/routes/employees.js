const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { wrap, httpError } = require('../lib/http');
const { normalizePhone } = require('../lib/phone');
const { newProfileToken } = require('../lib/profile');
const { sendTemplate } = require('../lib/messages');
const { contactCardUrl } = require('../lib/contactCard');

// Validates and cleans up the fields shared by add + edit
function readEmployee(body) {
  const { name, phone, department, start_date, birthday, status } = body;
  if (!name || !String(name).trim()) throw httpError(400, 'Name is required.');
  const normalizedPhone = normalizePhone(phone);
  if (phone && String(phone).trim() && !normalizedPhone) {
    throw httpError(400, `"${phone}" doesn't look like a phone number. Use a 10-digit number like 613-555-1234.`);
  }
  return [String(name).trim(), normalizedPhone, department || null, start_date || null, birthday || null,
    status === 'Inactive' ? 'Inactive' : 'Active'];
}

function duplicatePhone(err) {
  if (err.code === '23505') return httpError(409, 'That phone number is already in use by another employee.');
  return err;
}

// List all employees
router.get('/', wrap(async (req, res) => {
  const result = await pool.query('SELECT * FROM employees ORDER BY name ASC');
  res.json(result.rows);
}));

// Texts the welcome message and records when it was sent. Returns true if sent.
// force: send even if the welcome text is switched off (a manager asked for it).
async function sendWelcome(employee, force) {
  if (!employee || !employee.phone || employee.status === 'Inactive') return false;
  const sent = await sendTemplate('welcome', {}, { employee }, { force });
  if (!sent) return false;
  // Then, as its own text, the "save our number as OVM REWARDS" contact card
  if (contactCardUrl()) await sendTemplate('contact_card', {}, { employee }); // follows its own on/off switch
  await pool.query('UPDATE employees SET welcomed_at = now() WHERE id = $1', [employee.id]);
  return true;
}

// Add a new employee. If the welcome text is switched on, they get it straight away.
router.post('/', wrap(async (req, res) => {
  const values = readEmployee(req.body);
  let employee;
  try {
    const result = await pool.query(
      `INSERT INTO employees (name, phone, department, start_date, birthday, status, profile_token)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [...values, newProfileToken()]
    );
    employee = result.rows[0];
  } catch (err) {
    throw duplicatePhone(err);
  }
  const welcomed = await sendWelcome(employee, false);
  res.status(201).json({ ...employee, welcomed });
}));

// Send (or resend) the welcome text to one employee
router.post('/:id/welcome', wrap(async (req, res) => {
  const employee = (await pool.query('SELECT * FROM employees WHERE id = $1', [req.params.id])).rows[0];
  if (!employee) throw httpError(404, 'Employee not found');
  if (!employee.phone) throw httpError(400, 'Add their phone number first.');
  if (!(await sendWelcome(employee, true))) throw httpError(502, 'The text didn\'t send. Check that texting is set up (GHL_API_KEY in Render).');
  res.json({ ok: true });
}));

// Welcome everyone active who has a phone number and hasn't been welcomed yet (launch day)
router.post('/welcome-all', wrap(async (req, res) => {
  const todo = (await pool.query(
    `SELECT * FROM employees WHERE status = 'Active' AND phone IS NOT NULL AND welcomed_at IS NULL ORDER BY name`
  )).rows;
  let sent = 0;
  const failed = [];
  for (const employee of todo) {
    if (await sendWelcome(employee, true)) sent++;
    else failed.push(employee.name);
  }
  res.json({ sent, failed });
}));

// Update an employee
router.put('/:id', wrap(async (req, res) => {
  const values = readEmployee(req.body);
  let result;
  try {
    result = await pool.query(
      `UPDATE employees SET name=$1, phone=$2, department=$3, start_date=$4, birthday=$5, status=$6
       WHERE id=$7 RETURNING *`,
      [...values, req.params.id]
    );
  } catch (err) {
    throw duplicatePhone(err);
  }
  if (result.rows.length === 0) return res.status(404).json({ error: 'Employee not found' });
  res.json(result.rows[0]);
}));

// Give an employee a new profile link — the old one stops working immediately
// (e.g. if a text with their link was forwarded to someone else)
router.post('/:id/reset-profile-link', wrap(async (req, res) => {
  const result = await pool.query(
    'UPDATE employees SET profile_token = $1 WHERE id = $2 RETURNING *',
    [newProfileToken(), req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Employee not found' });
  res.json(result.rows[0]);
}));

// Delete (or deactivate) an employee — soft delete is safer for historical records
router.delete('/:id', wrap(async (req, res) => {
  await pool.query(`UPDATE employees SET status = 'Inactive' WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
}));

module.exports = router;
