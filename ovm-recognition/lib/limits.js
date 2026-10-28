// Simple in-memory limits (the app runs as one server, so memory is enough).
// They reset if the server restarts, which is fine: they only need to slow down
// someone guessing passcodes or spamming nominations.

function limiter({ max, windowMs }) {
  const hits = new Map(); // key -> timestamps
  return {
    // True if this key has used up its allowance in the current window
    blocked(key) {
      const now = Date.now();
      const recent = (hits.get(key) || []).filter(t => now - t < windowMs);
      hits.set(key, recent);
      return recent.length >= max;
    },
    record(key) {
      const list = hits.get(key) || [];
      list.push(Date.now());
      hits.set(key, list);
      if (hits.size > 5000) for (const [k, v] of hits) if (!v.length) hits.delete(k);
    }
  };
}

// Wrong dashboard passcodes: 10 tries per device (IP) per 15 minutes
const passcodeTries = limiter({ max: 10, windowMs: 15 * 60 * 1000 });
// Nominations: 20 per manager per hour (from their page or by text)
const nominations = limiter({ max: 20, windowMs: 60 * 60 * 1000 });

module.exports = { limiter, passcodeTries, nominations };
