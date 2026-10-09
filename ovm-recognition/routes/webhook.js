// Receives inbound texts forwarded from GoHighLevel.
//
// GHL setup (done inside GHL's UI, no coding needed): create a Workflow with
// trigger "Customer Replied" (or "Inbound Message"), filtered to SMS, and add
// a "Webhook" action pointing at:
//   https://<your-app>.onrender.com/webhook/ghl-sms
// with this JSON body (use GHL's merge-field picker to fill the {{ }} values):
//   {
//     "secret": "<same value as the WEBHOOK_SECRET environment variable>",
//     "phone": "{{contact.phone}}",
//     "name": "{{contact.name}}",
//     "contactId": "{{contact.id}}",
//     "message": "{{message.body}}"
//   }
//
// The secret stops anyone else who finds this URL from posting fake texts
// (e.g. pretending to be an employee and redeeming their points). It can also
// be sent as an "x-webhook-secret" header instead of in the body.

const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { safeEqual } = require('../lib/http');
const { normalizePhone } = require('../lib/phone');
const { sendTemplate } = require('../lib/messages');
const { requestReward } = require('../lib/redeem');

router.post('/ghl-sms', async (req, res) => {
  const expected = process.env.WEBHOOK_SECRET;
  const supplied = req.headers['x-webhook-secret'] || (req.body && req.body.secret);
  if (expected && !safeEqual(supplied, expected)) {
    console.warn('Rejected webhook call with missing or wrong secret');
    return res.status(401).json({ error: 'Missing or wrong webhook secret' });
  }

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
      await sendTemplate('unknown_number', {}, { contactId, phone, name: body.name });
      return;
    }

    const to = { employee, contactId };
    const upper = text.toUpperCase();

    if (upper === 'POINTS' || upper === 'BALANCE') {
      await sendTemplate('balance', {}, to);
      return;
    }

    if (upper.startsWith('REDEEM')) {
      const rewardName = text.slice(6).trim(); // everything after "REDEEM"
      if (!rewardName) {
        await sendTemplate('redeem_how', {}, to);
        return;
      }

      const result = await requestReward(employee.id, { rewardName });
      if (result.status === 'not_found') {
        await sendTemplate('redeem_not_found', { reward: rewardName }, to);
      } else if (result.status === 'not_enough') {
        await sendTemplate('redeem_not_enough', { reward: result.reward.reward, cost: result.reward.point_cost, balance: result.balance }, to);
      } else {
        await sendTemplate('redeem_requested', { reward: result.reward.reward, cost: result.reward.point_cost, balance: result.balance }, to);
      }
      return;
    }

    if ((upper === 'CONTACT' || upper === 'SAVE') && require('../lib/contactCard').contactCardUrl()) {
      await sendTemplate('contact_card', {}, to);
      return;
    }

    await sendTemplate('help', {}, to);
  } catch (err) {
    console.error('Webhook error:', err);
  }
});

module.exports = router;
