const { roleHasPermission } = require('../lib/rolePermissions');

/**
 * Requires req.user (use after requireAuth).
 */
function requirePermission(...permissionIds) {
  return (req, res, next) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const allowed = permissionIds.some((id) => roleHasPermission(user.role, id));
    if (!allowed) {
      return res.status(403).json({
        error: 'Permission denied',
        required: permissionIds,
      });
    }
    return next();
  };
}

module.exports = { requirePermission };
