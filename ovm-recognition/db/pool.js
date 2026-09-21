const { Pool } = require('pg');
require('dotenv').config();

// DATABASE_URL comes from Supabase (Project Settings -> Database -> Connection string -> URI)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

module.exports = pool;
