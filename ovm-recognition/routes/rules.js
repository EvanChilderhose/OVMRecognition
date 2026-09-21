const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

router.get('/', async (req, res) => {
  const result = await pool.query('SELECT * FROM recognition_rules ORDER BY event ASC');
  res.json(result.rows);
});

router.post('/', async (req, res) => {
  const { event, points, dollar_value } = req.body;
  const result = await pool.query(
    `INSERT INTO recognition_rules (event, points, dollar_value) VALUES ($1, $2, $3) RETURNING *`,
    [event, points, dollar_value || null]
  );
  res.status(201).json(result.rows[0]);
});

router.put('/:id', async (req, res) => {
  const { event, points, dollar_value } = req.body;
  const result = await pool.query(
    `UPDATE recognition_rules SET event=$1, points=$2, dollar_value=$3 WHERE id=$4 RETURNING *`,
    [event, points, dollar_value || null, req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Rule not found' });
  res.json(result.rows[0]);
});

module.exports = router;
