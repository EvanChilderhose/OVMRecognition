const { Pool, types } = require('pg');
require('dotenv').config();

// Return DATE columns (birthday, start_date) as plain 'YYYY-MM-DD' strings.
// By default pg turns them into JS Dates at midnight UTC, which then display
// as the previous day anywhere west of UTC (i.e. Ottawa).
types.setTypeParser(1082, value => value);

// DATABASE_URL comes from Supabase (Project Settings -> Database -> Connection string -> URI)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Runs fn(client) inside BEGIN/COMMIT, rolling back if it throws. Use this
// whenever several queries must all succeed or all fail together (e.g.
// changing a transaction's status AND an employee's points).
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = pool;
module.exports.withTransaction = withTransaction;
