import { useState, useCallback, useMemo } from 'react';
import { UserRole, PERMISSIONS, DEFAULT_ROLE_PERMISSIONS } from '@/lib/permissions';

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
  const { getUserRole, userRoles } = useUserRoles();

  // Helper to get user role from storage
  const getStoredUserRole = (id: string): UserRole => {
    // Check current user first
    const currentUserStr = localStorage.getItem('kwanzaerp_current_user');
    if (currentUserStr) {
      try {
        const currentUser = JSON.parse(currentUserStr);
        if (currentUser?.id === id && currentUser?.role) {
          return currentUser.role as UserRole;
        }
      } catch {
        // Ignore
      }
    }
    
    // Check users list
    const storedUsers = localStorage.getItem('kwanzaerp_users');
    if (storedUsers) {
      try {
        const users = JSON.parse(storedUsers);
        const user = users.find((u: any) => u.id === id);
        if (user?.role) {
          return user.role as UserRole;
        }
      } catch {
        // Ignore
      }
    }
    
    return 'viewer';
  };

  const userPermissions = useMemo(() => {
    if (!userId) return [];
    
    const assignment = userRoles.find(ur => ur.userId === userId);
    
    // If custom permissions are set, use those
    if (assignment?.customPermissions) {
      return assignment.customPermissions;
    }
    
    // Get role from assignment, or fall back to user's stored role
    let role: UserRole;
    if (assignment?.role) {
      role = assignment.role;
    } else {
      role = getStoredUserRole(userId);
    }
    
    const rolePerms = DEFAULT_ROLE_PERMISSIONS.find(rp => rp.role === role);
    return rolePerms?.permissions || [];
  }, [userId, userRoles, getUserRole]);

  const hasPermission = useCallback((permissionId: string): boolean => {
    // TESTING OVERRIDE: delete actions are enabled for every role during QA.
    // Remove this block to restore role-based delete restrictions.
    if (permissionId.endsWith('_delete')) return true;
    return userPermissions.includes(permissionId);
  }, [userPermissions]);

  const hasAnyPermission = useCallback((permissionIds: string[]): boolean => {
    return permissionIds.some(id => userPermissions.includes(id));
  }, [userPermissions]);

  const hasAllPermissions = useCallback((permissionIds: string[]): boolean => {
    return permissionIds.every(id => userPermissions.includes(id));
  }, [userPermissions]);

  const role = useMemo(() => {
    if (!userId) return 'viewer' as UserRole;
    
    // First check role assignments
    const assignment = userRoles.find(ur => ur.userId === userId);
    if (assignment?.role) {
      return assignment.role;
    }
    
    // Fall back to stored user's role (check current user first, then users list)
    // Check current user first
    const currentUserStr = localStorage.getItem('kwanzaerp_current_user');
    if (currentUserStr) {
      try {
        const currentUser = JSON.parse(currentUserStr);
        if (currentUser?.id === userId && currentUser?.role) {
          return currentUser.role as UserRole;
        }
      } catch {
        // Ignore
      }
    }
    
    // Check users list
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
    
    return 'viewer' as UserRole;
  }, [userId, userRoles]);

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
  const checkPermission = useCallback((userId: string | undefined, permissionId: string): boolean => {
    if (!userId) return false;
    
    const roles = getUserRoles();
    const assignment = roles.find(ur => ur.userId === userId);
    
    if (assignment?.customPermissions) {
      return assignment.customPermissions.includes(permissionId);
    }
    
    // Get role from assignment or fall back to user's stored role
    let role: UserRole = 'viewer';
    if (assignment?.role) {
      role = assignment.role;
    } else {
      const storedUsers = localStorage.getItem('kwanzaerp_users');
      if (storedUsers) {
        try {
          const users = JSON.parse(storedUsers);
          const user = users.find((u: any) => u.id === userId);
          if (user?.role) {
            role = user.role as UserRole;
          }
        } catch {
          // Ignore
        }
      }
    }
    
    const rolePerms = DEFAULT_ROLE_PERMISSIONS.find(rp => rp.role === role);
    return rolePerms?.permissions.includes(permissionId) || false;
  }, []);

  return { checkPermission };
}
