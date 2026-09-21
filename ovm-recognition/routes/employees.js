const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// List all employees
router.get('/', async (req, res) => {
  const result = await pool.query('SELECT * FROM employees ORDER BY name ASC');
  res.json(result.rows);
});

// Add a new employee
router.post('/', async (req, res) => {
  const { name, phone, department, start_date, birthday, status } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const result = await pool.query(
      `INSERT INTO employees (name, phone, department, start_date, birthday, status)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'Active')) RETURNING *`,
      [name, phone || null, department || null, start_date || null, birthday || null, status]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That phone number is already in use by another employee.' });
    throw err;
  }
});

// Update an employee
router.put('/:id', async (req, res) => {
  const { name, phone, department, start_date, birthday, status } = req.body;
  const result = await pool.query(
    `UPDATE employees SET name=$1, phone=$2, department=$3, start_date=$4, birthday=$5, status=$6
     WHERE id=$7 RETURNING *`,
    [name, phone || null, department || null, start_date || null, birthday || null, status, req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Employee not found' });
  res.json(result.rows[0]);
});

// Delete (or deactivate) an employee — soft delete is safer for historical records
router.delete('/:id', async (req, res) => {
  await pool.query(`UPDATE employees SET status = 'Inactive' WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
