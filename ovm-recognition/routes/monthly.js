// Month-end awards chosen by a manager in the dashboard (Employee of the Month).
//
// Picking someone in the rewards program awards the points straight away — the
// manager choosing is the approval — and texts them. Picking "Other" records that
// the month's award went to someone outside the program: no points, no text.
// Either way, the month is marked as done so the reminder banner goes away.

const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { withTransaction } = require('../db/pool');
const { wrap, httpError } = require('../lib/http');
const { sendTemplate } = require('../lib/messages');
const { today, periodOf, monthEndPeriod, periodLabel } = require('../lib/time');

const EOTM = 'Employee of the Month';
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

const PICKS = `SELECT m.period, m.other_name, m.created_at, e.name AS employee_name
               FROM employee_of_month m LEFT JOIN employees e ON e.id = m.employee_id`;
const withLabel = r => r && ({ ...r, label: periodLabel(r.period), winner_name: r.employee_name || r.other_name || 'Someone outside the program', in_program: !!r.employee_name });

// What the dashboard needs to show the month-end prompt
router.get('/employee-of-the-month', wrap(async (req, res) => {
  const now = today();
  const windowPeriod = monthEndPeriod(now); // set on the last day of a month and the first week after
  const period = windowPeriod || periodOf(now.year, now.month);
  const pick = withLabel((await pool.query(`${PICKS} WHERE m.period = $1`, [period])).rows[0]);
  const rule = (await pool.query('SELECT points FROM recognition_rules WHERE event = $1', [EOTM])).rows[0];
  const recent = (await pool.query(`${PICKS} ORDER BY m.period DESC LIMIT 6`)).rows.map(withLabel);

  res.json({
    period,
    label: periodLabel(period),
    due: Boolean(windowPeriod) && !pick, // show the banner
    pick: pick || null,
    points: rule ? rule.points : null,
    recent
  });
}));

router.post('/employee-of-the-month', wrap(async (req, res) => {
  const { period, employee_id, other, other_name, awarded_by, note } = req.body || {};
  if (!PERIOD.test(period || '')) throw httpError(400, 'Pick which month this is for.');
  if (!awarded_by || !String(awarded_by).trim()) throw httpError(400, 'Add your name (for the record).');
  const now = today();
  if (period > periodOf(now.year, now.month)) throw httpError(400, 'That month hasn\'t happened yet.');
  const by = String(awarded_by).trim();

  const rule = (await pool.query('SELECT points FROM recognition_rules WHERE event = $1', [EOTM])).rows[0];
  if (!other && !rule) throw httpError(400, `There's no "${EOTM}" rule. Add it under Recognition Rules first.`);

  const employee = await withTransaction(async (client) => {
    const claim = async (employeeId) => {
      try {
        await client.query(
          `INSERT INTO employee_of_month (period, employee_id, other_name, awarded_by, note) VALUES ($1, $2, $3, $4, $5)`,
          [period, employeeId, employeeId ? null : (String(other_name || '').trim() || null), by, note || null]
        );
      } catch (err) {
        if (err.code === '23505') throw httpError(409, `${periodLabel(period)} already has an Employee of the Month.`);
        throw err;
      }
    };

    if (other) {
      await claim(null); // outside the program: record it, nothing else
      return null;
    }

    const id = Number(employee_id);
    if (!Number.isInteger(id)) throw httpError(400, 'Choose an employee, or pick "Other — not in the rewards program".');
    const emp = (await client.query(`SELECT * FROM employees WHERE id = $1 AND status = 'Active'`, [id])).rows[0];
    if (!emp) throw httpError(404, 'Employee not found (or inactive).');

    await claim(id);
    await client.query(
      `INSERT INTO point_transactions (employee_id, type, reason, points, status, period, nominated_by, approved_by, notes, resolved_at)
       VALUES ($1, 'award', $2, $3, 'approved', $4, $5, $5, $6, now())`,
      [id, EOTM, rule.points, period, by, note || null]
    );
    return (await client.query(
      `UPDATE employees SET current_points = current_points + $1, lifetime_points = lifetime_points + $1
       WHERE id = $2 RETURNING *`,
      [rule.points, id]
    )).rows[0];
  });

  if (employee) {
    await sendTemplate('employee_of_the_month', { points: rule.points, month: periodLabel(period) }, { employee });
  }
  res.status(201).json({
    ok: true,
    label: periodLabel(period),
    winner: employee ? employee.name : (String(other_name || '').trim() || 'someone outside the program'),
    in_program: !!employee
  });
}));

// ---------- Monthly results import (see lib/monthlyImport.js) ----------
const monthlyImport = require('../lib/monthlyImport');

// Step 1: read the file and show what it would do
router.post('/import/preview', wrap(async (req, res) => {
  res.json(await monthlyImport.preview(String((req.body && req.body.csv) || '')));
}));

// Step 2: save it
router.post('/import', wrap(async (req, res) => {
  const { period, rows } = req.body || {};
  if (!Array.isArray(rows)) throw httpError(400, 'Nothing to import.');
  res.json(await monthlyImport.commit(period, rows));
}));

module.exports = router;
