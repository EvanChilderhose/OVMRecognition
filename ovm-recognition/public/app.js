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
  if (tab === 'texts') loadTexts();
  if (tab === 'log') loadLog();
}

// ---------- Texts ----------
let textsCache = [];

async function loadTexts() {
  textsCache = await api('/api/texts');
  const groups = [];
  for (const t of textsCache) {
    let g = groups.find(x => x.name === t.group);
    if (!g) groups.push(g = { name: t.group, items: [] });
    g.items.push(t);
  }
  document.getElementById('texts-list').innerHTML = groups.map(g => `
    <h3 class="texts-group">${esc(g.name)}</h3>
    ${g.items.map(t => `
      <article class="text-card${t.enabled ? '' : ' off'}" id="text-${t.key}">
        <header class="text-head">
          <div>
            <h4>${esc(t.label)} ${t.customized ? '<span class="tag warn">Edited</span>' : ''}</h4>
            <p class="text-when">${esc(t.when)}</p>
          </div>
          <label class="switch" title="${t.enabled ? 'On' : 'Off'}">
            <input type="checkbox" ${t.enabled ? 'checked' : ''} onchange="saveText('${t.key}')" aria-label="Send this text">
            <span class="switch-track"></span><span class="switch-label">${t.enabled ? 'On' : 'Off'}</span>
          </label>
        </header>
        <textarea id="body-${t.key}" rows="3" oninput="updateTextPreview('${t.key}')">${esc(t.body)}</textarea>
        <div class="text-meta">
          <span class="text-fields">${t.placeholders.length ? 'Fill-ins: ' + t.placeholders.map(p => `<code>{${esc(p)}}</code>`).join(' ') : 'No fill-ins'}</span>
          <span class="text-count" id="count-${t.key}"></span>
        </div>
        <div class="text-preview" id="preview-${t.key}"></div>
        <div class="text-actions">
          <button class="small" onclick="saveText('${t.key}')">Save</button>
          <button class="small secondary" onclick="testText('${t.key}')">Send me a test</button>
          ${t.customized ? `<button class="small link" onclick="resetText('${t.key}')">Reset to default</button>` : ''}
          <span class="text-status" id="status-${t.key}" role="status"></span>
        </div>
      </article>`).join('')}`).join('');
  textsCache.forEach(t => updateTextPreview(t.key));
}

// Live preview with sample details, like the employee would see it
function updateTextPreview(key) {
  const t = textsCache.find(x => x.key === key);
  const body = document.getElementById(`body-${key}`).value;
  const vars = { first_name: 'Sam', balance: 300, lifetime: 450, ...t.sample };
  let text = body.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
  if (t.to_employee) {
    const footer = textsCache.find(x => x.key === 'profile_footer');
    const footerBody = document.getElementById('body-profile_footer')?.value || footer.body;
    if (footer.enabled) text += '\n\n' + footerBody.replace('{profile_link}', footer.sample.profile_link);
  }
  document.getElementById(`preview-${key}`).textContent = text;
  // SMS parts: plain texts fit 160 characters (153 per part when split). Any emoji or
  // other special character switches the whole text to 70 (67 per part).
  const plain = /^[A-Za-z0-9 \n\r@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/.test(text);
  const units = [...text].length + (plain ? (text.match(/[\^{}\\[~\]|€]/g) || []).length : 0);
  const [single, multi] = plain ? [160, 153] : [70, 67];
  const parts = units <= single ? 1 : Math.ceil(units / multi);
  document.getElementById(`count-${key}`).textContent =
    `${units} characters${plain ? '' : ' (has emoji)'}${parts > 1 ? ` · sends as ${parts} parts` : ''}`;
}

function textStatus(key, msg, isError) {
  const el = document.getElementById(`status-${key}`);
  el.textContent = msg;
  el.classList.toggle('error', !!isError);
  if (!isError) setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 3000);
}

async function saveText(key) {
  const card = document.getElementById(`text-${key}`);
  const enabled = card.querySelector('input[type=checkbox]').checked;
  try {
    await api(`/api/texts/${key}`, { method: 'PUT', body: JSON.stringify({ body: document.getElementById(`body-${key}`).value, enabled }) });
    await loadTexts();
    textStatus(key, enabled ? 'Saved' : 'Saved — this text is switched off');
  } catch (e) {
    if (e.message !== 'unauthorized') textStatus(key, e.message, true);
  }
}

async function resetText(key) {
  if (!confirm('Go back to the original wording for this text?')) return;
  try {
    await api(`/api/texts/${key}/reset`, { method: 'POST' });
    await loadTexts();
    textStatus(key, 'Back to the original wording');
  } catch (e) {
    if (e.message !== 'unauthorized') textStatus(key, e.message, true);
  }
}

async function testText(key) {
  textStatus(key, 'Sending…');
  try {
    await api(`/api/texts/${key}/test`, { method: 'POST' });
    textStatus(key, 'Sent to your phone (saved wording, sample details)');
  } catch (e) {
    if (e.message !== 'unauthorized') textStatus(key, e.message, true);
  }
}

function initApp() {
  setupTabs();
  loadEmployees();
  refreshPendingCount();
  loadEmployeeOfMonthStatus();
}

// ---------- Monthly results import ----------
let importState = null;

function openImportForm() {
  importState = null;
  showModal('Import monthly results', `
    <p class="hint-text">Choose the results file from this month's /monthly-awards run (e.g. <code>monthly-results-2026-10.csv</code>).
      Nothing changes until you press Import.</p>
    ${field('f-import-file', 'Results file', '<input id="f-import-file" type="file" accept=".csv,text/csv" onchange="previewImport(this)">')}
    <div id="import-preview"></div>
  `, async () => {
    if (!importState) throw new Error('Choose the results file first.');
    const rows = importState.rows.map((r, i) => ({
      employee_id: Number(document.getElementById(`imp-emp-${i}`).value) || null,
      shifts: r.shifts,
      awards: r.awards.filter(a => a.ok).map(a => a.name)
    }));
    const unmatched = rows.filter((r, i) => !r.employee_id && (importState.rows[i].awards.length || importState.rows[i].shifts)).length;
    if (unmatched && !confirm(`${unmatched} line(s) aren't matched to an employee and will be skipped. Import the rest?`)) return;
    const s = await api('/api/monthly/import', { method: 'POST', body: JSON.stringify({ period: importState.period, rows }) });
    closeModal();
    refreshPendingCount();
    if (!document.getElementById('tab-pending').classList.contains('hidden')) loadPending();
    loadEmployees();
    alert(`Imported ${importState.label}:\n• ${s.awards} award(s) added to Pending Approvals${s.skipped ? ` (${s.skipped} already given, skipped)` : ''}\n• Shifts updated for ${s.shifts} employee(s)` +
      (s.milestones.length ? `\n• Shift milestones reached: ${s.milestones.join(', ')}` : '') +
      `\n\nApprove the awards in Pending Approvals to send each person their text.`);
  });
  document.querySelector('.modal').classList.add('wide');
  document.getElementById('modal-save').textContent = 'Import';
}

async function previewImport(input) {
  const file = input.files && input.files[0];
  const box = document.getElementById('import-preview');
  if (!file) return;
  try {
    const csv = await file.text();
    importState = await api('/api/monthly/import/preview', { method: 'POST', body: JSON.stringify({ csv }) });
  } catch (e) {
    importState = null;
    if (e.message !== 'unauthorized') box.innerHTML = `<p class="import-error">${esc(e.message)}</p>`;
    return;
  }
  const opts = sel => `<option value="">— Skip this line —</option>` +
    importState.employees.map(e => `<option value="${e.id}" ${e.id === sel ? 'selected' : ''}>${esc(e.name)}</option>`).join('');
  const awardsTotal = importState.rows.reduce((n, r) => n + r.awards.filter(a => a.ok).length, 0);
  box.innerHTML = `
    <div class="import-summary">
      <strong>${esc(importState.label)}</strong> · ${importState.rows.length} employees · ${awardsTotal} awards
      ${importState.previously_imported ? '<span class="tag warn">Imported before — shifts will be replaced, awards already given are skipped</span>' : ''}
    </div>
    <div class="table-wrap import-table">
      <table>
        <thead><tr><th>In the file</th><th>Employee in the app</th><th class="num">Shifts</th><th>Awards</th></tr></thead>
        <tbody>${importState.rows.map((r, i) => `
          <tr${r.employee_id ? '' : ' class="unmatched"'}>
            <td>${esc(r.name)}${r.problems.map(p => `<span class="sub-line import-error">${esc(p)}</span>`).join('')}</td>
            <td><select id="imp-emp-${i}" aria-label="Employee for ${esc(r.name)}">${opts(r.employee_id)}</select>
              ${r.employee_id ? '' : '<span class="sub-line import-error">No match — pick them, or add them under Employees first</span>'}</td>
            <td class="num">${r.shifts === null ? '—' : r.shifts}</td>
            <td>${r.awards.length ? r.awards.map(a => a.ok
              ? `<span class="type">${esc(a.name)} · ${a.points}</span>`
              : `<span class="type bad" title="${esc(a.problem)}">${esc(a.name)} — ${esc(a.problem)}</span>`).join(' ') : '<span class="dim">—</span>'}</td>
          </tr>`).join('')}</tbody>
      </table>
    </div>`;
}

// ---------- Employee of the Month ----------
let eotmStatus = null;

async function loadEmployeeOfMonthStatus() {
  try {
    eotmStatus = await api('/api/monthly/employee-of-the-month');
    document.getElementById('eotm-banner-title').textContent = `Time to pick Employee of the Month for ${eotmStatus.label}`;
    if (eotmStatus.points) document.getElementById('eotm-banner-points').textContent = eotmStatus.points;
    document.getElementById('eotm-banner').classList.toggle('hidden', !eotmStatus.due);
  } catch (e) { /* the banner is optional — never block the dashboard */ }
}

// The month being chosen for, plus the two before it (in case one was missed)
function eotmMonthOptions(period) {
  const [y, m] = period.split('-').map(Number);
  return [0, 1, 2].map(back => {
    const d = new Date(y, m - 1 - back, 15);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return { value, label: d.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' }) };
  });
}

function toggleEotmOther() {
  const other = val('f-eotm-employee') === 'other';
  document.getElementById('eotm-other').classList.toggle('hidden', !other);
  document.getElementById('eotm-points-note').classList.toggle('hidden', other);
  document.getElementById('modal-save').textContent = other ? 'Record it' : 'Award & send text';
  if (other) document.getElementById('f-eotm-name').focus();
}

async function openEmployeeOfMonthForm() {
  try {
    if (!eotmStatus) eotmStatus = await api('/api/monthly/employee-of-the-month');
    if (!employeesCache.length) employeesCache = await api('/api/employees');
  } catch (e) {
    if (e.message !== 'unauthorized') alert(e.message);
    return;
  }
  const active = employeesCache.filter(e => e.status !== 'Inactive');
  const recent = eotmStatus.recent.length
    ? `<p class="hint-text">Recent winners: ${eotmStatus.recent.map(r => `${esc(r.label)} — ${esc(r.winner_name)}`).join(' · ')}</p>`
    : '';
  showModal('Employee of the Month', `
    ${field('f-eotm-period', 'Month', `<select id="f-eotm-period">${eotmMonthOptions(eotmStatus.period).map(o => `<option value="${o.value}">${esc(o.label)}</option>`).join('')}</select>`)}
    ${field('f-eotm-employee', 'Employee', `
      <select id="f-eotm-employee" onchange="toggleEotmOther()">
        <option value="">Choose an employee…</option>
        ${active.map(e => `<option value="${e.id}">${esc(e.name)}${e.department ? ` — ${esc(e.department)}` : ''}</option>`).join('')}
        <option value="other">Other — not in the rewards program</option>
      </select>`)}
    <div id="eotm-other" class="other-box hidden">
      <p class="hint-text">The month is marked as done, but no points are given and no text is sent.</p>
      ${field('f-eotm-name', 'Who <span class="hint">(optional, for the record)</span>', '<input id="f-eotm-name">')}
    </div>
    ${field('f-eotm-note', 'Why they won <span class="hint">(optional, for the record)</span>', '<textarea id="f-eotm-note"></textarea>')}
    ${field('f-eotm-by', 'Your Name', '<input id="f-eotm-by">')}
    <p class="hint-text" id="eotm-points-note">${eotmStatus.points || 100} points are added right away and they get a text with their profile link.</p>
    ${recent}
  `, async () => {
    const choice = val('f-eotm-employee');
    if (!choice) throw new Error('Choose an employee, or pick "Other — not in the rewards program".');
    const payload = { period: val('f-eotm-period'), awarded_by: val('f-eotm-by'), note: val('f-eotm-note') };
    if (choice === 'other') { payload.other = true; payload.other_name = val('f-eotm-name'); }
    else payload.employee_id = Number(choice);
    const result = await api('/api/monthly/employee-of-the-month', { method: 'POST', body: JSON.stringify(payload) });
    closeModal();
    eotmStatus = null;
    await loadEmployeeOfMonthStatus();
    loadEmployees();
    alert(result.in_program
      ? `${result.winner} is Employee of the Month for ${result.label}. They've been texted.`
      : `Recorded: ${result.label}'s Employee of the Month went outside the rewards program. No points or text.`);
  });
  document.getElementById('modal-save').textContent = 'Award & send text';
  document.getElementById('f-eotm-employee').focus();
}

// ---------- Employees ----------
async function loadEmployees() {
  employeesCache = await api('/api/employees');
  const toWelcome = employeesCache.filter(e => e.status !== 'Inactive' && e.phone && !e.welcomed_at).length;
  const wbtn = document.getElementById('welcome-all-btn');
  wbtn.textContent = `Send welcome texts (${toWelcome})`;
  wbtn.classList.toggle('hidden', !toWelcome);
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
    ${emp.profile_token ? `
    <div class="field profile-link">
      <label for="f-profile">Profile link <span class="hint">— added to every text they get</span></label>
      <div class="link-row">
        <input id="f-profile" readonly value="${esc(profileLink(emp))}">
        <button type="button" class="secondary" onclick="copyProfileLink()">Copy</button>
        <a class="button-link" href="${esc(profileLink(emp))}" target="_blank" rel="noopener noreferrer">Open</a>
      </div>
      <button type="button" class="link reset-link" onclick="resetProfileLink(${emp.id})">Reset link (if it was shared with someone else)</button>
    </div>` : id ? `
    <div class="field profile-link">
      <label>Profile link</label>
      <p class="hint-text">No link yet — one is created automatically with their first text.</p>
      <button type="button" class="secondary create-link" onclick="createProfileLink(${emp.id})">Create profile link now</button>
    </div>` : ''}
    ${id ? `
    <div class="field profile-link">
      <label>Welcome text</label>
      <p class="hint-text" id="welcome-status">${emp.welcomed_at ? `Sent ${esc(fmtDateTime(emp.welcomed_at))}` : 'Not sent yet'}</p>
      ${emp.phone ? `<button type="button" class="secondary create-link" onclick="sendWelcomeText(${emp.id})">${emp.welcomed_at ? 'Resend welcome text' : 'Send welcome text'}</button>` : '<p class="hint-text">Add a phone number to send it.</p>'}
    </div>` : ''}
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

function profileLink(emp) { return `${location.origin}/me/${emp.profile_token}`; }

async function copyProfileLink() {
  const input = document.getElementById('f-profile');
  try { await navigator.clipboard.writeText(input.value); }
  catch (e) { input.select(); document.execCommand('copy'); }
  const btn = document.querySelector('.link-row button');
  btn.textContent = 'Copied';
  setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
}

async function resetProfileLink(id) {
  if (!confirm('Make a new profile link? The old link will stop working right away. Their next text will include the new one.')) return;
  try {
    const emp = await api(`/api/employees/${id}/reset-profile-link`, { method: 'POST' });
    const i = employeesCache.findIndex(e => e.id === id);
    if (i >= 0) employeesCache[i] = emp;
    document.getElementById('f-profile').value = profileLink(emp);
    document.querySelector('.link-row a').href = profileLink(emp);
  } catch (e) {
    if (e.message !== 'unauthorized') alert(e.message);
  }
}

// ---------- Send a message (broadcast) ----------
let bcFooter = null;

function bcRecipients() {
  const people = employeesCache.filter(e => e.status !== 'Inactive' && e.phone);
  const mode = document.querySelector('input[name=bc-mode]:checked').value;
  if (mode === 'all') return people;
  if (mode === 'dept') {
    const depts = [...document.querySelectorAll('.bc-dept:checked')].map(c => c.value);
    return people.filter(e => depts.includes(e.department || 'No department'));
  }
  const ids = [...document.querySelectorAll('.bc-person:checked')].map(c => Number(c.value));
  return people.filter(e => ids.includes(e.id));
}

function bcUpdate() {
  const mode = document.querySelector('input[name=bc-mode]:checked').value;
  document.getElementById('bc-depts').classList.toggle('hidden', mode !== 'dept');
  document.getElementById('bc-people').classList.toggle('hidden', mode !== 'pick');
  const who = bcRecipients();
  const body = document.getElementById('bc-body').value;
  const sample = who[0] || { name: 'Sam Sample', current_points: 300, lifetime_points: 450 };
  const vars = { first_name: sample.name.split(' ')[0], balance: sample.current_points, lifetime: sample.lifetime_points };
  let text = body.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
  if (document.getElementById('bc-link').checked && bcFooter) text += '\n\n' + bcFooter.replace('{profile_link}', location.origin + '/me/…');
  document.getElementById('bc-preview').textContent = text || 'Your message will appear here.';
  document.getElementById('bc-preview-who').textContent = who[0] ? 'Preview for ' + who[0].name : 'Preview';
  const plain = !/[^\x00-\x7F£¥èéùìòÇØøÅåÄÖÑÜßÉäöñüà€]/.test(text);
  const n = [...text].length;
  const parts = n <= (plain ? 160 : 70) ? 1 : Math.ceil(n / (plain ? 153 : 67));
  document.getElementById('bc-count').textContent = n + ' characters' + (parts > 1 ? ' · sends as ' + parts + ' parts' : '');
  document.getElementById('modal-save').textContent = who.length ? 'Send to ' + who.length + (who.length === 1 ? ' person' : ' people') : 'Send';
}

async function openBroadcast() {
  try {
    if (!employeesCache.length) employeesCache = await api('/api/employees');
    if (bcFooter === null) {
      const f = (await api('/api/texts')).find(t => t.key === 'profile_footer');
      bcFooter = f && f.enabled ? f.body : '';
    }
  } catch (e) { if (e.message !== 'unauthorized') alert(e.message); return; }
  const people = employeesCache.filter(e => e.status !== 'Inactive' && e.phone);
  const depts = [...new Set(people.map(e => e.department || 'No department'))].sort();
  const noPhone = employeesCache.filter(e => e.status !== 'Inactive' && !e.phone).length;
  const deptBoxes = depts.map(d => '<label><input type="checkbox" class="bc-dept" value="' + esc(d) + '" onchange="bcUpdate()"> ' + esc(d) +
    ' (' + people.filter(e => (e.department || 'No department') === d).length + ')</label>').join('');
  const personBoxes = people.map(e => '<label><input type="checkbox" class="bc-person" value="' + e.id + '" onchange="bcUpdate()"> ' + esc(e.name) +
    (e.department ? ' <span class="dim">· ' + esc(e.department) + '</span>' : '') + '</label>').join('');
  showModal('Send a message', `
    <div class="field">
      <label>Who gets it</label>
      <div class="bc-modes">
        <label><input type="radio" name="bc-mode" value="all" checked onchange="bcUpdate()"> Everyone (${people.length})</label>
        <label><input type="radio" name="bc-mode" value="dept" onchange="bcUpdate()"> By department</label>
        <label><input type="radio" name="bc-mode" value="pick" onchange="bcUpdate()"> Choose people</label>
      </div>
      <div id="bc-depts" class="bc-list hidden">${deptBoxes}</div>
      <div id="bc-people" class="bc-list hidden">${personBoxes}</div>
      ${noPhone ? '<p class="hint-text">' + noPhone + " active employee(s) have no phone number and won't get it.</p>" : ''}
    </div>
    ${field('bc-body', 'Message <span class="hint">({first_name} is filled in for each person)</span>', '<textarea id="bc-body" rows="4" oninput="bcUpdate()" placeholder="Hi {first_name}! Reminder: team BBQ this Friday at noon."></textarea>')}
    <label class="bc-check"><input type="checkbox" id="bc-link" checked onchange="bcUpdate()"> Add their profile link at the end</label>
    <div>
      <p class="hint-text" id="bc-preview-who">Preview</p>
      <div class="text-preview" id="bc-preview"></div>
      <p class="hint-text" id="bc-count"></p>
    </div>
    <div class="text-actions">
      <button type="button" class="secondary small" onclick="bcTest()">Send me a test first</button>
      <span class="text-status" id="bc-status" role="status"></span>
    </div>
  `, async () => {
    const who = bcRecipients();
    const body = document.getElementById('bc-body').value;
    if (!who.length) throw new Error('Choose who should get the message.');
    if (!body.trim()) throw new Error('Write a message first.');
    if (!confirm('Send this message to ' + who.length + (who.length === 1 ? ' person' : ' people') + '?\n\n' + who.map(e => e.name).join(', '))) return;
    const btn = document.getElementById('modal-save');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      const r = await api('/api/broadcast', { method: 'POST', body: JSON.stringify({ employee_ids: who.map(e => e.id), body, include_link: document.getElementById('bc-link').checked }) });
      closeModal();
      alert('Sent to ' + r.sent + (r.sent === 1 ? ' person.' : ' people.') + (r.failed.length ? "\nDidn't send to: " + r.failed.join(', ') + '.' : ''));
    } finally {
      btn.disabled = false;
      bcUpdate();
    }
  });
  document.querySelector('.modal').classList.add('wide');
  bcUpdate();
  document.getElementById('bc-body').focus();
}

async function bcTest() {
  const status = document.getElementById('bc-status');
  status.textContent = 'Sending…';
  status.classList.remove('error');
  try {
    await api('/api/broadcast/test', { method: 'POST', body: JSON.stringify({ body: document.getElementById('bc-body').value, include_link: document.getElementById('bc-link').checked }) });
    status.textContent = 'Test sent to your phone';
  } catch (e) {
    if (e.message !== 'unauthorized') { status.textContent = e.message; status.classList.add('error'); }
  }
}

async function sendWelcomeText(id) {
  const emp = employeesCache.find(e => e.id === id);
  if (!confirm(`Text the welcome message to ${emp.name} now?`)) return;
  try {
    await api(`/api/employees/${id}/welcome`, { method: 'POST' });
    document.getElementById('welcome-status').textContent = 'Sent just now';
    loadEmployees();
  } catch (e) {
    if (e.message !== 'unauthorized') alert(e.message);
  }
}

async function welcomeAll() {
  const todo = employeesCache.filter(e => e.status !== 'Inactive' && e.phone && !e.welcomed_at);
  if (!confirm(`Text the welcome message to ${todo.length} employee(s) who haven't had it yet?\n\n${todo.map(e => e.name).join(', ')}\n\nTip: also switch the welcome text on (Texts tab) so new hires get it automatically.`)) return;
  try {
    const r = await api('/api/employees/welcome-all', { method: 'POST' });
    alert(`Sent ${r.sent} welcome text(s).` + (r.failed.length ? `\nDidn't send to: ${r.failed.join(', ')} (check texting is set up).` : ''));
    loadEmployees();
  } catch (e) {
    if (e.message !== 'unauthorized') alert(e.message);
  }
}

async function createProfileLink(id) {
  try {
    const emp = await api(`/api/employees/${id}/reset-profile-link`, { method: 'POST' });
    const i = employeesCache.findIndex(e => e.id === id);
    if (i >= 0) employeesCache[i] = emp;
    openEmployeeForm(id); // re-open to show the new link
  } catch (e) {
    if (e.message !== 'unauthorized') alert(e.message);
  }
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
      <td class="strong"><span class="reward-cell">${RewardIcons.picture(r, 'thumb')}${esc(r.reward)}</span></td>
      <td class="num strong">${fmtNum(r.point_cost)}</td>
      <td class="num">${fmtMoney(r.dollar_value)}</td>
      <td class="dim">${esc(r.description)}</td>
      <td>${r.active ? '<span class="tag ok">Active</span>' : '<span class="tag off">Inactive</span>'}</td>
      <td class="actions"><button class="link" onclick="openRewardForm(${r.id})">Edit</button></td>
    </tr>`).join('') || emptyRow(6, 'No rewards yet. Add one so employees have something to redeem.');
}

// Picture choices while the reward form is open. Saved together with the form.
let picState = null;

function renderPicPreview() {
  const r = picState.reward;
  const preview = picState.photoData
    ? `<img class="pic-big photo" src="data:${picState.photoMime};base64,${picState.photoData}" alt="">`
    : RewardIcons.picture({ ...r, reward: val('f-reward'), icon: val('f-icon') || null, has_image: r.has_image && !picState.removePhoto }, 'pic-big');
  document.getElementById('pic-preview').innerHTML = preview;
  const hasPhoto = picState.photoData || (r.has_image && !picState.removePhoto);
  document.getElementById('pic-remove').classList.toggle('hidden', !hasPhoto);
  document.getElementById('pic-icon-row').classList.toggle('dimmed', !!hasPhoto);
}

// Shrinks a photo to at most 800px on its longest side and re-encodes it as JPEG,
// so uploads are small and load quickly on employees' phones.
function shrinkPhoto(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 800 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; // transparent PNGs get a white background
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file couldn\'t be read as a photo. Try a JPEG or PNG.')); };
    img.src = url;
  });
}

async function pickPhoto(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  try {
    picState.photoData = await shrinkPhoto(file);
    picState.photoMime = 'image/jpeg';
    picState.removePhoto = false;
    renderPicPreview();
  } catch (e) {
    alert(e.message);
  }
  input.value = '';
}

function removePhoto() {
  picState.photoData = null;
  picState.removePhoto = true;
  renderPicPreview();
}

function openRewardForm(id) {
  const r = id ? rewardsCache.find(x => x.id === id) : {};
  picState = { reward: r, photoData: null, photoMime: null, removePhoto: false };
  const iconOptions = Object.entries(RewardIcons.ICONS)
    .map(([key, ic]) => `<option value="${key}" ${r.icon === key ? 'selected' : ''}>${ic.label}</option>`).join('');
  showModal(id ? 'Edit Reward' : 'Add Reward', `
    <div class="field">
      <label>Picture <span class="hint">— shown to employees on their profile</span></label>
      <div class="pic-row">
        <div id="pic-preview"></div>
        <div class="pic-controls">
          <div class="pic-buttons">
            <label class="button-link">Upload photo<input type="file" accept="image/*" class="hidden" onchange="pickPhoto(this)"></label>
            <button type="button" class="link hidden" id="pic-remove" onclick="removePhoto()">Remove photo</button>
          </div>
          <div id="pic-icon-row">
            <select id="f-icon" onchange="renderPicPreview()" aria-label="Icon">
              <option value="">Icon: automatic (${esc(RewardIcons.ICONS[RewardIcons.guess(r.reward)].label)})</option>
              ${iconOptions}
            </select>
            <p class="hint-text">The icon is used when there's no photo.</p>
          </div>
        </div>
      </div>
    </div>
    ${field('f-reward', 'Reward Name', `<input id="f-reward" value="${esc(r.reward)}" oninput="renderPicPreview()">`)}
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
      description: val('f-desc'), fulfillment_instructions: val('f-fulfill'), active: val('f-active') === 'true',
      icon: val('f-icon') || null
    };
    const saved = id
      ? await api(`/api/rewards/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
      : await api('/api/rewards', { method: 'POST', body: JSON.stringify(payload) });
    if (picState.photoData) {
      await api(`/api/rewards/${saved.id}/image`, { method: 'PUT', body: JSON.stringify({ data: picState.photoData, mime: picState.photoMime }) });
    } else if (picState.removePhoto) {
      await api(`/api/rewards/${saved.id}/image`, { method: 'DELETE' });
    }
    closeModal();
    loadRewards();
  });
  renderPicPreview();
}

// ---------- Recognition rules ----------
let rulesCache = [];
async function loadRules() {
  rulesCache = await api('/api/recognition-rules');
  const tbody = document.querySelector('#rules-table tbody');
  tbody.innerHTML = rulesCache.map(r => `
    <tr>
      <td class="strong">${esc(r.event)}${r.note ? `<span class="sub-line">${esc(r.note)}</span>` : ''}</td>
      <td class="num strong">${fmtNum(r.points)}</td>
      <td class="num">${fmtMoney(r.dollar_value)}</td>
      <td>${r.show_on_profile !== false ? '<span class="tag ok">Shown</span>' : '<span class="tag off">Hidden</span>'}</td>
      <td class="actions"><button class="link" onclick="openRuleForm(${r.id})">Edit</button></td>
    </tr>`).join('') || emptyRow(5, 'No rules yet. Add one for each anniversary or milestone you reward.');
}

function openRuleForm(id) {
  const r = id ? rulesCache.find(x => x.id === id) : {};
  showModal(id ? 'Edit Rule' : 'Add Rule', `
    ${field('f-event', 'Event Name', `<input id="f-event" value="${esc(r.event)}">`)}
    <div class="field-row">
      ${field('f-rpoints', 'Points', `<input id="f-rpoints" type="number" value="${esc(r.points)}">`)}
      ${field('f-rdollar', 'Dollar Value', `<input id="f-rdollar" type="number" value="${esc(r.dollar_value)}">`)}
    </div>
    ${field('f-rshow', 'Show on employee profiles', `<select id="f-rshow"><option value="true" ${r.show_on_profile !== false ? 'selected' : ''}>Yes — listed under "Earn points"</option><option value="false" ${r.show_on_profile === false ? 'selected' : ''}>No — hidden (not running this award yet)</option></select>`)}
    ${field('f-rnote', 'Note for employees <span class="hint">(optional — shown under this award on their profile)</span>', `<input id="f-rnote" value="${esc(r.note)}" placeholder="e.g. Must work 4+ shifts per week to be eligible">`)}
  `, async () => {
    const payload = { event: val('f-event'), note: val('f-rnote'), points: Number(val('f-rpoints')), dollar_value: Number(val('f-rdollar')) || null, show_on_profile: val('f-rshow') === 'true' };
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
function closeModal() {
  document.getElementById('modal-backdrop').classList.add('hidden');
  document.querySelector('.modal').classList.remove('wide');
}
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
