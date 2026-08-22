'use strict';

/* 公开公示页逻辑
   渲染两个主题独立的"Ranking"与"Voting Ledger"
   (Voting Ledger = 全部实名投票记录，按提交时间排序) */

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

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/);
  return (parts[0] ? parts[0][0] : '') + (parts.length > 1 ? parts[parts.length - 1][0] : '');
}

function joinNames(list) {
  return list.length ? list.map(esc).join(', ') : '<em>None</em>';
}

function rankingHtml(themeData) {
  if (!themeData.ranking.length) return '<p class="empty">No names yet.</p>';
  return themeData.ranking.map((r, idx) => {
    const isSystem = r.source === 'System Preset';
    return '' +
      '<div class="rank-card">' +
        '<div class="rank-idx">' + (idx + 1) + '</div>' +
        '<div class="rank-body">' +
          '<div class="rank-name-row">' +
            '<span class="rank-name">' + esc(r.name) + '</span>' +
            '<span class="src-badge ' + (isSystem ? 'src-system' : 'src-user') + '">' + esc(r.source) + '</span>' +
          '</div>' +
          '<div class="rank-votes"><strong>' + r.total_votes + '</strong> vote' + (r.total_votes === 1 ? '' : 's') + '</div>' +
          '<div class="rank-lists">' +
            '<div class="rank-list"><span class="rank-list-label">Voters</span>' + joinNames(r.voters) + '</div>' +
            '<div class="rank-list"><span class="rank-list-label">Nominators</span>' + joinNames(r.nominators) + '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }).join('');
}

function ledgerHtml(themeData) {
  if (!themeData.submissions.length) return '<p class="empty">No submissions yet.</p>';
  return '<div class="ledger-list">' + themeData.submissions.map((s) => {
    const voted = s.selected_preset_names.length
      ? s.selected_preset_names.map(esc).join(', ')
      : '<em>None</em>';
    const nominated = s.user_nominated_names.length
      ? s.user_nominated_names.map(esc).join(', ')
      : '<em>None</em>';
    return '' +
      '<div class="ledger-row">' +
        '<div class="ledger-avatar">' + esc(initials(s.user_fullname).toUpperCase()) + '</div>' +
        '<div class="ledger-body">' +
          '<div class="ledger-user">' + esc(s.user_fullname) + '</div>' +
          '<div class="ledger-detail">' +
            '<div class="ledger-line"><span class="ledger-tag">Voted</span><span>' + voted + '</span></div>' +
            '<div class="ledger-line"><span class="ledger-tag">Nominated</span><span>' + nominated + '</span></div>' +
          '</div>' +
        '</div>' +
        '<div class="ledger-time">' + fmtDateTime(s.last_modified_time) + '</div>' +
      '</div>';
  }).join('') + '</div>';
}

function getUserPreferredTheme() {
  try {
    const stored = localStorage.getItem('mrv_chosen_theme');
    if (stored === 'galaxy' || stored === 'landscape') return stored;
  } catch {}
  return null;
}

function reorderResultsByPreference(preferred) {
  const stack = document.querySelector('.results-stack');
  if (!stack || !preferred) return;
  const firstId = preferred === 'galaxy' ? 'galaxy-block' : 'landscape-block';
  const first = document.getElementById(firstId);
  if (first && stack.firstElementChild !== first) {
    stack.insertBefore(first, stack.firstElementChild);
  }
  first && first.classList.add('preferred');
}

function renderThemeResults(blockId, themeData) {
  const block = document.getElementById(blockId);
  const totalSubmissions = themeData.submissions.length;
  block.innerHTML =
    '<div class="results-head">' +
      '<div class="theme-icon" style="' + (themeData.theme_label === 'Galaxy'
        ? 'background:linear-gradient(135deg,#4F46E5,#8B5CF6);'
        : 'background:linear-gradient(135deg,#0D9488,#10B981);') + 'width:44px;height:44px;border-radius:12px;display:grid;place-items:center;color:#fff;">' +
        (themeData.theme_label === 'Galaxy'
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:24px;height:24px;"><path d="M12 2 L14 9.5 L22 12 L14 14.5 L12 22 L10 14.5 L2 12 L10 9.5 Z"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:24px;height:24px;"><path d="M2 21 L8 10 L12 14 L16 5 L22 21 Z"/><circle cx="17" cy="4" r="1.5" fill="currentColor" stroke="none"/></svg>') +
      '</div>' +
      '<div>' +
        '<h2>' + esc(themeData.theme_label) + ' Theme</h2>' +
        '<p class="results-meta">' + totalSubmissions + ' submission' + (totalSubmissions === 1 ? '' : 's') + ' &middot; Top candidates lead the ranking</p>' +
      '</div>' +
    '</div>' +
    '<h3 class="section-title">Ranking</h3>' + rankingHtml(themeData) +
    '<h3 class="section-title">Voting Ledger</h3>' + ledgerHtml(themeData);
}

function renderThemeStats(stats) {
  const el = document.getElementById('theme-stats');
  if (!el || !stats) return;
  const g = stats.galaxy;
  const l = stats.landscape;
  el.innerHTML =
    '<div class="theme-stats-row">' +
      '<div class="theme-stat galaxy">' +
        '<div class="theme-stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 L14 9.5 L22 12 L14 14.5 L12 22 L10 14.5 L2 12 L10 9.5 Z"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg></div>' +
        '<div class="theme-stat-body">' +
          '<div class="theme-stat-label">Galaxy</div>' +
          '<div class="theme-stat-bar"><div class="theme-stat-fill" style="width:' + g.percent + '%"></div></div>' +
        '</div>' +
        '<div class="theme-stat-num">' + g.percent + '%<span>' + g.count + ' votes</span></div>' +
      '</div>' +
      '<div class="theme-stat landscape">' +
        '<div class="theme-stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 21 L8 10 L12 14 L16 5 L22 21 Z"/><circle cx="17" cy="4" r="1.5" fill="currentColor" stroke="none"/></svg></div>' +
        '<div class="theme-stat-body">' +
          '<div class="theme-stat-label">Natural Landscape</div>' +
          '<div class="theme-stat-bar"><div class="theme-stat-fill" style="width:' + l.percent + '%"></div></div>' +
        '</div>' +
        '<div class="theme-stat-num">' + l.percent + '%<span>' + l.count + ' votes</span></div>' +
      '</div>' +
    '</div>';
}

async function init() {
  try {
    // 静态部署：直接使用注入的快照数据，不走后端 API
    if (window.MRV_EMBEDDED) {
      const data = window.MRV_EMBEDDED;
      document.title = data.activity.site_title + ' — Public Results';
      renderThemeStats(data.theme_choice_stats);
      renderThemeResults('galaxy-block', data.galaxy);
      renderThemeResults('landscape-block', data.landscape);
      reorderResultsByPreference(getUserPreferredTheme());
      if (window.FX) {
        window.FX.fluid(document.getElementById('galaxy-block'), 'galaxy');
        window.FX.fluid(document.getElementById('landscape-block'), 'landscape');
      }
      const notice = document.getElementById('closing-notice');
      if (data.activity.status === 'VotingClosed') {
        notice.innerHTML =
          '<div class="closing-notice-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7A5B14" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg></div>' +
          '<div>Voting has closed. The administrator will select <strong>' + data.activity.total_meeting_rooms +
          '</strong> meeting room names from the combined name pool of both themes.</div>';
      } else {
        const s = data.activity.status === 'NotStarted' ? 'not started' : 'open';
        notice.innerHTML =
          '<div class="closing-notice-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7A5B14" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg></div>' +
          '<div>Voting is currently <strong>' + s + '</strong>. The final name pool will be available after voting closes.</div>';
      }
      return;
    }

    const data = await Api.getResults();
    document.title = data.activity.site_title + ' \u2014 Public Results';
    renderThemeStats(data.theme_choice_stats);
    renderThemeResults('galaxy-block', data.galaxy);
    renderThemeResults('landscape-block', data.landscape);
    reorderResultsByPreference(getUserPreferredTheme());
    if (window.FX) {
      window.FX.fluid(document.getElementById('galaxy-block'), 'galaxy');
      window.FX.fluid(document.getElementById('landscape-block'), 'landscape');
    }

    const notice = document.getElementById('closing-notice');
    if (data.activity.status === 'VotingClosed') {
      notice.innerHTML =
        '<div class="closing-notice-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7A5B14" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg></div>' +
        '<div>Voting has closed. The administrator will select <strong>' + data.activity.total_meeting_rooms +
        '</strong> meeting room names from the combined name pool of both themes.</div>';
    } else {
      const s = data.activity.status === 'NotStarted' ? 'not started' : 'open';
      notice.innerHTML =
        '<div class="closing-notice-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7A5B14" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg></div>' +
        '<div>Voting is currently <strong>' + s + '</strong>. The final name pool will be available after voting closes.</div>';
    }
  } catch (e) {
    showToast('Failed to load results: ' + e.message, 'error');
  }
}

init();