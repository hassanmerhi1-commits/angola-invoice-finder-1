/**
 * When the user must change a default/seed password, block mutating API calls
 * except auth self-service endpoints (change-password, logout, me).
 */
function mustChangePasswordGate(req, res, next) {
  if (!req.user?.mustChangePassword) return next();

  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();

  const path = String(req.path || '');
  const allowed =
    path === '/api/auth/change-password'
    || path === '/api/auth/logout'
    || path === '/api/auth/me';

  if (allowed) return next();

  return res.status(403).json({
    error: 'Password change required before continuing',
    code: 'MUST_CHANGE_PASSWORD',
  });
}

module.exports = { mustChangePasswordGate };
