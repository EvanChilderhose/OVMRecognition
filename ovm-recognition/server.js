require('dotenv').config();
const express = require('express');
const path = require('path');
const { safeEqual } = require('./lib/http');

const app = express();
app.set('trust proxy', 1); // Render sits in front of the app; this gives the real visitor IP

// Standard browser protections on every response
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY'); // no showing the app inside another site
  res.set('Referrer-Policy', res.get('Referrer-Policy') || 'same-origin');
  res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
});
// JSON bodies are capped at 100 KB, except reward photo uploads, which parse
// their own (larger) body in routes/rewards.js
const smallJson = express.json();
app.use((req, res, next) => (/^\/api\/rewards\/\d+\/image$/.test(req.path) ? next() : smallJson(req, res, next)));

// Very simple shared-passcode gate for the dashboard (just you + managers).
// Set DASHBOARD_PASSCODE in the environment; leave it unset to disable.
// The passcode is only accepted in a header, never the URL, so it doesn't end
// up in browser history or server logs.
app.use((req, res, next) => {
  if (!process.env.DASHBOARD_PASSCODE) return next();
  if (req.path.startsWith('/webhook/')) return next(); // protected by WEBHOOK_SECRET instead
  const { passcodeTries } = require('./lib/limits');
  if (req.path.startsWith('/api/') && passcodeTries.blocked(req.ip)) {
    return res.status(429).json({ error: 'Too many wrong passcodes. Wait 15 minutes and try again.' });
  }
  if (safeEqual(req.headers['x-passcode'], process.env.DASHBOARD_PASSCODE)) return next();
  if (req.path.startsWith('/api/')) {
    if (req.headers['x-passcode']) passcodeTries.record(req.ip); // count wrong guesses, not empty checks
    return res.status(401).json({ error: 'Missing or wrong passcode' });
  }
  next(); // let index.html load; the frontend itself will prompt for the passcode before calling the API
});

app.use('/api/employees', require('./routes/employees'));
app.use('/api/rewards', require('./routes/rewards'));
app.use('/api/recognition-rules', require('./routes/rules'));
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/monthly', require('./routes/monthly'));
app.use('/api/texts', require('./routes/texts'));
app.use('/api/broadcast', require('./routes/broadcast'));
app.use('/api/updates', require('./routes/updates'));
app.use('/api/managers', require('./routes/managers'));
app.use('/webhook', require('./routes/webhook'));
app.use(require('./routes/profile')); // employee profile pages: /me/<token> (outside /api, so no passcode)
app.use(require('./routes/nominate')); // managers' nominating pages: /n/<token> (outside /api, so no passcode)
app.use(require('./routes/rewards').imageRouter); // reward photos: /reward-image/<id>

// The dashboard page, with versioned script/style links (lib/version.js)
const fs = require('fs');
const { versioned } = require('./lib/version');
const DASHBOARD = versioned(fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8'));
app.get(['/', '/index.html'], (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(DASHBOARD);
});

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
