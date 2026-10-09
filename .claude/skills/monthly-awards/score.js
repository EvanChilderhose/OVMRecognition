#!/usr/bin/env node
// Scores a month of Time by Wagepoint punches against each employee's schedule
// and produces the monthly results file for the dashboard's "Import monthly results".
//
// Usage:
//   node score.js --csv <wagepoint.csv> --month 2026-10
//        [--config ../../../monthly-runs/config.json]
//        [--holiday 2026-10-12 ...]            closed days (scheduled shifts aren't absences)
//        [--excuse "Karlyn Babcock:2026-10-05" ...]  a day that shouldn't count against them
//        [--shifts-from 2026-07-14]            count shifts from this date (first run only)
//        [--out <folder>]
//
// No dependencies — plain Node. The rules match the July–September 2026 test run:
//   Late       = clock-in more than graceMinutes after the scheduled start
//   Very late  = more than veryLateMinutes late: NOT a Late, but costs Perfect Attendance
//   Early      = clock-in graceMinutes or more before the scheduled start
//   Absent     = scheduled (not a holiday) and no punch, whatever the reason
//   Picked up  = worked a day that isn't on their schedule (counts as a shift, never late/early)
//   Perfect Monthly Attendance — everyone: no absences, no lates, no very-lates
//   Best Monthly Attendance / Least Lates / Most Early — full-timers only
//     (scheduled fullTimeShiftsPerWeek or more), ties all win.
//     Best = highest % of scheduled shifts worked, fewer lates breaks ties.
//     Least Lates = fewest lates. Most Early = most early clock-ins (at least one).

const fs = require('fs');
const path = require('path');

// ---------- arguments ----------
const args = process.argv.slice(2);
const opt = (name, multi) => {
  const vals = [];
  for (let i = 0; i < args.length; i++) if (args[i] === `--${name}`) vals.push(args[i + 1]);
  return multi ? vals : vals[0];
};
const CSV = opt('csv');
const MONTH = opt('month');
const CONFIG = opt('config') || path.join(__dirname, '../../../monthly-runs/config.json');
const OUT = opt('out') || path.dirname(CONFIG);
if (!CSV || !/^\d{4}-\d{2}$/.test(MONTH || '')) {
  console.error('Usage: node score.js --csv <file> --month YYYY-MM [--config file] [--holiday YYYY-MM-DD] [--excuse "Name:YYYY-MM-DD"] [--shifts-from YYYY-MM-DD]');
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
const GRACE = cfg.graceMinutes ?? 5;
const VERY_LATE = cfg.veryLateMinutes ?? 60;
const FULL_TIME = cfg.fullTimeShiftsPerWeek ?? 4;
const holidays = new Map((cfg.holidays || []).map(h => [h.date, h.name || 'Holiday']));
for (const d of opt('holiday', true)) holidays.set(d, 'Holiday');
const excused = new Set(opt('excuse', true).map(s => s.trim().toLowerCase()));
const SHIFTS_FROM = opt('shifts-from');

// ---------- dates ----------
const [Y, M] = MONTH.split('-').map(Number);
const lastDay = new Date(Date.UTC(Y, M, 0)).getUTCDate();
const monthStart = `${MONTH}-01`, monthEnd = `${MONTH}-${String(lastDay).padStart(2, '0')}`;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const wd = iso => new Date(iso + 'T12:00:00Z').getUTCDay();
function* dates(a, b) { const d = new Date(a + 'T12:00:00Z'); const e = new Date(b + 'T12:00:00Z'); while (d <= e) { yield d.toISOString().slice(0, 10); d.setUTCDate(d.getUTCDate() + 1); } }
const hm = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const fmt = m => { if (m == null) return '—'; let h = Math.floor(m / 60), mm = m % 60, ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return `${h}:${String(mm).padStart(2, '0')}${ap}`; };
const pretty = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

// ---------- read Wagepoint CSV ----------
function parseCSV(t) { const rows = []; let r = [], f = '', q = false; t = t.replace(/^﻿/, ''); for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; } else if (c === '"') q = true; else if (c === ',') { r.push(f); f = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; r.push(f); rows.push(r); r = []; f = ''; } else f += c; } if (f || r.length) { r.push(f); rows.push(r); } return rows; }
const raw = parseCSV(fs.readFileSync(CSV, 'utf8'));
const head = raw[0].map(h => h.trim().toUpperCase());
const C = n => head.indexOf(n);
const [cName, cIn, cOut, cLoc, cJob] = [C('EMPLOYEE'), C('LOGIN'), C('LOGOUT'), C('LOCATION NAME'), C('JOB NAME')];
if (cName < 0 || cIn < 0) { console.error('This doesn\'t look like a Wagepoint "timesheet by shift" export (no EMPLOYEE / LOGIN columns).'); process.exit(1); }
const dt = s => { const m = String(s || '').match(/(\d\d)-(\d\d)-(\d{4}) (\d+):(\d\d) (am|pm)/i); if (!m) return null; let h = +m[4] % 12; if (m[6].toLowerCase() === 'pm') h += 12; return { date: `${m[3]}-${m[1]}-${m[2]}`, min: h * 60 + +m[5] }; };
const punches = raw.slice(1).filter(r => r.length > 3 && r[cName] && !r[cName].startsWith('>>') && !String(r[0]).startsWith('>>'))
  .map(r => ({ name: r[cName].trim(), in: dt(r[cIn]), out: dt(r[cOut]), loc: (r[cLoc] || '').trim(), job: (r[cJob] || '').trim() }))
  .map(p => ({ ...p, date: (p.in || p.out || {}).date }))
  .filter(p => p.date);
const allDates = punches.map(p => p.date).sort();
const dataFrom = allDates[0], dataTo = allDates[allDates.length - 1];

// ---------- score ----------
const norm = s => s.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
const people = cfg.employees.map(e => {
  const sched = {};
  for (const [d, range] of Object.entries(e.schedule || {})) { const [a, b] = range.split('-'); sched[DAYS.indexOf(d)] = [hm(a), hm(b)]; }
  return { ...e, sched, perWeek: Object.keys(sched).length, wp: norm(e.wagepointName || e.name) };
});
const flags = [];
const flag = (who, what, detail) => flags.push({ who, what, detail });

if (dataFrom > monthStart || dataTo < monthEnd) {
  flag('Everyone', 'File doesn\'t cover the whole month', `Punches run ${dataFrom} to ${dataTo}; ${MONTH} is ${monthStart} to ${monthEnd}. Days outside the file show as absences — export the full month.`);
}
const configured = new Set(people.map(p => p.wp));
const notInProgram = new Set((cfg.notInProgram || []).map(norm)); // e.g. managers — never flagged
const unknownNames = [...new Set(punches.filter(p => p.date >= monthStart && p.date <= monthEnd).map(p => p.name))].filter(n => !configured.has(norm(n)) && !notInProgram.has(norm(n)));

const results = [];
for (const p of people) {
  const mine = punches.filter(x => norm(x.name) === p.wp && !(p.ignoreJobs || []).some(j => j.toLowerCase() === x.job.toLowerCase() || j.toLowerCase() === x.loc.toLowerCase()));
  const byDate = {};
  for (const x of mine) (byDate[x.date] = byDate[x.date] || []).push(x);
  const from = p.firstDay && p.firstDay > monthStart ? p.firstDay : monthStart;
  const days = [];
  for (const d of dates(from, monthEnd)) {
    const s = p.sched[wd(d)];
    const ps = byDate[d] || [];
    const ins = ps.filter(x => x.in).map(x => x.in.min);
    const first = ins.length ? Math.min(...ins) : null;
    const isExcused = excused.has(`${p.name.toLowerCase()}:${d}`);
    const day = { date: d, sched: s, first, punches: ps.length, excused: isExcused };
    if (s && holidays.has(d)) day.status = ps.length ? 'Picked up' : 'Holiday';
    else if (s) {
      if (!ps.length) day.status = 'Absent';
      else if (first == null) day.status = 'Worked';
      else { day.diff = first - s[0]; day.status = day.diff > VERY_LATE ? 'Very late' : day.diff > GRACE ? 'Late' : day.diff <= -GRACE ? 'Early' : 'On time'; }
    } else day.status = ps.length ? 'Picked up' : null;
    if (day.status) days.push(day);
  }
  const counted = days.filter(d => !d.excused);
  const c = st => counted.filter(d => d.status === st).length;
  const scheduled = days.filter(d => d.sched && d.status !== 'Holiday' && !(d.excused && d.status === 'Absent')).length;
  const worked = ['Late', 'Very late', 'Early', 'On time', 'Worked'].reduce((n, st) => n + days.filter(d => d.status === st).length, 0);
  let shifts = days.filter(d => d.punches > 0).length;
  if (SHIFTS_FROM) shifts = new Set(mine.filter(x => x.date >= SHIFTS_FROM && x.date <= monthEnd).map(x => x.date)).size;
  const r = { p, days, scheduled, worked, absent: c('Absent'), late: c('Late'), veryLate: c('Very late'), early: c('Early'), pickedUp: c('Picked up'), shifts,
    fullTime: p.perWeek >= FULL_TIME, awards: [] };
  r.att = scheduled ? Math.min(1, worked / scheduled) : null;
  results.push(r);

  // flags for this person
  if (!mine.some(x => x.date >= monthStart && x.date <= monthEnd)) flag(p.name, 'No punches this month', 'Left, on leave, or a different name in Wagepoint? They get no awards this month.');
  const pick = {};
  for (const d of days.filter(d => d.status === 'Picked up' && !holidays.has(d.date))) (pick[wd(d.date)] = pick[wd(d.date)] || []).push(d);
  for (const [w, arr] of Object.entries(pick)) if (arr.length >= 3) flag(p.name, 'Works an unscheduled day regularly', `Worked ${arr.length} ${DAYS[w]}s that aren't on their schedule (usually from ${fmt(arr.map(a => a.first).sort((a, b) => a - b)[Math.floor(arr.length / 2)])}). Add it to their schedule in config.json if it's a regular shift.`);
  const diffs = days.filter(d => d.diff != null).map(d => d.diff).sort((a, b) => a - b);
  const med = diffs[Math.floor(diffs.length / 2)];
  if (diffs.length >= 6 && Math.abs(med) >= 15) flag(p.name, 'Schedule may be off', `Typically clocks in ${Math.abs(med)} min ${med > 0 ? 'after' : 'before'} the scheduled start. Check their start time in config.json.`);
  for (const d of days.filter(d => d.diff != null && Math.abs(d.diff) >= VERY_LATE)) flag(p.name, d.diff > 0 ? 'Very late clock-in' : 'Very early clock-in', `${pretty(d.date)}: in at ${fmt(d.first)}, scheduled ${fmt(d.sched[0])} (${d.diff > 0 ? '+' : ''}${d.diff} min). Excuse it if it was a planned schedule change.`);
  for (const d of days.filter(d => d.punches && d.first == null)) flag(p.name, 'Missing clock-in', `${pretty(d.date)}: only a clock-out recorded — counted as worked.`);
  let run = [];
  const flush = () => { if (run.length >= 3) flag(p.name, 'Several absences in a row', `${run.length} scheduled shifts missed, ${pretty(run[0].date)} to ${pretty(run[run.length - 1].date)}. They still count as absences.`); run = []; };
  for (const d of days.filter(d => d.sched && d.status !== 'Holiday')) { if (d.status === 'Absent' && !d.excused) run.push(d); else flush(); } flush();
}

// Possible holidays / closures: most people scheduled that day didn't work
for (const d of dates(monthStart, monthEnd)) {
  if (holidays.has(d)) continue;
  const sched = results.filter(r => r.days.some(x => x.date === d && x.sched));
  const off = sched.filter(r => r.days.some(x => x.date === d && x.status === 'Absent'));
  if (sched.length >= 3 && off.length / sched.length >= 0.5) flag('Everyone', 'Possible holiday or closure', `${pretty(d)}: ${off.length} of ${sched.length} scheduled people didn't work. If the business was closed, re-run with --holiday ${d}.`);
}
for (const n of unknownNames) flag(n, 'Not in config.json', 'Has punches but no schedule, so no attendance awards or shift count. Add them to config.json if they\'re in the program.');

// ---------- awards ----------
const eligible = results.filter(r => r.fullTime && r.scheduled > 0);
for (const r of results) if (r.scheduled > 0 && r.absent === 0 && r.late === 0 && r.veryLate === 0) r.awards.push('Perfect Monthly Attendance');
if (eligible.length) {
  const score = r => r.att - r.late / 1000;
  const best = Math.max(...eligible.map(score));
  const leastL = Math.min(...eligible.map(r => r.late));
  const mostE = Math.max(...eligible.map(r => r.early));
  for (const r of eligible) {
    if (score(r) === best) r.awards.push('Best Monthly Attendance');
    if (r.late === leastL) r.awards.push('Least Lates');
    if (mostE > 0 && r.early === mostE) r.awards.push('Most Early');
  }
}

// ---------- output ----------
const label = new Date(Date.UTC(Y, M - 1, 15)).toLocaleDateString('en-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const q = s => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const csvOut = ['Month,Employee,Shifts,Awards', ...results.map(r => [MONTH, q(r.p.name), r.shifts, q(r.awards.join('; '))].join(','))].join('\n') + '\n';
fs.mkdirSync(OUT, { recursive: true });
const csvPath = path.join(OUT, `monthly-results-${MONTH}.csv`);
fs.writeFileSync(csvPath, csvOut);

const pad = (s, n) => String(s).padEnd(n);
const lines = [];
lines.push(`# Monthly awards — ${label}`, '');
lines.push(`Data: ${dataFrom} to ${dataTo} · grace ${GRACE} min · very late > ${VERY_LATE} min · full-time = ${FULL_TIME}+ shifts/week`);
if (holidays.size) lines.push(`Holidays: ${[...holidays].filter(([d]) => d >= monthStart && d <= monthEnd).map(([d, n]) => `${d} (${n})`).join(', ') || 'none this month'}`);
if (excused.size) lines.push(`Excused: ${[...excused].join(', ')}`);
if (SHIFTS_FROM) lines.push(`Shifts counted from ${SHIFTS_FROM} (first run)`);
lines.push('', '## Results', '');
lines.push('| Employee | Sched | Worked | Absent | Late | Very late | Early | Picked up | Shifts | Awards |');
lines.push('|---|---|---|---|---|---|---|---|---|---|');
for (const r of results) lines.push(`| ${r.p.name}${r.fullTime ? '' : ' (part-time)'} | ${r.scheduled} | ${r.worked} | ${r.absent} | ${r.late} | ${r.veryLate} | ${r.early} | ${r.pickedUp} | ${r.shifts} | ${r.awards.join(', ') || '—'} |`);
lines.push('', `## Flags to review (${flags.length})`, '');
if (!flags.length) lines.push('None.');
for (const f of flags) lines.push(`- **${f.who}** — ${f.what}: ${f.detail}`);
lines.push('', `Import file: ${csvPath}`);
const report = lines.join('\n');
fs.writeFileSync(path.join(OUT, `monthly-report-${MONTH}.md`), report + '\n');
console.log(report);
