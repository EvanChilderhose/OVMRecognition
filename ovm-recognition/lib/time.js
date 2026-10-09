// The business runs on Ottawa time, but Render's servers run on UTC. Anything
// that asks "what day is it?" should use this instead of new Date().
const TIMEZONE = process.env.TIMEZONE || 'America/Toronto';

// Today's date in the business timezone as { iso: 'YYYY-MM-DD', year, month, day }
function today() {
  // en-CA formats dates as YYYY-MM-DD
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  const [year, month, day] = iso.split('-').map(Number);
  return { iso, year, month, day };
}

// Splits a 'YYYY-MM-DD' string into numbers without any timezone conversion.
function parseDate(str) {
  const [year, month, day] = String(str).slice(0, 10).split('-').map(Number);
  return { year, month, day };
}

function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

// True if dateStr's month/day falls on `now`. Feb 29 dates are celebrated on
// Feb 28 in non-leap years so they aren't skipped three years out of four.
function isSameMonthDay(dateStr, now) {
  const d = parseDate(dateStr);
  if (d.month === now.month && d.day === now.day) return true;
  return d.month === 2 && d.day === 29 && now.month === 2 && now.day === 28 && !isLeapYear(now.year);
}

// Current hour (0–23) in the business timezone
function currentHour() {
  return Number(new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isLastDayOfMonth(now) {
  return now.day === daysInMonth(now.year, now.month);
}

const pad = n => String(n).padStart(2, '0');

// 'YYYY-MM' for a month
function periodOf(year, month) {
  return `${year}-${pad(month)}`;
}

// Monthly awards are chosen from the last day of a month through the first
// week of the next. Returns the month being chosen for ('YYYY-MM'), or null
// outside that window.
function monthEndPeriod(now) {
  if (isLastDayOfMonth(now)) return periodOf(now.year, now.month);
  if (now.day <= 7) return now.month === 1 ? periodOf(now.year - 1, 12) : periodOf(now.year, now.month - 1);
  return null;
}

// '2026-10' -> 'October 2026'
function periodLabel(period) {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

module.exports = { TIMEZONE, today, parseDate, isSameMonthDay, currentHour, isLastDayOfMonth, periodOf, monthEndPeriod, periodLabel };
