// The dashboard's OVM Updates tab: text team news from the OVM Updates number
// (UPDATES_NUMBER) and see who replied. See lib/updates.js.

const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { wrap, httpError } = require('../lib/http');
const { sendSMS } = require('../lib/ghl');
const { placeholdersOf, adminPhones, getTemplate } = require('../lib/messages');
const { updatesNumber, updatesCardUrl } = require('../lib/contactCard');
const { updateText, sendUpdate } = require('../lib/updates');

const MAX_LENGTH = 800;

function checkBody(body) {
  const text = String(body || '').trim();
  if (!text) throw httpError(400, 'Write an update first.');
  if (text.length > MAX_LENGTH) throw httpError(400, `That update is very long (${MAX_LENGTH} characters max).`);
  const unknown = placeholdersOf(text).filter(p => p !== 'first_name');
  if (unknown.length) throw httpError(400, `Updates can't fill in {${unknown.join('}, {')}}. You can use {first_name}.`);
  return text;
}

function checkSetup() {
  if (!process.env.GHL_API_KEY) throw httpError(400, 'Texting isn\'t set up (GHL_API_KEY is missing in Render).');
  if (!updatesNumber()) throw httpError(400, 'Add the OVM Updates number as UPDATES_NUMBER in Render first.');
}

// Setup status, recent updates, and replies
router.get('/', wrap(async (req, res) => {
  const updates = (await pool.query('SELECT * FROM staff_updates ORDER BY created_at DESC LIMIT 30')).rows;
  const replies = (await pool.query(
    `SELECT s.id, s.phone, s.body, s.created_at, e.name AS employee_name
     FROM sms_log s LEFT JOIN employees e ON e.id = s.employee_id
     WHERE s.line = 'updates' AND s.direction = 'inbound' AND NOT (s.phone = ANY($1))
     ORDER BY s.created_at DESC LIMIT 100`,
    [adminPhones()] // not your own texts back to the number
  )).rows;
  const intro = await getTemplate('updates_intro');
  res.json({
    number: updatesNumber(),
    contact_url: updatesCardUrl(),
    notify_set: adminPhones().length > 0,
    intro: intro.enabled ? intro.body.replace('{updates_contact_url}', updatesCardUrl() || '') : null,
    updates,
    replies
  });
}));

// Test: sends the update to the manager's phone from the updates number, with the
// "save this number" intro on top, the way a first-timer sees it
router.post('/test', wrap(async (req, res) => {
  const body = checkBody(req.body.body);
  checkSetup();
  const phone = adminPhones()[0];
  if (!phone) throw httpError(400, 'Add your number as ADMIN_PHONE in Render to receive test texts.');
  const { text } = await updateText(body, { name: 'Sam Sample' });
  try {
    await sendSMS({ phone, name: 'OVM Manager', message: '[TEST] ' + text, fromNumber: updatesNumber() });
  } catch (err) {
    throw httpError(502, `GoHighLevel didn't send it: ${err.response?.data?.message || err.message}`);
  }
  res.json({ ok: true });
}));

// Send to the chosen employees
router.post('/', wrap(async (req, res) => {
  const body = checkBody(req.body.body);
  checkSetup();
  const ids = [...new Set((req.body.employee_ids || []).map(Number).filter(Number.isInteger))];
  if (!ids.length) throw httpError(400, 'Choose who should get the update.');

  const employees = (await pool.query(
    `SELECT * FROM employees WHERE id = ANY($1) AND status = 'Active' AND phone IS NOT NULL ORDER BY name`, [ids]
  )).rows;

  let sent = 0;
  const failed = [];
  for (const employee of employees) {
    try {
      await sendUpdate(body, employee);
      sent++;
    } catch (err) {
      console.error(`Update to ${employee.name} failed:`, err.response?.data?.message || err.message);
      failed.push(employee.name);
    }
  }
  await pool.query('INSERT INTO staff_updates (body, sent_count, failed) VALUES ($1, $2, $3)', [body, sent, failed]);
  res.json({ sent, failed, skipped: ids.length - employees.length });
}));

module.exports = router;
