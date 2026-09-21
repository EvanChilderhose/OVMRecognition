const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { sendSMS } = require('../lib/ghl');

// List transactions, optionally filtered by status (e.g. ?status=pending)
router.get('/', async (req, res) => {
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
});

// A manager nominates an employee for an award (goes to 'pending' for a second manager to approve)
router.post('/award', async (req, res) => {
  const { employee_id, reason, points, notes, nominated_by } = req.body;
  if (!employee_id || !reason || !points) {
    return res.status(400).json({ error: 'employee_id, reason, and points are required' });
  }
  const result = await pool.query(
    `INSERT INTO point_transactions (employee_id, type, reason, points, status, notes, approved_by)
     VALUES ($1, 'award', $2, $3, 'pending', $4, $5) RETURNING *`,
    [employee_id, reason, points, notes || null, nominated_by || null]
  );
  res.status(201).json(result.rows[0]);
});

// Approve a pending award or redemption. Awards: adds points and texts the employee.
// Redemptions: the points were already deducted when requested; this just marks it fulfilled.
router.post('/:id/approve', async (req, res) => {
  const { approved_by } = req.body;
  const tx = await pool.query('SELECT * FROM point_transactions WHERE id = $1', [req.params.id]);
  if (tx.rows.length === 0) return res.status(404).json({ error: 'Transaction not found' });
  const transaction = tx.rows[0];
  if (transaction.status !== 'pending') return res.status(400).json({ error: `Already ${transaction.status}` });

  const employee = (await pool.query('SELECT * FROM employees WHERE id = $1', [transaction.employee_id])).rows[0];

  const newStatus = transaction.type === 'award' ? 'approved' : 'fulfilled';
  await pool.query(
    `UPDATE point_transactions SET status = $1, approved_by = $2, resolved_at = now() WHERE id = $3`,
    [newStatus, approved_by || null, transaction.id]
  );

  if (transaction.type === 'award') {
    await pool.query(
      `UPDATE employees SET current_points = current_points + $1, lifetime_points = lifetime_points + $1 WHERE id = $2`,
      [transaction.points, transaction.employee_id]
    );
  }

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
});

// Deny a pending award or redemption. Redemptions get their points refunded.
router.post('/:id/deny', async (req, res) => {
  const { approved_by, reason } = req.body;
  const tx = await pool.query('SELECT * FROM point_transactions WHERE id = $1', [req.params.id]);
  if (tx.rows.length === 0) return res.status(404).json({ error: 'Transaction not found' });
  const transaction = tx.rows[0];
  if (transaction.status !== 'pending') return res.status(400).json({ error: `Already ${transaction.status}` });

  await pool.query(
    `UPDATE point_transactions SET status = 'denied', approved_by = $1, notes = COALESCE(notes || ' | ', '') || $2, resolved_at = now() WHERE id = $3`,
    [approved_by || null, reason || 'Denied', transaction.id]
  );

  if (transaction.type === 'redemption') {
    // Refund the points that were provisionally deducted at request time
    await pool.query(
      `UPDATE employees SET current_points = current_points - $1 WHERE id = $2`,
      [transaction.points, transaction.employee_id] // transaction.points is negative for redemptions
    );
  }

  res.json({ ok: true });
});

module.exports = router;
