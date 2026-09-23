let PASSCODE = sessionStorage.getItem('ovm_passcode') || '';
let employeesCache = [];
let rewardsCache = [];

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'x-passcode': PASSCODE, ...(options.headers || {}) }
  });
  if (res.status === 401) {
    showPasscodeScreen('Wrong passcode.');
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

function showPasscodeScreen(error) {
  document.getElementById('app').classList.add('hidden');
  document.getElementById('passcode-screen').classList.remove('hidden');
  document.getElementById('passcode-error').textContent = error || '';
}

async function submitPasscode() {
  PASSCODE = document.getElementById('passcode-input').value;
  try {
    await api('/api/employees'); // used purely to validate the passcode
    sessionStorage.setItem('ovm_passcode', PASSCODE);
    document.getElementById('passcode-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    initApp();
  } catch (e) {
    if (e.message !== 'unauthorized') showPasscodeScreen(e.message);
  }
}

// ---------- Tabs ----------
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.remove('hidden');
      loadTab(btn.dataset.tab);
    });
  });
}

function loadTab(tab) {
  if (tab === 'employees') loadEmployees();
  if (tab === 'pending') loadPending();
  if (tab === 'rewards') loadRewards();
  if (tab === 'rules') loadRules();
  if (tab === 'log') loadLog();
}

function initApp() {
  setupTabs();
  loadEmployees();
  refreshPendingCount();
}

// ---------- Employees ----------
async function loadEmployees() {
  employeesCache = await api('/api/employees');
  const tbody = document.querySelector('#employees-table tbody');
  tbody.innerHTML = employeesCache.map(e => `
    <tr>
      <td><strong>${esc(e.name)}</strong>${e.phone ? `<span class="sub-line">${esc(e.phone)}</span>` : ''}</td>
      <td>${esc(e.department)}</td>
      <td class="nowrap">${fmtDate(e.start_date)}</td>
      <td class="nowrap">${fmtDate(e.birthday)}</td>
      <td>${statusTag(e.status)}</td>
      <td class="num strong">${fmtNum(e.current_points)}</td>
      <td class="num dim">${fmtNum(e.lifetime_points)}</td>
      <td class="actions"><button class="link" onclick="openEmployeeForm(${e.id})">Edit</button></td>
    </tr>`).join('') || emptyRow(8, 'No employees yet. Add your staff to start tracking points.');
}

function openEmployeeForm(id) {
  const emp = id ? employeesCache.find(e => e.id === id) : {};
  showModal(id ? 'Edit Employee' : 'Add Employee', `
    ${field('f-name', 'Name', `<input id="f-name" value="${esc(emp.name)}">`)}
    <div class="field-row">
      ${field('f-phone', 'Phone', `<input id="f-phone" type="tel" placeholder="613-555-1234" value="${esc(emp.phone)}">`)}
      ${field('f-department', 'Department', `<input id="f-department" value="${esc(emp.department)}">`)}
    </div>
    <div class="field-row">
      ${field('f-start', 'Start Date', `<input id="f-start" type="date" value="${dateInputVal(emp.start_date)}">`)}
      ${field('f-birthday', 'Birthday', `<input id="f-birthday" type="date" value="${dateInputVal(emp.birthday)}">`)}
    </div>
    ${field('f-status', 'Status', `
    <select id="f-status">
      <option ${emp.status !== 'Inactive' ? 'selected' : ''}>Active</option>
      <option ${emp.status === 'Inactive' ? 'selected' : ''}>Inactive</option>
    </select>`)}
  `, async () => {
    const payload = {
      name: val('f-name'), phone: val('f-phone'), department: val('f-department'),
      start_date: val('f-start') || null, birthday: val('f-birthday') || null, status: val('f-status')
    };
    if (id) await api(`/api/employees/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await api('/api/employees', { method: 'POST', body: JSON.stringify(payload) });
    closeModal();
    loadEmployees();
  });
}

// ---------- Pending approvals ----------
async function loadPending() {
  const rows = await api('/api/transactions?status=pending');
  const tbody = document.querySelector('#pending-table tbody');
  setPendingCount(rows.length);
  tbody.innerHTML = rows.map(t => `
    <tr>
      <td class="strong nowrap">${esc(t.employee_name)}</td>
      <td class="request">${requestCell(t, true)}</td>
      <td class="num strong">${fmtPoints(t.points)}</td>
      <td>${esc(t.nominated_by) || '<span class="dim">—</span>'}</td>
      <td class="nowrap dim">${fmtDateTime(t.created_at)}</td>
      <td class="actions">
        <button class="small" onclick="approveTx(${t.id})">Approve</button>
        <button class="small deny" onclick="denyTx(${t.id})">Deny</button>
      </td>
    </tr>`).join('') || emptyRow(6, 'Nothing pending. You’re all caught up.');
}

async function refreshPendingCount() {
  try { setPendingCount((await api('/api/transactions?status=pending')).length); } catch (e) {}
}
function setPendingCount(n) {
  const el = document.getElementById('pending-count');
  el.textContent = n;
  el.classList.toggle('hidden', !n);
}

async function approveTx(id) {
  const approved_by = prompt('Your name (for the record):');
  if (approved_by === null) return; // Cancel
  try {
    await api(`/api/transactions/${id}/approve`, { method: 'POST', body: JSON.stringify({ approved_by }) });
  } catch (e) {
    if (e.message !== 'unauthorized') alert(e.message);
  }
  loadPending();
}
async function denyTx(id) {
  const approved_by = prompt('Your name (for the record):');
  if (approved_by === null) return; // Cancel
  const reason = prompt('Reason for denying (optional):') || '';
  try {
    await api(`/api/transactions/${id}/deny`, { method: 'POST', body: JSON.stringify({ approved_by, reason }) });
  } catch (e) {
    if (e.message !== 'unauthorized') alert(e.message);
  }
  loadPending();
}

function openAwardForm() {
  showModal('Nominate an Award', `
    ${field('f-employee', 'Employee', `<select id="f-employee">${employeesCache.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select>`)}
    <div class="field-row">
      ${field('f-reason', 'Reason', `<input id="f-reason" placeholder="Safety Champ, Above + Beyond…">`)}
      ${field('f-points', 'Points', `<input id="f-points" type="number" value="50">`)}
    </div>
    ${field('f-notes', 'Notes', `<textarea id="f-notes"></textarea>`)}
    ${field('f-nominated', 'Your Name', `<input id="f-nominated">`)}
  `, async () => {
    await api('/api/transactions/award', { method: 'POST', body: JSON.stringify({
      employee_id: Number(val('f-employee')), reason: val('f-reason'),
      points: Number(val('f-points')), notes: val('f-notes'), nominated_by: val('f-nominated')
    })});
    closeModal();
    loadPending();
  });
}

// ---------- Rewards ----------
async function loadRewards() {
  rewardsCache = await api('/api/rewards');
  const tbody = document.querySelector('#rewards-table tbody');
  tbody.innerHTML = rewardsCache.map(r => `
    <tr>
      <td class="strong">${esc(r.reward)}</td>
      <td class="num strong">${fmtNum(r.point_cost)}</td>
      <td class="num">${fmtMoney(r.dollar_value)}</td>
      <td class="dim">${esc(r.description)}</td>
      <td>${r.active ? '<span class="tag ok">Active</span>' : '<span class="tag off">Inactive</span>'}</td>
      <td class="actions"><button class="link" onclick="openRewardForm(${r.id})">Edit</button></td>
    </tr>`).join('') || emptyRow(6, 'No rewards yet. Add one so employees have something to redeem.');
}

function openRewardForm(id) {
  const r = id ? rewardsCache.find(x => x.id === id) : {};
  showModal(id ? 'Edit Reward' : 'Add Reward', `
    ${field('f-reward', 'Reward Name', `<input id="f-reward" value="${esc(r.reward)}">`)}
    <div class="field-row">
      ${field('f-cost', 'Point Cost', `<input id="f-cost" type="number" value="${esc(r.point_cost)}">`)}
      ${field('f-dollar', 'Dollar Value', `<input id="f-dollar" type="number" value="${esc(r.dollar_value)}">`)}
    </div>
    ${field('f-desc', 'Description', `<textarea id="f-desc">${esc(r.description)}</textarea>`)}
    ${field('f-fulfill', 'Fulfillment Instructions', `<textarea id="f-fulfill">${esc(r.fulfillment_instructions)}</textarea>`)}
    ${field('f-active', 'Active', `<select id="f-active"><option value="true" ${r.active !== false ? 'selected' : ''}>Yes</option><option value="false" ${r.active === false ? 'selected' : ''}>No</option></select>`)}
  `, async () => {
    const payload = {
      reward: val('f-reward'), point_cost: Number(val('f-cost')), dollar_value: Number(val('f-dollar')) || null,
      description: val('f-desc'), fulfillment_instructions: val('f-fulfill'), active: val('f-active') === 'true'
    };
    if (id) await api(`/api/rewards/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await api('/api/rewards', { method: 'POST', body: JSON.stringify(payload) });
    closeModal();
    loadRewards();
  });
}

// ---------- Recognition rules ----------
let rulesCache = [];
async function loadRules() {
  rulesCache = await api('/api/recognition-rules');
  const tbody = document.querySelector('#rules-table tbody');
  tbody.innerHTML = rulesCache.map(r => `
    <tr>
      <td class="strong">${esc(r.event)}</td>
      <td class="num strong">${fmtNum(r.points)}</td>
      <td class="num">${fmtMoney(r.dollar_value)}</td>
      <td class="actions"><button class="link" onclick="openRuleForm(${r.id})">Edit</button></td>
    </tr>`).join('') || emptyRow(4, 'No rules yet. Add one for each anniversary or milestone you reward.');
}

function openRuleForm(id) {
  const r = id ? rulesCache.find(x => x.id === id) : {};
  showModal(id ? 'Edit Rule' : 'Add Rule', `
    ${field('f-event', 'Event Name', `<input id="f-event" value="${esc(r.event)}">`)}
    <div class="field-row">
      ${field('f-rpoints', 'Points', `<input id="f-rpoints" type="number" value="${esc(r.points)}">`)}
      ${field('f-rdollar', 'Dollar Value', `<input id="f-rdollar" type="number" value="${esc(r.dollar_value)}">`)}
    </div>
  `, async () => {
    const payload = { event: val('f-event'), points: Number(val('f-rpoints')), dollar_value: Number(val('f-rdollar')) || null };
    if (id) await api(`/api/recognition-rules/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await api('/api/recognition-rules', { method: 'POST', body: JSON.stringify(payload) });
    closeModal();
    loadRules();
  });
}

// ---------- Log ----------
async function loadLog() {
  const rows = await api('/api/transactions');
  const tbody = document.querySelector('#log-table tbody');
  tbody.innerHTML = rows.map(t => `
    <tr>
      <td class="nowrap dim">${fmtDateTime(t.created_at)}</td>
      <td class="strong nowrap">${esc(t.employee_name)}</td>
      <td class="request">${requestCell(t, false)}</td>
      <td class="num strong">${fmtPoints(t.points)}</td>
      <td>${statusTag(t.status)}</td>
      <td>${esc(t.nominated_by)}</td>
      <td>${esc(t.approved_by)}</td>
    </tr>`).join('') || emptyRow(7, 'No transactions yet.');
}

// ---------- Table cell helpers ----------
const STATUS_TONE = { active: 'ok', approved: 'ok', pending: 'warn', inactive: 'off', denied: 'off' };
function statusTag(s) {
  if (!s) return '';
  return `<span class="tag ${STATUS_TONE[String(s).toLowerCase()] || 'off'}">${esc(s)}</span>`;
}
function requestCell(t, withNotes) {
  const notes = withNotes && t.notes ? `<span class="sub-line">${esc(t.notes)}</span>` : '';
  return `<span class="type ${esc(t.type)}">${esc(t.type)}</span>${esc(t.reason)}${notes}`;
}
function emptyRow(cols, msg) { return `<tr><td colspan="${cols}" class="empty">${msg}</td></tr>`; }
function fmtNum(n) { return n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString(); }
function fmtPoints(n) {
  if (n === null || n === undefined) return '';
  n = Number(n);
  return n < 0 ? `<span class="neg">−${Math.abs(n).toLocaleString()}</span>` : `+${n.toLocaleString()}`;
}
function fmtMoney(v) {
  return v === null || v === undefined || v === '' ? '' : '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function field(id, label, control) {
  return `<div class="field"><label for="${id}">${label}</label>${control}</div>`;
}

// ---------- Modal helpers ----------
function showModal(title, bodyHtml, onSave) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  const saveBtn = document.getElementById('modal-save');
  saveBtn.textContent = 'Save';
  saveBtn.onclick = async () => {
    try { await onSave(); } catch (e) { if (e.message !== 'unauthorized') alert(e.message); }
  };
  document.getElementById('modal-backdrop').classList.remove('hidden');
  const first = document.querySelector('#modal-body input, #modal-body select, #modal-body textarea');
  if (first) first.focus();
}
function closeModal() { document.getElementById('modal-backdrop').classList.add('hidden'); }
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !document.getElementById('modal-backdrop').classList.contains('hidden')) closeModal();
});
function val(id) { return document.getElementById(id).value; }

// Escapes text before it's inserted into the page, so a name or note
// containing < > " & shows up as text instead of being run as HTML.
function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Birthdays and start dates arrive as plain 'YYYY-MM-DD'. Build the Date from
// its parts (local time) — new Date('YYYY-MM-DD') means midnight UTC, which
// shows as the previous day in Ottawa.
function fmtDate(d) {
  if (!d) return '';
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString();
}
function fmtDateTime(d) {
  return d ? new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
}
function dateInputVal(d) { return d ? String(d).slice(0, 10) : ''; }

// ---------- Boot ----------
if (PASSCODE) {
  api('/api/employees').then(() => {
    document.getElementById('passcode-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    initApp();
  }).catch(() => {});
} else {
  showPasscodeScreen();
}
