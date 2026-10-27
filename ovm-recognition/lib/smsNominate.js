// Managers nominating by text. Every text from a manager's number comes here.
//
// All in one text:   NOMINATE Kenny for Above + Beyond for cleaning up the warehouse
// Or step by step:   NOMINATE Kenny  ->  "Which award? Add a reason if you like"  ->  2 for cleaning up
// Or just:           NOMINATE        ->  "Who would you like to nominate?"
//
// The reason is optional. A name that matches more than one employee gets a
// numbered "Which one?" list. Where each manager is in a conversation lives in
// sms_sessions; it's forgotten after 30 minutes, and CANCEL ends it.

const pool = require('../db/pool');
const {
  textManager, nominatableRules, nominatableEmployees, createNomination, NominationError, MAX_CUSTOM_POINTS, cashFor
} = require('./nominate');

const EXPIRE_MINUTES = 30;
const MAX_CHOICES = 6;

async function getSession(phone) {
  return (await pool.query(
    `SELECT * FROM sms_sessions WHERE phone = $1 AND updated_at > now() - ($2 || ' minutes')::interval`,
    [phone, String(EXPIRE_MINUTES)]
  )).rows[0] || null;
}
async function setSession(phone, step, data) {
  await pool.query(
    `INSERT INTO sms_sessions (phone, step, data, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (phone) DO UPDATE SET step = $2, data = $3, updated_at = now()`,
    [phone, step, JSON.stringify(data || {})]
  );
}
async function endSession(phone) {
  await pool.query('DELETE FROM sms_sessions WHERE phone = $1', [phone]);
}

// ---------- Reading what they typed ----------

// One word for matching: lower case, "+"/"&" read as "and", punctuation dropped
const normWord = w => w.toLowerCase().replace(/^[+&]$/, 'and').replace(/[^a-z0-9]/g, '');
const clean = s => String(s || '').toLowerCase().replace(/[+&]/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Words with their position in the original text, so the reason keeps the manager's own wording
function tokenize(text) {
  const out = [];
  const re = /[^\s\-–—,:;]+/g;
  let m;
  while ((m = re.exec(text))) {
    const norm = normWord(m[0]);
    if (norm) out.push({ norm, start: m.index });
  }
  return out;
}

// Words that sit between the name, the award and the reason
const JOINERS = new Set(['for', 'because', 'cause', 'since', 'with', 'by', 'after', 'about', 'to', 'the', 'award']);

// Everything from token i on, as typed (minus leading joiners and punctuation)
function textFrom(text, tokens, i) {
  while (i < tokens.length && JOINERS.has(tokens[i].norm)) i++;
  if (i >= tokens.length) return '';
  return text.slice(tokens[i].start).replace(/^[\s.,:;)\-–—]+/, '').trim();
}

// Ways a manager might type each award: the full name, its first two words,
// its first word (if it's distinctive), and "five" for "5"
function awardAliases(rule) {
  const words = clean(rule.event).split(' ');
  const set = new Set([words.join(' ')]);
  if (words.length > 1) set.add(words.slice(0, 2).join(' '));
  if (words[0].length >= 5) set.add(words[0]);
  for (const a of [...set]) if (/\b5\b/.test(a)) set.add(a.replace(/\b5\b/, 'five'));
  return [...set].map(a => a.split(' '));
}

// The award starting at token i (longest match), or null. Returns { rule, end }.
function awardAt(tokens, i, rules) {
  let best = null;
  for (const rule of rules) {
    for (const alias of awardAliases(rule)) {
      if (alias.every((w, k) => tokens[i + k] && tokens[i + k].norm === w) && (!best || alias.length > best.end - i)) {
        best = { rule, end: i + alias.length };
      }
    }
  }
  return best;
}

// A custom amount starting at token i: "custom", "custom 75", "custom 75 points", "75 points".
// Returns { custom: true, points, end } or null.
const POINT_WORDS = new Set(['points', 'point', 'pts', 'pt']);
function customAt(tokens, i) {
  const t = k => tokens[k] && tokens[k].norm;
  if (t(i) === 'custom') {
    let end = i + 1, points = null;
    if (t(end) === 'amount') end++;
    if (/^\d+$/.test(t(end) || '')) { points = Number(t(end)); end++; if (POINT_WORDS.has(t(end))) end++; }
    return { custom: true, points, end };
  }
  if (/^\d+$/.test(t(i) || '') && POINT_WORDS.has(t(i + 1))) return { custom: true, points: Number(t(i)), end: i + 2 };
  return null;
}

// Employees whose name matches: the full name, a first name, a last name, or
// the start of one ("ken" -> Kenny)
function matchEmployees(employees, typed) {
  const q = clean(typed);
  if (!q) return [];
  const exact = employees.filter(e => clean(e.name) === q);
  if (exact.length) return exact;
  const words = q.split(' ');
  return employees.filter(e => {
    const parts = clean(e.name).split(' ');
    return words.every(w => parts.some(p => p.startsWith(w)));
  });
}

// "Kenny for above and beyond for cleaning up the warehouse"
//   -> { nameText: 'Kenny', matches: [Kenny Smith], rule: Above + Beyond, reason: 'cleaning up the warehouse' }
function parseNomination(text, employees, rules) {
  const tokens = tokenize(text);
  // The name is the words before the first joiner; use the longest start of them that matches someone
  let stop = tokens.findIndex(t => JOINERS.has(t.norm));
  if (stop < 0) stop = tokens.length;
  let nameEnd = 0, matches = [];
  for (let k = Math.min(stop, 4); k >= 1; k--) {
    const found = matchEmployees(employees, tokens.slice(0, k).map(t => t.norm).join(' '));
    if (found.length) { nameEnd = k; matches = found; break; }
  }
  if (!nameEnd) nameEnd = Math.min(stop, 3);
  const nameText = nameEnd ? text.slice(tokens[0].start, tokens[nameEnd - 1].start + 40).split(/\s+/).slice(0, nameEnd).join(' ') : '';

  // Then the award (if they named one), then the reason
  let i = nameEnd;
  while (i < tokens.length && JOINERS.has(tokens[i].norm)) i++;
  const award = customAt(tokens, i) || awardAt(tokens, i, rules);
  const reason = award ? textFrom(text, tokens, award.end) : textFrom(text, tokens, nameEnd);
  return { nameText, matches, rule: award && award.rule ? award.rule : null, custom: !!(award && award.custom), points: award ? award.points : null, reason };
}

// A reply to "Which award?": "2", "2 for cleaning up", "above and beyond, cleaned up", ...
function parseAwardReply(text, rules, ruleIds) {
  const tokens0 = tokenize(text);
  const custom = customAt(tokens0, 0);
  if (custom) return { custom: true, points: custom.points, reason: textFrom(text, tokens0, custom.end) };
  const num = text.match(/^\s*(\d+)\s*[.)]?\s*/);
  if (num) {
    if (Number(num[1]) === ruleIds.length + 1) { // the last option on the list: Custom
      const rest = text.slice(num[0].length);
      const t = tokenize(rest);
      const pts = /^\d+$/.test((t[0] && t[0].norm) || '') ? Number(t[0].norm) : null;
      let k = pts !== null ? 1 : 0;
      if (pts !== null && t[k] && POINT_WORDS.has(t[k].norm)) k++;
      return { custom: true, points: pts, reason: textFrom(rest, t, k) };
    }
    const id = ruleIds[Number(num[1]) - 1];
    const rule = rules.find(r => r.id === id);
    if (!rule) return null;
    const rest = text.slice(num[0].length);
    const tokens = tokenize(rest);
    return { rule, reason: textFrom(rest, tokens, 0) };
  }
  const tokens = tokenize(text);
  let i = 0;
  while (i < tokens.length && JOINERS.has(tokens[i].norm)) i++;
  const award = awardAt(tokens, i, rules);
  if (!award) return null;
  return { rule: award.rule, reason: textFrom(text, tokens, award.end) };
}

const numbered = items => items.map((label, i) => `${i + 1}. ${label}`).join('\n');

// ---------- The conversation ----------

// Next step once we know who: ask for the award, or submit if we have it
async function proceed(manager, data, to) {
  const employee = (await nominatableEmployees()).find(e => e.id === data.employee_id);
  const rules = await nominatableRules();
  const rule = rules.find(r => r.id === data.rule_id);
  if (!employee) {
    await setSession(manager.phone, 'who', {});
    await textManager('nominate_who', {}, manager, to);
    return;
  }
  if (data.custom) {
    const first = employee.name.split(' ')[0];
    const points = Number(data.points);
    if (!Number.isInteger(points) || points < 1 || points > MAX_CUSTOM_POINTS) {
      await setSession(manager.phone, 'points', { employee_id: employee.id, custom: true, reason: data.reason || '' });
      await textManager('nominate_points', { employee_first: first, max: MAX_CUSTOM_POINTS.toLocaleString(), max_cash: cashFor(MAX_CUSTOM_POINTS) }, manager, to);
      return;
    }
    if (!data.reason) {
      await setSession(manager.phone, 'custom_reason', { employee_id: employee.id, custom: true, points });
      await textManager('nominate_custom_reason', { employee_first: first, points, cash: cashFor(points) }, manager, to);
      return;
    }
    return submit(manager, { employeeId: employee.id, custom: true, points, note: data.reason }, to);
  }
  if (!rule) {
    await setSession(manager.phone, 'award', { employee_id: employee.id, reason: data.reason || '', rule_ids: rules.map(r => r.id) });
    await textManager('nominate_award', {
      employee: employee.name,
      employee_first: employee.name.split(' ')[0],
      awards: numbered([...rules.map(r => `${r.event} (${r.points} pts)`), 'Custom (you choose the points)'])
    }, manager, to);
    return;
  }
  return submit(manager, { employeeId: employee.id, ruleId: rule.id, note: data.reason }, to);
}

async function submit(manager, nomination, to) {
  try {
    const { employee, award, points } = await createNomination(manager, nomination);
    await endSession(manager.phone);
    await textManager('nominate_done', { employee: employee.name, award: nomination.custom ? `"${award}"` : award, points }, manager, to);
  } catch (err) {
    if (!(err instanceof NominationError)) throw err;
    await endSession(manager.phone);
    await textManager('manager_help', {}, manager, to);
  }
}

// A name (plus maybe the award and reason): find the person, then carry on
async function handleWho(manager, text, data, to) {
  const [employees, rules] = await Promise.all([nominatableEmployees(), nominatableRules()]);
  const parsed = parseNomination(text, employees, rules);
  data = {
    ...data,
    rule_id: parsed.rule ? parsed.rule.id : data.rule_id,
    custom: parsed.custom || data.custom || false,
    points: parsed.points || data.points || null,
    reason: parsed.reason || data.reason || ''
  };
  if (parsed.matches.length === 1) {
    await proceed(manager, { ...data, employee_id: parsed.matches[0].id }, to);
  } else if (parsed.matches.length > 1 && parsed.matches.length <= MAX_CHOICES) {
    await setSession(manager.phone, 'pick_who', { ...data, choices: parsed.matches.map(e => e.id) });
    await textManager('nominate_pick', { choices: numbered(parsed.matches.map(e => e.name)) }, manager, to);
  } else {
    await setSession(manager.phone, 'who', data);
    await textManager('nominate_no_match', { name: (parsed.nameText || text).trim().slice(0, 40) }, manager, to);
  }
}

// Handles every text from a manager. Returns false if it wasn't a nomination
// (the webhook then sends the manager help text).
async function handleManagerText(manager, text, contactId) {
  const phone = manager.phone;
  const to = { contactId };
  const start = text.match(/^\s*(nominate|nomination|nom)\b[\s:,\-]*/i);

  if (start) {
    const rest = text.slice(start[0].length).trim();
    if (!rest) {
      await setSession(phone, 'who', {});
      await textManager('nominate_who', {}, manager, to);
    } else {
      await handleWho(manager, rest, {}, to);
    }
    return true;
  }

  const session = await getSession(phone);
  if (!session) return false;

  if (/^\s*(cancel|stop|quit|never ?mind)\s*$/i.test(text)) {
    await endSession(phone);
    await textManager('nominate_cancelled', {}, manager, to);
    return true;
  }

  const data = session.data || {};

  if (session.step === 'pick_who') {
    const num = text.match(/^\s*(\d+)\s*[.)]?\s*$/);
    if (num) {
      const id = (data.choices || [])[Number(num[1]) - 1];
      if (id) { await proceed(manager, { ...data, employee_id: id }, to); return true; }
      const employees = await nominatableEmployees();
      const listed = (data.choices || []).map(cid => employees.find(e => e.id === cid)).filter(Boolean);
      await textManager('nominate_pick', { choices: numbered(listed.map(e => e.name)) }, manager, to);
      return true;
    }
    await handleWho(manager, text, data, to);
    return true;
  }

  if (session.step === 'who') {
    await handleWho(manager, text, data, to);
    return true;
  }

  if (session.step === 'award') {
    const rules = await nominatableRules();
    const reply = parseAwardReply(text, rules, data.rule_ids || []);
    if (!reply) { await proceed(manager, { employee_id: data.employee_id, reason: data.reason }, to); return true; }
    if (reply.custom) {
      await proceed(manager, { employee_id: data.employee_id, custom: true, points: reply.points, reason: reply.reason || data.reason }, to);
    } else {
      await proceed(manager, { employee_id: data.employee_id, rule_id: reply.rule.id, reason: reply.reason || data.reason }, to);
    }
    return true;
  }

  // Custom amount: "How many points?" (a reason can come with it: "75 for cleaning up")
  if (session.step === 'points') {
    const m = text.match(/^\s*(\d[\d,]*)\s*(points?|pts?)?\b[\s.,:;\-]*/i);
    if (!m) { await proceed(manager, { ...data, points: null }, to); return true; }
    const rest = text.slice(m[0].length);
    const reason = textFrom(rest, tokenize(rest), 0);
    await proceed(manager, { ...data, points: Number(m[1].replace(/,/g, '')), reason: reason || data.reason }, to);
    return true;
  }

  // Custom amount: "What's it for?"
  if (session.step === 'custom_reason') {
    await proceed(manager, { ...data, reason: text.trim() }, to);
    return true;
  }

  await endSession(phone);
  return false;
}

module.exports = { handleManagerText, parseNomination, parseAwardReply, matchEmployees };
