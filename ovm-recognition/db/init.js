// Run once after setting DATABASE_URL: `npm run init-db`
// Creates all tables, then seeds Rewards and Recognition Rules with the values
// from the original Employee_Recognition.xlsx so you don't have to re-enter them.

const fs = require('fs');
const path = require('path');
const pool = require('./pool');

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

async function main() {
  console.log('Creating tables...');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);

  console.log('Seeding recognition rules...');
  for (const [event, points, dollar] of RECOGNITION_RULES) {
    await pool.query(
      `INSERT INTO recognition_rules (event, points, dollar_value)
       VALUES ($1, $2, $3)
       ON CONFLICT (event) DO UPDATE SET points = $2, dollar_value = $3`,
      [event, points, dollar]
    );
  }

  console.log('Seeding rewards...');
  for (const [reward, cost, dollar, desc, fulfillment] of REWARDS) {
    const existing = await pool.query('SELECT id FROM rewards WHERE reward = $1', [reward]);
    if (existing.rows.length === 0) {
      await pool.query(
        `INSERT INTO rewards (reward, point_cost, dollar_value, description, fulfillment_instructions)
         VALUES ($1, $2, $3, $4, $5)`,
        [reward, cost, dollar, desc, fulfillment]
      );
    }
  }

  console.log('Done. Tables created and seeded.');
  await pool.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
