require('dotenv').config();
const express = require('express');
const path = require('path');
const { safeEqual } = require('./lib/http');

const app = express();
app.use(express.json());

// Very simple shared-passcode gate for the dashboard (just you + managers).
// Set DASHBOARD_PASSCODE in the environment; leave it unset to disable.
// The passcode is only accepted in a header, never the URL, so it doesn't end
// up in browser history or server logs.
app.use((req, res, next) => {
  if (!process.env.DASHBOARD_PASSCODE) return next();
  if (req.path.startsWith('/webhook/')) return next(); // protected by WEBHOOK_SECRET instead
  if (safeEqual(req.headers['x-passcode'], process.env.DASHBOARD_PASSCODE)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Missing or wrong passcode' });
  next(); // let index.html load; the frontend itself will prompt for the passcode before calling the API
});

app.use('/api/employees', require('./routes/employees'));
app.use('/api/rewards', require('./routes/rewards'));
app.use('/api/recognition-rules', require('./routes/rules'));
app.use('/api/transactions', require('./routes/transactions'));
app.use('/webhook', require('./routes/webhook'));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ ok: true }));

// Catches every error from the routes above so a bad request gets a clear
// response instead of hanging or crashing the server.
const BAD_INPUT_CODES = {
  '23502': 'A required field is missing.',
  '22P02': 'One of the values is in the wrong format (e.g. text where a number is expected).',
  '22007': 'One of the dates is invalid.',
  '22008': 'One of the dates is invalid.',
  '23503': 'That refers to an employee or record that doesn\'t exist.',
  '23505': 'That duplicates an existing record.'
};
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.status && err.status < 500 && err.expose) {
    return res.status(err.status).json({ error: err.message });
  }
  if (BAD_INPUT_CODES[err.code]) {
    return res.status(err.code === '23505' ? 409 : 400).json({ error: BAD_INPUT_CODES[err.code] });
  }
  console.error(`Error on ${req.method} ${req.path}:`, err);
  res.status(500).json({ error: 'Something went wrong on the server. Check the Render logs for details.' });
});

process.on('unhandledRejection', err => console.error('Unhandled promise rejection:', err));

if (!process.env.WEBHOOK_SECRET) {
  console.warn('WARNING: WEBHOOK_SECRET is not set — anyone who finds the webhook URL can send fake texts. See README section 3.');
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`OVM Recognition running on port ${PORT}`);
  try {
    const { migrate, seedIfEmpty } = require('./db/init');
    await migrate();
    await seedIfEmpty();
  } catch (err) {
    console.error('Database setup failed — is DATABASE_URL correct and the Supabase project awake?', err);
  }
  require('./lib/cron').start();
});
