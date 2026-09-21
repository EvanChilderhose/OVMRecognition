require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());

// Very simple shared-passcode gate for the dashboard (just you + managers).
// Set DASHBOARD_PASSCODE in the environment; leave it unset to disable.
app.use((req, res, next) => {
  if (!process.env.DASHBOARD_PASSCODE) return next();
  if (req.path.startsWith('/webhook/')) return next(); // GHL can't send a passcode
  const supplied = req.headers['x-passcode'] || req.query.passcode;
  if (supplied === process.env.DASHBOARD_PASSCODE) return next();
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`OVM Recognition running on port ${PORT}`);
  require('./lib/cron').start();
});
