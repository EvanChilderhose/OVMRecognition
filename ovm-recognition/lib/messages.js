// Every text the app sends is defined here, so the wording lives in one place.
// Placeholders in {curly_braces} are filled in when the text is sent.
// Texts to a known employee get their profile link added at the end.
//
// (Later these will be editable from the dashboard — see the roadmap.)

const pool = require('../db/pool');
const { sendSMS } = require('./ghl');
const { profileUrl, ensureProfileToken } = require('./profile');

const TEMPLATES = {
  award_approved: 'Congrats {first_name}! You earned {points} points for "{reason}". Text POINTS anytime to check your balance.',
  redemption_approved: 'Your redemption of "{reward}" has been approved! Reach out to your manager to arrange it.',
  balance: 'Hi {first_name}, you have {balance} points available ({lifetime} earned all-time).',
  redeem_how: 'To redeem, text REDEEM followed by the reward name, e.g. "REDEEM OVM Flannel".',
  redeem_not_found: 'We couldn\'t find a reward called "{reward}". Text POINTS to see your balance, or check with your manager for exact reward names.',
  redeem_not_enough: '"{reward}" costs {cost} points — you currently have {balance}. Keep it up!',
  redeem_requested: 'Requested "{reward}" for {cost} points. It\'s pending manager approval — we\'ll text you once it\'s confirmed.',
  help: 'Hi {first_name}! Text POINTS to check your balance, or REDEEM followed by a reward name (e.g. "REDEEM $100 Meat").',
  unknown_number: 'We couldn\'t match this number to an employee record. Please contact your manager.',
  employee_of_the_month: 'Congrats {first_name}! You\'re Ottawa Valley Meats\' Employee of the Month for {month}! You earned {points} points.',
  // Sent to the program manager (ADMIN_PHONE), not employees — no profile link is added
  admin_month_end: 'Month end! Time to pick {month}\'s Employee of the Month and run the monthly awards: {dashboard_link}'
};

const PROFILE_FOOTER = 'View your awards profile: {profile_link}';

function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (match, key) => (vars[key] !== undefined && vars[key] !== null ? String(vars[key]) : match));
}

// Builds the final text for a template key. Pass the employee (when known) so
// {first_name} and the profile link can be filled in.
function render(key, vars = {}, employee = null) {
  const template = TEMPLATES[key];
  if (!template) throw new Error(`Unknown message template "${key}"`);
  const all = { ...vars };
  if (employee) {
    all.first_name = all.first_name || employee.name.split(' ')[0];
    if (all.balance === undefined) all.balance = employee.current_points;
    if (all.lifetime === undefined) all.lifetime = employee.lifetime_points;
  }
  let text = fill(template, all);
  const link = profileUrl(employee);
  if (link) text += '\n\n' + fill(PROFILE_FOOTER, { profile_link: link });
  return text;
}

// Sends a templated text and records it in sms_log. Never throws — a failed
// text shouldn't undo an approval or a redemption.
// target: { employee } for a known employee, or { phone, name, contactId } otherwise.
async function sendTemplate(key, vars, target) {
  const phone = target.employee ? target.employee.phone : target.phone;
  if (!phone || !process.env.GHL_API_KEY) return null;
  let employee = target.employee || null;
  let message;
  try {
    employee = await ensureProfileToken(employee); // first text creates their profile link
    message = render(key, vars, employee);
    await sendSMS({ contactId: target.contactId, phone, name: employee ? employee.name : target.name, message });
    await pool.query(
      `INSERT INTO sms_log (employee_id, direction, phone, body) VALUES ($1, 'outbound', $2, $3)`,
      [employee ? employee.id : null, phone, message]
    );
  } catch (err) {
    console.error(`Failed to send "${key}" text:`, err.message);
  }
  return message;
}

module.exports = { TEMPLATES, render, sendTemplate };
