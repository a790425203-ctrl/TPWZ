'use strict';

/* 首页两步投票逻辑
   第 1 步：每人选择一个主题（galaxy / landscape），首页实时显示比例。
   第 2 步：在已选主题内投票，最多选 total_meeting_rooms 个名字（预设 + 提名）。
   切换主题会自动清除另一主题的投票记录。
*/

const THEME_ICONS = {
  galaxy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 L14 9.5 L22 12 L14 14.5 L12 22 L10 14.5 L2 12 L10 9.5 Z"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg>',
  landscape: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 21 L8 10 L12 14 L16 5 L22 21 Z"/><circle cx="17" cy="4" r="1.5" fill="currentColor" stroke="none"/></svg>',
};

const THEME_LABELS = { galaxy: 'Galaxy', landscape: 'Natural Landscape' };

const state = {
  activity: null,
  stats: { total: 0, galaxy: { count: 0, percent: 0 }, landscape: { count: 0, percent: 0 } },
  user: Api.getUser(),
  choice: null,       // { user_id, chosen_theme, ... }
  myVote: null,       // 当前主题的名字投票
  hasVoted: false,    // 是否已在该主题投过名字票（锁定主题切换）
  cap: 7,
  pendingTheme: null, // 未登录用户点击的主题
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmtDateTime(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '\u2014';
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch { return '\u2014'; }
}

function showToast(msg, type) {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = 'toast ' + (type || 'info');
  t.textContent = msg;
  c.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3500);
}

function renderIdentity() {
  const bar = document.getElementById('identity-bar');
  if (state.user) {
    bar.innerHTML =
      '<span class="identity-who">Voting as <strong>' + esc(state.user.fullname) + '</strong></span>' +
      '<button class="btn btn-ghost btn-sm" id="logout-btn">Sign out</button>';
    bar.querySelector('#logout-btn').addEventListener('click', () => {
      Api.clearSession(); state.user = null; state.choice = null; state.myVote = null; location.reload();
    });
  } else {
    bar.innerHTML =
      '<span class="identity-who">You are not signed in.</span>' +
      '<button class="btn btn-primary btn-sm" id="login-btn">Sign in to vote</button>';
    bar.querySelector('#login-btn').addEventListener('click', openLogin);
  }
}

function renderBanner() {
  const el = document.getElementById('activity-banner');
  const s = state.activity.status;
  if (s === 'VotingOpen') { el.innerHTML = ''; return; }
  const msg = s === 'NotStarted'
    ? 'Voting has not started yet. You can browse the options but cannot submit.'
    : 'Voting has closed. The administrator will select the final meeting room names from the winning theme.';
  el.innerHTML = '<div class="banner ' + (s === 'NotStarted' ? 'banner-warn' : 'banner-closed') + '">' + esc(msg) + '</div>';
}

function updateStatsUI() {
  const g = state.stats.galaxy;
  const l = state.stats.landscape;
  document.getElementById('galaxy-percent-bar').style.width = g.percent + '%';
  document.getElementById('galaxy-percent-text').textContent = g.percent + '%';
  document.getElementById('galaxy-count-text').textContent = g.count + ' vote' + (g.count === 1 ? '' : 's');
  document.getElementById('landscape-percent-bar').style.width = l.percent + '%';
  document.getElementById('landscape-percent-text').textContent = l.percent + '%';
  document.getElementById('landscape-count-text').textContent = l.count + ' vote' + (l.count === 1 ? '' : 's');
}

function showSelectionView() {
  document.getElementById('theme-selection-view').classList.remove('hidden');
  document.getElementById('name-voting-view').classList.add('hidden');
}

function showVotingView(theme) {
  document.getElementById('theme-selection-view').classList.add('hidden');
  document.getElementById('name-voting-view').classList.remove('hidden');
  document.getElementById('chosen-theme-label').textContent = THEME_LABELS[theme];
  document.getElementById('voting-subtitle').className = theme === 'galaxy' ? 'section-subtitle galaxy-text' : 'section-subtitle landscape-text';

  // 已投票：锁定主题切换，隐藏"Change theme"按钮并提示
  const backWrap = document.querySelector('.back-to-themes');
  const changeBtn = document.getElementById('change-theme-btn');
  if (state.hasVoted) {
    if (backWrap) backWrap.classList.add('locked');
    if (changeBtn) { changeBtn.disabled = true; changeBtn.classList.add('disabled'); }
  } else {
    if (backWrap) backWrap.classList.remove('locked');
    if (changeBtn) { changeBtn.disabled = false; changeBtn.classList.remove('disabled'); }
  }

  renderActiveThemeCard(theme);
  if (window.FX) {
    const card = document.getElementById('active-theme-card');
    card.querySelectorAll('.fx-fluid').forEach((c) => c.remove());
    window.FX.fluid(card, theme);
  }
}

function renderActiveThemeCard(theme) {
  const card = document.getElementById('active-theme-card');
  card.className = 'theme-card ' + theme;
  const vote = state.myVote;
  const presets = theme === 'galaxy' ? state.activity.galaxy_presets : state.activity.landscape_presets;
  const cap = state.cap;
  const isOpen = state.activity.status === 'VotingOpen';

  const selected = (vote && vote.selected_preset_names) || [];
  const noms = (vote && vote.user_nominated_names) || [];
  const nomInputs = state.activity.max_nomination_inputs || 5;

  card.innerHTML =
    '<div class="theme-card-head">' +
      '<div class="theme-title-wrap">' +
        '<div class="theme-icon">' + THEME_ICONS[theme] + '</div>' +
        '<div>' +
          '<h2>' + esc(THEME_LABELS[theme]) + ' Theme</h2>' +
          '<p class="theme-hint">Curated names plus your own nominations</p>' +
        '</div>' +
      '</div>' +
      '<span class="badge ' + (vote ? 'badge-submitted' : 'badge-empty') + '" data-role="badge">' +
        (vote ? 'Submitted (Editable)' : 'Not submitted') +
      '</span>' +
    '</div>' +

    '<div class="cap-meter" data-role="meter">' +
      '<div class="cap-bar"><div class="cap-bar-fill" data-role="fill"></div></div>' +
      '<div class="cap-label">' +
        '<span class="used" data-role="used">0</span>' +
        ' / <span class="limit">' + cap + '</span> used' +
      '</div>' +
    '</div>' +
    '<p class="cap-hint" data-role="hint"></p>' +

    '<fieldset class="preset-list" data-role="presets">' +
      '<legend>Curated names</legend>' +
      presets.map((p) => {
        const checked = selected.some((s) => s.toLowerCase() === String(p).toLowerCase());
        return '' +
          '<label class="check-item">' +
            '<input type="checkbox" class="preset-cb" value="' + esc(p) + '" ' +
              (checked ? 'checked ' : '') + (isOpen ? '' : 'disabled ') + '>' +
            '<span class="check-box"></span>' +
            '<span class="check-label">' + esc(p) + '</span>' +
          '</label>';
      }).join('') +
    '</fieldset>' +

    '<div class="nomination-group">' +
      '<label class="nom-title">Your nominations</label>' +
      Array.from({ length: nomInputs }, (_, i) => {
        const v = noms[i] || '';
        return '<input type="text" class="nom-input" placeholder="Custom nomination ' + (i + 1) + ' (optional)" ' +
          'value="' + esc(v) + '" maxlength="80" ' + (isOpen ? '' : 'disabled ') + '>';
      }).join('') +
      '<p class="nom-note" data-role="nom-note"></p>' +
    '</div>' +

    '<button class="btn ' + (vote ? 'btn-done' : 'btn-save') + '" data-role="save" ' + (isOpen ? '' : 'disabled ') + '>' +
      '<svg class="btn-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l4 4L19 7"/></svg>' +
      (vote ? 'Update ' + esc(THEME_LABELS[theme]) + ' Vote' : 'Save ' + esc(THEME_LABELS[theme]) + ' Vote') +
    '</button>' +
    '<p class="card-error" data-role="error"></p>';

  card.querySelectorAll('.preset-cb').forEach((cb) => cb.addEventListener('change', () => updateMeter(card)));
  card.querySelectorAll('.nom-input').forEach((inp) => inp.addEventListener('input', () => updateMeter(card)));
  card.querySelector('[data-role="save"]').addEventListener('click', () => onSave(theme));
  updateMeter(card);
}

function updateMeter(card) {
  const cap = state.cap;
  const presetBoxes = [...card.querySelectorAll('.preset-cb')];
  const checked = presetBoxes.filter((c) => c.checked);
  const selCount = checked.length;

  const nomInputs = [...card.querySelectorAll('.nom-input')];
  const nomAllow = Math.max(0, cap - selCount);
  const seen = new Set();
  let nomCount = 0;
  for (const v of nomInputs.map((i) => i.value.trim())) {
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    nomCount++;
    if (nomCount >= nomAllow) break;
  }
  const used = selCount + nomCount;
  const remaining = Math.max(0, cap - used);

  const fill = card.querySelector('[data-role="fill"]');
  fill.style.width = Math.min(100, (used / cap) * 100) + '%';
  fill.classList.toggle('full', used >= cap);
  card.querySelector('[data-role="meter"]').classList.toggle('complete', used >= cap);
  card.querySelector('[data-role="used"]').textContent = used;

  presetBoxes.forEach((c) => {
    c.disabled = (!c.checked && used >= cap) || !state.activity || state.activity.status !== 'VotingOpen';
  });
  nomInputs.forEach((inp) => {
    const hasValue = inp.value.trim().length > 0;
    inp.disabled = (!hasValue && used >= cap) || !state.activity || state.activity.status !== 'VotingOpen';
  });

  const hint = card.querySelector('[data-role="hint"]');
  const note = card.querySelector('[data-role="nom-note"]');
  if (used >= cap) {
    hint.textContent = 'All ' + cap + ' names selected. Your vote is complete — tap the button below to save or update it.';
    hint.classList.add('full');
    if (note) note.textContent = 'You have used all ' + cap + ' name slots. Clear one if you want to change your selection.';
  } else {
    hint.textContent = remaining + (remaining === 1 ? ' name ' : ' names ') + 'remaining (presets + nominations combined).';
    hint.classList.remove('full');
    if (note) note.textContent = 'You can nominate up to ' + remaining + ' more name' + (remaining === 1 ? '' : 's') + ' (duplicates and whitespace are ignored). The total of presets + nominations cannot exceed ' + cap + '.';
  }
}

async function onSave(theme) {
  if (!state.user) { showToast('Please sign in first.', 'error'); openLogin(); return; }
  const card = document.getElementById('active-theme-card');
  const selected = [...card.querySelectorAll('.preset-cb')].filter((c) => c.checked).map((c) => c.value);
  const noms = [...card.querySelectorAll('.nom-input')].map((i) => i.value);
  const errBox = card.querySelector('[data-role="error"]');
  errBox.textContent = '';

  try {
    const res = await Api.saveVote(theme, selected, noms);
    state.myVote = res.vote;
    state.hasVoted = true;
    renderActiveThemeCard(theme);
    showVotingView(theme); // 刷新锁定状态（隐藏 Change theme）
    showToast(THEME_LABELS[theme] + ' vote saved. Your theme is now locked.', 'success');
  } catch (e) {
    errBox.textContent = e.message;
    showToast(e.message, 'error');
  }
}

async function chooseTheme(theme) {
  // 一人一票：已投票后禁止改选/切换主题
  if (state.hasVoted) {
    showToast('You have already voted in the ' + THEME_LABELS[state.choice ? state.choice.chosen_theme : theme] + ' theme. Each person may vote only once.', 'error');
    return;
  }
  if (!state.user) {
    state.pendingTheme = theme;
    openLogin();
    return;
  }
  try {
    const res = await Api.saveThemeChoice(theme);
    state.choice = res.choice;
    state.stats = res.stats;
    updateStatsUI();
    // 记住用户主题偏好，用于结果页优先展示对应排行榜
    try { localStorage.setItem('mrv_chosen_theme', theme); } catch {}
    showVotingView(theme);
    showToast('You chose the ' + THEME_LABELS[theme] + ' theme.', 'success');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function openLogin() {
  document.getElementById('login-modal').classList.remove('hidden');
  document.getElementById('login-name').focus();
}
function closeLogin() {
  document.getElementById('login-modal').classList.add('hidden');
  document.getElementById('login-error').textContent = '';
  document.getElementById('login-name').value = '';
}

async function submitLogin() {
  const input = document.getElementById('login-name');
  const name = input.value.trim();
  const errEl = document.getElementById('login-error');
  if (!name) { errEl.textContent = 'Please enter your full name.'; return; }
  try {
    const res = await Api.login(name);
    Api.setSession(res.token, res.user);
    state.user = res.user;
    closeLogin();
    renderIdentity();
    await loadUserState();
    if (state.pendingTheme) {
      await chooseTheme(state.pendingTheme);
      state.pendingTheme = null;
    } else if (state.choice) {
      showVotingView(state.choice.chosen_theme);
    }
  } catch (e) { errEl.textContent = e.message; }
}

document.getElementById('login-cancel').addEventListener('click', closeLogin);
document.getElementById('login-submit').addEventListener('click', submitLogin);
document.getElementById('login-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitLogin();
});

// 主题选择按钮事件委托
document.getElementById('theme-selection-view').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-role="choose-theme"]');
  if (!btn) return;
  chooseTheme(btn.dataset.theme);
});

document.getElementById('change-theme-btn').addEventListener('click', () => {
  showSelectionView();
});

async function loadUserState() {
  if (!state.user) return;
  try {
    const choiceRes = await Api.getMyThemeChoice();
    state.choice = choiceRes.choice;
    state.stats = choiceRes.stats;
  } catch {
    state.choice = null;
  }
  try {
    const votesRes = await Api.getMyVotes();
    state.myVote = state.choice
      ? (state.choice.chosen_theme === 'galaxy' ? votesRes.galaxy : votesRes.landscape)
      : null;
  } catch {
    state.myVote = null;
  }
  // 已投过名字票 → 锁定主题（一人一票）
  state.hasVoted = !!state.myVote;
}

async function init() {
  try {
    state.activity = await Api.getActivity();
    state.cap = state.activity.total_meeting_rooms || 7;
    state.stats = await Api.getThemeChoiceStats();
  } catch (e) {
    showToast('Failed to load: ' + e.message, 'error');
    return;
  }

  if (state.user) {
    await loadUserState();
  }

  document.title = state.activity.site_title;
  document.getElementById('cap-display').textContent = state.cap;
  renderIdentity();
  renderBanner();
  updateStatsUI();
  document.getElementById('voting-end-label').textContent = fmtDateTime(state.activity.voting_end_at);

  if (state.choice) {
    showVotingView(state.choice.chosen_theme);
  } else {
    showSelectionView();
  }

  // 定期刷新主题比例（30 秒）
  setInterval(async () => {
    try { state.stats = await Api.getThemeChoiceStats(); updateStatsUI(); } catch {}
  }, 30000);
}

init();