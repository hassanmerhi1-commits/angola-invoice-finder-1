const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET } = require('../jwtSecret');
const { getBearerToken } = require('./requireAdmin');
const { touchSession, isSessionRevoked } = require('../lib/sessionLog');
const { parsePermissionOverrides } = require('../lib/rolePermissions');

// Short user-row cache: avoids one DB round-trip on EVERY authenticated request.
// Deactivation / permission edits propagate within USER_CACHE_TTL_MS.
const USER_CACHE_TTL_MS = 15_000;
const userCache = new Map();

function readCachedUser(userId) {
  const hit = userCache.get(userId);
  if (!hit) return null;
  if (Date.now() - hit.at > USER_CACHE_TTL_MS) {
    userCache.delete(userId);
    return null;
  }
  return hit.user;
}

function writeCachedUser(userId, user) {
  userCache.set(userId, { at: Date.now(), user });
  if (userCache.size > 500) {
    const oldest = userCache.keys().next().value;
    if (oldest != null) userCache.delete(oldest);
  }
}

function invalidateUserCache(userId) {
  if (userId != null) userCache.delete(String(userId));
  else userCache.clear();
}

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
    let user = readCachedUser(String(decoded.userId));
    if (!user) {
      let result;
      try {
        result = await db.query(
          'SELECT id, email, name, role, branch_id, is_active, permissions, must_change_password FROM users WHERE id = $1',
          [decoded.userId],
        );
      } catch (_) {
        result = await db.query(
          'SELECT id, email, name, role, branch_id, is_active, permissions FROM users WHERE id = $1',
          [decoded.userId],
        );
      }

      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'User not found' });
      }
      user = result.rows[0];
      writeCachedUser(String(decoded.userId), user);
    }

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
      mustChangePassword: user.must_change_password === true || user.must_change_password === 1,
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

module.exports = { requireAuth, invalidateUserCache };
