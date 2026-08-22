'use strict';

/**
 * 聚合引擎。
 * 每个主题独立聚合：系统预设名称 + 该主题所有用户提名名称合并。
 * 同一主题多人提名相同名称 → 合并为一条，票数累加，记录全部提名人与投票人。
 * 不同主题的同名名称互不干扰（按 theme 独立计算）。
 *
 * 说明：对“用户提名”的名字而言，提名本身即投出的一票，因此提名者同时计入 voters 与 nominators；
 * 对“系统预设”名字而言，voters 为勾选它的用户，nominators 为空。
 */

function normalizeName(s) {
  return String(s || '').trim().toLowerCase();
}

/**
 * @param {Array} votes    该主题的全部投票记录（user_theme_vote）
 * @param {Array} presets  该主题的系统预设名称数组
 * @returns {Array} 按 total_votes 降序排列的榜单条目
 */
function aggregateTheme(votes, presets) {
  const map = new Map(); // key: 规范化名称 -> { name, source, voters:Set, nominators:Set }

  // 初始化系统预设（0 票也进入榜单）
  for (const p of presets) {
    map.set(normalizeName(p), {
      name: String(p).trim(),
      source: 'System Preset',
      voters: new Set(),
      nominators: new Set(),
    });
  }

  for (const v of votes) {
    const fullname = v.user_fullname;

    // 勾选的预设候选 → 记为投票人
    for (const sel of v.selected_preset_names) {
      const entry = map.get(normalizeName(sel));
      if (entry) entry.voters.add(fullname);
    }

    // 个人提名 → 提名者 + 投票人；同名提名合并；空/空白名被过滤，不进入榜单
    for (const nom of v.user_nominated_names) {
      const key = normalizeName(nom);
      if (!key) continue;
      let entry = map.get(key);
      if (!entry) {
        entry = { name: String(nom).trim(), source: 'User Nominated', voters: new Set(), nominators: new Set() };
        map.set(key, entry);
      }
      entry.nominators.add(fullname);
      entry.voters.add(fullname);
    }
  }

  const results = [];
  for (const entry of map.values()) {
    results.push({
      name: entry.name,
      source: entry.source,
      total_votes: entry.voters.size,
      voters: [...entry.voters].sort(),
      nominators: [...entry.nominators].sort(),
    });
  }

  results.sort((a, b) => b.total_votes - a.total_votes || a.name.localeCompare(b.name));
  return results;
}

module.exports = { aggregateTheme, normalizeName };
