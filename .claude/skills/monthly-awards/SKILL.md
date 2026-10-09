---
name: monthly-awards
description: Run the OVM Employee Recognition monthly attendance awards from a Time by Wagepoint timesheet export — score the month, review flags (holidays, schedule changes, very late/early clock-ins) with Evan, and produce the results file for the dashboard's "Import monthly results". Use at each month end, or when Evan asks to run/score the monthly awards.
---

# Monthly awards run

Evan runs this once a month (reminder: 10 AM on the last day of the month). Goal: a reviewed
`monthly-results-YYYY-MM.csv` that Evan uploads in the dashboard (Pending Approvals →
**Import monthly results**). Awards land in Pending Approvals; each winner is texted when Evan
approves. Employee of the Month is separate — Evan picks it in the dashboard, never in this file.

Everything private (Wagepoint CSVs, schedules, results) lives in `monthly-runs/` at the repo
root, which is git-ignored. Never copy those files elsewhere in the repo or commit them.

## Steps

1. **Get the month and the file.** Default month = the month that just ended (or is ending today).
   Ask Evan to export the Time by Wagepoint **"timesheet by shift"** report covering the whole month
   and save it into `~/OVMRecognition/monthly-runs/` (not Downloads/Desktop/Documents — macOS blocks
   reading those). If the file covers only part of the month, say so and ask whether to wait.

2. **Check the settings** in `monthly-runs/config.json` (see `config.example.json` for the format):
   schedules, `firstDay` for new hires, `ignoreJobs` (Brayden's "Markets" shifts), holidays, and
   `notInProgram`. Ask Evan about anyone who started, left, or changed schedule this month, and
   update the file before scoring.

3. **Score it:**
   ```
   node .claude/skills/monthly-awards/score.js --csv monthly-runs/<file>.csv --month YYYY-MM
   ```
   - **First run only (October 2026):** add `--shifts-from 2026-07-14` so shifts completed counts
     from July 14, 2026 (the date shown on employee profiles). The CSV must then start on July 14.
   - Closed days: `--holiday YYYY-MM-DD` (or add them to config.json's `holidays`).
   - A day that shouldn't count against someone (planned schedule change): `--excuse "Name:YYYY-MM-DD"`.

4. **Review the flags with Evan, one decision at a time.** Show the results table and every flag
   in plain language. Agreed policies (don't re-ask these):
   - A missing shift is an **absence whatever the reason** (vacation, sick, leave) — no excusing those.
   - Late = more than 5 min after the start. **Very late** (more than 60 min) is not a Late but costs
     Perfect Attendance. Late clock-outs don't matter.
   - Brayden's start is 8:30 even though he's often ~15–20 min late — keep it.
   - Best Attendance, Least Lates and Most Early are **full-timers only** (4+ scheduled shifts/week);
     Perfect Attendance is open to everyone; ties all win.
   Do ask about: possible holidays/closures, very late/early days that might be planned schedule
   changes, regular unscheduled days (schedule should change?), people not in config.json, and
   anyone with no punches. Re-run the script after each change until Evan is happy.

5. **Hand over.** Tell Evan where `monthly-results-YYYY-MM.csv` is, then: dashboard → Pending
   Approvals → **Import monthly results** → choose the file → check every line matched an employee →
   **Import** → approve the awards (that sends the texts). Remind him to pick **Employee of the Month**
   if he hasn't. Summarize the month in a short table: who won what, points and dollar value
   (100 points = $20).

## Notes
- The script needs only Node: `~/.local/node/bin/node` on Evan's Mac if `node` isn't on PATH.
- The import is safe to repeat: shift counts are replaced (not added twice) and awards already
  given or denied for that month are skipped. Reaching 100/250/500/1000 shifts creates the
  milestone award automatically on import.
- Award names in the file must match the dashboard's Recognition Rules exactly
  (Perfect Monthly Attendance, Best Monthly Attendance, Least Lates, Most Early).
