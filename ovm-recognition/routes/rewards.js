const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { wrap, httpError } = require('../lib/http');

function validate({ reward, point_cost }) {
  if (!reward || !String(reward).trim()) throw httpError(400, 'Reward name is required.');
  if (!Number.isInteger(Number(point_cost)) || Number(point_cost) <= 0) {
    throw httpError(400, 'Point cost must be a whole number greater than 0.');
  }
}

router.get('/', wrap(async (req, res) => {
  const result = await pool.query('SELECT * FROM rewards ORDER BY point_cost ASC');
  res.json(result.rows);
}));

router.post('/', wrap(async (req, res) => {
  validate(req.body);
  const { reward, point_cost, dollar_value, description, fulfillment_instructions } = req.body;
  const result = await pool.query(
    `INSERT INTO rewards (reward, point_cost, dollar_value, description, fulfillment_instructions)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [String(reward).trim(), point_cost, dollar_value || null, description || null, fulfillment_instructions || null]
  );
  res.status(201).json(result.rows[0]);
}));

router.put('/:id', wrap(async (req, res) => {
  validate(req.body);
  const { reward, point_cost, dollar_value, description, active, fulfillment_instructions } = req.body;
  const result = await pool.query(
    `UPDATE rewards SET reward=$1, point_cost=$2, dollar_value=$3, description=$4, active=$5, fulfillment_instructions=$6
     WHERE id=$7 RETURNING *`,
    [String(reward).trim(), point_cost, dollar_value || null, description || null, active !== false, fulfillment_instructions || null, req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Reward not found' });
  res.json(result.rows[0]);
}));

module.exports = router;
