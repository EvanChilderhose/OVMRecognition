// OVM Updates: team news texted to employees from its own GoHighLevel number
// (UPDATES_NUMBER), kept apart from the OVM REWARDS number.
//
// - Each employee's first update starts with the "updates_intro" text, asking
//   them to save the number as OVM Updates 📣 (with a contact card link).
// - Replies don't get an automatic answer. They're forwarded to ADMIN_PHONE
//   ("admin_update_reply") and shown on the dashboard's OVM Updates tab.

const pool = require('../db/pool');
const { sendSMS } = require('./ghl');
const { updatesNumber } = require('./contactCard');
const { getTemplate, render, sendTemplate, adminPhones } = require('./messages');
const { normalizePhone } = require('./phone');

// Texts that always belong to the rewards number, even right after an update
const REWARDS_WORDS = /^(POINTS|BALANCE|REDEEM\b.*|CONTACT|SAVE|NOMINATE\b.*|CANCEL)$/i;
// A reply counts as an answer to an update if the update was the last text they got, this recently
const REPLY_WINDOW_DAYS = 7;

// The text an employee gets: the update, with the "save this number" intro on top the first time
async function updateText(body, employee) {
  const text = render(body, {}, employee);
  if (employee.updates_intro_sent_at) return { text, intro: false };
  const intro = await getTemplate('updates_intro');
  if (!intro.enabled) return { text, intro: false };
  return { text: render(intro.body, {}, employee) + '\n\n' + text, intro: true };
}

// Sends one update to one employee. Throws if GHL doesn't send it.
async function sendUpdate(body, employee) {
  const { text, intro } = await updateText(body, employee);
  await sendSMS({ phone: employee.phone, name: employee.name, message: text, fromNumber: updatesNumber() });
  await pool.query(
    `INSERT INTO sms_log (employee_id, direction, phone, body, line) VALUES ($1, 'outbound', $2, $3, 'updates')`,
    [employee.id, employee.phone, text]
  );
  if (intro) await pool.query('UPDATE employees SET updates_intro_sent_at = now() WHERE id = $1', [employee.id]);
}

// Was this inbound text sent to the OVM Updates number?
// GHL's webhook can pass the number that was texted as "to". When it doesn't,
// a text counts as an updates reply if the last text the app sent that phone
// came from the updates number (in the last week) and it isn't a rewards
// keyword like POINTS or REDEEM. (That also covers you replying to a
// forwarded reply, so you don't get the rewards "unknown number" text.)
async function isUpdatesReply({ to, phone, text }) {
  const number = updatesNumber();
  if (!number) return false;
  const texted = normalizePhone(to);
  if (texted) return texted === number;
  if (REWARDS_WORDS.test(text.trim())) return false;
  const last = (await pool.query(
    `SELECT line, created_at FROM sms_log WHERE phone = $1 AND direction = 'outbound'
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [phone]
  )).rows[0];
  return !!last && last.line === 'updates' &&
    Date.now() - new Date(last.created_at).getTime() < REPLY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

// Logs the reply and forwards it to the manager's phone. Never auto-replies.
async function handleUpdatesReply({ phone, text, employee, name }) {
  await pool.query(
    `INSERT INTO sms_log (employee_id, direction, phone, body, line) VALUES ($1, 'inbound', $2, $3, 'updates')`,
    [employee ? employee.id : null, phone, text]
  );
  if (adminPhones().includes(phone)) return; // your own text to the updates number
  const who = employee ? employee.name : (name && String(name).trim()) || phone;
  for (const admin of adminPhones()) {
    await sendTemplate('admin_update_reply', { name: who, message: text }, { phone: admin, name: 'OVM Manager' });
  }
}

module.exports = { updateText, sendUpdate, isUpdatesReply, handleUpdatesReply };
