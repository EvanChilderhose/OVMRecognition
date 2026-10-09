// Requesting a reward, shared by the REDEEM text and the Request button on the
// employee's profile page so both behave exactly the same.
//
// Points are deducted immediately and a pending redemption is created for a
// manager to approve or deny (denying refunds the points). The balance check is
// part of the UPDATE itself, so two requests arriving together can't spend the
// same points twice.

const pool = require('../db/pool');
const { withTransaction } = require('../db/pool');

// Returns { status, reward, balance } where status is one of:
//   'requested'   — done; balance is the new balance
//   'not_found'   — no active reward matched
//   'not_enough'  — balance is too low; balance is the current balance
async function requestReward(employeeId, { rewardId, rewardName }) {
  const reward = (rewardId
    ? await pool.query('SELECT * FROM rewards WHERE active = true AND id = $1', [rewardId])
    : await pool.query('SELECT * FROM rewards WHERE active = true AND LOWER(reward) = LOWER($1)', [rewardName])
  ).rows[0];
  if (!reward) return { status: 'not_found' };

  const balance = await withTransaction(async (client) => {
    const updated = await client.query(
      `UPDATE employees SET current_points = current_points - $1
       WHERE id = $2 AND current_points >= $1 RETURNING current_points`,
      [reward.point_cost, employeeId]
    );
    if (updated.rows.length === 0) return null;
    await client.query(
      `INSERT INTO point_transactions (employee_id, type, reason, points, status)
       VALUES ($1, 'redemption', $2, $3, 'pending')`,
      [employeeId, reward.reward, -reward.point_cost]
    );
    return updated.rows[0].current_points;
  });

  if (balance === null) {
    const current = (await pool.query('SELECT current_points FROM employees WHERE id = $1', [employeeId])).rows[0].current_points;
    return { status: 'not_enough', reward, balance: current };
  }
  return { status: 'requested', reward, balance };
}

module.exports = { requestReward };
