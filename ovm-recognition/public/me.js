// Employee profile page. The token is the last part of the address: /me/<token>
const TOKEN = location.pathname.split('/').filter(Boolean).pop();
// Opened from the dashboard's "View as employee": look only, nothing can be requested
const PREVIEW = new URLSearchParams(location.search).has('preview');
if (PREVIEW) document.documentElement.classList.add('preview');
let data = null;

const $ = id => document.getElementById(id);
const num = n => Number(n || 0).toLocaleString('en-CA');

function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Dates arrive as 'YYYY-MM-DD' (or 'MM-DD' for birthdays); build them in local time
function dateFromParts(y, m, d) { return new Date(y, m - 1, d); }
function fmtLong(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return dateFromParts(y, m, d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtMonthDay(md) {
  if (!md) return 'Not set';
  const [m, d] = md.split('-').map(Number);
  return dateFromParts(2000, m, d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}
// '2026-07-14' -> 'July 14th, 2026'
function fmtOrdinal(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const suffix = (d % 100 >= 11 && d % 100 <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[d % 10] || 'th');
  return `${dateFromParts(y, m, d).toLocaleDateString('en-CA', { month: 'long' })} ${d}${suffix}, ${y}`;
}
function fmtWhen(ts) {
  return new Date(ts).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
}
function tenure(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const start = dateFromParts(y, m, d), now = new Date();
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months--;
  if (months < 1) return 'New this month';
  if (months < 12) return `${months} month${months === 1 ? '' : 's'}`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'}`;
}

async function load() {
  try {
    const res = await fetch(`/profile-api/${encodeURIComponent(TOKEN)}`, { cache: 'no-store' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return showGone(res.status === 404 ? null : body.error);
    }
    data = await res.json();
    render();
  } catch (e) {
    showGone('We couldn\'t load your profile. Check your connection and try again.');
  }
}

function showGone(message) {
  $('main').classList.add('hidden');
  $('gone').classList.remove('hidden');
  if (message) $('gone-msg').textContent = message;
  $('hello').textContent = 'Ottawa Valley Meats';
}

function render() {
  const e = data.employee;
  document.title = `${e.first_name}'s Awards | Ottawa Valley Meats`;
  $('hello').textContent = `Hi ${e.first_name}!`;
  $('main').setAttribute('aria-busy', 'false');

  // Balance
  $('balance').textContent = num(e.current_points);
  $('lifetime').textContent = `${num(e.lifetime_points)} earned all-time`;
  const pending = data.history.filter(h => h.type === 'redemption' && h.status === 'pending');
  if (pending.length) {
    const held = pending.reduce((a, h) => a + Math.abs(h.points), 0);
    $('on-hold').textContent = `${num(held)} points are set aside for ${pending.length === 1 ? `your ${pending[0].reason} request` : `${pending.length} requests`} waiting on a manager.`;
    $('on-hold').classList.remove('hidden');
  } else {
    $('on-hold').classList.add('hidden');
  }

  // Closest reward they can't afford yet
  const next = data.rewards.find(r => r.point_cost > e.current_points);
  if (next) {
    $('next-label').textContent = `Next: ${next.reward}`;
    $('next-togo').textContent = `${num(next.point_cost - e.current_points)} to go`;
    $('next').classList.remove('hidden');
    requestAnimationFrame(() => { $('next-bar').style.width = `${Math.min(100, (e.current_points / next.point_cost) * 100)}%`; });
  } else {
    $('next').classList.add('hidden');
  }

  // Facts
  $('f-shifts').textContent = num(e.shifts_completed);
  $('f-shifts-since').textContent = e.shifts_since ? `since ${fmtOrdinal(e.shifts_since)}` : '';
  $('f-start').textContent = e.start_date ? tenure(e.start_date) : 'Not set';
  $('f-start-label').textContent = e.start_date ? `Since ${fmtLong(e.start_date)}` : 'With OVM since';
  $('f-bday').textContent = fmtMonthDay(e.birthday);
  $('contact-btn').classList.toggle('hidden', !e.contact_card);

  renderRewards();
  renderEarn();
  renderHistory();
}

function renderRewards() {
  const bal = data.employee.current_points;
  $('rewards').innerHTML = data.rewards.map(r => {
    const can = bal >= r.point_cost;
    const pct = Math.min(100, (bal / r.point_cost) * 100);
    const value = r.dollar_value ? `$${Number(r.dollar_value).toLocaleString('en-CA', { maximumFractionDigits: 0 })} value` : '';
    return `
      <li class="reward${can ? ' can' : ''}">
        <div class="reward-top">
          ${RewardIcons.picture(r)}
          <div class="reward-title">
            <h3 class="reward-name">${esc(r.reward)}</h3>
            ${value ? `<p class="reward-value">${value}</p>` : ''}
          </div>
          <div class="reward-cost"><strong>${num(r.point_cost)}</strong><span>points</span></div>
        </div>
        ${r.description ? `<p class="reward-desc">${esc(r.description)}</p>` : ''}
        <div class="reward-foot">
          ${can
            ? (PREVIEW ? `<button class="btn" disabled title="Requests are turned off in preview">Request this reward</button>` : `<button class="btn" data-request="${r.id}">Request this reward</button>`)
            : `<div class="reward-progress"><span>${num(r.point_cost - bal)} more points to go</span><div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div></div>`}
        </div>
      </li>`;
  }).join('') || '<li class="empty">No rewards are available right now.</li>';
}

// Groups the recognition rules so ten anniversary rows don't swamp the list
function renderEarn() {
  const groups = { Birthday: [], 'Every month': [], Milestones: [], 'Recognized by a manager': [] };
  const anniversaries = [];
  for (const r of data.rules) {
    if (/Year Anniversary/i.test(r.event)) anniversaries.push(r);
    else if (/Birthday/i.test(r.event)) groups.Birthday.push(r);
    else if (/Shifts Completed|Orders Picked/i.test(r.event)) groups.Milestones.push(r);
    else if (/Month|Monthly|Least Shifts|Most Shifts|Least Lates|Most Early/i.test(r.event)) groups['Every month'].push(r);
    else groups['Recognized by a manager'].push(r);
  }
  const list = rows => `<ul class="earn-list">${rows.map(r => `<li><span>${esc(r.event)}${r.note ? `<span class="earn-note-line">${esc(r.note)}</span>` : ''}</span><span class="pts">${num(r.points)} pts</span></li>`).join('')}</ul>`;
  let html = '';
  if (groups.Birthday.length) html += `<div class="earn-group"><h3>Birthday</h3>${list(groups.Birthday)}</div>`;
  if (anniversaries.length) {
    const sorted = anniversaries.sort((a, b) => parseInt(a.event) - parseInt(b.event));
    html += `<div class="earn-group"><h3>Work anniversaries</h3>${list(sorted.map(r => ({ event: r.event.replace(' Anniversary', ''), points: r.points })))}</div>`;
  }
  // Shift milestones first, then order milestones, each in number order
  groups.Milestones.sort((a, b) => (/Shifts/.test(b.event) - /Shifts/.test(a.event)) || parseInt(a.event) - parseInt(b.event));
  for (const name of ['Every month', 'Milestones', 'Recognized by a manager']) {
    if (groups[name].length) html += `<div class="earn-group"><h3>${name}</h3>${list(groups[name])}</div>`;
  }
  $('earn').innerHTML = html || '<p class="empty">Nothing here yet.</p>';
}

function renderHistory() {
  $('history').innerHTML = data.history.map(h => {
    const when = fmtWhen(h.resolved_at || h.created_at);
    if (h.type === 'redemption') {
      const chip = h.status === 'pending' ? '<span class="chip pending">Waiting on a manager</span>'
        : h.status === 'denied' ? '<span class="chip denied">Declined, points returned</span>'
        : '<span class="chip done">Approved</span>';
      return `<li><div class="h-main"><div class="h-reason">${esc(h.reason)}</div><div class="h-meta">${when} ${chip}</div></div>
        <div class="h-pts ${h.status === 'denied' ? 'void' : 'minus'}">−${num(Math.abs(h.points))}</div></li>`;
    }
    return `<li><div class="h-main"><div class="h-reason">${esc(h.reason)}</div><div class="h-meta">${when}</div></div>
      <div class="h-pts plus">+${num(h.points)}</div></li>`;
  }).join('') || '<li class="empty">Your awards will show up here.</li>';
}

// ---------- Tabs ----------
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
    document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    $(tab.dataset.panel).classList.remove('hidden');
  });
});

// ---------- Requesting a reward ----------
let pendingReward = null;
$('rewards').addEventListener('click', e => {
  const btn = e.target.closest('[data-request]');
  if (!btn) return;
  pendingReward = data.rewards.find(r => r.id === Number(btn.dataset.request));
  if (!pendingReward) return;
  $('sheet-title').textContent = `Request ${pendingReward.reward}?`;
  $('sheet-body').textContent = `${num(pendingReward.point_cost)} points will come off your balance now. A manager will review it and text you. If it's declined, you get your points back.`;
  $('sheet-error').classList.add('hidden');
  $('sheet-confirm').disabled = false;
  $('sheet-confirm').textContent = 'Request';
  $('sheet-backdrop').classList.remove('hidden');
  $('sheet-confirm').focus();
});

function closeSheet() { $('sheet-backdrop').classList.add('hidden'); pendingReward = null; }
$('sheet-cancel').addEventListener('click', closeSheet);
$('sheet-backdrop').addEventListener('click', e => { if (e.target === $('sheet-backdrop')) closeSheet(); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('sheet-backdrop').classList.contains('hidden')) closeSheet();
  if (!$('save-backdrop').classList.contains('hidden')) closeSave();
});

$('sheet-confirm').addEventListener('click', async () => {
  if (!pendingReward) return;
  const btn = $('sheet-confirm');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    const res = await fetch(`/profile-api/${encodeURIComponent(TOKEN)}/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reward_id: pendingReward.id })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Something went wrong. Please try again.');
    closeSheet();
    toast(`Requested ${body.reward}. We'll text you once it's approved.`);
    await load();
  } catch (err) {
    $('sheet-error').textContent = err.message;
    $('sheet-error').classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Try again';
  }
});

// ---------- Save to your phone ----------
const ua = navigator.userAgent;
const isAndroid = /Android/.test(ua);
// iPads report themselves as Macs, so a "Mac" with a touch screen is an iPad
const isIOS = /iPhone|iPad|iPod/.test(ua) || (!isAndroid && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isSaved = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let installPrompt = null;

// Chrome on Android offers a one-tap install; keep it for the button
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installPrompt = e;
  updateSaveSheet();
});
window.addEventListener('appinstalled', () => { installPrompt = null; closeSave(); toast('Saved! Look for the OVM icon on your home screen.'); });

function updateSaveSheet() {
  $('save-installed').classList.toggle('hidden', !isSaved);
  // Unknown phone (or a computer): show both sets of steps
  $('save-ios').classList.toggle('hidden', isSaved || (isAndroid && !isIOS));
  $('save-android').classList.toggle('hidden', isSaved || (isIOS && !isAndroid));
  $('save-install').classList.toggle('hidden', !installPrompt);
  $('save-android-steps').classList.toggle('hidden', !!installPrompt);
}

function openSave() {
  updateSaveSheet();
  $('save-backdrop').classList.remove('hidden');
  $('save-close').focus();
}
function closeSave() { $('save-backdrop').classList.add('hidden'); }

$('save-open').addEventListener('click', openSave);
$('save-close').addEventListener('click', closeSave);
$('save-backdrop').addEventListener('click', e => { if (e.target === $('save-backdrop')) closeSave(); });
$('save-install').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  updateSaveSheet();
});
if (isSaved) $('save-foot').classList.add('hidden');

// The welcome text links to <profile>#save. Open the steps, then drop "#save" from the
// address so the saved home-screen icon opens the plain profile.
if (!PREVIEW && location.hash === '#save') {
  history.replaceState(null, '', location.pathname);
  if (!isSaved) openSave();
}

let toastTimer;
function toast(msg) {
  $('toast').textContent = msg;
  $('toast').classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.add('hidden'), 4500);
}

load();
