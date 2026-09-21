// A browser-triggerable version of `npm run init-db`, for hosting plans
// (like Render's free tier) that don't include Shell/SSH access.
//
// Visit https://<your-app>/setup/init-db?passcode=YOUR_DASHBOARD_PASSCODE
// once, then you can ignore this route forever. Safe to run more than once —
// it only adds what's missing.

const express = require('express');
const router = express.Router();
const { seed } = require('../db/init');

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

module.exports = router;
