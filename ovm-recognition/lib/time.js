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

module.exports = { TIMEZONE, today, parseDate, isSameMonthDay };
