// The dashboard's Texts tab: see, edit, switch off, reset and test every text the app sends.

const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { wrap, httpError } = require('../lib/http');
const { TEXTS, BY_KEY, getTemplate, render, placeholdersOf, fill } = require('../lib/messages');
const { sendSMS } = require('../lib/ghl');
const { normalizePhone } = require('../lib/phone');

const SAMPLE_EMPLOYEE = { name: 'Sam Sample', current_points: 300, lifetime_points: 450, profile_token: 'abc123' };

router.get('/', wrap(async (req, res) => {
  const rows = Object.fromEntries((await pool.query('SELECT key, body, enabled, updated_at FROM message_templates')).rows.map(r => [r.key, r]));
  res.json(TEXTS.map(t => {
    const row = rows[t.key];
    const body = (row && row.body) || t.body;
    return {
      key: t.key, group: t.group, label: t.label, when: t.when,
      body, default_body: t.body, customized: !!(row && row.body && row.body !== t.body),
      enabled: row ? row.enabled !== false : true,
      placeholders: placeholdersOf(t.body), // the ones this text can use
      footer: !!t.footer, to_employee: t.toEmployee !== false && !t.footer,
      sample: t.sample
    };
  }));
}));

router.put('/:key', wrap(async (req, res) => {
  const def = BY_KEY[req.params.key];
  if (!def) throw httpError(404, 'Unknown text.');
  const body = String(req.body.body || '').trim();
  if (!body) throw httpError(400, 'The text can\'t be empty. Switch it off instead if you don\'t want it sent.');
  if (body.length > 600) throw httpError(400, 'That text is very long (600 characters max).');
  // Catch typos like {firstname} — only the placeholders this text supports are allowed
  const allowed = new Set([...placeholdersOf(def.body), 'first_name', 'balance', 'lifetime']);
  const unknown = placeholdersOf(body).filter(p => !allowed.has(p));
  if (unknown.length) throw httpError(400, `This text can't fill in {${unknown.join('}, {')}}. Use: {${[...allowed].join('}, {')}}`);
  const enabled = req.body.enabled !== false;
  await pool.query(
    `INSERT INTO message_templates (key, body, enabled, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (key) DO UPDATE SET body = $2, enabled = $3, updated_at = now()`,
    [def.key, body, enabled]
  );
  res.json({ ok: true });
}));

// Back to the default wording (and switched on)
router.post('/:key/reset', wrap(async (req, res) => {
  if (!BY_KEY[req.params.key]) throw httpError(404, 'Unknown text.');
  await pool.query('DELETE FROM message_templates WHERE key = $1', [req.params.key]);
  res.json({ ok: true });
}));

// Sends the text, filled with sample details, to the manager's phone (ADMIN_PHONE)
router.post('/:key/test', wrap(async (req, res) => {
  const def = BY_KEY[req.params.key];
  if (!def) throw httpError(404, 'Unknown text.');
  const phone = normalizePhone(String(process.env.ADMIN_PHONE || '').split(',')[0]);
  if (!phone) throw httpError(400, 'Add your number as ADMIN_PHONE in Render to receive test texts.');
  if (!process.env.GHL_API_KEY) throw httpError(400, 'Texting isn\'t set up (GHL_API_KEY is missing in Render).');

  const template = await getTemplate(def.key);
  const footer = await getTemplate('profile_footer');
  let message;
  if (def.footer) message = fill(template.body, def.sample);
  else if (def.toEmployee === false) message = fill(template.body, def.sample);
  else message = render(template.body, def.sample, SAMPLE_EMPLOYEE, footer.enabled ? footer.body : null);
  message = `[TEST] ${message}`;
  try {
    await sendSMS({ phone, name: 'OVM Manager', message });
  } catch (err) {
    throw httpError(502, `GoHighLevel didn't send it: ${err.response?.data?.message || err.message}`);
  }
  res.json({ ok: true, message });
}));

module.exports = router;
