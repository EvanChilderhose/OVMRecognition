// Receives inbound texts forwarded from GoHighLevel.
//
// GHL setup (done inside GHL's UI, no coding needed): create a Workflow with
// trigger "Customer Replied" (or "Inbound Message"), filtered to SMS, and add
// a "Webhook" action pointing at:
//   https://<your-app>.onrender.com/webhook/ghl-sms
// with this JSON body (use GHL's merge-field picker to fill the {{ }} values):
//   {
//     "phone": "{{contact.phone}}",
//     "name": "{{contact.name}}",
//     "contactId": "{{contact.id}}",
//     "message": "{{message.body}}"
//   }

const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { sendSMS } = require('../lib/ghl');

function normalizePhone(phone) {
  if (!phone) return null;
  return phone.replace(/[^\d+]/g, '');
}

router.post('/ghl-sms', async (req, res) => {
  // Respond immediately — GHL just needs a 200, the rest happens after
  res.json({ received: true });

  try {
    const body = req.body || {};
    const phone = normalizePhone(body.phone || body.contact?.phone);
    const contactId = body.contactId || body.contact?.id;
    const text = String(body.message || body.body || '').trim();
    if (!phone || !text) return;

    const empResult = await pool.query('SELECT * FROM employees WHERE phone = $1', [phone]);
    const employee = empResult.rows[0];

    await pool.query(
      `INSERT INTO sms_log (employee_id, direction, phone, body) VALUES ($1, 'inbound', $2, $3)`,
      [employee ? employee.id : null, phone, text]
    );

    if (!employee) {
      await reply({ contactId, phone, name: body.name }, "We couldn't match this number to an employee record. Please contact your manager.");
      return;
    }

    const upper = text.toUpperCase();

    if (upper === 'POINTS' || upper === 'BALANCE') {
      await reply({ contactId, phone, name: employee.name },
        `Hi ${employee.name.split(' ')[0]}, you have ${employee.current_points} points available (${employee.lifetime_points} earned all-time).`);
      return;
    }

    if (upper.startsWith('REDEEM')) {
      const rewardName = text.slice(6).trim(); // everything after "REDEEM"
      if (!rewardName) {
        await reply({ contactId, phone, name: employee.name },
          `To redeem, text REDEEM followed by the reward name, e.g. "REDEEM OVM Flannel".`);
        return;
      }

      const rewardResult = await pool.query(
        `SELECT * FROM rewards WHERE active = true AND LOWER(reward) = LOWER($1)`,
        [rewardName]
      );
      const reward = rewardResult.rows[0];

      if (!reward) {
        await reply({ contactId, phone, name: employee.name },
          `We couldn't find a reward called "${rewardName}". Text POINTS to see your balance, or check with your manager for exact reward names.`);
        return;
      }

      if (employee.current_points < reward.point_cost) {
        await reply({ contactId, phone, name: employee.name },
          `"${reward.reward}" costs ${reward.point_cost} points — you currently have ${employee.current_points}. Keep it up!`);
        return;
      }

      // Deduct points immediately and create a pending redemption for manager approval/fulfillment
      await pool.query(
        `UPDATE employees SET current_points = current_points - $1 WHERE id = $2`,
        [reward.point_cost, employee.id]
      );
      await pool.query(
        `INSERT INTO point_transactions (employee_id, type, reason, points, status)
         VALUES ($1, 'redemption', $2, $3, 'pending')`,
        [employee.id, reward.reward, -reward.point_cost]
      );

      await reply({ contactId, phone, name: employee.name },
        `Requested "${reward.reward}" for ${reward.point_cost} points. It's pending manager approval — we'll text you once it's confirmed.`);
      return;
    }

    await reply({ contactId, phone, name: employee.name },
      `Hi ${employee.name.split(' ')[0]}! Text POINTS to check your balance, or REDEEM followed by a reward name (e.g. "REDEEM $100 Meat").`);
  } catch (err) {
    console.error('Webhook error:', err);
  }
});

async function reply(target, message) {
  try {
    await sendSMS({ contactId: target.contactId, phone: target.phone, name: target.name, message });
  } catch (err) {
    console.error('Failed to send reply SMS:', err.message);
  }
}

module.exports = router;
