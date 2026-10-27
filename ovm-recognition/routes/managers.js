// Managers who can nominate employees for awards (dashboard Managers tab).
// Adding a manager never texts them; the invite goes out when you click Send invite.

const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { wrap, httpError } = require('../lib/http');
const { normalizePhone } = require('../lib/phone');
const { newProfileToken } = require('../lib/profile');
const { sendInvite, ensureManagerToken, managerUrl, firstName } = require('../lib/nominate');
const { sendSMS } = require('../lib/ghl');
const { fill, placeholdersOf, adminPhones } = require('../lib/messages');

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

// ---------- "Text managers": a one-off message to the managers you pick ----------
// {first_name} and {manager_link} are filled in for each manager, and their
// page link can be added at the end.

const MSG_ALLOWED = ['first_name', 'manager_link'];
const MSG_MAX = 800;

function checkMessage(body) {
  const text = String(body || '').trim();
  if (!text) throw httpError(400, 'Write a message first.');
  if (text.length > MSG_MAX) throw httpError(400, `That message is very long (${MSG_MAX} characters max).`);
  const unknown = placeholdersOf(text).filter(p => !MSG_ALLOWED.includes(p));
  if (unknown.length) throw httpError(400, `Messages can't fill in {${unknown.join('}, {')}}. You can use {first_name} or {manager_link}.`);
  return text;
}

function managerMessage(text, manager, link, includeLink) {
  let message = fill(text, { first_name: firstName(manager.name), manager_link: link }).trim();
  if (includeLink && link && !text.includes('{manager_link}')) message += `\n\nYour manager page: ${link}`;
  return message;
}

// Test: sends it, filled in with sample details, to your phone
router.post('/message/test', wrap(async (req, res) => {
  const text = checkMessage(req.body.body);
  const phone = adminPhones()[0];
  if (!phone) throw httpError(400, 'Add your number as ADMIN_PHONE in Render to receive test texts.');
  if (!process.env.GHL_API_KEY) throw httpError(400, 'Texting isn\'t set up (GHL_API_KEY is missing in Render).');
  const message = '[TEST] ' + managerMessage(text, { name: 'Sam Sample' }, managerUrl({ token: 'abc123' }) || 'https://ovmrecognition.onrender.com/n/abc123', req.body.include_link !== false);
  try {
    await sendSMS({ phone, name: 'OVM Manager', message });
  } catch (err) {
    throw httpError(502, `GoHighLevel didn't send it: ${err.response?.data?.message || err.message}`);
  }
  res.json({ ok: true });
}));

// Send to the chosen managers
router.post('/message', wrap(async (req, res) => {
  const text = checkMessage(req.body.body);
  const ids = [...new Set((req.body.manager_ids || []).map(Number).filter(Number.isInteger))];
  if (!ids.length) throw httpError(400, 'Choose who should get the message.');
  if (!process.env.GHL_API_KEY) throw httpError(400, 'Texting isn\'t set up (GHL_API_KEY is missing in Render).');
  const managers = (await pool.query(
    `SELECT * FROM managers WHERE id = ANY($1) AND status = 'Active' AND phone IS NOT NULL ORDER BY name`, [ids]
  )).rows;

  let sent = 0;
  const failed = [];
  for (let manager of managers) {
    try {
      manager = await ensureManagerToken(manager);
      const message = managerMessage(text, manager, managerUrl(manager), req.body.include_link !== false);
      await sendSMS({ phone: manager.phone, name: manager.name, message });
      await pool.query(`INSERT INTO sms_log (direction, phone, body) VALUES ('outbound', $1, $2)`, [manager.phone, message]);
      sent++;
    } catch (err) {
      console.error(`Message to ${manager.name} failed:`, err.message);
      failed.push(manager.name);
    }
  }
  res.json({ sent, failed });
}));

module.exports = router;
