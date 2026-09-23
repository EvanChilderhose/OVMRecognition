// Puts phone numbers into one consistent format (E.164, e.g. +16135551234)
// so a number typed in the dashboard as "613-555-1234" still matches the
// "+16135551234" GHL sends on an inbound text.
//
// Returns null if the input is empty or doesn't look like a phone number.
function normalizePhone(input) {
  if (!input) return null;
  const s = String(input).trim();
  const digits = s.replace(/\D/g, '');
  if (!digits) return null;
  if (s.startsWith('+')) return digits.length >= 8 ? '+' + digits : null;
  if (digits.length === 10) return '+1' + digits;                          // 6135551234
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits; // 16135551234
  return null;
}

module.exports = { normalizePhone };
