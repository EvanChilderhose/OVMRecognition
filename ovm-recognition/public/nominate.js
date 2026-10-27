// Manager nominating page. The token is the last part of the address: /n/<token>
const TOKEN = location.pathname.split('/').filter(Boolean).pop();
let data = null;

const $ = id => document.getElementById(id);
const num = n => Number(n || 0).toLocaleString('en-CA');
function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const cash = p => '$' + (p * data.dollars_per_point).toLocaleString('en-CA', { maximumFractionDigits: 2 });
const fmtWhen = ts => new Date(ts).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });

async function load() {
  try {
    const res = await fetch(`/nominate-api/${encodeURIComponent(TOKEN)}`, { cache: 'no-store' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return showGone(res.status === 404 ? null : body.error);
    }
    data = await res.json();
    render();
  } catch (e) {
    showGone('We couldn\'t load this page. Check your connection and try again.');
  }
}

function showGone(msg) {
  $('main').classList.add('hidden');
  $('gone').classList.remove('hidden');
  if (msg) $('gone-msg').textContent = msg;
}

function render() {
  $('hello').textContent = `Hi ${data.manager.first_name}!`;
  $('main').setAttribute('aria-busy', 'false');
  $('contact-btn').classList.toggle('hidden', !data.contact_card);

  const chosen = $('who').value;
  $('who').innerHTML = '<option value="">Choose a name…</option>' +
    data.employees.map(e => `<option value="${e.id}">${esc(e.name)}${e.department ? ` (${esc(e.department)})` : ''}</option>`).join('');
  $('who').value = chosen;

  $('awards').innerHTML = data.awards.map(a => `
    <label class="award">
      <input type="radio" name="award" value="${a.id}">
      <span class="award-dot" aria-hidden="true"></span>
      <span class="award-text"><span class="award-name">${esc(a.event)}</span>${a.note ? `<span class="award-note">${esc(a.note)}</span>` : ''}</span>
      <span class="award-pts">${num(a.points)} pts</span>
    </label>`).join('') + `
    <label class="award">
      <input type="radio" name="award" value="custom">
      <span class="award-dot" aria-hidden="true"></span>
      <span class="award-text"><span class="award-name">Custom</span><span class="award-note">You choose the points. Add a reason, it's what they'll see.</span></span>
    </label>
    <div class="custom-points">
      <input id="custom-points" type="number" inputmode="numeric" min="1" max="${data.max_custom_points}" placeholder="Points" aria-label="Custom points">
      <span id="custom-cash">points (up to ${num(data.max_custom_points)}). 100 pts = ${cash(100)}</span>
    </div>`;
  $('custom-points').addEventListener('input', () => {
    const p = Number($('custom-points').value);
    $('custom-cash').textContent = p > 0 ? `points = ${cash(p)} value` : `points (up to ${num(data.max_custom_points)}). 100 pts = ${cash(100)}`;
  });

  renderMine();
}

function renderMine() {
  $('mine').innerHTML = data.nominations.map(n => {
    const chip = n.status === 'pending' ? '<span class="chip pending">Waiting for approval</span>'
      : n.status === 'approved' ? '<span class="chip done">Approved</span>'
      : '<span class="chip denied">Not approved</span>';
    return `<li><div class="h-main">
        <div class="h-reason">${esc(n.employee_name)}: ${esc(n.reason)}</div>
        <div class="h-meta">${fmtWhen(n.created_at)} ${chip}</div>
        ${n.notes ? `<div class="h-note">${esc(String(n.notes).split(' | ')[0])}</div>` : ''}
      </div>
      <div class="h-pts ${n.status === 'approved' ? 'plus' : n.status === 'pending' ? '' : 'void'}">+${num(n.points)}</div></li>`;
  }).join('') || '<li class="empty">Your nominations will show up here.</li>';
}

// Custom amounts need a reason; the regular awards don't
$('awards').addEventListener('change', () => {
  const custom = document.querySelector('input[name="award"]:checked')?.value === 'custom';
  $('note-optional').textContent = custom ? '(needed for a custom amount)' : '(optional)';
  if (custom) $('custom-points').focus();
});

function formError(msg) {
  $('form-error').textContent = msg;
  $('form-error').classList.toggle('hidden', !msg);
}

$('form').addEventListener('submit', async e => {
  e.preventDefault();
  const award = document.querySelector('input[name="award"]:checked');
  const note = $('note').value.trim();
  if (!$('who').value) return formError('Choose who you\'re nominating.');
  if (!award) return formError('Pick an award.');
  const custom = award.value === 'custom';
  const points = custom ? Number($('custom-points').value) : null;
  if (custom && !(Number.isInteger(points) && points >= 1 && points <= data.max_custom_points)) return formError(`Enter the custom points (1 to ${num(data.max_custom_points)}).`);
  if (custom && !note) return formError('Add a reason for the custom amount. It\'s what they\'ll see in their text.');
  formError('');
  const btn = $('send');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    const res = await fetch(`/nominate-api/${encodeURIComponent(TOKEN)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_id: Number($('who').value), rule_id: custom ? 'custom' : Number(award.value), points, note })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Something went wrong. Please try again.');
    $('form').reset();
    toast(`Your nomination has been submitted: ${body.employee} for ${custom ? `"${body.award}"` : body.award} (${num(body.points)} pts).`);
    await load();
    $('mine').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    formError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send nomination';
  }
});

// ---------- Save to your phone ----------
const ua = navigator.userAgent;
const isAndroid = /Android/.test(ua);
const isIOS = /iPhone|iPad|iPod/.test(ua) || (!isAndroid && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isSaved = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let installPrompt = null;

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; updateSaveSheet(); });
window.addEventListener('appinstalled', () => { installPrompt = null; closeSave(); toast('Saved! Look for the OVM icon on your home screen.'); });

function updateSaveSheet() {
  $('save-installed').classList.toggle('hidden', !isSaved);
  $('save-ios').classList.toggle('hidden', isSaved || (isAndroid && !isIOS));
  $('save-android').classList.toggle('hidden', isSaved || (isIOS && !isAndroid));
  $('save-install').classList.toggle('hidden', !installPrompt);
  $('save-android-steps').classList.toggle('hidden', !!installPrompt);
}
function openSave() { updateSaveSheet(); $('save-backdrop').classList.remove('hidden'); $('save-close').focus(); }
function closeSave() { $('save-backdrop').classList.add('hidden'); }

$('save-open').addEventListener('click', openSave);
$('save-close').addEventListener('click', closeSave);
$('save-backdrop').addEventListener('click', e => { if (e.target === $('save-backdrop')) closeSave(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSave(); });
$('save-install').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  updateSaveSheet();
});
if (isSaved) $('save-foot').classList.add('hidden');

let toastTimer;
function toast(msg) {
  $('toast').textContent = msg;
  $('toast').classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.add('hidden'), 4500);
}

load();
