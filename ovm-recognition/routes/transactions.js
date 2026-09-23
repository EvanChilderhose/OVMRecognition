const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { withTransaction } = require('../db/pool');
const { sendSMS } = require('../lib/ghl');
const { wrap, httpError } = require('../lib/http');

// List transactions, optionally filtered by status (e.g. ?status=pending)
router.get('/', wrap(async (req, res) => {
  const { status } = req.query;
  const result = status
    ? await pool.query(
        `SELECT t.*, e.name AS employee_name, e.phone AS employee_phone
         FROM point_transactions t JOIN employees e ON e.id = t.employee_id
         WHERE t.status = $1 ORDER BY t.created_at DESC`,
        [status]
      )
    : await pool.query(
        `SELECT t.*, e.name AS employee_name, e.phone AS employee_phone
         FROM point_transactions t JOIN employees e ON e.id = t.employee_id
         ORDER BY t.created_at DESC LIMIT 500`
      );
  res.json(result.rows);
}));

// A manager nominates an employee for an award (goes to 'pending' for a second manager to approve)
router.post('/award', wrap(async (req, res) => {
  const { employee_id, reason, points, notes, nominated_by } = req.body;
  if (!employee_id || !reason || !points) {
    return res.status(400).json({ error: 'employee_id, reason, and points are required' });
  }
  if (!Number.isInteger(Number(points)) || Number(points) <= 0) {
    return res.status(400).json({ error: 'Points must be a whole number greater than 0.' });
  }
  const result = await pool.query(
    `INSERT INTO point_transactions (employee_id, type, reason, points, status, notes, nominated_by)
     VALUES ($1, 'award', $2, $3, 'pending', $4, $5) RETURNING *`,
    [employee_id, reason, points, notes || null, nominated_by || null]
  );
  res.status(201).json(result.rows[0]);
}));

// Locks a pending transaction row for the rest of the DB transaction, so two
// managers clicking at the same moment can't both approve/deny it.
async function lockPending(client, id) {
  const tx = (await client.query('SELECT * FROM point_transactions WHERE id = $1 FOR UPDATE', [id])).rows[0];
  if (!tx) throw httpError(404, 'Transaction not found');
  if (tx.status !== 'pending') throw httpError(400, `Already ${tx.status}`);
  return tx;
}

// Approve a pending award or redemption. Awards: adds points and texts the employee.
// Redemptions: the points were already deducted when requested; this just marks it fulfilled.
router.post('/:id/approve', wrap(async (req, res) => {
  const { approved_by } = req.body;

  const transaction = await withTransaction(async (client) => {
    const tx = await lockPending(client, req.params.id);

    // Auto-generated awards with no matching rule are created with 0 points
    // (see lib/cron.js); pick up the points now if the rule has been added.
    let points = tx.points;
    if (tx.type === 'award' && points <= 0) {
      const rule = (await client.query('SELECT points FROM recognition_rules WHERE event = $1', [tx.reason])).rows[0];
      if (!rule) {
        throw httpError(400, `There's no "${tx.reason}" rule yet, so this award has no points. Add it under Recognition Rules and approve again, or deny this and nominate an award with the right points.`);
      }
      points = rule.points;
    }

    const newStatus = tx.type === 'award' ? 'approved' : 'fulfilled';
    await client.query(
      `UPDATE point_transactions SET status = $1, approved_by = $2, points = $3, resolved_at = now() WHERE id = $4`,
      [newStatus, approved_by || null, points, tx.id]
    );

    if (tx.type === 'award') {
      await client.query(
        `UPDATE employees SET current_points = current_points + $1, lifetime_points = lifetime_points + $1 WHERE id = $2`,
        [points, tx.employee_id]
      );
    }
    return { ...tx, points };
  });

  const employee = (await pool.query('SELECT * FROM employees WHERE id = $1', [transaction.employee_id])).rows[0];

  // Text the employee, but don't fail the approval if GHL/SMS has a problem
  if (employee && employee.phone && process.env.GHL_API_KEY) {
    try {
      const message = transaction.type === 'award'
        ? `Congrats ${employee.name.split(' ')[0]}! You earned ${transaction.points} points for "${transaction.reason}". Text POINTS anytime to check your balance.`
        : `Your redemption of "${transaction.reason}" has been approved! Reach out to your manager to arrange it.`;
      await sendSMS({ phone: employee.phone, name: employee.name, message });
      await pool.query(
        `INSERT INTO sms_log (employee_id, direction, phone, body) VALUES ($1, 'outbound', $2, $3)`,
        [employee.id, employee.phone, message]
      );
    } catch (err) {
      console.error('SMS send failed on approval:', err.message);
    }
  }

  res.json({ ok: true });
}));

// Deny a pending award or redemption. Redemptions get their points refunded.
router.post('/:id/deny', wrap(async (req, res) => {
  const { approved_by, reason } = req.body;

  await withTransaction(async (client) => {
    const tx = await lockPending(client, req.params.id);

    await client.query(
      `UPDATE point_transactions SET status = 'denied', approved_by = $1, notes = COALESCE(notes || ' | ', '') || $2, resolved_at = now() WHERE id = $3`,
      [approved_by || null, reason || 'Denied', tx.id]
    );

    if (tx.type === 'redemption') {
      // Refund the points that were provisionally deducted at request time
      await client.query(
        `UPDATE employees SET current_points = current_points - $1 WHERE id = $2`,
        [tx.points, tx.employee_id] // tx.points is negative for redemptions
      );
    }
  });

  res.json({ ok: true });
}));

module.exports = router;
