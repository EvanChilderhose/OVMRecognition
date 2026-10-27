// Managers nominating employees for awards (Safety Champ, Above + Beyond, ...).
//
// Managers get a private page at /n/<token> (routes/nominate.js) and can also
// text NOMINATE (lib/smsNominate.js). Either way the nomination lands in
// Pending Approvals, and the program manager (ADMIN_PHONE) gets a text.

const pool = require('../db/pool');
const { newProfileToken, appUrl } = require('./profile');
const { sendTemplate, notifyManager, adminPhones } = require('./messages');
const { contactCardUrl } = require('./contactCard');

const firstName = name => String(name || '').trim().split(/\s+/)[0];

function managerUrl(manager) {
  const base = appUrl();
  if (!base || !manager || !manager.token) return null;
  return `${base}/n/${manager.token}`;
}

// Makes sure a manager has a link token, creating one the first time
async function ensureManagerToken(manager) {
  if (!manager || manager.token) return manager;
  const result = await pool.query(
    'UPDATE managers SET token = COALESCE(token, $1) WHERE id = $2 RETURNING *',
    [newProfileToken(), manager.id]
  );
  return result.rows[0] || manager;
}

// Texts a manager. Their first name and page link are filled in automatically.
async function textManager(key, vars, manager, options) {
  manager = await ensureManagerToken(manager);
  return sendTemplate(key, { first_name: firstName(manager.name), manager_link: managerUrl(manager) || '', ...vars },
    { phone: manager.phone, name: manager.name, contactId: options && options.contactId }, options);
}

// The invite: their link and how to text NOMINATE, then the "save our number" card
async function sendInvite(manager) {
  if (!manager || !manager.phone || manager.status === 'Inactive') return false;
  const sent = await textManager('manager_invite', {}, manager, { force: true });
  if (!sent) return false;
  if (contactCardUrl()) await sendTemplate('contact_card', {}, { phone: manager.phone, name: manager.name });
  await pool.query('UPDATE managers SET invited_at = now() WHERE id = $1', [manager.id]);
  return true;
}

async function managerByPhone(phone) {
  if (!phone) return null;
  return (await pool.query(`SELECT * FROM managers WHERE phone = $1 AND status = 'Active'`, [phone])).rows[0] || null;
}

// The awards managers can nominate for, cheapest first
async function nominatableRules() {
  return (await pool.query(
    'SELECT id, event, points, note FROM recognition_rules WHERE nominatable = true ORDER BY points ASC, event ASC'
  )).rows;
}

// Employees in the program that can be nominated
async function nominatableEmployees() {
  return (await pool.query(
    `SELECT id, name, department FROM employees WHERE status = 'Active' ORDER BY name ASC`
  )).rows;
}

class NominationError extends Error {}

// Most points a manager can suggest with a custom amount (you still approve every nomination)
const MAX_CUSTOM_POINTS = 1000;
// What a point is worth in cash, shown to managers choosing a custom amount (100 points = $20)
const DOLLARS_PER_POINT = 0.20;
const cashFor = points => '$' + (points * DOLLARS_PER_POINT).toLocaleString('en-CA', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// Creates the pending award and lets the program manager know.
// Either ruleId (one of the nominatable awards) or custom: true with points and a reason.
// Returns { employee, award, points }.
async function createNomination(manager, { employeeId, ruleId, note, custom, points }) {
  note = String(note || '').trim();
  if (note.length > 600) throw new NominationError('Keep the reason under 600 characters.');
  const employee = (await pool.query(`SELECT * FROM employees WHERE id = $1 AND status = 'Active'`, [employeeId])).rows[0];
  if (!employee) throw new NominationError('Pick someone from the list.');

  let award, notes;
  if (custom) {
    points = Number(points);
    if (!Number.isInteger(points) || points < 1 || points > MAX_CUSTOM_POINTS) {
      throw new NominationError(`Choose a custom amount from 1 to ${MAX_CUSTOM_POINTS.toLocaleString()} points.`);
    }
    if (!note) throw new NominationError('Add a reason for the custom amount. It\'s what they\'ll see in their text.');
    // The reason is the award's name, so the employee's text reads "...50 points for cleaning up the warehouse"
    award = note.length > 80 ? note.slice(0, 77).trimEnd() + '...' : note;
    award = award.replace(/[.!\s]+$/, '');
    notes = 'Custom amount' + (note.length > 80 ? ': ' + note : '');
  } else {
    const rule = (await pool.query('SELECT * FROM recognition_rules WHERE id = $1 AND nominatable = true', [ruleId])).rows[0];
    if (!rule) throw new NominationError('Pick one of the awards in the list.');
    award = rule.event;
    points = rule.points;
    notes = note || null;
  }

  await pool.query(
    `INSERT INTO point_transactions (employee_id, type, reason, points, status, notes, nominated_by, manager_id)
     VALUES ($1, 'award', $2, $3, 'pending', $4, $5, $6)`,
    [employee.id, award, points, notes, manager.name, manager.id]
  );

  // No alert when the program manager nominates from their own manager account
  if (!adminPhones().includes(manager.phone)) {
    await notifyManager('admin_nomination', {
      manager: manager.name, employee: employee.name, award: custom ? `a custom award` : award, points,
      note: note ? note.replace(/[.!\s]+$/, '') : 'none given'
    });
  }
  return { employee, award, points };
}

// A manager's recent nominations and where each one stands
async function nominationsBy(manager) {
  return (await pool.query(
    `SELECT t.reason, t.points, t.status, t.notes, t.created_at, t.resolved_at, e.name AS employee_name
     FROM point_transactions t JOIN employees e ON e.id = t.employee_id
     WHERE t.manager_id = $1 ORDER BY t.created_at DESC LIMIT 30`,
    [manager.id]
  )).rows;
}

module.exports = {
  firstName, managerUrl, ensureManagerToken, textManager, sendInvite, managerByPhone,
  nominatableRules, nominatableEmployees, createNomination, nominationsBy, NominationError, MAX_CUSTOM_POINTS, DOLLARS_PER_POINT, cashFor
};
