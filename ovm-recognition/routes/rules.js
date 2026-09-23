const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { wrap, httpError } = require('../lib/http');

function validate({ event, points }) {
  if (!event || !String(event).trim()) throw httpError(400, 'Event name is required.');
  if (!Number.isInteger(Number(points)) || Number(points) <= 0) {
    throw httpError(400, 'Points must be a whole number greater than 0.');
  }
}

function duplicateEvent(err) {
  if (err.code === '23505') return httpError(409, 'A rule with that event name already exists.');
  return err;
}

router.get('/', wrap(async (req, res) => {
  const result = await pool.query('SELECT * FROM recognition_rules ORDER BY event ASC');
  res.json(result.rows);
}));

router.post('/', wrap(async (req, res) => {
  validate(req.body);
  const { event, points, dollar_value } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO recognition_rules (event, points, dollar_value) VALUES ($1, $2, $3) RETURNING *`,
      [String(event).trim(), points, dollar_value || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    throw duplicateEvent(err);
  }
}));

router.put('/:id', wrap(async (req, res) => {
  validate(req.body);
  const { event, points, dollar_value } = req.body;
  let result;
  try {
    result = await pool.query(
      `UPDATE recognition_rules SET event=$1, points=$2, dollar_value=$3 WHERE id=$4 RETURNING *`,
      [String(event).trim(), points, dollar_value || null, req.params.id]
    );
  } catch (err) {
    throw duplicateEvent(err);
  }
  if (result.rows.length === 0) return res.status(404).json({ error: 'Rule not found' });
  res.json(result.rows[0]);
}));

module.exports = router;
