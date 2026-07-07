/**
 * Treat loopback requests as system admin (Electron embedded Express calls).
 * Only 127.0.0.1 / ::1 — never exposed to LAN clients.
 */
function isLoopbackIp(req) {
  const ip = String(req.ip || req.socket?.remoteAddress || '').trim();
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function attachLoopbackSystemUser(req, res, next) {
  if (!isLoopbackIp(req)) {
    return res.status(403).json({ error: 'Internal endpoint — loopback only' });
  }
  if (!req.user) {
    req.user = {
      id: 'system-internal',
      email: 'system@localhost',
      name: 'System',
      role: 'admin',
      branchId: null,
      permissionOverrides: null,
    };
  }
  return next();
}

module.exports = { isLoopbackIp, attachLoopbackSystemUser };
