'use strict';

/**
 * 实名认证模块。
 * 采用无状态 HMAC 签名令牌（无需服务端会话存储，重启不失效）。
 * - 用户令牌：{ user_id, fullname, exp }
 * - 管理员令牌：{ is_admin: true, exp }
 * 生产环境请通过环境变量 SESSION_SECRET / ADMIN_PASSWORD 覆盖默认值。
 */

const crypto = require('node:crypto');

const SECRET = process.env.SESSION_SECRET || 'meeting-room-name-voting-demo-secret';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function issueUserToken(user, anonToken) {
  const payload = { user_id: user.user_id, fullname: user.fullname, exp: Date.now() + TOKEN_TTL_MS };
  if (anonToken) payload.anon_token = anonToken;
  return sign(payload);
}

function issueAdminToken() {
  return sign({ is_admin: true, exp: Date.now() + TOKEN_TTL_MS });
}

/** 从 Authorization: Bearer <token> 头提取令牌 */
function extractBearer(req) {
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

/** 校验普通用户令牌，失败返回 null */
function requireUser(req) {
  const payload = verify(extractBearer(req));
  if (!payload || !payload.user_id) return null;
  return payload;
}

/** 校验管理员令牌，失败返回 null */
function requireAdmin(req) {
  const payload = verify(extractBearer(req));
  if (!payload || !payload.is_admin) return null;
  return payload;
}

module.exports = {
  sign,
  verify,
  issueUserToken,
  issueAdminToken,
  extractBearer,
  requireUser,
  requireAdmin,
  ADMIN_PASSWORD,
};
