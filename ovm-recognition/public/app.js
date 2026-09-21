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
    // showPasscodeScreen already ran via the 401 handler
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
}

// ---------- Employees ----------
async function loadEmployees() {
  employeesCache = await api('/api/employees');
  const tbody = document.querySelector('#employees-table tbody');
  tbody.innerHTML = employeesCache.map(e => `
    <tr>
      <td>${e.name}</td>
      <td>${e.department || ''}</td>
      <td>${e.phone || ''}</td>
      <td>${fmtDate(e.start_date)}</td>
      <td>${fmtDate(e.birthday)}</td>
      <td>${e.status}</td>
      <td>${e.current_points}</td>
      <td>${e.lifetime_points}</td>
      <td><button class="small" onclick="openEmployeeForm(${e.id})">Edit</button></td>
    </tr>`).join('');
}

function openEmployeeForm(id) {
  const emp = id ? employeesCache.find(e => e.id === id) : {};
  showModal(id ? 'Edit Employee' : 'Add Employee', `
    <label>Name</label><input id="f-name" value="${emp.name || ''}">
    <label>Phone (e.g. +16135551234)</label><input id="f-phone" value="${emp.phone || ''}">
    <label>Department</label><input id="f-department" value="${emp.department || ''}">
    <label>Start Date</label><input id="f-start" type="date" value="${dateInputVal(emp.start_date)}">
    <label>Birthday</label><input id="f-birthday" type="date" value="${dateInputVal(emp.birthday)}">
    <label>Status</label>
    <select id="f-status">
      <option ${emp.status !== 'Inactive' ? 'selected' : ''}>Active</option>
      <option ${emp.status === 'Inactive' ? 'selected' : ''}>Inactive</option>
    </select>
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
  tbody.innerHTML = rows.map(t => `
    <tr>
      <td>${t.employee_name}</td>
      <td>${t.type}</td>
      <td>${t.reason}</td>
      <td>${t.points}</td>
      <td>${t.notes || ''}</td>
      <td>${fmtDateTime(t.created_at)}</td>
      <td>
        <button class="small" onclick="approveTx(${t.id})">Approve</button>
        <button class="small deny" onclick="denyTx(${t.id})">Deny</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="7">Nothing pending.</td></tr>';
}

async function approveTx(id) {
  const approved_by = prompt('Your name (for the record):') || '';
  await api(`/api/transactions/${id}/approve`, { method: 'POST', body: JSON.stringify({ approved_by }) });
  loadPending();
}
async function denyTx(id) {
  const approved_by = prompt('Your name (for the record):') || '';
  const reason = prompt('Reason for denying (optional):') || '';
  await api(`/api/transactions/${id}/deny`, { method: 'POST', body: JSON.stringify({ approved_by, reason }) });
  loadPending();
}

function openAwardForm() {
  showModal('Nominate an Award', `
    <label>Employee</label>
    <select id="f-employee">${employeesCache.map(e => `<option value="${e.id}">${e.name}</option>`).join('')}</select>
    <label>Reason (e.g. "Safety Champ", "Above + Beyond")</label><input id="f-reason">
    <label>Points</label><input id="f-points" type="number" value="50">
    <label>Notes</label><textarea id="f-notes"></textarea>
    <label>Your Name</label><input id="f-nominated">
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
      <td>${r.reward}</td><td>${r.point_cost}</td><td>${r.dollar_value ?? ''}</td>
      <td>${r.description || ''}</td><td>${r.active ? 'Yes' : 'No'}</td>
      <td><button class="small" onclick="openRewardForm(${r.id})">Edit</button></td>
    </tr>`).join('');
}

function openRewardForm(id) {
  const r = id ? rewardsCache.find(x => x.id === id) : {};
  showModal(id ? 'Edit Reward' : 'Add Reward', `
    <label>Reward Name</label><input id="f-reward" value="${r.reward || ''}">
    <label>Point Cost</label><input id="f-cost" type="number" value="${r.point_cost || ''}">
    <label>Dollar Value</label><input id="f-dollar" type="number" value="${r.dollar_value || ''}">
    <label>Description</label><textarea id="f-desc">${r.description || ''}</textarea>
    <label>Fulfillment Instructions</label><textarea id="f-fulfill">${r.fulfillment_instructions || ''}</textarea>
    <label>Active</label>
    <select id="f-active"><option value="true" ${r.active !== false ? 'selected' : ''}>Yes</option><option value="false" ${r.active === false ? 'selected' : ''}>No</option></select>
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
      <td>${r.event}</td><td>${r.points}</td><td>${r.dollar_value ?? ''}</td>
      <td><button class="small" onclick="openRuleForm(${r.id})">Edit</button></td>
    </tr>`).join('');
}

function openRuleForm(id) {
  const r = id ? rulesCache.find(x => x.id === id) : {};
  showModal(id ? 'Edit Rule' : 'Add Rule', `
    <label>Event Name</label><input id="f-event" value="${r.event || ''}">
    <label>Points</label><input id="f-rpoints" type="number" value="${r.points || ''}">
    <label>Dollar Value</label><input id="f-rdollar" type="number" value="${r.dollar_value || ''}">
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
      <td>${fmtDateTime(t.created_at)}</td><td>${t.employee_name}</td><td>${t.type}</td>
      <td>${t.reason}</td><td>${t.points}</td><td>${t.status}</td><td>${t.approved_by || ''}</td>
    </tr>`).join('');
}

// ---------- Modal helpers ----------
function showModal(title, bodyHtml, onSave) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  const saveBtn = document.getElementById('modal-save');
  saveBtn.textContent = 'Save';
  saveBtn.onclick = async () => {
    try { await onSave(); } catch (e) { alert(e.message); }
  };
  document.getElementById('modal-backdrop').classList.remove('hidden');
}
function closeModal() { document.getElementById('modal-backdrop').classList.add('hidden'); }
function val(id) { return document.getElementById(id).value; }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString() : ''; }
function fmtDateTime(d) { return d ? new Date(d).toLocaleString() : ''; }
function dateInputVal(d) { return d ? new Date(d).toISOString().slice(0, 10) : ''; }

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
