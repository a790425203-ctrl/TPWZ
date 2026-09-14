'use strict';

/* v26：左 sidebar 为完整投票面板（顶部 Voting Guide + Step1 主题选择 + 选完才跳出的 Step2 投票卡），
   右 main 为 Results Dashboard（两主题合并成 100% 能量条 + 双列排行榜：Galaxy 列 + Landscape 列）。

   行为：
   - 左侧顶部：Voting Guide 引导用户如何投票
   - Step 1：主题 tabs；点击主题后才出现 Step 2 投票卡
   - 已投票用户加载后直接跳到已选主题，卡片自动显示
   - 右侧：Results Dashboard 始终展示实时能量条与 Galaxy / Landscape 双列排行榜
   - 未投票：左侧 tab 自由切换，右侧投票卡跟随主题变化
   - 已投票：activeTheme 锁定为用户所选主题，禁用另一 tab
   - 投票保存后：保持当前 tab，自动刷新右侧 Results Dashboard
   - 能量条每 15s、结果每 30s 自动刷新
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
  choice: null,         // { user_id, chosen_theme, ... }
  myVotes: { galaxy: null, landscape: null },
  hasVoted: false,      // 任意主题投过名字票即 true
  activeTheme: null,     // 当前选中的主题（null = 尚未选择，未投票用户初始不显示投票卡）
  cap: 7,
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

/* ============== Sidebar: Tabs / Energy / Ranking ============== */

function renderSidebar() {
  renderTabs();
  renderEnergy();
  renderRanking();
  renderStep2();
}

function renderTabs() {
  // 已投票：另一 tab disabled
  const myChosen = state.choice ? state.choice.chosen_theme : null;
  ['galaxy', 'landscape'].forEach((t) => {
    const tab = document.getElementById('tab-' + t);
    if (!tab) return;
    const isActive = state.activeTheme === t;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    // 锁定逻辑：已投票且不是用户主题 → disabled
    if (state.hasVoted && myChosen && myChosen !== t) {
      tab.classList.add('disabled');
      tab.disabled = true;
    } else {
      tab.classList.remove('disabled');
      tab.disabled = false;
    }
    // tab meta 文本
    const meta = document.getElementById('tab-meta-' + t);
    if (meta) {
      const s = state.stats[t];
      meta.textContent = s.count + ' vote' + (s.count === 1 ? '' : 's') + ' · ' + s.percent + '%';
    }
  });
}

// 控制 Step2 投票卡显示/隐藏
function renderStep2() {
  const wrap = document.getElementById('step2-wrap');
  const hint = document.getElementById('step1-hint');
  if (!wrap || !hint) return;
  const show = !!state.activeTheme;
  wrap.classList.toggle('hidden', !show);
  hint.classList.toggle('hidden', show);
}

// 渲染两主题合并的 100% 能量条
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

function renderRanking() {
  // 右侧排行榜：Galaxy 列 + Landscape 列，始终同时展示两个主题的实时排名
  ['galaxy', 'landscape'].forEach((themeKey) => {
    const listEl = document.getElementById('ranking-list-' + themeKey);
    if (!listEl) return;
    const data = state.results[themeKey] || { ranking: [] };
    if (!data.ranking.length) {
      listEl.innerHTML = '<p class="ranking-empty">No names yet.</p>';
      return;
    }
    listEl.innerHTML = data.ranking.map((r, idx) => {
      const rank = idx + 1;
      const label = rank === 1 ? '1st' : rank === 2 ? '2nd' : rank === 3 ? '3rd' : rank;
      return '' +
        '<div class="rank-mini">' +
          '<div class="rank-mini-idx">' + label + '</div>' +
          '<div class="rank-mini-body">' +
            '<div class="rank-mini-name">' + esc(r.name) + '</div>' +
            '<div class="rank-mini-src">' + esc(r.source) + '</div>' +
          '</div>' +
          '<div class="rank-mini-votes"><strong>' + r.total_votes + '</strong></div>' +
        '</div>';
    }).join('');
  });
}

/* ============== Main: 单主题卡渲染 ============== */

function renderActiveCard() {
  const card = document.getElementById('active-theme-card');
  if (!card) return;
  const theme = state.activeTheme;
  const vote = state.myVotes[theme];
  const presets = theme === 'galaxy' ? state.activity.galaxy_presets : state.activity.landscape_presets;
  const cap = state.cap;
  const isOpen = state.activity.status === 'VotingOpen';
  const myChosen = state.choice ? state.choice.chosen_theme : null;
  const editable = isOpen && !vote;

  const selected = (vote && vote.selected_preset_names) || [];
  const noms = (vote && vote.user_nominated_names) || [];
  const nomInputs = state.activity.max_nomination_inputs || 5;

  // 已投票用户：标记哪些名字是自己投的
  const myPresetSet = new Set(selected.map((s) => String(s).toLowerCase()));
  const myNomSet = new Set(noms.map((s) => String(s).toLowerCase()));

  // 状态徽章：已提交 / 进行中；未选该主题时不显示徽章
  const badgeText = vote ? 'Submitted' : (myChosen === theme ? 'In progress' : '');
  const badgeHtml = badgeText
    ? '<span class="badge ' + (vote ? 'badge-submitted' : 'badge-empty') + '" data-role="badge">' + badgeText + '</span>'
    : '';

  card.className = 'theme-card ' + theme;
  card.setAttribute('data-theme', theme);
  card.innerHTML =
    '<div class="theme-card-bg"></div>' +
    '<div class="theme-card-head">' +
      '<div class="theme-title-wrap">' +
        '<div class="theme-icon theme-icon--' + theme + '">' + THEME_ICONS[theme] + '</div>' +
        '<div>' +
          '<h2>' + esc(THEME_LABELS[theme]) + ' Theme</h2>' +
        '</div>' +
      '</div>' +
      badgeHtml +
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
          '<label class="check-item' + (checked ? ' check-item--mine' : '') + '">' +
            '<input type="checkbox" class="preset-cb" value="' + esc(p) + '" ' +
              (checked ? 'checked ' : '') + (editable ? '' : 'disabled ') + '>' +
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
            'value="' + esc(v) + '" maxlength="80" ' + (editable ? '' : 'disabled ') + '>';
      }).join('') +
      '<p class="nom-note" data-role="nom-note"></p>' +
    '</div>' +

    (state.hasVoted && myChosen && myChosen !== theme
      ? '<div class="theme-locked-note">You have already chosen the <strong>' + esc(THEME_LABELS[myChosen]) + '</strong> theme. One person, one vote, one theme.</div>'
      : '<button class="btn ' + (vote ? 'btn-done' : 'btn-save') + ' btn-save-card" data-role="save" ' + (editable ? '' : 'disabled ') + '>' +
          '<svg class="btn-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l4 4L19 7"/></svg>' +
          (vote ? 'Successfully submitted' : 'Choose ' + esc(THEME_LABELS[theme]) + ' and Submit') +
        '</button>'
    ) +
    '<p class="card-error" data-role="error"></p>';

  if (editable) {
    card.querySelectorAll('.preset-cb').forEach((cb) => cb.addEventListener('change', () => updateMeter(card)));
    card.querySelectorAll('.nom-input').forEach((inp) => inp.addEventListener('input', () => updateMeter(card)));
    const saveBtn = card.querySelector('[data-role="save"]');
    if (saveBtn) saveBtn.addEventListener('click', () => onSave(theme));
  }
  updateMeter(card);

  // 流体背景
  if (window.FX) {
    card.querySelectorAll('.fx-fluid').forEach((c) => c.remove());
    window.FX.fluid(card, theme);
  }
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

  const isOpen = state.activity && state.activity.status === 'VotingOpen';
  const myChosen = state.choice ? state.choice.chosen_theme : null;
  const theme = card.dataset.theme;
  const vote = state.myVotes[theme];
  const submitted = !!vote;
  const locked = (state.hasVoted && myChosen && myChosen !== theme) || submitted;

  presetBoxes.forEach((c) => {
    c.disabled = (!c.checked && used >= cap) || !isOpen || !!locked;
  });
  nomInputs.forEach((inp) => {
    const hasValue = inp.value.trim().length > 0;
    inp.disabled = (!hasValue && used >= cap) || !isOpen || !!locked;
  });

  const hint = card.querySelector('[data-role="hint"]');
  const note = card.querySelector('[data-role="nom-note"]');
  if (submitted) {
    hint.textContent = 'Your vote has been submitted.';
    hint.classList.add('full');
    if (note) note.textContent = '';
  } else if (used >= cap) {
    hint.textContent = 'All ' + cap + ' names selected. Your vote is complete — tap the button below to submit it.';
    hint.classList.add('full');
    if (note) note.textContent = '';
  } else {
    hint.textContent = remaining + (remaining === 1 ? ' name ' : ' names ') + 'remaining (presets + nominations combined).';
    hint.classList.remove('full');
    if (note) note.textContent = 'You can nominate up to ' + remaining + ' more name' + (remaining === 1 ? '' : 's') + ' (duplicates and whitespace are ignored). The total of presets + nominations cannot exceed ' + cap + '.';
  }
}

function switchToTheme(theme) {
  if (state.activeTheme === theme) return;
  // 已投票用户禁止切换
  if (state.hasVoted && state.choice && state.choice.chosen_theme !== theme) {
    showToast('Your theme is locked. One person, one vote, one theme.', 'error');
    return;
  }
  state.activeTheme = theme;
  renderTabs();
  renderStep2();
  renderActiveCard();
  renderRanking();
}

async function onSave(theme) {
  if (!state.user) {
    await ensureAnonymous();
    if (!state.user) { showToast('Could not start voting session.', 'error'); return; }
  }
  const card = document.getElementById('active-theme-card');
  if (!card) return;
  const selected = [...card.querySelectorAll('.preset-cb')].filter((c) => c.checked).map((c) => c.value);
  const noms = [...card.querySelectorAll('.nom-input')].map((i) => i.value);
  const errBox = card.querySelector('[data-role="error"]');
  if (errBox) errBox.textContent = '';

  if (state.choice && state.choice.chosen_theme !== theme) {
    showToast('You have already chosen the ' + THEME_LABELS[state.choice.chosen_theme] + ' theme. One person, one theme.', 'error');
    return;
  }

  try {
    if (!state.choice || state.choice.chosen_theme !== theme) {
      const choiceRes = await Api.saveThemeChoice(theme);
      state.choice = choiceRes.choice;
      state.stats = choiceRes.stats;
    }
    const res = await Api.saveVote(theme, selected, noms);
    state.myVotes[theme] = res.vote;
    state.hasVoted = true;
    try { localStorage.setItem('mrv_chosen_theme', theme); } catch {}
    showToast('Successfully Submitted', 'success');
    renderSidebar();
    // 投票成功后刷新一次 ranking，让用户立即看到包含自己投票的结果
    try { await loadResultsData(); } catch {}
    renderActiveCard();
    renderRanking();
    // 提交后停止 results 轮询：当前会话内的结果保持提交时的快照，不再自动更新
    if (state.timers.results) {
      clearInterval(state.timers.results);
      state.timers.results = null;
    }
    // 投票成功后滚动到右侧结果区顶部，让用户看到最终数据
    setTimeout(() => {
      const r = document.getElementById('main-column');
      if (r) r.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);
  } catch (e) {
    if (errBox) errBox.textContent = e.message;
    showToast(e.message, 'error');
  }
}

// 主题 tabs 点击切换
['galaxy', 'landscape'].forEach((t) => {
  const tab = document.getElementById('tab-' + t);
  if (tab) tab.addEventListener('click', () => switchToTheme(t));
});

/* ============== 加载与状态同步 ============== */

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
    state.myVotes = { galaxy: votesRes.galaxy, landscape: votesRes.landscape };
  } catch {
    state.myVotes = { galaxy: null, landscape: null };
  }
  state.hasVoted = !!(state.myVotes.galaxy || state.myVotes.landscape);
}

function syncActiveThemeToChoice() {
  // 用户有已选主题 → 切到对应 tab
  if (state.choice && state.choice.chosen_theme) {
    state.activeTheme = state.choice.chosen_theme;
  }
  // 否则按 localStorage 偏好
  if (!state.choice) {
    try {
      const stored = localStorage.getItem('mrv_chosen_theme');
      if (stored === 'galaxy' || stored === 'landscape') state.activeTheme = stored;
    } catch {}
  }
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

function renderAll() {
  renderBanner();
  renderSidebar();
  renderActiveCard();
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

  if (!state.user) {
    await ensureAnonymous();
  }
  if (state.user) {
    await loadUserState();
  }

  syncActiveThemeToChoice();

  document.title = state.activity.site_title;
  const capEl = document.getElementById('cap-display');
  if (capEl) capEl.textContent = state.cap;
  const endEl = document.getElementById('voting-end-label');
  if (endEl) endEl.textContent = fmtDateTime(state.activity.voting_end_at);
  renderAll();

  await loadResultsData();
  renderAll();
  renderRanking();

  // 周期刷新：
  // - theme stats（能量条）始终实时刷新
  // - results（排行榜）仅在未投票时自动刷新；提交投票后冻结，保持提交时的结果快照
  state.timers.themeStats = setInterval(async () => {
    try {
      state.stats = await Api.getThemeChoiceStats();
      renderEnergy();
      renderTabs();
    } catch {}
  }, 15000);
  if (!state.hasVoted) {
    // 注意：结果轮询只刷新右侧排行榜，绝不能调用 renderActiveCard()，
    // 否则每 30s 会整体重建投票卡，把用户正在选的复选框和已输入的名字清空。
    state.timers.results = setInterval(async () => {
      try { await loadResultsData(); renderRanking(); } catch {}
    }, 30000);
  }
}

init();
