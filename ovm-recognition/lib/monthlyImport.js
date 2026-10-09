// Monthly results import. The file is produced by the /monthly-awards run
// (see .claude/skills/monthly-awards) and looks like:
//
//   Month,Employee,Shifts,Awards
//   2026-10,Karlyn Babcock,23,Least Lates; Most Early
//   2026-10,Joel Dapaa,20,
//
// Shifts = shifts worked that month. Awards = recognition rule names, separated
// by semicolons. Awards go to Pending Approvals (approving sends the text);
// shift totals and shift milestones (100 / 250 / 500 / 1000) update straight away.
// Importing the same month again is safe: shifts are replaced, not added twice,
// and awards already given (or denied) for that month are skipped.

const pool = require('../db/pool');
const { withTransaction } = require('../db/pool');
const { parseCSV } = require('./csv');
const { httpError } = require('./http');
const { periodLabel } = require('./time');

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const IMPORTED_BY = 'Monthly import';
const MANAGER_PICKED = ['employee of the month']; // chosen in the dashboard, not imported

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// Finds the employee a name in the file refers to. Wagepoint names can be longer
// ("Joel Nana Agyemang Dapaa") or the app can have a short form ("Kehinde A"),
// so after an exact match it tries first name + last name / last initial.
// Only returns a match when exactly one employee fits.
function matchEmployee(name, employees) {
  const n = norm(name);
  const exact = employees.filter(e => norm(e.name) === n);
  if (exact.length === 1) return exact[0];
  const t = n.split(' ');
  const fits = employees.filter(e => {
    const u = norm(e.name).split(' ');
    if (u[0] !== t[0] || u.length < 2 || t.length < 2) return false;
    const a = u[u.length - 1], b = t[t.length - 1];
    return a === b || (a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b));
  });
  return fits.length === 1 ? fits[0] : null;
}

// Reads the file and matches it up, without changing anything
async function preview(csvText) {
  const rows = parseCSV(csvText);
  if (rows.length < 2) throw httpError(400, 'That file is empty.');
  const header = rows[0].map(h => norm(h));
  const col = name => header.indexOf(name);
  const [cMonth, cEmp, cShifts, cAwards] = [col('month'), col('employee'), col('shifts'), col('awards')];
  if (cMonth < 0 || cEmp < 0) throw httpError(400, 'This doesn\'t look like a monthly results file (it needs Month and Employee columns).');

  const employees = (await pool.query(`SELECT id, name, department FROM employees WHERE status = 'Active' ORDER BY name`)).rows;
  const rules = (await pool.query('SELECT event, points FROM recognition_rules')).rows;
  const ruleByName = Object.fromEntries(rules.map(r => [norm(r.event), r]));

  const periods = new Set();
  const out = rows.slice(1).map((r, i) => {
    const period = String(r[cMonth] || '').trim();
    periods.add(period);
    const name = String(r[cEmp] || '').trim();
    const shiftsRaw = cShifts >= 0 ? String(r[cShifts] || '').trim() : '';
    const shifts = shiftsRaw === '' ? null : Number(shiftsRaw);
    const awards = (cAwards >= 0 ? String(r[cAwards] || '') : '').split(';').map(a => a.trim()).filter(Boolean).map(a => {
      const rule = ruleByName[norm(a)];
      const managerPicked = MANAGER_PICKED.includes(norm(a));
      return { name: rule ? rule.event : a, points: rule ? rule.points : null, ok: !!rule && !managerPicked,
        problem: managerPicked ? 'Chosen in the dashboard, not imported' : rule ? null : 'No recognition rule with this name' };
    });
    const match = matchEmployee(name, employees);
    const problems = [];
    if (shifts !== null && (!Number.isInteger(shifts) || shifts < 0)) problems.push(`Shifts "${shiftsRaw}" isn't a whole number`);
    return { line: i + 2, name, shifts, awards, employee_id: match ? match.id : null, matched_name: match ? match.name : null, problems };
  });

  const list = [...periods];
  if (list.length !== 1) throw httpError(400, `The file should be for one month, but it has: ${list.join(', ')}`);
  if (!PERIOD.test(list[0])) throw httpError(400, `The Month column should look like 2026-10 (got "${list[0]}").`);
  const already = (await pool.query('SELECT COUNT(*)::int AS n FROM monthly_shifts WHERE period = $1', [list[0]])).rows[0].n;
  return { period: list[0], label: periodLabel(list[0]), rows: out, employees, previously_imported: already > 0 };
}

// Saves it. rows: [{ employee_id, shifts, awards: [rule names] }] (rows without employee_id are skipped)
async function commit(period, rows) {
  if (!PERIOD.test(period || '')) throw httpError(400, 'Missing month.');
  const rules = (await pool.query('SELECT event, points FROM recognition_rules')).rows;
  const ruleByName = Object.fromEntries(rules.map(r => [norm(r.event), r]));
  const milestones = rules
    .map(r => ({ ...r, n: Number((r.event.match(/^(\d+) Shifts Completed$/i) || [])[1]) }))
    .filter(r => r.n > 0);
  const label = periodLabel(period);
  const summary = { awards: 0, skipped: 0, shifts: 0, milestones: [] };

  await withTransaction(async (client) => {
    const ids = [];
    for (const row of rows) {
      if (!row.employee_id) continue; // "Skip this line"
      const id = Number(row.employee_id);
      if (!Number.isInteger(id) || id <= 0) continue;
      const emp = (await client.query('SELECT id, name FROM employees WHERE id = $1', [id])).rows[0];
      if (!emp) throw httpError(400, 'One of the employees no longer exists. Re-open the file and try again.');
      ids.push(id);

      if (row.shifts !== null && row.shifts !== undefined) {
        const shifts = Number(row.shifts);
        if (!Number.isInteger(shifts) || shifts < 0) throw httpError(400, `${emp.name}: shifts must be a whole number.`);
        await client.query(
          `INSERT INTO monthly_shifts (employee_id, period, shifts) VALUES ($1, $2, $3)
           ON CONFLICT (employee_id, period) DO UPDATE SET shifts = $3, imported_at = now()`,
          [id, period, shifts]
        );
        summary.shifts++;
      }

      for (const name of row.awards || []) {
        const rule = ruleByName[norm(name)];
        if (!rule || MANAGER_PICKED.includes(norm(name))) throw httpError(400, `"${name}" can't be imported.`);
        const exists = await client.query(
          `SELECT 1 FROM point_transactions WHERE employee_id = $1 AND reason = $2 AND period = $3`,
          [id, rule.event, period]
        );
        if (exists.rows.length) { summary.skipped++; continue; }
        await client.query(
          `INSERT INTO point_transactions (employee_id, type, reason, points, status, period, nominated_by, notes)
           VALUES ($1, 'award', $2, $3, 'pending', $4, $5, $6)`,
          [id, rule.event, rule.points, period, IMPORTED_BY, `${label} attendance results`]
        );
        summary.awards++;
      }
    }

    // Shift totals = all imported months; then any newly reached shift milestones
    for (const id of ids) {
      const total = (await client.query(
        `UPDATE employees SET shifts_completed = (SELECT COALESCE(SUM(shifts), 0) FROM monthly_shifts WHERE employee_id = $1)
         WHERE id = $1 RETURNING name, shifts_completed`, [id]
      )).rows[0];
      for (const m of milestones) {
        if (total.shifts_completed < m.n) continue;
        const had = await client.query(
          `SELECT 1 FROM point_transactions WHERE employee_id = $1 AND reason = $2`, [id, m.event]
        );
        if (had.rows.length) continue;
        await client.query(
          `INSERT INTO point_transactions (employee_id, type, reason, points, status, period, nominated_by, notes)
           VALUES ($1, 'award', $2, $3, 'pending', $4, $5, $6)`,
          [id, m.event, m.points, period, IMPORTED_BY, `Reached ${total.shifts_completed} shifts`]
        );
        summary.milestones.push(`${total.name}: ${m.event}`);
      }
    }
  });
  return summary;
}

module.exports = { preview, commit, matchEmployee };
