const { userHasPermission } = require('./rolePermissions');
const { normalizeBranchIdKey } = require('./branchIdMatch');

function isActiveUser(user) {
  return user?.is_active !== false && user?.is_active !== 0;
}

/**
 * Who should be told that an expense is waiting for approval.
 *
 * Approval follows the filial that spends the money, so a manager only hears about
 * their own branch. Admins and users with no branch of their own (head office) are
 * the exception — they oversee every filial.
 */
function selectExpenseApprovers(users, branchId) {
  const wanted = normalizeBranchIdKey(branchId);
  return (Array.isArray(users) ? users : []).filter((user) => {
    if (!isActiveUser(user)) return false;
    if (!userHasPermission(user.role, user.permissions, 'expense_approve')) return false;
    if (user.role === 'admin') return true;
    const own = normalizeBranchIdKey(user.branch_id);
    return !own || !wanted || own === wanted;
  });
}

module.exports = { selectExpenseApprovers };
