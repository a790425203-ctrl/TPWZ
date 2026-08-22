'use strict';

/* 管理员配置页逻辑
   v2 表单：移除 max_preset_per_theme / max_nominations_per_theme 字段
   （组合上限由 total_meeting_rooms 统一决定），保留站点标题、总名额、提名框数、时间窗、两套预设名称。 */

const ADMIN_TOKEN_KEY = 'mrv_admin_token';

function showToast(msg, type) {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = 'toast ' + (type || 'info');
  t.textContent = msg;
  c.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3500);
}

function adminToken() { return localStorage.getItem(ADMIN_TOKEN_KEY) || ''; }
function showGate() {
  document.getElementById('admin-gate').hidden = false;
  document.getElementById('admin-panel').hidden = true;
  const dataSection = document.getElementById('admin-data');
  if (dataSection) dataSection.hidden = true;
}
function showPanel() {
  document.getElementById('admin-gate').hidden = true;
  document.getElementById('admin-panel').hidden = false;
  const dataSection = document.getElementById('admin-data');
  if (dataSection) dataSection.hidden = false;
}

function toLocalInput(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
    'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function fromLocalInput(v) {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function fillForm(a) {
  document.getElementById('f-title').value = a.site_title || '';
  document.getElementById('f-rooms').value = a.total_meeting_rooms;
  document.getElementById('f-maxinputs').value = a.max_nomination_inputs || 5;
  document.getElementById('f-start').value = toLocalInput(a.voting_start_at);
  document.getElementById('f-end').value = toLocalInput(a.voting_end_at);
  document.getElementById('f-galaxy').value = (a.galaxy_presets || []).join('\n');
  document.getElementById('f-landscape').value = (a.landscape_presets || []).join('\n');
}

function readForm() {
  const lines = (v) => v.split('\n').map((s) => s.trim()).filter(Boolean);
  const start = fromLocalInput(document.getElementById('f-start').value);
  const end = fromLocalInput(document.getElementById('f-end').value);
  const payload = {
    site_title: document.getElementById('f-title').value.trim(),
    total_meeting_rooms: Number(document.getElementById('f-rooms').value),
    max_nomination_inputs: Number(document.getElementById('f-maxinputs').value),
    galaxy_presets: lines(document.getElementById('f-galaxy').value),
    landscape_presets: lines(document.getElementById('f-landscape').value),
  };
  if (start) payload.voting_start_at = start;
  if (end) payload.voting_end_at = end;
  return payload;
}

async function loadPanel() {
  const activity = await Api.getActivity();
  fillForm(activity);
  showPanel();
  await loadUsers();
}

const THEME_LABELS = { galaxy: 'Galaxy', landscape: 'Natural Landscape' };

async function loadUsers() {
  try {
    const res = await Api.adminListUsers(adminToken());
    const users = res.users || [];
    document.getElementById('user-count').textContent = users.length;
    const list = document.getElementById('user-list');
    if (users.length === 0) {
      list.innerHTML = '<p class="muted" id="user-empty">No voters yet.</p>';
      return;
    }
    list.innerHTML = users.map((u) => {
      const theme = u.chosen_theme ? THEME_LABELS[u.chosen_theme] : '—';
      const status = u.has_voted
        ? '<span class="tag tag-voted">Voted</span>'
        : '<span class="tag tag-idle">Chose theme only</span>';
      return '' +
        '<div class="user-row" data-name="' + escAttr(u.fullname) + '">' +
          '<div class="user-meta">' +
            '<span class="user-name">' + escHtml(u.fullname) + '</span>' +
            '<span class="user-theme">Theme: ' + escHtml(theme) + '</span>' +
            status +
          '</div>' +
          '<button class="btn btn-danger btn-sm" data-role="del-user">Delete</button>' +
        '</div>';
    }).join('');
  } catch (e) {
    if (e.status === 401) { localStorage.removeItem(ADMIN_TOKEN_KEY); showGate(); }
  }
}

function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escAttr(s) { return escHtml(s); }

async function deleteUser(fullname) {
  if (!confirm('Delete voter "' + fullname + '"?\nThis removes their theme choice and all name votes. This cannot be undone.')) return;
  try {
    const res = await Api.adminDeleteUser(fullname, adminToken());
    showToast('Deleted ' + fullname + '.', 'success');
    await loadUsers();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function clearAll() {
  if (!confirm('Clear ALL votes and test data?\nEvery user, theme choice and name vote will be permanently deleted, and the ranking reset to zero. The activity settings remain. This cannot be undone.')) return;
  try {
    await Api.adminClearAll(adminToken());
    showToast('All votes cleared.', 'success');
    await loadUsers();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

document.getElementById('admin-login-btn').addEventListener('click', async () => {
  const pw = document.getElementById('admin-password').value;
  const errEl = document.getElementById('admin-error');
  errEl.textContent = '';
  try {
    const res = await Api.adminLogin(pw);
    localStorage.setItem(ADMIN_TOKEN_KEY, res.token);
    document.getElementById('admin-password').value = '';
    showToast('Admin access granted.', 'success');
    await loadPanel();
  } catch (e) { errEl.textContent = e.message; }
});
document.getElementById('admin-password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('admin-login-btn').click();
});

document.getElementById('save-btn').addEventListener('click', async () => {
  const errEl = document.getElementById('save-error');
  errEl.textContent = '';
  try {
    const updated = await Api.updateActivity(readForm(), adminToken());
    fillForm(updated);
    showToast('Configuration saved.', 'success');
  } catch (e) {
    if (e.status === 401) {
      localStorage.removeItem(ADMIN_TOKEN_KEY);
      showGate();
      showToast('Admin session expired. Please sign in again.', 'error');
    } else {
      errEl.textContent = e.message;
      showToast(e.message, 'error');
    }
  }
});

document.getElementById('logout-admin-btn').addEventListener('click', () => {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  showGate();
  showToast('Signed out.', 'info');
});

document.getElementById('clear-all-btn').addEventListener('click', clearAll);
document.getElementById('user-list').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-role="del-user"]');
  if (!btn) return;
  const row = btn.closest('.user-row');
  const name = row && row.getAttribute('data-name');
  if (name) deleteUser(name);
});

async function init() {
  const token = adminToken();
  if (!token) { showGate(); return; }
  try {
    await Api.adminCheck(token);
    await loadPanel();
  } catch {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    showGate();
  }
}
init();