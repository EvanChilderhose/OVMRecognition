// A manager's nominating page (/n/<token>) and its data.
//
// Like employee profiles, these routes are NOT behind the dashboard passcode:
// the random token in the link identifies the manager. Managers only see
// employee names and their own nominations, never points or balances.

const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const pool = require('../db/pool');
const { wrap, httpError } = require('../lib/http');
const { appUrl } = require('../lib/profile');
const { contactCardUrl } = require('../lib/contactCard');
const {
  firstName, nominatableRules, nominatableEmployees, createNomination, nominationsBy, NominationError, MAX_CUSTOM_POINTS, DOLLARS_PER_POINT
} = require('../lib/nominate');

const TOKEN = /^[A-Za-z0-9_-]{8,64}$/;
const GONE = 'This link isn\'t valid anymore. Ask for a new one.';

function privateHeaders(res) {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Robots-Tag', 'noindex, nofollow');
}

async function managerForToken(token) {
  if (!TOKEN.test(token || '')) return null;
  return (await pool.query(`SELECT * FROM managers WHERE token = $1 AND status = 'Active'`, [token])).rows[0] || null;
}

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'public', 'nominate.html'), 'utf8');
router.get('/n/:token', (req, res) => {
  privateHeaders(res);
  const base = appUrl() || `https://${req.get('host')}`;
  const manifest = TOKEN.test(req.params.token) ? `/n/${req.params.token}/manifest.webmanifest` : '';
  res.type('html').send(PAGE.replace(/%APP_URL%/g, base).replace(/%MANIFEST%/g, manifest));
});

// Saving the page to the home screen opens straight to this manager's page
router.get('/n/:token/manifest.webmanifest', wrap(async (req, res) => {
  privateHeaders(res);
  if (!(await managerForToken(req.params.token))) return res.status(404).end();
  const home = `/n/${req.params.token}`;
  res.type('application/manifest+json').send(JSON.stringify({
    name: 'OVM Nominations', short_name: 'OVM Nominate', start_url: home, scope: home, id: home,
    display: 'standalone', background_color: '#faf6f0', theme_color: '#8c1c13',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  }));
}));

router.get('/nominate-api/:token', wrap(async (req, res) => {
  privateHeaders(res);
  const manager = await managerForToken(req.params.token);
  if (!manager) throw httpError(404, GONE);
  const [employees, awards, nominations] = await Promise.all([
    nominatableEmployees(), nominatableRules(), nominationsBy(manager)
  ]);
  res.json({
    manager: { name: manager.name, first_name: firstName(manager.name) },
    contact_card: contactCardUrl() ? '/contact.vcf' : null,
    employees,
    awards,
    max_custom_points: MAX_CUSTOM_POINTS,
    dollars_per_point: DOLLARS_PER_POINT,
    nominations
  });
}));

router.post('/nominate-api/:token', wrap(async (req, res) => {
  privateHeaders(res);
  const manager = await managerForToken(req.params.token);
  if (!manager) throw httpError(404, GONE);
  const body = req.body || {};
  try {
    const custom = body.rule_id === 'custom';
    const { employee, award, points } = await createNomination(manager, {
      employeeId: Number(body.employee_id), ruleId: custom ? null : Number(body.rule_id), note: body.note,
      custom, points: custom ? Number(body.points) : undefined
    });
    res.status(201).json({ ok: true, employee: employee.name, award, points });
  } catch (err) {
    if (err instanceof NominationError) throw httpError(400, err.message);
    throw err;
  }
}));

module.exports = router;
