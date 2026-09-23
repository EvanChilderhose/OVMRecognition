# OVM Employee Recognition

A dashboard + SMS system for Ottawa Valley Meats: track points, manage rewards
and recognition rules, approve awards, and let employees check their balance
or redeem rewards by texting a number.

This guide assumes no prior experience with any of these tools. Do the
sections in order.

---

## 1. Create a free Supabase account (this stores your data permanently)

1. Go to https://supabase.com and sign up (free tier is enough for this).
2. Click **New Project**. Name it `ovm-recognition`, set a database password
   (save it somewhere), pick a region close to Ottawa (e.g. `us-east-1` or
   `ca-central-1` if offered), and click **Create**.
3. Once it's ready, go to **Project Settings -> Database -> Connection string**
   and copy the **URI** — it looks like
   `postgresql://postgres:[YOUR-PASSWORD]@...supabase.co:5432/postgres`.
   Replace `[YOUR-PASSWORD]` with the password you set. This is your
   `DATABASE_URL`.

## 2. Create a free Render account (this runs the app 24/7)

1. Go to https://render.com and sign up (you can use GitHub or just email).
2. You'll deploy from a code repository, so you need a place to put this
   code:
   - Easiest: create a free GitHub account at https://github.com if you
     don't have one, create a new repository called `ovm-recognition`, and
     upload all the files from this project to it (GitHub's website lets
     you drag-and-drop files — no command line needed).
3. Back in Render, click **New -> Web Service**, connect your GitHub
   account, and pick the `ovm-recognition` repository.
4. Settings:
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free is fine to start
5. Under **Environment Variables**, add each of these (values from the
   `.env.example` file):
   - `DATABASE_URL` — from Supabase, step 1
   - `GHL_API_KEY` — from GoHighLevel, step 3 below
   - `GHL_LOCATION_ID` — from GoHighLevel, step 3 below
   - `DASHBOARD_PASSCODE` — make up a password for you/your managers
   - `WEBHOOK_SECRET` — make up a long random string (30+ characters);
     you'll paste the same value into GHL in step 3
   - `TIMEZONE` — optional, defaults to `America/Toronto` (Ottawa time)
6. Click **Create Web Service**. Render will give you a URL like
   `https://ovm-recognition.onrender.com` — that's your dashboard address.

   Note: on Render's free tier, the app "sleeps" after 15 minutes of no
   traffic and takes ~30 seconds to wake up on the next request (including
   an inbound text). If that delay is a problem, Render's cheapest paid
   tier (~$7/month) keeps it always-on.

7. **Database setup happens automatically.** Every time the app starts it
   creates or updates the tables it needs. On the very first start it also
   pre-loads your Rewards and Recognition Rules from your spreadsheet (it
   only does this while those lists are empty, so it never overwrites your
   edits). You'll still need to add your employees in the dashboard.

## 3. Set up GoHighLevel

**Get an API key (Private Integration Token):**
1. In GoHighLevel, go to **Settings -> Private Integrations -> Create New**.
2. Name it "OVM Recognition Dashboard".
3. Enable these scopes: `contacts.readonly`, `contacts.write`,
   `conversations.readonly`, `conversations.write`,
   `conversations/message.readonly`, `conversations/message.write`.
4. Click Create, then **copy the token immediately** — GHL only shows it
   once. This is your `GHL_API_KEY`.
5. Your **Location ID** is visible in the GHL URL when you're in your
   sub-account (the string after `/location/`), or under
   **Settings -> Business Profile**.

**Set up inbound texts (so employees can text POINTS or REDEEM):**
1. In GHL, go to **Automation -> Workflows -> Create Workflow**.
2. Trigger: **Customer Replied** (or **Inbound Message**), filtered to SMS.
3. Add an action: **Webhook**.
4. URL: `https://ovm-recognition.onrender.com/webhook/ghl-sms` (use your
   real Render URL).
5. Method: POST. Body (use GHL's merge-field picker for the `{{ }}` parts):
   ```json
   {
     "secret": "PASTE YOUR WEBHOOK_SECRET HERE",
     "phone": "{{contact.phone}}",
     "name": "{{contact.name}}",
     "contactId": "{{contact.id}}",
     "message": "{{message.body}}"
   }
   ```
   The `secret` must exactly match `WEBHOOK_SECRET` on Render. Without it,
   anyone who found the webhook URL could send fake texts, e.g. to redeem
   someone else's points.
6. Save and publish the workflow.

## 4. Using the dashboard

Open your Render URL, enter the passcode you set, and you'll see:
- **Employees** — add/edit staff, their phone number (needed for texts),
  birthday, and start date.
- **Pending Approvals** — anything waiting on a manager: awards you or a
  coworker nominated, auto-detected birthdays/anniversaries, and reward
  redemptions employees requested by text. Approve or deny each one.
- **Rewards** and **Recognition Rules** — edit the point values, matching
  your spreadsheet.
- **Transaction Log** — full history.

**What employees can text:**
- `POINTS` — get their current balance
- `REDEEM <reward name>` — e.g. `REDEEM OVM Flannel` — requests a
  redemption, which lands in Pending Approvals

**Important:** points for awards only apply once a manager clicks
**Approve** — nothing is automatic, including birthdays/anniversaries
(the app flags them daily, but a person still signs off).

If an anniversary has no matching rule (e.g. there's no "11 Year
Anniversary" rule), it still shows up in Pending Approvals, with 0 points
and a note. Add the rule under **Recognition Rules** and then approve it —
it picks up the rule's points. Or deny it and nominate an award by hand.

## 5. Local testing (optional, before deploying)

```
npm install
cp .env.example .env   # fill in DATABASE_URL at minimum
npm start              # sets up the database automatically
```
Then open http://localhost:3000

---

### What's NOT included yet, if you want it later
- Bulk-importing your existing employee list from the spreadsheet (a
  one-time script — quick to add once your database is live)
- Manager login accounts (right now it's one shared passcode)
- Editing/removing a reward after it's been redeemed keeps history intact,
  but there's no "undo" button for accidental approvals — those need a
  manual database fix
