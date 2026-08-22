'use strict';

/**
 * 会议室命名投票网站 —— 服务入口。
 * 零外部依赖：仅使用 Node 内置模块（http / fs / path / crypto）+ node:sqlite。
 * 启动：node server/index.js
 *
 * 核心规则（v2）：
 *  每个主题独立计票。用户在一个主题内的"勾选预设 + 有效个人提名"总数不得超过
 *  voting_activity.total_meeting_rooms（同时充当本主题的"票数上限"）。
 *  不同主题的数据完全隔离。
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const db = require('./db');
const auth = require('./auth');
const { aggregateTheme } = require('./aggregation');
const { THEME_TYPES } = require('./config');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

db.initDb();

/* ---------------- 工具 ---------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1_000_000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

/**
 * 校验并规范化"勾选的预设候选"。
 * 限制：最多 combinedCap 条（每个用户在该主题的"勾选 + 提名"总数上限）。
 */
function normalizeSelections(raw, presets, combinedCap) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (out.length >= combinedCap) break;
    const t = String(item || '').trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    const canonical = presets.find((p) => String(p).trim().toLowerCase() === key);
    if (!canonical) continue;
    seen.add(key);
    out.push(String(canonical).trim());
  }
  return out;
}

/**
 * 校验并规范化"个人提名"。
 * 限制：最多 remaining 条（combinedCap - selected.length），过滤空/空白、去重、保留前 N 个。
 */
function normalizeNominations(raw, remaining) {
  if (!Array.isArray(raw) || remaining <= 0) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (out.length >= remaining) break;
    const t = String(item || '').trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function ensureInitialAggregation() {
  const activity = db.getActivity();
  const pairs = [
    ['galaxy', 'Galaxy', activity.galaxy_presets],
    ['landscape', 'NaturalLandscape', activity.landscape_presets],
  ];
  for (const [, themeType, presets] of pairs) {
    if (db.getAggregation(themeType).length === 0) {
      db.replaceAggregation(themeType, aggregateTheme([], presets));
    }
  }
}
ensureInitialAggregation();

function recomputeTheme(themeKey) {
  const activity = db.getActivity();
  const presets = themeKey === 'galaxy' ? activity.galaxy_presets : activity.landscape_presets;
  const themeType = THEME_TYPES[themeKey];
  db.replaceAggregation(themeType, aggregateTheme(db.getVotesByTheme(themeType), presets));
}

function buildResultsPayload() {
  const activity = db.getActivity();
  return {
    activity: {
      site_title: activity.site_title,
      total_meeting_rooms: activity.total_meeting_rooms,
      status: activity.status,
      voting_start_at: activity.voting_start_at,
      voting_end_at: activity.voting_end_at,
    },
    theme_choice_stats: db.getThemeChoiceStats(),
    galaxy: {
      theme_label: 'Galaxy',
      presets: activity.galaxy_presets,
      ranking: db.getAggregation('Galaxy'),
      submissions: db.getVotesByTheme('Galaxy'),
    },
    landscape: {
      theme_label: 'Natural Landscape',
      presets: activity.landscape_presets,
      ranking: db.getAggregation('NaturalLandscape'),
      submissions: db.getVotesByTheme('NaturalLandscape'),
    },
  };
}

/* ---------------- API 路由 ---------------- */

async function handleApi(req, res, pathname, method) {
  try {
    if (pathname === '/api/auth/login' && method === 'POST') {
      const body = await readBody(req);
      const fullname = String(body.fullname || '').trim();
      // 免注册：未提供姓名时自动分配匿名身份（Guest-XXXX），同一浏览器复用同一令牌
      if (!fullname) {
        const anonToken = String(body.anon_token || '').trim() || crypto.randomUUID();
        const user = db.getOrCreateAnonymousUser(anonToken);
        const token = auth.issueUserToken(user, anonToken);
        return sendJson(res, 200, { token, user, anonymous: true, anon_token: anonToken });
      }
      const user = db.getOrCreateUser(fullname);
      return sendJson(res, 200, { token: auth.issueUserToken(user), user });
    }

    // 匿名用户设置真实显示名（不改变 user_id，保留已投票记录）
    if (pathname === '/api/auth/name' && method === 'PUT') {
      const user = auth.requireUser(req);
      if (!user) return sendJson(res, 401, { error: 'Sign in required.' });
      const body = await readBody(req);
      const newName = String(body.fullname || '').trim();
      if (!newName) return sendJson(res, 400, { error: 'Name is required.' });
      let updated;
      try {
        updated = db.renameAnonymousUser(user.anon_token || (user.user_id.startsWith('anon_') ? user.user_id.slice(5) : ''), newName);
      } catch (e) {
        return sendJson(res, 400, { error: e.message });
      }
      return sendJson(res, 200, { token: auth.issueUserToken(updated, user.anon_token), user: updated });
    }

    if (pathname === '/api/auth/admin-login' && method === 'POST') {
      const body = await readBody(req);
      if (String(body.password || '') !== auth.ADMIN_PASSWORD) {
        return sendJson(res, 401, { error: 'Incorrect admin password.' });
      }
      return sendJson(res, 200, { token: auth.issueAdminToken(), admin: true });
    }

    if (pathname === '/api/auth/me' && method === 'GET') {
      const payload = auth.requireUser(req);
      if (!payload) return sendJson(res, 401, { error: 'Not signed in.' });
      return sendJson(res, 200, { user: { user_id: payload.user_id, fullname: payload.fullname } });
    }

    if (pathname === '/api/auth/admin-check' && method === 'GET') {
      if (!auth.requireAdmin(req)) return sendJson(res, 401, { error: 'Admin access required.' });
      return sendJson(res, 200, { admin: true });
    }

    if (pathname === '/api/activity' && method === 'GET') {
      return sendJson(res, 200, { ...db.getActivity(), now: new Date().toISOString() });
    }

    if (pathname === '/api/activity' && method === 'PUT') {
      if (!auth.requireAdmin(req)) return sendJson(res, 401, { error: 'Admin access required.' });
      const body = await readBody(req);
      const activity = db.updateActivity(body);
      recomputeTheme('galaxy');
      recomputeTheme('landscape');
      return sendJson(res, 200, activity);
    }

    if (pathname === '/api/theme-choice' && method === 'GET') {
      const user = auth.requireUser(req);
      if (!user) return sendJson(res, 401, { error: 'Sign in required.' });
      return sendJson(res, 200, {
        choice: db.getThemeChoice(user.user_id),
        stats: db.getThemeChoiceStats(),
      });
    }

    if (pathname === '/api/theme-choice' && method === 'PUT') {
      const user = auth.requireUser(req);
      if (!user) return sendJson(res, 401, { error: 'Sign in required.' });
      const body = await readBody(req);
      const theme = String(body.theme || '').toLowerCase();
      if (theme !== 'galaxy' && theme !== 'landscape') {
        return sendJson(res, 400, { error: 'Theme must be galaxy or landscape.' });
      }
      // 一人一票：只要用户已在任主题投过名，就不允许再选/改选其他主题
      let choice;
      try {
        choice = db.upsertThemeChoice(user.user_id, user.fullname, theme);
      } catch (e) {
        if (String(e.message).startsWith('VOTE_LOCKED:')) {
          return sendJson(res, 403, { error: e.message.replace('VOTE_LOCKED: ', '') });
        }
        throw e;
      }
      recomputeTheme('galaxy');
      recomputeTheme('landscape');
      return sendJson(res, 200, { choice, stats: db.getThemeChoiceStats() });
    }

    if (pathname === '/api/theme-choice/stats' && method === 'GET') {
      return sendJson(res, 200, db.getThemeChoiceStats());
    }

    if (pathname === '/api/votes/mine' && method === 'GET') {
      const user = auth.requireUser(req);
      if (!user) return sendJson(res, 401, { error: 'Sign in required.' });
      return sendJson(res, 200, {
        galaxy: db.getVote(user.user_id, 'Galaxy'),
        landscape: db.getVote(user.user_id, 'NaturalLandscape'),
      });
    }

    const voteMatch = pathname.match(/^\/api\/votes\/(galaxy|landscape)$/);
    if (voteMatch && method === 'PUT') {
      const themeKey = voteMatch[1];
      const user = auth.requireUser(req);
      if (!user) return sendJson(res, 401, { error: 'Sign in required.' });

      const activity = db.getActivity();
      if (activity.status !== 'VotingOpen') {
        return sendJson(res, 403, { error: 'Voting is not open at the moment.' });
      }

      // 每人只能投一个主题：必须先选主题，且只能投已选主题
      const choice = db.getThemeChoice(user.user_id);
      if (!choice) {
        return sendJson(res, 400, { error: 'Please choose a theme on the homepage before voting on names.' });
      }
      if (choice.chosen_theme !== themeKey) {
        return sendJson(res, 400, { error: 'You chose the ' + (choice.chosen_theme === 'galaxy' ? 'Galaxy' : 'Natural Landscape') + ' theme. You can only vote on that theme.' });
      }

      const body = await readBody(req);
      const presets = themeKey === 'galaxy' ? activity.galaxy_presets : activity.landscape_presets;
      // 核心规则：本主题"勾选预设 + 有效提名"总数 ≤ total_meeting_rooms
      const combinedCap = Math.max(1, activity.total_meeting_rooms);
      const selected = normalizeSelections(body.selected_preset_names, presets, combinedCap);
      const remaining = Math.max(0, combinedCap - selected.length);
      const nominated = normalizeNominations(
        body.nominated_inputs ?? body.user_nominated_names,
        remaining
      );

      if (selected.length === 0 && nominated.length === 0) {
        return sendJson(res, 400, { error: 'Select at least one preset name or provide a nomination.' });
      }

      const themeType = THEME_TYPES[themeKey];
      const vote = db.upsertVote(user.user_id, user.fullname, themeType, selected, nominated);
      recomputeTheme(themeKey);
      return sendJson(res, 200, {
        vote,
        cap: {
          combined_limit: combinedCap,
          selected_count: selected.length,
          nomination_count: nominated.length,
          used: selected.length + nominated.length,
          remaining: combinedCap - selected.length - nominated.length,
        },
      });
    }

    /* ---------------- 管理员：用户与数据清理 ---------------- */

    if (pathname === '/api/admin/users' && method === 'GET') {
      if (!auth.requireAdmin(req)) return sendJson(res, 401, { error: 'Admin access required.' });
      return sendJson(res, 200, { users: db.listUsersWithVotes() });
    }

    const delUserMatch = pathname.match(/^\/api\/admin\/users\/(.+)$/);
    if (delUserMatch && method === 'DELETE') {
      if (!auth.requireAdmin(req)) return sendJson(res, 401, { error: 'Admin access required.' });
      const fullname = decodeURIComponent(delUserMatch[1]);
      let result;
      try {
        result = db.deleteUserByFullname(fullname);
      } catch (e) {
        return sendJson(res, 404, { error: e.message });
      }
      // 重聚合受影响主题
      for (const t of result.voted_themes) {
        const themeKey = t === 'Galaxy' ? 'galaxy' : 'landscape';
        recomputeTheme(themeKey);
      }
      return sendJson(res, 200, { deleted: result, stats: db.getThemeChoiceStats() });
    }

    if (pathname === '/api/admin/clear' && method === 'POST') {
      if (!auth.requireAdmin(req)) return sendJson(res, 401, { error: 'Admin access required.' });
      db.clearAllVotes();
      return sendJson(res, 200, {
        cleared: true,
        stats: db.getThemeChoiceStats(),
        results: buildResultsPayload(),
      });
    }

    // 管理员导出投票数据（CSV 下载）
    if (pathname === '/api/admin/export' && method === 'GET') {
      if (!auth.requireAdmin(req)) return sendJson(res, 401, { error: 'Admin access required.' });
      const csv = db.exportVotesCsv();
      const fname = 'voting-data-' + new Date().toISOString().slice(0, 10) + '.csv';
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="' + fname + '"',
        'Cache-Control': 'no-store',
      });
      return res.end('﻿' + csv); // ﻿ = BOM，Excel 正确识别 UTF-8
    }

    if (pathname === '/api/results' && method === 'GET') {
      return sendJson(res, 200, buildResultsPayload());
    }

    return sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error('[api error]', err);
    return sendJson(res, 500, { error: 'Internal server error' });
  }
}

/* ---------------- 静态文件 ---------------- */

function serveStatic(req, res, pathname) {
  let rel = pathname;
  if (rel === '/' || rel === '/index') rel = '/index.html';
  else if (rel === '/results') rel = '/results.html';
  else if (rel === '/admin') rel = '/admin.html';

  let resolved;
  try {
    resolved = path.normalize(path.join(PUBLIC_DIR, rel));
  } catch {
    return sendJson(res, 400, { error: 'Bad request' });
  }
  if (!resolved.startsWith(PUBLIC_DIR)) {
    return sendJson(res, 403, { error: 'Forbidden' });
  }

  fs.readFile(resolved, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('Not Found');
    }
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

/* ---------------- 服务器 ---------------- */

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return sendJson(res, 400, { error: 'Bad request' });
  }
  const method = (req.method || 'GET').toUpperCase();

  if (pathname.startsWith('/api/')) {
    return handleApi(req, res, pathname, method);
  }
  if (method !== 'GET' && method !== 'HEAD') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }
  return serveStatic(req, res, pathname);
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  Meeting room name voting — server running');
  console.log(`  Vote:    http://localhost:${PORT}/`);
  console.log(`  Results: http://localhost:${PORT}/results`);
  console.log(`  Admin:   http://localhost:${PORT}/admin`);
  console.log(`  Admin password (default): ${auth.ADMIN_PASSWORD}`);
  console.log('');
});