const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { wrap, httpError } = require('../lib/http');
const { normalizePhone } = require('../lib/phone');

// Validates and cleans up the fields shared by add + edit
function readEmployee(body) {
  const { name, phone, department, start_date, birthday, status } = body;
  if (!name || !String(name).trim()) throw httpError(400, 'Name is required.');
  const normalizedPhone = normalizePhone(phone);
  if (phone && String(phone).trim() && !normalizedPhone) {
    throw httpError(400, `"${phone}" doesn't look like a phone number. Use a 10-digit number like 613-555-1234.`);
  }
  return [String(name).trim(), normalizedPhone, department || null, start_date || null, birthday || null,
    status === 'Inactive' ? 'Inactive' : 'Active'];
}

function duplicatePhone(err) {
  if (err.code === '23505') return httpError(409, 'That phone number is already in use by another employee.');
  return err;
}

// List all employees
router.get('/', wrap(async (req, res) => {
  const result = await pool.query('SELECT * FROM employees ORDER BY name ASC');
  res.json(result.rows);
}));

// Add a new employee
router.post('/', wrap(async (req, res) => {
  const values = readEmployee(req.body);
  try {
    const result = await pool.query(
      `INSERT INTO employees (name, phone, department, start_date, birthday, status)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      values
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    throw duplicatePhone(err);
  }
}));

// Update an employee
router.put('/:id', wrap(async (req, res) => {
  const values = readEmployee(req.body);
  let result;
  try {
    result = await pool.query(
      `UPDATE employees SET name=$1, phone=$2, department=$3, start_date=$4, birthday=$5, status=$6
       WHERE id=$7 RETURNING *`,
      [...values, req.params.id]
    );
  } catch (err) {
    throw duplicatePhone(err);
  }
  if (result.rows.length === 0) return res.status(404).json({ error: 'Employee not found' });
  res.json(result.rows[0]);
}));

// Delete (or deactivate) an employee — soft delete is safer for historical records
router.delete('/:id', wrap(async (req, res) => {
  await pool.query(`UPDATE employees SET status = 'Inactive' WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
}));

module.exports = router;
