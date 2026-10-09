const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { wrap, httpError } = require('../lib/http');

// Built-in icons a reward can use instead of a photo (drawn in public/icons.js)
const ICONS = ['day-off', 'weekend', 'long-weekend', 'shirt', 'meat', 'gift', 'star'];
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

// Everything except the photo bytes themselves
const COLUMNS = `id, reward, point_cost, dollar_value, description, active, fulfillment_instructions,
  icon, image_version, (image IS NOT NULL) AS has_image`;

function validate({ reward, point_cost, icon }) {
  if (!reward || !String(reward).trim()) throw httpError(400, 'Reward name is required.');
  if (!Number.isInteger(Number(point_cost)) || Number(point_cost) <= 0) {
    throw httpError(400, 'Point cost must be a whole number greater than 0.');
  }
  if (icon && !ICONS.includes(icon)) throw httpError(400, 'Unknown icon.');
}

router.get('/', wrap(async (req, res) => {
  const result = await pool.query(`SELECT ${COLUMNS} FROM rewards ORDER BY point_cost ASC`);
  res.json(result.rows);
}));

router.post('/', wrap(async (req, res) => {
  validate(req.body);
  const { reward, point_cost, dollar_value, description, fulfillment_instructions, icon } = req.body;
  const result = await pool.query(
    `INSERT INTO rewards (reward, point_cost, dollar_value, description, fulfillment_instructions, icon)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
    [String(reward).trim(), point_cost, dollar_value || null, description || null, fulfillment_instructions || null, icon || null]
  );
  res.status(201).json(result.rows[0]);
}));

router.put('/:id', wrap(async (req, res) => {
  validate(req.body);
  const { reward, point_cost, dollar_value, description, active, fulfillment_instructions, icon } = req.body;
  const result = await pool.query(
    `UPDATE rewards SET reward=$1, point_cost=$2, dollar_value=$3, description=$4, active=$5, fulfillment_instructions=$6, icon=$7
     WHERE id=$8 RETURNING ${COLUMNS}`,
    [String(reward).trim(), point_cost, dollar_value || null, description || null, active !== false, fulfillment_instructions || null, icon || null, req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Reward not found' });
  res.json(result.rows[0]);
}));

// Upload a photo: { data: <base64>, mime: 'image/jpeg' }. The dashboard shrinks
// photos before sending, so they're normally well under the size limit.
// (server.js skips its default small body limit for this one route.)
router.put('/:id/image', express.json({ limit: '4mb' }), wrap(async (req, res) => {
  const { data, mime } = req.body || {};
  if (!IMAGE_TYPES.includes(mime)) throw httpError(400, 'Photos must be JPEG, PNG or WebP.');
  const bytes = Buffer.from(String(data || ''), 'base64');
  if (!bytes.length) throw httpError(400, 'No photo was received.');
  if (bytes.length > MAX_IMAGE_BYTES) throw httpError(400, 'That photo is too large (2 MB max).');
  const result = await pool.query(
    `UPDATE rewards SET image = $1, image_mime = $2, image_version = COALESCE(image_version, 0) + 1
     WHERE id = $3 RETURNING ${COLUMNS}`,
    [bytes, mime, req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Reward not found' });
  res.json(result.rows[0]);
}));

router.delete('/:id/image', wrap(async (req, res) => {
  const result = await pool.query(
    `UPDATE rewards SET image = NULL, image_mime = NULL, image_version = COALESCE(image_version, 0) + 1
     WHERE id = $1 RETURNING ${COLUMNS}`,
    [req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Reward not found' });
  res.json(result.rows[0]);
}));

// Public photo address used by the dashboard and employee profiles: /reward-image/<id>?v=<version>
// (mounted outside /api in server.js — product photos aren't private)
const imageRouter = express.Router();
imageRouter.get('/reward-image/:id', wrap(async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).end();
  const row = (await pool.query('SELECT image, image_mime FROM rewards WHERE id = $1', [req.params.id])).rows[0];
  if (!row || !row.image) return res.status(404).end();
  res.set('Content-Type', row.image_mime);
  // The ?v= number changes on every upload, so it's safe to cache for a long time
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(row.image);
}));

module.exports = router;
module.exports.imageRouter = imageRouter;
