// Supervisors who are employees in the rewards program. They nominate through
// the same machinery as managers (a row in `managers` linked by employee_id),
// while their own texts like POINTS and REDEEM still work as an employee's.

const pool = require('../db/pool');
const { httpError } = require('./http');
const { newProfileToken } = require('./profile');

// Turns supervisor on or off for an employee, keeping their nominating row in step
async function setEmployeeSupervisor(employee, on) {
  if (on) {
    if (!employee.phone) throw httpError(400, 'Add their mobile number to make them a supervisor (they need it for texts).');
    await pool.query(
      `INSERT INTO managers (name, phone, status, token, employee_id, supervisor)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (employee_id) DO UPDATE SET name = $1, phone = $2, status = $3, supervisor = true`,
      [employee.name, employee.phone, employee.status === 'Inactive' ? 'Inactive' : 'Active', newProfileToken(), employee.id]
    );
  } else {
    // Keep the row (and their nomination history), just switch it off
    await pool.query(`UPDATE managers SET supervisor = false, status = 'Inactive' WHERE employee_id = $1`, [employee.id]);
  }
}

// Which employees are supervisors right now
async function supervisorEmployeeIds() {
  const rows = (await pool.query(`SELECT employee_id FROM managers WHERE employee_id IS NOT NULL AND supervisor = true AND status = 'Active'`)).rows;
  return new Set(rows.map(r => r.employee_id));
}

module.exports = { setEmployeeSupervisor, supervisorEmployeeIds };
