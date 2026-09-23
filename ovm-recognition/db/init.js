// Database setup. Runs automatically every time the server starts (see
// server.js), and can also be run by hand with `npm run init-db`.
//
// - migrate(): creates/updates tables and tidies existing data. Safe to run
//   any number of times.
// - seedIfEmpty(): loads Rewards and Recognition Rules from the original
//   Employee_Recognition.xlsx — but only into an EMPTY table, so it never
//   overwrites or re-adds anything a manager has since edited in the dashboard.

const fs = require('fs');
const path = require('path');
const pool = require('./pool');
const { normalizePhone } = require('../lib/phone');

const RECOGNITION_RULES = [
  ['Birthday', 100, 20],
  ['1 Year Anniversary', 100, 20],
  ['2 Year Anniversary', 200, 40],
  ['3 Year Anniversary', 300, 60],
  ['4 Year Anniversary', 400, 80],
  ['5 Year Anniversary', 500, 100],
  ['6 Year Anniversary', 600, 120],
  ['7 Year Anniversary', 700, 140],
  ['8 Year Anniversary', 800, 160],
  ['9 Year Anniversary', 900, 180],
  ['10 Year Anniversary', 2500, 500],
  ['100 Shifts Completed', 50, 10],
  ['250 Shifts Completed', 100, 20],
  ['500 Shifts Completed', 200, 40],
  ['1000 Shifts Completed', 500, 100],
  ['1000 Orders Picked', 100, 20],
  ['2500 Orders Picked', 200, 40],
  ['5000 Orders Picked', 500, 100],
  ['10000 Orders Picked', 1000, 200],
  ['Perfect Monthly Attendance', 50, 10],
  ['Best Monthly Attendance', 50, 10],
  ['Most Punctual - Month', 50, 10],
  ['Least Shifts Missed', 50, 10],
  ['Most Shifts Picked Up', 100, 20],
  ['Highest Picking Accuracy - Month', 50, 10],
  ['Most Picked/Packed - Month', 50, 10],
  ['No Error Month', 100, 20],
  ['Safety Champ', 50, 10],
  ['Above + Beyond', 50, 10],
  ['Major Improvement', 50, 10],
  ['5-Star Review Mentioning Your Name', 50, 10],
  ['Difficult Interaction Well Handled', 50, 10]
];

const REWARDS = [
  ['Day Off (weekday)', 1000, 200, 'Pending approval from the Warehouse Manager, the employee can take a day off', 'Manager schedules the day off after approving redemption'],
  ['Day Off (Weekend)', 1500, 300, null, null],
  ['$100 Meat', 500, 100, null, null],
  ['OVM Flannel', 200, 40, null, null],
  ['Long Weekend', 1500, 300, null, null]
];

async function migrate() {
  const log = [];
  const say = (msg) => { console.log(msg); log.push(msg); };

  say('Creating/updating tables...');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);

  // Older versions stored the nominator's name in approved_by on pending
  // awards (where it was later overwritten by the approver). Move it over.
  await pool.query(
    `UPDATE point_transactions SET nominated_by = approved_by, approved_by = NULL
     WHERE type = 'award' AND status = 'pending' AND nominated_by IS NULL AND approved_by IS NOT NULL`
  );

  // Put every stored phone number in the same format inbound texts use
  const employees = (await pool.query('SELECT id, name, phone FROM employees WHERE phone IS NOT NULL')).rows;
  for (const emp of employees) {
    const normalized = normalizePhone(emp.phone);
    if (!normalized) {
      say(`Warning: ${emp.name}'s phone "${emp.phone}" doesn't look like a valid number — texts from them won't match. Fix it in the dashboard.`);
    } else if (normalized !== emp.phone) {
      try {
        await pool.query('UPDATE employees SET phone = $1 WHERE id = $2', [normalized, emp.id]);
        say(`Reformatted ${emp.name}'s phone to ${normalized}`);
      } catch (err) {
        if (err.code !== '23505') throw err;
        say(`Warning: ${emp.name}'s phone ${normalized} is also used by another employee — fix it in the dashboard.`);
      }
    }
  }

  return log;
}

async function seedIfEmpty() {
  const log = [];
  const say = (msg) => { console.log(msg); log.push(msg); };

  const ruleCount = Number((await pool.query('SELECT COUNT(*) FROM recognition_rules')).rows[0].count);
  if (ruleCount === 0) {
    say('Seeding recognition rules...');
    for (const [event, points, dollar] of RECOGNITION_RULES) {
      await pool.query(
        'INSERT INTO recognition_rules (event, points, dollar_value) VALUES ($1, $2, $3)',
        [event, points, dollar]
      );
    }
  }

  const rewardCount = Number((await pool.query('SELECT COUNT(*) FROM rewards')).rows[0].count);
  if (rewardCount === 0) {
    say('Seeding rewards...');
    for (const [reward, cost, dollar, desc, fulfillment] of REWARDS) {
      await pool.query(
        `INSERT INTO rewards (reward, point_cost, dollar_value, description, fulfillment_instructions)
         VALUES ($1, $2, $3, $4, $5)`,
        [reward, cost, dollar, desc, fulfillment]
      );
    }
  }

  return log;
}

// Only run automatically when invoked directly via `node db/init.js` / `npm run init-db`
if (require.main === module) {
  migrate()
    .then(seedIfEmpty)
    .then(() => { console.log('Done.'); return pool.end(); })
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { migrate, seedIfEmpty };
