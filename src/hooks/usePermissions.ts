import { useState, useCallback, useMemo } from 'react';
import {
  UserRole,
  getEffectivePermissions,
  type PermissionOverrides,
} from '@/lib/permissions';
import { useAuth } from '@/hooks/useERP';

/** Read server-persisted permission overrides for a user from local caches. */
function getStoredUserOverrides(userId: string): Partial<PermissionOverrides> | undefined {
  try {
    const cu = JSON.parse(localStorage.getItem('kwanzaerp_current_user') || 'null');
    if (cu?.id === userId && cu?.permissionOverrides) return cu.permissionOverrides;
  } catch { /* ignore */ }
  try {
    const users = JSON.parse(localStorage.getItem('kwanzaerp_users') || '[]');
    if (Array.isArray(users)) {
      const u = users.find((x: { id?: string }) => x?.id === userId);
      if (u?.permissionOverrides) return u.permissionOverrides;
    }
  } catch { /* ignore */ }
  return undefined;
}

const STORAGE_KEY = 'kwanza_user_roles';

interface UserRoleAssignment {
  userId: string;
  role: UserRole;
  customPermissions?: string[]; // Override default role permissions
}

function getUserRoles(): UserRoleAssignment[] {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored ? JSON.parse(stored) : [];
}

function saveUserRoles(roles: UserRoleAssignment[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(roles));
}

export function useUserRoles() {
  const [userRoles, setUserRoles] = useState<UserRoleAssignment[]>(getUserRoles);

  const assignRole = useCallback((userId: string, role: UserRole) => {
    setUserRoles(prev => {
      const existing = prev.filter(ur => ur.userId !== userId);
      const updated = [...existing, { userId, role }];
      saveUserRoles(updated);
      return updated;
    });
  }, []);

  const removeRole = useCallback((userId: string) => {
    setUserRoles(prev => {
      const updated = prev.filter(ur => ur.userId !== userId);
      saveUserRoles(updated);
      return updated;
    });
  }, []);

  const getUserRole = useCallback((userId: string): UserRole => {
    const assignment = userRoles.find(ur => ur.userId === userId);
    if (assignment?.role) {
      return assignment.role;
    }
    
  // Fall back to user's stored role
    const storedUsers = localStorage.getItem('kwanzaerp_users');
    if (storedUsers) {
      try {
        const users = JSON.parse(storedUsers);
        const user = users.find((u: any) => u.id === userId);
        if (user?.role) {
          return user.role as UserRole;
        }
      } catch {
        // Ignore parse errors
      }
    }
    
    return 'viewer';
  }, [userRoles]);

  const setCustomPermissions = useCallback((userId: string, permissions: string[]) => {
    setUserRoles(prev => {
      const updated = prev.map(ur => 
        ur.userId === userId 
          ? { ...ur, customPermissions: permissions }
          : ur
      );
      saveUserRoles(updated);
      return updated;
    });
  }, []);

  return {
    userRoles,
    assignRole,
    removeRole,
    getUserRole,
    setCustomPermissions,
  };
}

export function usePermissions(userId: string | undefined) {
  // Prefer live auth session (JWT user) over parallel localStorage role maps.
  const { user: authUser } = useAuth();
  const { getUserRole, userRoles } = useUserRoles();

  const sessionUser =
    authUser && (!userId || authUser.id === userId) ? authUser : null;

  const role = useMemo((): UserRole => {
    if (sessionUser?.role) return sessionUser.role as UserRole;
    if (!userId) return 'viewer';
    const assignment = userRoles.find((ur) => ur.userId === userId);
    if (assignment?.role) return assignment.role;
    return getUserRole(userId);
  }, [sessionUser, userId, userRoles, getUserRole]);

  const overrides = useMemo(() => {
    if (sessionUser?.permissionOverrides) return sessionUser.permissionOverrides;
    if (!userId) return undefined;
    return getStoredUserOverrides(userId);
  }, [sessionUser, userId]);

  const userPermissions = useMemo(() => {
    if (!userId && !sessionUser) return [];
    return getEffectivePermissions(role, overrides);
  }, [userId, sessionUser, role, overrides]);

  const hasPermission = useCallback((permissionId: string): boolean => {
    // QA: *_delete is admin-only until testing finishes — then delete this block.
    if (permissionId.endsWith('_delete')) return role === 'admin';
    return userPermissions.includes(permissionId);
  }, [userPermissions, role]);

  const hasAnyPermission = useCallback((permissionIds: string[]): boolean => {
    return permissionIds.some((id) => hasPermission(id));
  }, [hasPermission]);

  const hasAllPermissions = useCallback((permissionIds: string[]): boolean => {
    return permissionIds.every((id) => hasPermission(id));
  }, [hasPermission]);

  const isAdmin = role === 'admin';
  const isManager = role === 'manager' || isAdmin;

  return {
    permissions: userPermissions,
    role,
    isAdmin,
    isManager,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
  };
}

// Permission check component
export function usePermissionCheck() {
  const { user: authUser } = useAuth();

  const checkPermission = useCallback((userId: string | undefined, permissionId: string): boolean => {
    if (!userId) return false;

    let role: UserRole = 'viewer';
    let overrides: Partial<PermissionOverrides> | undefined;

    if (authUser?.id === userId) {
      role = (authUser.role as UserRole) || 'viewer';
      overrides = authUser.permissionOverrides;
    } else {
      const roles = getUserRoles();
      const assignment = roles.find((ur) => ur.userId === userId);
      role = assignment?.role || 'viewer';
      if (!assignment?.role) {
        const storedUsers = localStorage.getItem('kwanzaerp_users');
        if (storedUsers) {
          try {
            const users = JSON.parse(storedUsers);
            const user = users.find((u: { id?: string; role?: UserRole }) => u.id === userId);
            if (user?.role) role = user.role;
          } catch {
            // Ignore
          }
        }
      }
      overrides = getStoredUserOverrides(userId);
    }

    // QA: *_delete is admin-only until testing finishes — then delete this block.
    if (permissionId.endsWith('_delete')) return role === 'admin';
    return getEffectivePermissions(role, overrides).includes(permissionId);
  }, [authUser]);

  return { checkPermission };
}
