// "Send a message": a manager writes a one-off text and sends it to everyone,
// a department, or chosen employees. {first_name}, {balance} and {lifetime}
// are filled in per person; their profile link can be added at the end.

const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { wrap, httpError } = require('../lib/http');
const { sendSMS } = require('../lib/ghl');
const { getTemplate, render, placeholdersOf, adminPhones } = require('../lib/messages');
const { ensureProfileToken } = require('../lib/profile');

const ALLOWED = ['first_name', 'balance', 'lifetime'];
const MAX_LENGTH = 800;

function checkBody(body) {
  const text = String(body || '').trim();
  if (!text) throw httpError(400, 'Write a message first.');
  if (text.length > MAX_LENGTH) throw httpError(400, `That message is very long (${MAX_LENGTH} characters max).`);
  const unknown = placeholdersOf(text).filter(p => !ALLOWED.includes(p));
  if (unknown.length) throw httpError(400, `Messages can't fill in {${unknown.join('}, {')}}. You can use {first_name}, {balance} or {lifetime}.`);
  return text;
}

async function footerFor(includeLink) {
  if (!includeLink) return null;
  const f = await getTemplate('profile_footer');
  return f.enabled ? f.body : null;
}

// Test: sends the message, filled in with sample details, to the manager's phone
router.post('/test', wrap(async (req, res) => {
  const text = checkBody(req.body.body);
  const phone = adminPhones()[0];
  if (!phone) throw httpError(400, 'Add your number as ADMIN_PHONE in Render to receive test texts.');
  if (!process.env.GHL_API_KEY) throw httpError(400, 'Texting isn\'t set up (GHL_API_KEY is missing in Render).');
  const sample = { name: 'Sam Sample', current_points: 300, lifetime_points: 450, profile_token: 'abc123' };
  const message = '[TEST] ' + render(text, {}, sample, await footerFor(req.body.include_link !== false));
  try {
    await sendSMS({ phone, name: 'OVM Manager', message });
  } catch (err) {
    throw httpError(502, `GoHighLevel didn't send it: ${err.response?.data?.message || err.message}`);
  }
  res.json({ ok: true });
}));

// Send to the chosen employees
router.post('/', wrap(async (req, res) => {
  const text = checkBody(req.body.body);
  const ids = [...new Set((req.body.employee_ids || []).map(Number).filter(Number.isInteger))];
  if (!ids.length) throw httpError(400, 'Choose who should get the message.');
  if (!process.env.GHL_API_KEY) throw httpError(400, 'Texting isn\'t set up (GHL_API_KEY is missing in Render).');
  const footer = await footerFor(req.body.include_link !== false);

  const employees = (await pool.query(
    `SELECT * FROM employees WHERE id = ANY($1) AND status = 'Active' AND phone IS NOT NULL ORDER BY name`, [ids]
  )).rows;

  let sent = 0;
  const failed = [];
  for (let employee of employees) {
    try {
      if (footer) employee = await ensureProfileToken(employee);
      const message = render(text, {}, employee, footer);
      await sendSMS({ phone: employee.phone, name: employee.name, message });
      await pool.query(
        `INSERT INTO sms_log (employee_id, direction, phone, body) VALUES ($1, 'outbound', $2, $3)`,
        [employee.id, employee.phone, message]
      );
      sent++;
    } catch (err) {
      console.error(`Message to ${employee.name} failed:`, err.message);
      failed.push(employee.name);
    }
  }
  res.json({ sent, failed, skipped: ids.length - employees.length });
}));

module.exports = router;
