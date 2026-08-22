'use strict';

/**
 * 数据访问层（Data Access Layer）。
 * 基于 Node.js 内置的 node:sqlite（零原生依赖），持久化到 data/voting.db。
 *
 * 核心表：
 *  1. voting_activity         活动配置表（会议室总数、规则参数、两套预设名称、投票时间状态）
 *  2. user_theme_vote         用户-主题投票记录表（一个用户一个主题一条记录，编辑即覆盖）
 *  3. aggregated_name_result  自动聚合榜单表（每个主题独立计算）
 * 支撑表：
 *  app_user                   实名用户表（登录姓名 → 稳定 user_id，用于实名制）
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { DEFAULT_CONFIG } = require('./config');
const { aggregateTheme } = require('./aggregation');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'voting.db');

let db = null;

/** 根据当前时间与起止时间推导活动状态：NotStarted / VotingOpen / VotingClosed */
function computeStatus(config, now = new Date()) {
  const start = new Date(config.voting_start_at);
  const end = new Date(config.voting_end_at);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'VotingOpen';
  if (now.getTime() < start.getTime()) return 'NotStarted';
  if (now.getTime() > end.getTime()) return 'VotingClosed';
  return 'VotingOpen';
}

/** 初始化数据库：建表 + 首次启动写入默认活动配置 */
function initDb() {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS voting_activity (
      id                        INTEGER PRIMARY KEY AUTOINCREMENT,
      site_title                TEXT NOT NULL,
      total_meeting_rooms       INTEGER NOT NULL,
      max_preset_per_theme      INTEGER NOT NULL,
      max_nominations_per_theme INTEGER NOT NULL,
      max_nomination_inputs     INTEGER NOT NULL,
      galaxy_presets            TEXT NOT NULL,
      landscape_presets         TEXT NOT NULL,
      voting_start_at           TEXT NOT NULL,
      voting_end_at             TEXT NOT NULL,
      updated_at                TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS app_user (
      user_id  TEXT PRIMARY KEY,
      fullname TEXT NOT NULL UNIQUE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_theme_choice (
      user_id            TEXT PRIMARY KEY,
      user_fullname      TEXT NOT NULL,
      chosen_theme       TEXT NOT NULL,
      last_modified_time TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_theme_vote (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id               TEXT NOT NULL,
      user_fullname         TEXT NOT NULL,
      theme_type            TEXT NOT NULL,
      selected_preset_names TEXT NOT NULL,
      user_nominated_names  TEXT NOT NULL,
      last_modified_time    TEXT NOT NULL,
      UNIQUE(user_id, theme_type)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS aggregated_name_result (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      theme_type  TEXT NOT NULL,
      name        TEXT NOT NULL,
      source      TEXT NOT NULL,
      total_votes INTEGER NOT NULL,
      voters      TEXT NOT NULL,
      nominators  TEXT NOT NULL,
      UNIQUE(theme_type, name)
    );
  `);

  // 首次启动：写入默认活动配置
  const exists = db.prepare('SELECT id FROM voting_activity LIMIT 1').get();
  if (!exists) {
    const c = DEFAULT_CONFIG;
    db.prepare(`
      INSERT INTO voting_activity
        (site_title, total_meeting_rooms, max_preset_per_theme, max_nominations_per_theme,
         max_nomination_inputs, galaxy_presets, landscape_presets, voting_start_at, voting_end_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      c.site_title, c.total_meeting_rooms, c.max_preset_per_theme, c.max_nominations_per_theme,
      c.max_nomination_inputs, JSON.stringify(c.galaxy_presets), JSON.stringify(c.landscape_presets),
      c.voting_start_at, c.voting_end_at, new Date().toISOString()
    );
  }

  return db;
}

/* ---------------- 活动配置 ---------------- */

function rowToActivity(row) {
  const config = {
    site_title: row.site_title,
    total_meeting_rooms: row.total_meeting_rooms,
    max_preset_per_theme: row.max_preset_per_theme,
    max_nominations_per_theme: row.max_nominations_per_theme,
    max_nomination_inputs: row.max_nomination_inputs,
    galaxy_presets: JSON.parse(row.galaxy_presets),
    landscape_presets: JSON.parse(row.landscape_presets),
    voting_start_at: row.voting_start_at,
    voting_end_at: row.voting_end_at,
    updated_at: row.updated_at,
  };
  config.status = computeStatus(config);
  return config;
}

function getActivity() {
  const row = db.prepare('SELECT * FROM voting_activity ORDER BY id DESC LIMIT 1').get();
  return row ? rowToActivity(row) : null;
}

function updateActivity(partial) {
  const current = getActivity();
  const next = {
    site_title: partial.site_title != null ? String(partial.site_title).trim() || current.site_title : current.site_title,
    total_meeting_rooms: intOr(partial.total_meeting_rooms, current.total_meeting_rooms, 1),
    max_preset_per_theme: intOr(partial.max_preset_per_theme, current.max_preset_per_theme, 1),
    max_nominations_per_theme: intOr(partial.max_nominations_per_theme, current.max_nominations_per_theme, 1),
    max_nomination_inputs: intOr(partial.max_nomination_inputs, current.max_nomination_inputs, 1),
    galaxy_presets: arrayOr(partial.galaxy_presets, current.galaxy_presets),
    landscape_presets: arrayOr(partial.landscape_presets, current.landscape_presets),
    voting_start_at: partial.voting_start_at != null ? String(partial.voting_start_at) : current.voting_start_at,
    voting_end_at: partial.voting_end_at != null ? String(partial.voting_end_at) : current.voting_end_at,
  };

  db.prepare(`
    UPDATE voting_activity SET
      site_title = ?, total_meeting_rooms = ?, max_preset_per_theme = ?, max_nominations_per_theme = ?,
      max_nomination_inputs = ?, galaxy_presets = ?, landscape_presets = ?, voting_start_at = ?, voting_end_at = ?, updated_at = ?
    WHERE id = (SELECT id FROM voting_activity ORDER BY id DESC LIMIT 1)
  `).run(
    next.site_title, next.total_meeting_rooms, next.max_preset_per_theme, next.max_nominations_per_theme,
    next.max_nomination_inputs, JSON.stringify(next.galaxy_presets), JSON.stringify(next.landscape_presets),
    next.voting_start_at, next.voting_end_at, new Date().toISOString()
  );
  return getActivity();
}

function intOr(v, fallback, min) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) return fallback;
  return Math.floor(n);
}

function arrayOr(v, fallback) {
  if (Array.isArray(v)) {
    const cleaned = v.map((x) => String(x).trim()).filter(Boolean);
    if (cleaned.length > 0) return cleaned;
  }
  return fallback;
}

/* ---------------- 用户（实名） ---------------- */

function getOrCreateUser(fullname) {
  const name = String(fullname || '').trim();
  const existing = db.prepare('SELECT * FROM app_user WHERE fullname = ?').get(name);
  if (existing) return { user_id: existing.user_id, fullname: existing.fullname };
  const userId = 'u_' + crypto.randomUUID();
  db.prepare('INSERT INTO app_user (user_id, fullname) VALUES (?, ?)').run(userId, name);
  return { user_id: userId, fullname: name };
}

/**
 * 匿名自动命名：用户不填姓名时，服务器分配一个稳定的 Guest 身份。
 * 在浏览器本地生成一个匿名令牌（随机 UUID），同一浏览器始终复用同一身份，
 * 从而满足"一人一票"的隔离要求，同时免去注册/输名字的门槛。
 */
function getOrCreateAnonymousUser(anonToken) {
  const token = String(anonToken || '').trim() || crypto.randomUUID();
  const name = 'Guest-' + token.slice(0, 6).toUpperCase();
  // 匿名身份按 user_id = 'anon_' + token 持久化，保证刷新后仍是同一人
  const userId = 'anon_' + token;
  const existing = db.prepare('SELECT * FROM app_user WHERE user_id = ?').get(userId);
  if (existing) return { user_id: existing.user_id, fullname: existing.fullname };
  db.prepare('INSERT INTO app_user (user_id, fullname) VALUES (?, ?)').run(userId, name);
  return { user_id: userId, fullname: name };
}

/**
 * 匿名用户可选"设置真实名字"：只更新显示名，不改变 user_id，
 * 因此已投的票与一人一票限制都保持不变。
 */
function renameAnonymousUser(anonToken, newName) {
  const token = String(anonToken || '').trim();
  const name = String(newName || '').trim();
  if (!token || !name) throw new Error('Token and name are required.');
  const userId = 'anon_' + token;
  const user = db.prepare('SELECT * FROM app_user WHERE user_id = ?').get(userId);
  if (!user) throw new Error('Anonymous session not found.');
  db.prepare('UPDATE app_user SET fullname = ? WHERE user_id = ?').run(name, userId);
  return { user_id: userId, fullname: name };
}

/* ---------------- 主题选择（每人只能选一个主题） ---------------- */

function getThemeChoice(userId) {
  const row = db.prepare('SELECT * FROM user_theme_choice WHERE user_id = ?').get(userId);
  return row ? {
    user_id: row.user_id,
    user_fullname: row.user_fullname,
    chosen_theme: row.chosen_theme,
    last_modified_time: row.last_modified_time,
  } : null;
}

function upsertThemeChoice(userId, fullname, chosenTheme) {
  const theme = String(chosenTheme || '').toLowerCase();
  if (theme !== 'galaxy' && theme !== 'landscape') {
    throw new Error('Theme must be galaxy or landscape.');
  }
  // 一人一票：只要用户已在任一种主题投过名字票，就禁止再选/改选其他主题。
  // （首次选主题、或未投票仅改选主题时，hasVotedAnyTheme 返回 false，放行。）
  const existingChoice = getThemeChoice(userId);
  if (existingChoice && existingChoice.chosen_theme !== theme && hasVotedAnyTheme(userId)) {
    throw new Error('VOTE_LOCKED: You have already submitted a vote in the ' +
      (existingChoice.chosen_theme === 'galaxy' ? 'Galaxy' : 'Natural Landscape') +
      ' theme. Each person may vote only once, in a single theme.');
  }
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO user_theme_choice (user_id, user_fullname, chosen_theme, last_modified_time)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      user_fullname = excluded.user_fullname,
      chosen_theme = excluded.chosen_theme,
      last_modified_time = excluded.last_modified_time
  `).run(userId, fullname, theme, now);

  // 切换主题后，删除用户在另一主题的投票记录（保证每人只参与一个主题）
  const otherTheme = theme === 'galaxy' ? 'NaturalLandscape' : 'Galaxy';
  db.prepare('DELETE FROM user_theme_vote WHERE user_id = ? AND theme_type = ?').run(userId, otherTheme);
  return getThemeChoice(userId);
}

/**
 * 用户是否已在任一主题投过名字票（用于"一人一票、锁定主题"硬校验）。
 * 只要 user_theme_vote 中存在该用户任意一条记录即视为已投票。
 */
function hasVotedAnyTheme(userId) {
  const row = db.prepare('SELECT 1 FROM user_theme_vote WHERE user_id = ? LIMIT 1').get(userId);
  return !!row;
}

function getThemeChoiceStats() {
  const galaxy = db.prepare("SELECT COUNT(*) AS c FROM user_theme_choice WHERE chosen_theme = 'galaxy'").get().c || 0;
  const landscape = db.prepare("SELECT COUNT(*) AS c FROM user_theme_choice WHERE chosen_theme = 'landscape'").get().c || 0;
  const total = galaxy + landscape;
  return {
    total,
    galaxy: { count: galaxy, percent: total ? Math.round((galaxy / total) * 1000) / 10 : 0 },
    landscape: { count: landscape, percent: total ? Math.round((landscape / total) * 1000) / 10 : 0 },
  };
}

/* ---------------- 投票记录 ---------------- */

function voteRowToObj(row) {
  return {
    user_id: row.user_id,
    user_fullname: row.user_fullname,
    theme_type: row.theme_type,
    selected_preset_names: JSON.parse(row.selected_preset_names),
    user_nominated_names: JSON.parse(row.user_nominated_names),
    last_modified_time: row.last_modified_time,
  };
}

function getVote(userId, themeType) {
  const row = db.prepare('SELECT * FROM user_theme_vote WHERE user_id = ? AND theme_type = ?').get(userId, themeType);
  return row ? voteRowToObj(row) : null;
}

function getVotesByTheme(themeType) {
  const rows = db.prepare('SELECT * FROM user_theme_vote WHERE theme_type = ? ORDER BY last_modified_time ASC').all(themeType);
  return rows.map(voteRowToObj);
}

/** 新增或覆盖：同一用户+同一主题仅保留最新一条记录，编辑时覆盖旧记录 */
function upsertVote(userId, fullname, themeType, selected, nominated) {
  const now = new Date().toISOString();
  const sel = JSON.stringify(selected);
  const nom = JSON.stringify(nominated);
  db.prepare(`
    INSERT INTO user_theme_vote (user_id, user_fullname, theme_type, selected_preset_names, user_nominated_names, last_modified_time)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, theme_type) DO UPDATE SET
      user_fullname = excluded.user_fullname,
      selected_preset_names = excluded.selected_preset_names,
      user_nominated_names = excluded.user_nominated_names,
      last_modified_time = excluded.last_modified_time
  `).run(userId, fullname, themeType, sel, nom, now);
  return getVote(userId, themeType);
}

/* ---------------- 聚合榜单 ---------------- */

/** 用新计算结果整体替换某主题的聚合表（保证与投票记录始终一致） */
function replaceAggregation(themeType, entries) {
  db.prepare('DELETE FROM aggregated_name_result WHERE theme_type = ?').run(themeType);
  const ins = db.prepare(`
    INSERT INTO aggregated_name_result (theme_type, name, source, total_votes, voters, nominators)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const e of entries) {
    ins.run(themeType, e.name, e.source, e.total_votes, JSON.stringify(e.voters), JSON.stringify(e.nominators));
  }
}

function getAggregation(themeType) {
  const rows = db.prepare('SELECT * FROM aggregated_name_result WHERE theme_type = ? ORDER BY total_votes DESC, name ASC').all(themeType);
  return rows.map((r) => ({
    name: r.name,
    source: r.source,
    total_votes: r.total_votes,
    voters: JSON.parse(r.voters),
    nominators: JSON.parse(r.nominators),
  }));
}

/* ---------------- 管理员：用户与数据清理 ---------------- */

/**
 * 列出所有参与用户（含是否已选主题、是否已投票、所选主题），用于后台管理。
 * 同时返回每个用户对应的真实 user_id，供删除时精确匹配。
 */
function listUsersWithVotes() {
  const rows = db.prepare(`
    SELECT
      u.user_id, u.fullname,
      tc.chosen_theme AS chosen_theme,
      (SELECT 1 FROM user_theme_vote v WHERE v.user_id = u.user_id LIMIT 1) AS has_voted
    FROM app_user u
    LEFT JOIN user_theme_choice tc ON tc.user_id = u.user_id
    ORDER BY u.fullname COLLATE NOCASE ASC
  `).all();
  return rows.map((r) => ({
    user_id: r.user_id,
    fullname: r.fullname,
    chosen_theme: r.chosen_theme || null,
    has_voted: !!r.has_voted,
  }));
}

/**
 * 删除指定用户（按姓名精确匹配，大小写不敏感）。
 * 同步清理其主题选择、名字投票、用户主记录，并返回受影响需要重聚合的主题。
 */
function deleteUserByFullname(fullname) {
  const name = String(fullname || '').trim();
  if (!name) throw new Error('Full name is required.');
  const user = db.prepare('SELECT * FROM app_user WHERE LOWER(fullname) = LOWER(?)').get(name);
  if (!user) throw new Error('User not found: ' + name);

  // 该用户投过的主题（用于后续重聚合）
  const votedThemes = db.prepare('SELECT DISTINCT theme_type FROM user_theme_vote WHERE user_id = ?').all(user.user_id)
    .map((r) => r.theme_type);

  db.prepare('DELETE FROM user_theme_vote WHERE user_id = ?').run(user.user_id);
  db.prepare('DELETE FROM user_theme_choice WHERE user_id = ?').run(user.user_id);
  db.prepare('DELETE FROM app_user WHERE user_id = ?').run(user.user_id);

  return { fullname: name, voted_themes: votedThemes };
}

/**
 * 导出全部投票数据为 CSV 字符串（管理员用）。
 * 包含：每个投票用户的姓名、所选主题、该主题的勾选预设名、个人提名、提交时间；
 * 以及两个主题的聚合榜单（名称、来源、票数）。
 */
function csvCell(v) {
  const s = String(v == null ? '' : v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function exportVotesCsv() {
  const activity = getActivity();
  const themeChoice = getThemeChoiceStats();
  const lines = [];

  // 区块一：主题选择统计
  lines.push('=== THEME CHOICE SUMMARY ===');
  lines.push(['Theme', 'Voters', 'Percent'].map(csvCell).join(','));
  lines.push([csvCell('Galaxy'), themeChoice.galaxy.count, themeChoice.galaxy.percent + '%'].join(','));
  lines.push([csvCell('Natural Landscape'), themeChoice.landscape.count, themeChoice.landscape.percent + '%'].join(','));
  lines.push([csvCell('Total'), themeChoice.total, ''].join(','));
  lines.push('');

  // 区块二：逐票明细
  lines.push('=== VOTE DETAILS ===');
  lines.push(['Voter Name', 'Chosen Theme', 'Selected Preset Names', 'Nominated Names', 'Submitted At'].map(csvCell).join(','));
  const detailRows = db.prepare(`
    SELECT u.fullname AS name, tc.chosen_theme AS theme, v.selected_preset_names, v.user_nominated_names, v.last_modified_time
    FROM app_user u
    LEFT JOIN user_theme_vote v ON v.user_id = u.user_id
    LEFT JOIN user_theme_choice tc ON tc.user_id = u.user_id
    WHERE v.user_id IS NOT NULL
    ORDER BY v.last_modified_time ASC
  `).all();
  for (const r of detailRows) {
    const theme = r.theme === 'galaxy' ? 'Galaxy' : (r.theme === 'landscape' ? 'Natural Landscape' : r.theme || '');
    const sel = (JSON.parse(r.selected_preset_names || '[]')).join(' | ');
    const nom = (JSON.parse(r.user_nominated_names || '[]')).join(' | ');
    lines.push([csvCell(r.name), csvCell(theme), csvCell(sel), csvCell(nom), csvCell(r.last_modified_time)].join(','));
  }
  lines.push('');

  // 区块三：聚合榜单（Galaxy）
  lines.push('=== GALAXY RANKING ===');
  lines.push(['Name', 'Source', 'Votes', 'Voters', 'Nominators'].map(csvCell).join(','));
  for (const e of getAggregation('Galaxy')) {
    lines.push([csvCell(e.name), csvCell(e.source), e.total_votes, csvCell(e.voters.join(' | ')), csvCell(e.nominators.join(' | '))].join(','));
  }
  lines.push('');

  // 区块四：聚合榜单（Natural Landscape）
  lines.push('=== NATURAL LANDSCAPE RANKING ===');
  lines.push(['Name', 'Source', 'Votes', 'Voters', 'Nominators'].map(csvCell).join(','));
  for (const e of getAggregation('NaturalLandscape')) {
    lines.push([csvCell(e.name), csvCell(e.source), e.total_votes, csvCell(e.voters.join(' | ')), csvCell(e.nominators.join(' | '))].join(','));
  }

  return lines.join('\r\n');
}

/**
 * 清空所有投票与测试数据（保留活动配置 voting_activity 不变）：
 * 删除 app_user / user_theme_choice / user_theme_vote，
 * 并把 aggregated_name_result 重置为仅含预设名称、0 票的初始状态。
 */
function clearAllVotes() {
  db.prepare('DELETE FROM user_theme_vote').run();
  db.prepare('DELETE FROM user_theme_choice').run();
  db.prepare('DELETE FROM app_user').run();

  const activity = getActivity();
  for (const [, themeType, presets] of [
    ['galaxy', 'Galaxy', activity.galaxy_presets],
    ['landscape', 'NaturalLandscape', activity.landscape_presets],
  ]) {
    db.replaceAggregation(themeType, aggregateTheme([], presets));
  }
}

module.exports = {
  initDb,
  getActivity,
  updateActivity,
  getOrCreateUser,
  getOrCreateAnonymousUser,
  renameAnonymousUser,
  exportVotesCsv,
  getThemeChoice,
  upsertThemeChoice,
  hasVotedAnyTheme,
  getThemeChoiceStats,
  getVote,
  getVotesByTheme,
  upsertVote,
  replaceAggregation,
  getAggregation,
  listUsersWithVotes,
  deleteUserByFullname,
  clearAllVotes,
};
