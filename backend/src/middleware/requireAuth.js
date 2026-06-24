const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET } = require('../jwtSecret');
const { getBearerToken } = require('./requireAdmin');
const { touchSession, isSessionRevoked } = require('../lib/sessionLog');
const { parsePermissionOverrides } = require('../lib/rolePermissions');

/**
 * Requires a valid JWT and an active user row.
 */
async function requireAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await db.query(
      'SELECT id, email, name, role, branch_id, is_active, permissions FROM users WHERE id = $1',
      [decoded.userId],
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    const active = user.is_active === true || user.is_active === 1;
    if (!active) {
      return res.status(401).json({ error: 'User account is inactive' });
    }

    if (decoded.jti && (await isSessionRevoked(decoded.jti))) {
      return res.status(401).json({ error: 'Session ended. Please sign in again.' });
    }

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      branchId: user.branch_id,
      permissionOverrides: parsePermissionOverrides(user.permissions),
    };
    req.tokenJti = decoded.jti || null;
    if (decoded.jti) {
      touchSession(decoded.jti).catch(() => {});
    }
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { requireAuth };
