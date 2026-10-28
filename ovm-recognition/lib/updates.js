// OVM Updates: team news texted from its own GoHighLevel number
// (UPDATES_NUMBER), kept apart from the OVM REWARDS number.
//
// Three groups can get updates: employees in the rewards program, managers, and
// "other staff" (update_contacts: people who get updates but aren't in rewards).
//
// - Each person's first update starts with the "updates_intro" text, asking
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

// The groups, by the letter in a recipient key ("e:12" = employee 12)
const GROUPS = {
  e: { table: 'employees', group: 'employees' },
  m: { table: 'managers', group: 'managers' },
  c: { table: 'update_contacts', group: 'other' }
};

// Everyone who can get an update right now (active, with a phone number)
async function recipients() {
  const [employees, managers, contacts] = await Promise.all([
    pool.query(`SELECT id, name, phone, department AS detail, updates_intro_sent_at FROM employees
                WHERE COALESCE(status, 'Active') <> 'Inactive' AND phone IS NOT NULL ORDER BY name`),
    pool.query(`SELECT id, name, phone, NULL AS detail, updates_intro_sent_at FROM managers
                WHERE COALESCE(status, 'Active') <> 'Inactive' AND phone IS NOT NULL ORDER BY name`),
    pool.query('SELECT id, name, phone, NULL AS detail, updates_intro_sent_at FROM update_contacts ORDER BY name')
  ]);
  const tag = (rows, kind) => rows.map(r => ({ ...r, kind, key: `${kind}:${r.id}`, group: GROUPS[kind].group }));
  return [...tag(employees.rows, 'e'), ...tag(managers.rows, 'm'), ...tag(contacts.rows, 'c')];
}

// The text someone gets: the update, with the "save this number" intro on top the first time
async function updateText(body, person) {
  const text = render(body, {}, person);
  if (person.updates_intro_sent_at) return { text, intro: false };
  const intro = await getTemplate('updates_intro');
  if (!intro.enabled) return { text, intro: false };
  return { text: render(intro.body, {}, person) + '\n\n' + text, intro: true };
}

// Sends one update to one person from recipients(). Throws if GHL doesn't send it.
async function sendUpdate(body, person) {
  const { text, intro } = await updateText(body, person);
  await sendSMS({ phone: person.phone, name: person.name, message: text, fromNumber: updatesNumber() });
  await pool.query(
    `INSERT INTO sms_log (employee_id, direction, phone, body, line) VALUES ($1, 'outbound', $2, $3, 'updates')`,
    [person.kind === 'e' ? person.id : null, person.phone, text]
  );
  if (intro) await pool.query(`UPDATE ${GROUPS[person.kind].table} SET updates_intro_sent_at = now() WHERE id = $1`, [person.id]);
}

// "Other staff" only ever deal with the updates number
async function contactByPhone(phone) {
  return (await pool.query('SELECT * FROM update_contacts WHERE phone = $1', [phone])).rows[0] || null;
}

// Was this inbound text sent to the OVM Updates number?
// GHL's webhook can pass the number that was texted as "to". When it doesn't,
// a text counts as an updates reply if it's from "other staff", or if the last
// text the app sent that phone came from the updates number (in the last week)
// and it isn't a rewards keyword like POINTS or REDEEM. (That also covers you
// replying to a forwarded reply, so you don't get the rewards "unknown number" text.)
async function isUpdatesReply({ to, phone, text }) {
  const number = updatesNumber();
  if (!number) return false;
  const texted = normalizePhone(to);
  if (texted) return texted === number;
  if (await contactByPhone(phone)) return true;
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
  let who = employee && employee.name;
  if (!who) {
    const known = (await pool.query(
      `SELECT name FROM managers WHERE phone = $1 UNION ALL SELECT name FROM update_contacts WHERE phone = $1 LIMIT 1`, [phone]
    )).rows[0];
    who = known ? known.name : (name && String(name).trim()) || phone;
  }
  for (const admin of adminPhones()) {
    await sendTemplate('admin_update_reply', { name: who, message: text }, { phone: admin, name: 'OVM Manager' });
  }
}

module.exports = { recipients, updateText, sendUpdate, isUpdatesReply, handleUpdatesReply };
