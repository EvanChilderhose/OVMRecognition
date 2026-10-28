// The dashboard's OVM Updates tab: text team news from the OVM Updates number
// (UPDATES_NUMBER) to employees, managers and "other staff", and see who replied.
// See lib/updates.js.

const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { wrap, httpError } = require('../lib/http');
const { sendSMS } = require('../lib/ghl');
const { normalizePhone } = require('../lib/phone');
const { placeholdersOf, adminPhones, getTemplate } = require('../lib/messages');
const { updatesNumber, updatesCardUrl } = require('../lib/contactCard');
const { recipients, updateText, sendUpdate } = require('../lib/updates');

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

// Setup status, who can get updates, recent updates, and replies
router.get('/', wrap(async (req, res) => {
  const updates = (await pool.query('SELECT * FROM staff_updates ORDER BY created_at DESC LIMIT 30')).rows;
  const replies = (await pool.query(
    `SELECT s.id, s.phone, s.body, s.created_at,
            COALESCE(e.name, (SELECT name FROM managers WHERE phone = s.phone LIMIT 1),
                     (SELECT name FROM update_contacts WHERE phone = s.phone LIMIT 1)) AS employee_name
     FROM sms_log s LEFT JOIN employees e ON e.id = s.employee_id
     WHERE s.line = 'updates' AND s.direction = 'inbound' AND NOT (s.phone = ANY($1))
     ORDER BY s.created_at DESC LIMIT 100`,
    [adminPhones()] // not your own texts back to the number
  )).rows;
  const noPhone = (await pool.query(
    `SELECT (SELECT count(*) FROM employees WHERE COALESCE(status, 'Active') <> 'Inactive' AND phone IS NULL)::int AS employees,
            (SELECT count(*) FROM managers WHERE COALESCE(status, 'Active') <> 'Inactive' AND phone IS NULL)::int AS managers`
  )).rows[0];
  const intro = await getTemplate('updates_intro');
  res.json({
    number: updatesNumber(),
    contact_url: updatesCardUrl(),
    notify_set: adminPhones().length > 0,
    intro: intro.enabled ? intro.body.replace('{updates_contact_url}', updatesCardUrl() || '') : null,
    people: await recipients(),
    no_phone: noPhone,
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

// Send to the chosen people: recipients is a list of keys like "e:12" (employee),
// "m:3" (manager), "c:5" (other staff)
router.post('/', wrap(async (req, res) => {
  const body = checkBody(req.body.body);
  checkSetup();
  const keys = new Set((req.body.recipients || []).map(String));
  if (!keys.size) throw httpError(400, 'Choose who should get the update.');

  // One text per phone number, even if someone is in two groups
  const seen = new Set();
  const people = (await recipients()).filter(p => keys.has(p.key) && !seen.has(p.phone) && seen.add(p.phone));

  let sent = 0;
  const failed = [];
  for (const person of people) {
    try {
      await sendUpdate(body, person);
      sent++;
    } catch (err) {
      console.error(`Update to ${person.name} failed:`, err.response?.data?.message || err.message);
      failed.push(person.name);
    }
  }
  await pool.query('INSERT INTO staff_updates (body, sent_count, failed) VALUES ($1, $2, $3)', [body, sent, failed]);
  res.json({ sent, failed, skipped: keys.size - people.length });
}));

// ---------- Other staff: people who get updates but aren't in the rewards program ----------

async function checkContact({ name, phone }) {
  if (!name || !String(name).trim()) throw httpError(400, 'Add their name.');
  const normalized = normalizePhone(phone);
  if (!normalized) throw httpError(400, 'Add their mobile number (10 digits, like 613-555-1234).');
  const emp = (await pool.query('SELECT name FROM employees WHERE phone = $1', [normalized])).rows[0];
  if (emp) throw httpError(409, `That number belongs to ${emp.name}, who's already under Employees.`);
  const mgr = (await pool.query('SELECT name FROM managers WHERE phone = $1', [normalized])).rows[0];
  if (mgr) throw httpError(409, `That number belongs to ${mgr.name}, who's already under Managers.`);
  const dup = (await pool.query('SELECT name FROM update_contacts WHERE phone = $1', [normalized])).rows[0];
  if (dup) throw httpError(409, `That number is already on the list for ${dup.name}.`);
  return { name: String(name).trim(), phone: normalized };
}

router.post('/contacts', wrap(async (req, res) => {
  const c = await checkContact(req.body);
  const result = await pool.query('INSERT INTO update_contacts (name, phone) VALUES ($1, $2) RETURNING *', [c.name, c.phone]);
  res.json(result.rows[0]);
}));

router.delete('/contacts/:id', wrap(async (req, res) => {
  await pool.query('DELETE FROM update_contacts WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

module.exports = router;
