// Every text the app sends is listed here with its default wording.
// The wording can be edited (or a text switched off) from the dashboard's
// Texts tab — those edits are stored in the message_templates table and take
// priority over the defaults below.
//
// Placeholders in {curly_braces} are filled in when the text is sent.
// Texts to a known employee get their profile link added at the end
// (the "profile_footer" text).

const pool = require('../db/pool');
const { sendSMS } = require('./ghl');
const { profileUrl, ensureProfileToken, appUrl } = require('./profile');
const { normalizePhone } = require('./phone');

// Shown in the dashboard in this order. `sample` fills the placeholders for
// previews and test texts. `toEmployee: false` texts don't get the profile link.
const TEXTS = [
  { key: 'welcome', group: 'Welcome', label: 'Welcome to the program', defaultEnabled: false,
    when: 'Automatically when you add an employee with a phone number (while this is switched on), or when you click Send welcome text. Starts switched off so nobody is texted while you set up — switch it on at launch.',
    body: 'Welcome to the Ottawa Valley Meats Employee Recognition program, {first_name}! You earn points for great attendance, your birthday, work anniversaries, shift milestones and going above and beyond. Save your points for rewards like OVM gear, meat and days off. Your profile shows your points, the rewards and how to earn more.',
    sample: {} },

  { key: 'award_approved', group: 'Awards', label: 'Award approved',
    when: 'When you approve an award in Pending Approvals (monthly awards, birthdays, anniversaries, nominations, milestones).',
    body: 'Congrats {first_name}! You earned {points} points for {reason}. You now have {balance} points.',
    sample: { points: 50, reason: 'Perfect Monthly Attendance', balance: 300 } },
  { key: 'employee_of_the_month', group: 'Awards', label: 'Employee of the Month',
    when: 'When you choose an Employee of the Month who is in the rewards program.',
    body: 'Congrats {first_name}! You\'re Ottawa Valley Meats\' Employee of the Month for {month}! You earned {points} points.',
    sample: { month: 'October 2026', points: 100, balance: 350 } },

  { key: 'redeem_requested', group: 'Rewards', label: 'Reward requested',
    when: 'Right after an employee requests a reward by text (REDEEM …).',
    body: 'Requested {reward} for {cost} points. It\'s waiting on a manager — we\'ll text you once it\'s approved.',
    sample: { reward: 'OVM Flannel', cost: 200, balance: 100 } },
  { key: 'redemption_approved', group: 'Rewards', label: 'Reward approved',
    when: 'When you approve a reward request.',
    body: 'Your {reward} request has been approved! Reach out to your manager to arrange it.',
    sample: { reward: 'OVM Flannel' } },
  { key: 'redemption_denied', group: 'Rewards', label: 'Reward declined',
    when: 'When you deny a reward request. Their points are returned automatically.',
    body: 'Your {reward} request wasn\'t approved this time, so your {points} points are back in your balance. Questions? Ask your manager.',
    sample: { reward: 'OVM Flannel', points: 200, balance: 300 } },

  { key: 'balance', group: 'Replies to employee texts', label: 'Points balance',
    when: 'When an employee texts POINTS or BALANCE.',
    body: 'Hi {first_name}, you have {balance} points available ({lifetime} earned all-time).',
    sample: { balance: 300, lifetime: 450 } },
  { key: 'help', group: 'Replies to employee texts', label: 'Help',
    when: 'When an employee texts anything the app doesn\'t recognize.',
    body: 'Hi {first_name}! Text POINTS to check your balance, or REDEEM followed by a reward name (e.g. "REDEEM $100 Meat").',
    sample: {} },
  { key: 'redeem_how', group: 'Replies to employee texts', label: 'How to redeem',
    when: 'When an employee texts REDEEM without a reward name.',
    body: 'To redeem, text REDEEM followed by the reward name, e.g. "REDEEM OVM Flannel".',
    sample: {} },
  { key: 'redeem_not_found', group: 'Replies to employee texts', label: 'Reward not found',
    when: 'When an employee texts REDEEM with a reward name that doesn\'t match.',
    body: 'We couldn\'t find a reward called "{reward}". Check the reward names on your profile.',
    sample: { reward: 'Flannel shirt' } },
  { key: 'redeem_not_enough', group: 'Replies to employee texts', label: 'Not enough points',
    when: 'When an employee texts REDEEM for a reward they can\'t afford yet.',
    body: '{reward} costs {cost} points — you currently have {balance}. Keep it up!',
    sample: { reward: '$100 Meat', cost: 500, balance: 300 } },
  { key: 'unknown_number', group: 'Replies to employee texts', label: 'Unknown number', toEmployee: false,
    when: 'When someone texts in from a number that isn\'t an employee\'s.',
    body: 'We couldn\'t match this number to an employee record. Please contact your manager.',
    sample: {} },

  { key: 'profile_footer', group: 'Added to every employee text', label: 'Profile link line', footer: true,
    when: 'Added to the end of every text sent to an employee.',
    body: 'View your awards profile: {profile_link}',
    sample: { profile_link: 'https://ovm-recognition.onrender.com/me/abc123' } },

  { key: 'admin_redemption_request', group: 'To you (the manager)', label: 'Reward request alert', toEmployee: false,
    when: 'Texted to ADMIN_PHONE each time an employee requests a reward (by text or from their profile).',
    body: 'Reward request: {employee} wants {reward} ({cost} points). Approve or deny in Pending Approvals: {dashboard_link}',
    sample: { employee: 'Karlyn Babcock', reward: 'OVM Flannel', cost: 200, dashboard_link: 'https://ovm-recognition.onrender.com' } },
  { key: 'admin_month_end', group: 'To you (the manager)', label: 'Month-end reminder', toEmployee: false,
    when: 'Texted to ADMIN_PHONE at 10 AM on the last day of each month.',
    body: 'Month end! Time to pick {month}\'s Employee of the Month and run the monthly awards: {dashboard_link}',
    sample: { month: 'October 2026', dashboard_link: 'https://ovm-recognition.onrender.com' } }
];

const BY_KEY = Object.fromEntries(TEXTS.map(t => [t.key, t]));
const placeholdersOf = body => [...new Set((body.match(/\{(\w+)\}/g) || []).map(m => m.slice(1, -1)))];

// The wording and on/off state in use for a text (dashboard edit, or the default)
async function getTemplate(key) {
  const def = BY_KEY[key];
  if (!def) throw new Error(`Unknown message template "${key}"`);
  const row = (await pool.query('SELECT body, enabled FROM message_templates WHERE key = $1', [key])).rows[0];
  return { body: (row && row.body) || def.body, enabled: row ? row.enabled !== false : def.defaultEnabled !== false };
}

function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (match, key) => (vars[key] !== undefined && vars[key] !== null ? String(vars[key]) : match));
}

// Builds the final text. Pass the employee (when known) so {first_name},
// {balance} and the profile link can be filled in.
function render(body, vars = {}, employee = null, footer = null) {
  const all = { ...vars };
  if (employee) {
    all.first_name = all.first_name || employee.name.split(' ')[0];
    if (all.balance === undefined) all.balance = employee.current_points;
    if (all.lifetime === undefined) all.lifetime = employee.lifetime_points;
  }
  let text = fill(body, all);
  const link = profileUrl(employee);
  if (link && footer) text += '\n\n' + fill(footer, { profile_link: link });
  return text;
}

// Sends a text and records it in sms_log. Never throws — a failed text
// shouldn't undo an approval or a redemption. Switched-off texts are skipped
// unless options.force is set (e.g. a manager clicking "Send welcome text").
// Returns the text that was sent, or null if nothing was sent.
// target: { employee } for a known employee, or { phone, name, contactId } otherwise.
async function sendTemplate(key, vars, target, options = {}) {
  const phone = target.employee ? target.employee.phone : target.phone;
  if (!phone || !process.env.GHL_API_KEY) return null;
  let employee = target.employee || null;
  let message = null;
  try {
    const template = await getTemplate(key);
    if (!template.enabled && !options.force) return null;
    let footer = null;
    if (employee && BY_KEY[key].toEmployee !== false) {
      employee = await ensureProfileToken(employee); // first text creates their profile link
      const f = await getTemplate('profile_footer');
      if (f.enabled) footer = f.body;
    }
    message = render(template.body, vars, employee, footer);
    await sendSMS({ contactId: target.contactId, phone, name: employee ? employee.name : target.name, message });
    await pool.query(
      `INSERT INTO sms_log (employee_id, direction, phone, body) VALUES ($1, 'outbound', $2, $3)`,
      [employee ? employee.id : null, phone, message]
    );
  } catch (err) {
    console.error(`Failed to send "${key}" text:`, err.message);
    return null;
  }
  return message;
}

// The program manager's number(s) from ADMIN_PHONE (commas allow more than one)
function adminPhones() {
  return String(process.env.ADMIN_PHONE || '').split(',').map(p => normalizePhone(p)).filter(Boolean);
}

// Texts the manager. {dashboard_link} is filled in automatically.
async function notifyManager(key, vars = {}) {
  for (const phone of adminPhones()) {
    await sendTemplate(key, { dashboard_link: appUrl() || 'the dashboard', ...vars }, { phone, name: 'OVM Manager' });
  }
}

module.exports = { adminPhones, notifyManager, TEXTS, BY_KEY, getTemplate, render, sendTemplate, placeholdersOf, fill };
