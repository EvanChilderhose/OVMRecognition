// A browser-triggerable version of `npm run init-db`, for hosting plans
// (like Render's free tier) that don't include Shell/SSH access.
//
// Visit https://<your-app>/setup/init-db?passcode=YOUR_DASHBOARD_PASSCODE
// once, then you can ignore this route forever. Safe to run more than once —
// it only adds what's missing.

const express = require('express');
const router = express.Router();
const { seed } = require('../db/init');
const pool = require('../db/pool');

router.get('/init-db', async (req, res) => {
  if (!process.env.DASHBOARD_PASSCODE || req.query.passcode !== process.env.DASHBOARD_PASSCODE) {
    return res.status(401).send('Wrong or missing passcode. Add ?passcode=YOUR_DASHBOARD_PASSCODE to the URL.');
  }
  try {
    const log = await seed();
    res.type('text/plain').send('Success!\n\n' + log.join('\n'));
  } catch (err) {
    res.status(500).type('text/plain').send('Something went wrong: ' + err.message);
  }
});

// One-time import of the employee list from the spreadsheet.
// Safe to run more than once — skips anyone whose phone number already exists.
const EMPLOYEES = [
  ['Kehinde A', '+14388895166', 'Warehouse', '2026-08-10', '1993-09-09'],
  ['Joel D', '+14376031065', 'Warehouse', '2026-05-29', '1990-06-01'],
  ['Karlyn B', '+19052432314', 'Store', '2026-01-12', '1999-05-27'],
  ['Costa B', '+15068664497', 'Warehouse', '2026-06-05', '1995-07-08'],
  ['David B', '+16137624992', 'Market', '2023-05-02', '1984-09-20'],
  ['Brayden G', '+16136143161', 'Warehouse', '2024-04-30', '2006-06-30'],
  ['Shane K', '+16138544191', 'Warehouse', '2026-03-13', '1997-12-28'],
  ['Zoe P', '+16137592105', 'Store', '2026-04-08', '1994-03-22'],
  ['Ty P', '+16139216391', 'Customer R', '2026-06-26', '1998-02-04'],
  ['Rohan R', '+14382262905', 'Warehouse', '2026-07-25', '1994-01-31'],
  ['Eric S', '+16137120572', 'Warehouse', '2025-01-27', '1993-05-04'],
  ['Ian S', '+16132863804', 'Customer R', '2026-06-11', '1981-01-29'],
  ['Hamza S', '+16133049994', 'Warehouse', '2026-06-22', '1995-05-25'],
  ['Nicolai Y', '+16132041166', 'Store', '2026-08-17', '1992-11-29']
];

router.get('/import-employees', async (req, res) => {
  if (!process.env.DASHBOARD_PASSCODE || req.query.passcode !== process.env.DASHBOARD_PASSCODE) {
    return res.status(401).send('Wrong or missing passcode. Add ?passcode=YOUR_DASHBOARD_PASSCODE to the URL.');
  }
  const log = [];
  try {
    for (const [name, phone, department, start_date, birthday] of EMPLOYEES) {
      const existing = await pool.query('SELECT id FROM employees WHERE phone = $1', [phone]);
      if (existing.rows.length > 0) {
        log.push(`Skipped ${name} (already exists)`);
        continue;
      }
      await pool.query(
        `INSERT INTO employees (name, phone, department, start_date, birthday, status)
         VALUES ($1, $2, $3, $4, $5, 'Active')`,
        [name, phone, department, start_date, birthday]
      );
      log.push(`Added ${name}`);
    }
    res.type('text/plain').send('Success!\n\n' + log.join('\n'));
  } catch (err) {
    res.status(500).type('text/plain').send('Something went wrong: ' + err.message + '\n\n' + log.join('\n'));
  }
});

module.exports = router;
