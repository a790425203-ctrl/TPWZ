'use strict';

/* v39：单界面「展示 + 投票」合并版。
   一个 Live Voting Board 面板内完成：
   - 顶部：Galaxy / Natural Landscape 主题标签（含实时占比）
   - 能量条（主题对决 100%）
   - 实时名字板：每个名字带 👍 点赞按钮（快捷投票），点亮的为本人草稿；全局票数实时刷新
   - 底部：自己编辑（自定义提名） + 确定(Confirm) 按钮

   规则：
   - 点击任意名字的 👍 = 草稿式点赞（本地高亮），不立即上报；点「确定」才正式提交
   - 第一次点赞即锁定本人所投主题（一人一主题）；其他主题仍可查看但不可编辑
   - 每人最多点亮 cap 个名字（预设 + 自定义合计，默认 7）
   - 提交后冻结本人结果，能量条/主题占比仍实时
*/

const THEME_ICONS = {
  galaxy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 L14 9.5 L22 12 L14 14.5 L12 22 L10 14.5 L2 12 L10 9.5 Z"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg>',
  landscape: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 21 L8 10 L12 14 L16 5 L22 21 Z"/><circle cx="17" cy="4" r="1.5" fill="currentColor" stroke="none"/></svg>',
};

const THEME_LABELS = { galaxy: 'Galaxy', landscape: 'Natural Landscape' };

const state = {
  activity: null,
  stats: { total: 0, galaxy: { count: 0, percent: 0 }, landscape: { count: 0, percent: 0 } },
  results: { galaxy: { ranking: [], submissions: [] }, landscape: { ranking: [], submissions: [] } },
  user: Api.getUser(),
  anonToken: localStorage.getItem('mrv_anon_token') || '',
  choice: null,
  myVotes: { galaxy: null, landscape: null },
  hasVoted: false,
  activeTheme: 'galaxy',   // 当前查看的主题
  voteTheme: null,         // 本人正在投票的主题（首次点赞后锁定；提交后保持不变）
  cap: 7,
  liked: { galaxy: new Set(), landscape: new Set() },        // 本人点亮（草稿）的名字
  customNames: { galaxy: new Set(), landscape: new Set() },   // 本人添加的自定义名字（待提交）
  timers: { themeStats: null, results: null },
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

function renderBanner() {
  const el = document.getElementById('activity-banner');
  if (!el) return;
  const s = state.activity.status;
  if (s === 'VotingOpen') { el.innerHTML = ''; return; }
  const msg = s === 'NotStarted'
    ? 'Voting has not started yet. You can browse the options but cannot submit.'
    : 'Voting has closed. The administrator will select the final meeting room names from the winning theme.';
  el.innerHTML = '<div class="banner ' + (s === 'NotStarted' ? 'banner-warn' : 'banner-closed') + '">' + esc(msg) + '</div>';
}

/* 当前主题是否可编辑（点赞 / 添加 / 确定）：
   投票进行中 + 未提交 + （尚未锁定主题 或 当前查看主题即本人投票主题） */
function isEditable(theme) {
  const isOpen = state.activity && state.activity.status === 'VotingOpen';
  if (!isOpen || state.hasVoted) return false;
  return state.voteTheme === null || state.voteTheme === theme;
}

/* ============== 渲染 ============== */

function renderTabs() {
  const myChosen = state.choice ? state.choice.chosen_theme : null;
  ['galaxy', 'landscape'].forEach((t) => {
    const tab = document.getElementById('tab-' + t);
    if (!tab) return;
    const isActive = state.activeTheme === t;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    const viewOnly = (state.hasVoted && myChosen && myChosen !== t) || (state.voteTheme && state.voteTheme !== t);
    tab.classList.toggle('viewonly', !!viewOnly);
    const meta = document.getElementById('tab-meta-' + t);
    if (meta) meta.textContent = state.stats[t].percent + '%';
  });
}

function renderEnergy() {
  const g = state.stats.galaxy;
  const l = state.stats.landscape;
  const total = g.count + l.count;
  const gPct = total === 0 ? 50 : Math.round((g.count / total) * 100);
  const lPct = 100 - gPct;
  const gf = document.getElementById('energy-fill-galaxy');
  const lf = document.getElementById('energy-fill-landscape');
  const gl = document.getElementById('energy-label-galaxy');
  const ll = document.getElementById('energy-label-landscape');
  const gn = document.getElementById('energy-num-galaxy');
  const ln = document.getElementById('energy-num-landscape');
  if (gf) gf.style.width = gPct + '%';
  if (lf) lf.style.width = lPct + '%';
  if (gl) gl.textContent = 'Galaxy ' + gPct + '%';
  if (ll) ll.textContent = 'Landscape ' + lPct + '%';
  if (gn) gn.textContent = g.count;
  if (ln) ln.textContent = l.count;
}

function renderThemeHead() {
  const theme = state.activeTheme;
  const title = document.getElementById('board-theme-title');
  const icon = document.getElementById('board-theme-icon');
  const meta = document.getElementById('board-theme-meta');
  if (title) title.textContent = THEME_LABELS[theme];
  if (icon) icon.innerHTML = THEME_ICONS[theme];
  if (meta) {
    const r = (state.results[theme] && state.results[theme].ranking) || [];
    const total = r.reduce((s, x) => s + x.total_votes, 0);
    meta.textContent = r.length + ' names · ' + total + ' votes';
  }
}

function renderBoard() {
  const theme = state.activeTheme;
  const container = document.getElementById('name-board');
  if (!container) return;
  const ranking = (state.results[theme] && state.results[theme].ranking) || [];
  const liked = state.liked[theme];
  const custom = state.customNames[theme];
  const editable = isEditable(theme);

  const rows = ranking.map((r) => ({
    name: r.name, source: r.source, votes: r.total_votes, global: true, pending: false, liked: liked.has(r.name),
  }));
  for (const cn of custom) {
    if (!rows.some((r) => r.name.toLowerCase() === cn.toLowerCase())) {
      rows.push({ name: cn, source: 'nomination', votes: 0, global: false, pending: true, liked: true });
    }
  }
  rows.sort((a, b) => {
    if (a.global !== b.global) return a.global ? -1 : 1;
    return b.votes - a.votes;
  });

  if (!rows.length) {
    container.innerHTML = '<p class="ranking-empty">No names yet.</p>';
    return;
  }

  container.innerHTML = rows.map((r) => {
    const rank = r.global ? rows.filter((x) => x.global).indexOf(r) + 1 : null;
    const rankLabel = rank === 1 ? '1st' : rank === 2 ? '2nd' : rank === 3 ? '3rd' : rank;
    const srcLabel = r.source === 'preset' ? 'Curated' : 'Nomination';
    return '' +
      '<div class="nb-row' + (r.liked ? ' liked' : '') + (r.pending ? ' pending' : '') + (editable ? '' : ' viewonly') + '" data-name="' + esc(r.name) + '">' +
        '<div class="nb-rank' + (rank && rank <= 3 ? ' top' : '') + '">' +
          (rank ? esc(String(rankLabel)) : '<span class="nb-new">NEW</span>') +
        '</div>' +
        '<div class="nb-main">' +
          '<div class="nb-name">' + esc(r.name) + '</div>' +
          '<div class="nb-src">' + srcLabel + (r.liked ? ' · your pick' : '') + '</div>' +
        '</div>' +
        '<button class="nb-like' + (r.liked ? ' liked' : '') + '" type="button" data-like="' + esc(r.name) + '"' +
          (editable ? '' : ' disabled') + '>' +
          '<svg class="nb-thumb" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3z"/><path d="M7 11l4-7a2 2 0 0 1 2 2v3h5a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 16.8 20H7"/></svg>' +
          '<span class="nb-like-count">' + r.votes + '</span>' +
        '</button>' +
      '</div>';
  }).join('');

  container.querySelectorAll('[data-like]').forEach((btn) => {
    btn.addEventListener('click', () => toggleLike(theme, btn.getAttribute('data-like')));
  });
}

function renderHint() {
  const el = document.getElementById('board-hint');
  if (!el) return;
  const theme = state.activeTheme;
  if (!isEditable(theme)) { el.textContent = ''; return; }
  if (!state.voteTheme) {
    el.textContent = 'Tap \u{1F44D} on the names you like. Your first tap chooses the ' + THEME_LABELS[theme] + ' theme. Pick up to ' + state.cap + '.';
  } else {
    el.textContent = 'Tap \u{1F44D} to add or remove names. Pick up to ' + state.cap + ', then tap Confirm.';
  }
}

function renderFoot() {
  const voteZone = document.getElementById('vote-zone');
  const readonlyZone = document.getElementById('readonly-zone');
  const readonlyMsg = document.getElementById('readonly-msg');
  if (!voteZone || !readonlyZone) return;

  const editable = isEditable(state.activeTheme);
  if (editable) {
    voteZone.classList.remove('hidden');
    readonlyZone.classList.add('hidden');
    const theme = state.activeTheme;
    const used = state.liked[theme].size;
    const cap = state.cap;
    const capEl = document.getElementById('cap-meter-inline');
    if (capEl) capEl.textContent = used + ' / ' + cap + ' picked';
    const note = document.getElementById('nom-editor-note');
    if (note) {
      if (used >= cap) note.textContent = 'You have picked all ' + cap + ' names. Tap Confirm to submit.';
      else note.textContent = 'Add a custom name or pick up to ' + (cap - used) + ' more. One person votes once, in one theme.';
    }
    const input = document.getElementById('nom-input');
    if (input) { input.disabled = false; }
  } else {
    voteZone.classList.add('hidden');
    readonlyZone.classList.remove('hidden');
    let msg;
    if (state.hasVoted) {
      const t = state.voteTheme || (state.choice && state.choice.chosen_theme);
      msg = 'You have submitted your vote for the ' + (t === 'galaxy' ? 'Galaxy' : 'Natural Landscape') + ' theme. Thanks for voting!';
    } else if (state.voteTheme && state.voteTheme !== state.activeTheme) {
      msg = 'You are voting in the ' + (state.voteTheme === 'galaxy' ? 'Galaxy' : 'Natural Landscape') + ' theme. Switch to that tab to edit your picks, or tap Clear to start over.';
    } else {
      msg = 'Voting is closed. Browse the live results above.';
    }
    if (readonlyMsg) readonlyMsg.textContent = msg;
  }
}

function renderAll() {
  renderBanner();
  renderTabs();
  renderEnergy();
  renderThemeHead();
  renderBoard();
  renderHint();
  renderFoot();
}

/* ============== 交互 ============== */

function toggleLike(theme, name) {
  if (!isEditable(theme)) return;
  const set = state.liked[theme];
  if (set.has(name)) {
    set.delete(name);
    if (state.customNames[theme].has(name)) state.customNames[theme].delete(name);
  } else {
    if (set.size >= state.cap) { showToast('You can pick up to ' + state.cap + ' names.', 'error'); return; }
    set.add(name);
  }
  if (state.liked[theme].size === 0 && state.voteTheme === theme && !state.hasVoted) {
    state.voteTheme = null;
  } else if (state.liked[theme].size > 0 && !state.voteTheme) {
    state.voteTheme = theme;
  }
  renderAll();
}

function addCustom() {
  if (!isEditable(state.activeTheme)) return;
  const input = document.getElementById('nom-input');
  const name = input.value.trim();
  if (!name) return;
  const theme = state.activeTheme;
  const key = name.toLowerCase();
  const exists = state.liked[theme].has(name)
    || [...state.customNames[theme]].some((c) => c.toLowerCase() === key)
    || (state.results[theme].ranking || []).some((r) => r.name.toLowerCase() === key);
  if (exists) {
    showToast('That name is already in your picks or on the board.', 'error');
    input.value = '';
    return;
  }
  if (state.liked[theme].size >= state.cap) {
    showToast('You can pick up to ' + state.cap + ' names.', 'error');
    return;
  }
  state.customNames[theme].add(name);
  state.liked[theme].add(name);
  if (!state.voteTheme) state.voteTheme = theme;
  input.value = '';
  renderAll();
}

function clearPicks() {
  if (state.hasVoted || !state.voteTheme) return;
  state.liked[state.voteTheme].clear();
  state.customNames[state.voteTheme].clear();
  state.voteTheme = null;
  renderAll();
}

async function onConfirm() {
  const theme = state.voteTheme;
  if (!theme) { showToast('Tap \u{1F44D} on at least one name first.', 'error'); return; }
  if (state.liked[theme].size === 0) { showToast('Tap \u{1F44D} on at least one name first.', 'error'); return; }
  if (!await ensureValidSession()) {
    showToast('Could not start voting session.', 'error');
    return;
  }
  const presets = theme === 'galaxy' ? state.activity.galaxy_presets : state.activity.landscape_presets;
  const inPresets = (n) => presets.some((p) => String(p).trim().toLowerCase() === n.toLowerCase());
  const selected = [...state.liked[theme]].filter(inPresets);
  const nominated = [...state.liked[theme]].filter((n) => !inPresets(n));

  try {
    if (!state.choice || state.choice.chosen_theme !== theme) {
      const cRes = await Api.saveThemeChoice(theme);
      state.choice = cRes.choice;
      state.stats = cRes.stats;
    }
    await Api.saveVote(theme, selected, nominated);
    state.myVotes[theme] = { selected_preset_names: selected, user_nominated_names: nominated };
    state.hasVoted = true;
    state.activeTheme = theme;
    showToast('Successfully Submitted', 'success');
    try { await loadResultsData(); } catch {}
    renderAll();
    if (state.timers.results) {
      clearInterval(state.timers.results);
      state.timers.results = null;
    }
    setTimeout(() => {
      const r = document.getElementById('board-foot');
      if (r) r.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function switchTheme(theme) {
  if (state.activeTheme === theme) return;
  state.activeTheme = theme;
  renderAll();
}

/* ============== 加载与状态同步 ============== */

async function loadUserState() {
  if (!state.user) return;
  try {
    const choiceRes = await Api.getMyThemeChoice();
    state.choice = choiceRes.choice;
    state.stats = choiceRes.stats;
  } catch { state.choice = null; }
  try {
    const votesRes = await Api.getMyVotes();
    state.myVotes = { galaxy: votesRes.galaxy, landscape: votesRes.landscape };
  } catch { state.myVotes = { galaxy: null, landscape: null }; }
  state.hasVoted = !!(state.myVotes.galaxy || state.myVotes.landscape);
}

/** 用已提交的投票记录回填本人草稿（点赞高亮 + 自定义名字），并锁定投票主题 */
function hydrateFromMyVotes() {
  ['galaxy', 'landscape'].forEach((t) => {
    const v = state.myVotes[t];
    if (!v) return;
    state.voteTheme = t;
    (v.selected_preset_names || []).forEach((n) => state.liked[t].add(n));
    (v.user_nominated_names || []).forEach((n) => {
      state.liked[t].add(n);
      state.customNames[t].add(n);
    });
  });
}

async function loadResultsData() {
  try {
    const data = await Api.getResults();
    state.results = {
      galaxy: data.galaxy || { ranking: [], submissions: [] },
      landscape: data.landscape || { ranking: [], submissions: [] },
    };
  } catch {}
}

/** 确保当前持有有效（未过期）的用户令牌；失效则清空并自动重新匿名登录（复用同一匿名身份，不破坏一人一票） */
async function ensureValidSession() {
  if (state.user) {
    try {
      const me = await Api.me();
      if (me && me.user && me.user.user_id) { state.user = me.user; return true; }
    } catch {}
    Api.clearSession();
    state.user = null;
  }
  await ensureAnonymous();
  return !!state.user;
}

async function ensureAnonymous() {
  if (state.user) return state.user;
  if (!state.anonToken) {
    state.anonToken = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
    try { localStorage.setItem('mrv_anon_token', state.anonToken); } catch {}
  }
  try {
    const res = await Api.login('', state.anonToken);
    Api.setSession(res.token, res.user);
    state.user = res.user;
    state.anonToken = res.anon_token || state.anonToken;
    try { localStorage.setItem('mrv_anon_token', state.anonToken); } catch {}
  } catch (e) {
    showToast('Could not start voting session: ' + e.message, 'error');
  }
  return state.user;
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
    // 校验已存令牌是否仍有效；失效（如超过 TTL）则清空并重新匿名登录
    try {
      const me = await Api.me();
      if (me && me.user && me.user.user_id) state.user = me.user;
      else throw new Error('invalid');
    } catch {
      Api.clearSession();
      state.user = null;
      await ensureAnonymous();
    }
  } else {
    await ensureAnonymous();
  }
  if (state.user) await loadUserState();
  hydrateFromMyVotes();

  if (!state.activeTheme) state.activeTheme = 'galaxy';
  if (state.voteTheme) state.activeTheme = state.voteTheme;

  renderAll();
  await loadResultsData();
  renderAll();

  // 主题占比 / 能量条：始终实时刷新
  state.timers.themeStats = setInterval(async () => {
    try {
      state.stats = await Api.getThemeChoiceStats();
      renderEnergy();
      renderTabs();
      renderThemeHead();
    } catch {}
  }, 15000);

  // 名字板票数：仅未投票时自动刷新（提交后冻结，保持提交时的结果快照）
  if (!state.hasVoted) {
    state.timers.results = setInterval(async () => {
      try { await loadResultsData(); renderBoard(); renderThemeHead(); } catch {}
    }, 30000);
  }
}

// 静态元素事件（vote-zone 不被重建，可一次性绑定）
['galaxy', 'landscape'].forEach((t) => {
  const tab = document.getElementById('tab-' + t);
  if (tab) tab.addEventListener('click', () => switchTheme(t));
});
const confirmBtn = document.getElementById('confirm-btn');
if (confirmBtn) confirmBtn.addEventListener('click', onConfirm);
const nomAdd = document.getElementById('nom-add');
if (nomAdd) nomAdd.addEventListener('click', addCustom);
const clearBtn = document.getElementById('clear-btn');
if (clearBtn) clearBtn.addEventListener('click', clearPicks);
const nomInput = document.getElementById('nom-input');
if (nomInput) nomInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } });

init();
