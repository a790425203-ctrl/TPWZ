'use strict';

/* 统一的 API 客户端 + 登录态管理（经典脚本，挂载到 window.Api） */

window.Api = (function () {
  const TOKEN_KEY = 'mrv_token';
  const USER_KEY = 'mrv_user';

  function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
  function getUser() { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; } }
  function setSession(token, user) { localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(USER_KEY, JSON.stringify(user)); }
  function clearSession() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); }

  /**
   * 通用请求。
   * @param {string} method
   * @param {string} path
   * @param {object} [body]
   * @param {string} [tokenOverride] 覆盖令牌（管理员页使用）
   */
  async function request(method, path, body, tokenOverride) {
    const headers = { 'Content-Type': 'application/json' };
    const token = tokenOverride || getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const res = await fetch(path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    let data = null;
    try { data = await res.json(); } catch { /* 非 JSON 响应 */ }

    if (!res.ok) {
      const err = new Error((data && data.error) || ('Request failed (' + res.status + ')'));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  return {
    getToken, getUser, setSession, clearSession, request,
    login: (fullname, anonToken) => request('POST', '/api/auth/login', fullname ? { fullname } : { anon_token: anonToken }),
    setMyName: (fullname) => request('PUT', '/api/auth/name', { fullname }),
    adminLogin: (password) => request('POST', '/api/auth/admin-login', { password }),
    adminCheck: (token) => request('GET', '/api/auth/admin-check', null, token),
    me: () => request('GET', '/api/auth/me'),
    getActivity: () => request('GET', '/api/activity'),
    updateActivity: (cfg, token) => request('PUT', '/api/activity', cfg, token),
    getMyThemeChoice: () => request('GET', '/api/theme-choice'),
    saveThemeChoice: (theme) => request('PUT', '/api/theme-choice', { theme }),
    getThemeChoiceStats: () => request('GET', '/api/theme-choice/stats'),
    getMyVotes: () => request('GET', '/api/votes/mine'),
    saveVote: (themeKey, selected, nominatedInputs) =>
      request('PUT', '/api/votes/' + themeKey, { selected_preset_names: selected, nominated_inputs: nominatedInputs }),
    getResults: () => request('GET', '/api/results'),
    adminListUsers: (token) => request('GET', '/api/admin/users', null, token),
    adminDeleteUser: (fullname, token) =>
      request('DELETE', '/api/admin/users/' + encodeURIComponent(fullname), null, token),
    adminClearAll: (token) => request('POST', '/api/admin/clear', {}, token),
  };
})();
