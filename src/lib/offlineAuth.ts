import bcrypt from 'bcryptjs';
import type { User } from '@/types/erp';

const CACHE_KEY = 'kwanza_offline_login_cache';
export const OFFLINE_MODE_KEY = 'kwanza_offline_mode';

type OfflineLoginCache = {
  identifier: string;
  passwordHash: string;
  user: User;
  cachedAt: string;
};

function normalizeLoginId(raw: string): string {
  return String(raw || '').trim().toLowerCase();
}

function loginIdsMatch(cachedId: string, entered: string): boolean {
  const a = normalizeLoginId(cachedId);
  const b = normalizeLoginId(entered);
  if (!a || !b) return false;
  if (a === b) return true;
  const aLocal = a.includes('@') ? a.split('@')[0] : a;
  const bLocal = b.includes('@') ? b.split('@')[0] : b;
  return aLocal === bLocal;
}

export function isOfflineModeActive(): boolean {
  try {
    return localStorage.getItem(OFFLINE_MODE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setOfflineModeActive(active: boolean): void {
  try {
    if (active) localStorage.setItem(OFFLINE_MODE_KEY, 'true');
    else localStorage.removeItem(OFFLINE_MODE_KEY);
  } catch {
    /* ignore */
  }
}

/** After a successful online login, cache credentials for offline use on this PC. */
export async function cacheOfflineLoginCredential(
  identifier: string,
  password: string,
  user: User,
): Promise<void> {
  const passwordHash = await bcrypt.hash(String(password), 10);
  const payload: OfflineLoginCache = {
    identifier: normalizeLoginId(identifier),
    passwordHash,
    user,
    cachedAt: new Date().toISOString(),
  };
  localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  setOfflineModeActive(false);
}

/** Verify password against last successful online login on this machine. */
export async function tryOfflineLogin(
  identifier: string,
  password: string,
): Promise<User | null> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as OfflineLoginCache;
    if (!cached?.passwordHash || !cached?.user) return null;
    if (!loginIdsMatch(cached.identifier, identifier)) return null;
    const ok = await bcrypt.compare(String(password), cached.passwordHash);
    return ok ? cached.user : null;
  } catch {
    return null;
  }
}

export function clearOfflineLoginCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
    setOfflineModeActive(false);
  } catch {
    /* ignore */
  }
}
