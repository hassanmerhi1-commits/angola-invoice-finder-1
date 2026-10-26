import bcrypt from 'bcryptjs';
import type { User } from '@/types/erp';

// v1 stored a single user object; v2 stores a map of users keyed by login id so
// every account that has logged in online at least once can log in offline later
// (not just the most recent person).
const LEGACY_CACHE_KEY = 'kwanza_offline_login_cache';
const CACHE_KEY = 'kwanza_offline_login_cache_v2';
export const OFFLINE_MODE_KEY = 'kwanza_offline_mode';

/** Reserved key inside the existing printer JSON (old Electron shells have no dedicated IPC). */
export const OFFLINE_LOGIN_PRINTER_KEY = '_nexorOfflineLoginStore';

// Cap the store so it can't grow without bound; oldest entries are pruned first.
const MAX_CACHED_USERS = 25;

type OfflineLoginCache = {
  identifier: string;
  passwordHash: string;
  user: User;
  cachedAt: string;
};

type OfflineLoginStore = Record<string, OfflineLoginCache>;

export type OfflineLoginAttempt = {
  user: User | null;
  reason: 'ok' | 'no_cache' | 'bad_password';
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

function sanitizeUser(user: User): User {
  return {
    id: String(user.id || ''),
    email: String(user.email || ''),
    name: String(user.name || ''),
    username: String(user.username || ''),
    role: user.role || 'cashier',
    branchId: String(user.branchId || ''),
    isActive: true,
    createdAt: String(user.createdAt || ''),
    permissionOverrides: user.permissionOverrides,
    mustChangePassword: !!(user.mustChangePassword),
  };
}

function sanitizeStore(raw: unknown): OfflineLoginStore {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: OfflineLoginStore = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const entry = value as Partial<OfflineLoginCache>;
    if (typeof entry.identifier !== 'string' || typeof entry.passwordHash !== 'string') continue;
    if (!entry.user || typeof entry.user !== 'object') continue;
    const id = normalizeLoginId(key || entry.identifier);
    if (!id) continue;
    out[id] = {
      identifier: normalizeLoginId(entry.identifier),
      passwordHash: entry.passwordHash,
      user: sanitizeUser(entry.user as User),
      cachedAt: typeof entry.cachedAt === 'string' ? entry.cachedAt : new Date().toISOString(),
    };
  }
  return out;
}

function mergeStores(a: OfflineLoginStore, b: OfflineLoginStore): OfflineLoginStore {
  const out: OfflineLoginStore = { ...a };
  for (const [key, entry] of Object.entries(b)) {
    const existing = out[key];
    if (!existing) {
      out[key] = entry;
      continue;
    }
    const existingAt = new Date(existing.cachedAt || 0).getTime();
    const nextAt = new Date(entry.cachedAt || 0).getTime();
    if (nextAt >= existingAt) out[key] = entry;
  }
  return out;
}

function readLocalStore(): OfflineLoginStore {
  let store: OfflineLoginStore = {};
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) store = sanitizeStore(JSON.parse(raw));
  } catch {
    store = {};
  }
  if (Object.keys(store).length === 0) {
    try {
      const legacyRaw = localStorage.getItem(LEGACY_CACHE_KEY);
      if (legacyRaw) {
        const legacyEntry = JSON.parse(legacyRaw) as OfflineLoginCache;
        const legacy = sanitizeStore({
          [normalizeLoginId(legacyEntry?.identifier)]: legacyEntry,
        });
        if (Object.keys(legacy).length) store = legacy;
      }
    } catch {
      /* ignore malformed legacy cache */
    }
  }
  return store;
}

function writeLocalStore(store: OfflineLoginStore): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(store));
  } catch {
    /* ignore quota/serialization errors */
  }
}

async function readDiskStore(): Promise<OfflineLoginStore> {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!api) return {};

  try {
    const dedicated = await api.offlineAuth?.read?.();
    const fromDedicated = sanitizeStore(dedicated?.store);
    if (Object.keys(fromDedicated).length) return fromDedicated;
  } catch {
    /* old installer — no dedicated IPC */
  }

  try {
    const disk = await api.app?.getPrinterConfig?.();
    if (disk && typeof disk === 'object') {
      return sanitizeStore((disk as Record<string, unknown>)[OFFLINE_LOGIN_PRINTER_KEY]);
    }
  } catch {
    /* ignore */
  }
  return {};
}

async function writeDiskStore(store: OfflineLoginStore): Promise<void> {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!api) return;

  try {
    await api.offlineAuth?.write?.(store);
  } catch {
    /* old installer */
  }

  // Existing tills already persist printer JSON in userData. Keep a copy there so
  // file:// / 127.0.0.1 cache / city /app all see the same hashes without a new installer.
  try {
    const disk = await api.app?.getPrinterConfig?.();
    const base = disk && typeof disk === 'object' ? disk : {};
    await api.app?.setPrinterConfig?.({
      ...base,
      [OFFLINE_LOGIN_PRINTER_KEY]: store,
    });
  } catch {
    /* ignore */
  }
}

async function readStore(): Promise<OfflineLoginStore> {
  const local = readLocalStore();
  const disk = await readDiskStore();
  const merged = mergeStores(local, disk);
  if (Object.keys(merged).length && JSON.stringify(merged) !== JSON.stringify(local)) {
    writeLocalStore(merged);
  }
  return merged;
}

async function writeStore(store: OfflineLoginStore): Promise<void> {
  writeLocalStore(store);
  await writeDiskStore(store);
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

function findCachedEntry(store: OfflineLoginStore, identifier: string): OfflineLoginCache | undefined {
  return store[normalizeLoginId(identifier)]
    || Object.values(store).find((c) => loginIdsMatch(c.identifier, identifier));
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
    user: sanitizeUser(user),
    cachedAt: new Date().toISOString(),
  };
  const store = await readStore();
  store[normalizeLoginId(identifier)] = entry;
  pruneOldest(store);
  await writeStore(store);
  setOfflineModeActive(false);
}

export async function tryOfflineLoginDetailed(
  identifier: string,
  password: string,
): Promise<OfflineLoginAttempt> {
  try {
    const store = await readStore();
    const entry = findCachedEntry(store, identifier);
    if (!entry?.passwordHash || !entry?.user) return { user: null, reason: 'no_cache' };
    const ok = await bcrypt.compare(String(password), entry.passwordHash);
    return ok ? { user: entry.user, reason: 'ok' } : { user: null, reason: 'bad_password' };
  } catch {
    return { user: null, reason: 'no_cache' };
  }
}

/** Verify password against any user that has previously logged in online on this machine. */
export async function tryOfflineLogin(
  identifier: string,
  password: string,
): Promise<User | null> {
  const result = await tryOfflineLoginDetailed(identifier, password);
  return result.user;
}

export async function hasOfflineLoginCache(): Promise<boolean> {
  const store = await readStore();
  return Object.keys(store).length > 0;
}

export async function clearOfflineLoginCache(): Promise<void> {
  try {
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(LEGACY_CACHE_KEY);
    setOfflineModeActive(false);
  } catch {
    /* ignore */
  }
  await writeDiskStore({});
}

export function cityUnreachableOfflineHint(reason: OfflineLoginAttempt['reason']): string {
  if (reason === 'bad_password') {
    return ' Wrong password for the login saved on this PC.';
  }
  return ' This PC has no saved login yet. Sign in once while the city server is online, then you can use this till when the city is down.';
}
