// User Management Hook — API-First
import { useState, useEffect, useCallback } from 'react';
import { User } from '@/types/erp';
import { UserRole } from '@/lib/permissions';
import { api } from '@/lib/api/client';
import { isDemoMode } from '@/lib/api/config';

function normalizeUser(row: Record<string, unknown>): User {
  const isActiveRaw = row.is_active ?? row.isActive;
  const isActive =
    isActiveRaw === undefined || isActiveRaw === null
      ? true
      : isActiveRaw === true || isActiveRaw === 1 || isActiveRaw === '1';

  return {
    id: String(row.id),
    email: String(row.email || ''),
    name: String(row.name || ''),
    username: row.username
      ? String(row.username)
      : String(row.email || '').includes('@')
        ? String(row.email).split('@')[0]
        : undefined,
    role: (row.role as User['role']) || 'viewer',
    branchId: String(row.branch_id ?? row.branchId ?? ''),
    isActive,
    createdAt: String(row.created_at ?? row.createdAt ?? new Date().toISOString()),
    updatedAt: row.updated_at || row.updatedAt ? String(row.updated_at ?? row.updatedAt) : undefined,
  };
}

function readLocalUsers(): User[] {
  try {
    const raw = localStorage.getItem('kwanzaerp_users');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((row) => normalizeUser(row));
  } catch {
    return [];
  }
}

function saveLocalUsers(users: User[]) {
  localStorage.setItem('kwanzaerp_users', JSON.stringify(users));
}

export function useUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUsers = useCallback(async () => {
    setIsLoading(true);
    try {
      const usersResponse = await api.users.list();
      if (usersResponse.error) {
        throw new Error(usersResponse.error);
      }
      if (Array.isArray(usersResponse.data) && usersResponse.data.length > 0) {
        const normalized = usersResponse.data.map((row) => normalizeUser(row));
        setUsers(normalized);
        saveLocalUsers(normalized);
        return;
      }
      const local = readLocalUsers();
      setUsers(local);
    } catch {
      setUsers(readLocalUsers());
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUsers();
  }, [refreshUsers]);

  const createUser = useCallback(
    async (data: {
      email: string;
      name: string;
      username?: string;
      role: UserRole;
      branchId: string;
      password?: string;
    }): Promise<User> => {
      const response = await api.users.create(data);
      if (response.data && !response.error) {
        const created = normalizeUser(response.data);
        await refreshUsers();
        return created;
      }

      if (response.error) {
        throw new Error(response.error);
      }

      if (!isDemoMode()) {
        throw new Error('Failed to create user on server');
      }

      const newUser: User = {
        id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        email: data.email,
        name: data.name,
        username: data.username,
        role: data.role,
        branchId: data.branchId,
        isActive: true,
        createdAt: new Date().toISOString(),
      };
      const all = readLocalUsers();
      all.push(newUser);
      saveLocalUsers(all);
      setUsers(all);
      return newUser;
    },
    [refreshUsers],
  );

  const updateUser = useCallback(
    async (user: User): Promise<void> => {
      const response = await api.users.update(user.id, user);
      if (!response.error) {
        await refreshUsers();
        return;
      }

      if (!isDemoMode()) {
        throw new Error(response.error || 'Failed to update user on server');
      }

      const all = readLocalUsers();
      const idx = all.findIndex((u) => u.id === user.id);
      if (idx >= 0) all[idx] = user;
      else all.push(user);
      saveLocalUsers(all);
      setUsers(all);
    },
    [refreshUsers],
  );

  const deleteUser = useCallback(
    async (userId: string): Promise<void> => {
      const response = await api.users.delete(userId);
      if (!response.error) {
        await refreshUsers();
        return;
      }

      if (!isDemoMode()) {
        throw new Error(response.error || 'Failed to delete user on server');
      }

      const all = readLocalUsers().filter((u) => u.id !== userId);
      saveLocalUsers(all);
      setUsers(all);
    },
    [refreshUsers],
  );

  const updateUserRole = useCallback(
    async (userId: string, role: UserRole): Promise<void> => {
      const user = users.find((u) => u.id === userId);
      if (user) {
        await updateUser({ ...user, role, updatedAt: new Date().toISOString() });
      }
    },
    [users, updateUser],
  );

  const toggleUserActive = useCallback(
    async (userId: string): Promise<void> => {
      const user = users.find((u) => u.id === userId);
      if (user) {
        await updateUser({ ...user, isActive: !user.isActive, updatedAt: new Date().toISOString() });
      }
    },
    [users, updateUser],
  );

  const getUserById = useCallback(
    (userId: string): User | undefined => {
      return users.find((u) => u.id === userId);
    },
    [users],
  );

  return {
    users,
    isLoading,
    refreshUsers,
    createUser,
    updateUser,
    deleteUser,
    updateUserRole,
    toggleUserActive,
    getUserById,
  };
}
