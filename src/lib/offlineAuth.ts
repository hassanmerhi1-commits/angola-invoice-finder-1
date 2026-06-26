import bcrypt from 'bcryptjs';
import type { User } from '@/types/erp';

// v1 stored a single user object; v2 stores a map of users keyed by login id so
// every account that has logged in online at least once can log in offline later
// (not just the most recent person).
const LEGACY_CACHE_KEY = 'kwanza_offline_login_cache';
const CACHE_KEY = 'kwanza_offline_login_cache_v2';
export const OFFLINE_MODE_KEY = 'kwanza_offline_mode';

// Cap the store so it can't grow without bound; oldest entries are pruned first.
const MAX_CACHED_USERS = 25;

type OfflineLoginCache = {
  identifier: string;
  passwordHash: string;
  user: User;
  cachedAt: string;
};

type OfflineLoginStore = Record<string, OfflineLoginCache>;

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

function readStore(): OfflineLoginStore {
  let store: OfflineLoginStore = {};
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) store = JSON.parse(raw) as OfflineLoginStore;
  } catch {
    store = {};
  }
  // One-time migration: fold a legacy single-user cache into the v2 map.
  if (Object.keys(store).length === 0) {
    try {
      const legacyRaw = localStorage.getItem(LEGACY_CACHE_KEY);
      if (legacyRaw) {
        const legacy = JSON.parse(legacyRaw) as OfflineLoginCache;
        if (legacy?.identifier && legacy?.passwordHash && legacy?.user) {
          store[normalizeLoginId(legacy.identifier)] = legacy;
          writeStore(store);
        }
      }
    } catch {
      /* ignore malformed legacy cache */
    }
  }
  return store;
}

function writeStore(store: OfflineLoginStore): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(store));
  } catch {
    /* ignore quota/serialization errors */
  }
}

function pruneOldest(store: OfflineLoginStore): void {
  const keys = Object.keys(store);
  if (keys.length <= MAX_CACHED_USERS) return;
  keys
    .sort((a, b) => new Date(store[a]?.cachedAt || 0).getTime() - new Date(store[b]?.cachedAt || 0).getTime())
    .slice(0, keys.length - MAX_CACHED_USERS)
    .forEach((k) => delete store[k]);
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

/** After a successful online login, cache this user's credentials for offline use on this PC. */
export async function cacheOfflineLoginCredential(
  identifier: string,
  password: string,
  user: User,
): Promise<void> {
  const passwordHash = await bcrypt.hash(String(password), 10);
  const entry: OfflineLoginCache = {
    identifier: normalizeLoginId(identifier),
    passwordHash,
    user,
    cachedAt: new Date().toISOString(),
  };
  const store = readStore();
  store[normalizeLoginId(identifier)] = entry;
  pruneOldest(store);
  writeStore(store);
  setOfflineModeActive(false);
}

/** Verify password against any user that has previously logged in online on this machine. */
export async function tryOfflineLogin(
  identifier: string,
  password: string,
): Promise<User | null> {
  try {
    const store = readStore();
    const entry =
      store[normalizeLoginId(identifier)]
      || Object.values(store).find((c) => loginIdsMatch(c.identifier, identifier));
    if (!entry?.passwordHash || !entry?.user) return null;
    const ok = await bcrypt.compare(String(password), entry.passwordHash);
    return ok ? entry.user : null;
  } catch {
    return null;
  }
}

export function clearOfflineLoginCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(LEGACY_CACHE_KEY);
    setOfflineModeActive(false);
  } catch {
    /* ignore */
  }
}
