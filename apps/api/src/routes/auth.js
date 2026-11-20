/**
 * 认证与用户管理领域路由 (Phase 2 - routes/auth.js)
 * 职责：
 *  - POST /auth/login (密码认证与防暴破限流)
 *  - POST /auth/logout (会话注销)
 *  - GET /auth/me (当前会话信息)
 *  - 用户 CRUD 与权限配置
 */
const auth = require('../auth');

async function handleAuthRoutes(services, req, res, pathname, urlObj, context) {
  const { db, sendJson, parseBody } = context;
  const token = context.token;
  const sessionUser = context.sessionUser;
  const isAdmin = context.isAdmin;
  const isViewerOrAdmin = context.isViewerOrAdmin;

  // 1. 登录
  if (pathname === '/auth/login' && req.method === 'POST') {
    const b = await parseBody(req);
    const clientIp = (req.socket?.remoteAddress || '').replace(/^::ffff:/i, '');
    try {
      const loginRes = auth.login(db, b.username, b.password, clientIp);
      if (!loginRes) return sendJson(res, 401, { error: '用户名或密码错误' });
      res.setHeader('Set-Cookie', `ml_session=${loginRes.token}; Path=/; Max-Age=${30 * 24 * 3600}; HttpOnly; SameSite=Lax`);
      return sendJson(res, 200, { success: true, data: loginRes });
    } catch (err) {
      if (err.code === 'RATE_LIMITED') {
        return sendJson(res, 429, { error: err.message });
      }
      return sendJson(res, 500, { error: err.message });
    }
  }

  // 2. 登出
  if (pathname === '/auth/logout' && req.method === 'POST') {
    if (token) auth.logout(db, token);
    res.setHeader('Set-Cookie', 'ml_session=; Path=/; Max-Age=0');
    return sendJson(res, 200, { success: true });
  }

  // 3. 当前会话与用户信息
  if (pathname === '/auth/me' && req.method === 'GET') {
    if (!sessionUser) return sendJson(res, 401, { error: '未登录或会话已过期' });
    return sendJson(res, 200, {
      success: true,
      data: {
        id: sessionUser.id,
        username: sessionUser.username,
        role: sessionUser.role,
        allow_all_models: sessionUser.allow_all_models || 0
      }
    });
  }

  // 4. 用户列表 (Admin 权限)
  if (pathname === '/auth/users' && req.method === 'GET') {
    if (!isAdmin) return sendJson(res, 403, { error: '需要管理员权限' });
    try {
      const users = db.prepare('SELECT id, username, role, is_locked, allow_all_models, created_at FROM users ORDER BY id ASC').all();
      return sendJson(res, 200, { success: true, data: users });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  return false;
}

module.exports = { handleAuthRoutes };
