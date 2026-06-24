const { userHasPermission } = require('../lib/rolePermissions');

/**
 * Requires req.user (use after requireAuth).
 * Honors per-user permission overrides (req.user.permissionOverrides) on top of the role.
 */
function requirePermission(...permissionIds) {
  return (req, res, next) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const allowed = permissionIds.some((id) => userHasPermission(user.role, user.permissionOverrides, id));
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
