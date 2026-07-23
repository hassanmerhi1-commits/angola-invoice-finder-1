// Phase 3 — LAN Security Middleware
// CORS hardening, rate limiting, and helmet-like headers

/**
 * LAN-restricted CORS middleware
 * Allows: localhost, 127.0.0.1, 192.168.x.x, 10.x.x.x, 172.16-31.x.x,
 * Tailscale 100.64-127.x.x (CGNAT), Electron file://
 */
function lanCors(req, res, next) {
  const origin = req.headers.origin || '';
  const allowed = isAllowedOrigin(origin) || origin === 'null';

  if (allowed || !origin) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Filename, X-Request-Id');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
      return res.sendStatus(204);
    }
  } else {
    console.warn(`[SECURITY] Blocked origin: ${origin}`);
    return res.status(403).json({ error: 'Origin not allowed' });
  }

  next();
}

function isAllowedOrigin(origin) {
  if (!origin) return true; // Same-origin or server-to-server
  try {
    const url = new URL(origin);
    const host = url.hostname;

    // Localhost
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;

    // Private network ranges
    if (host.startsWith('192.168.')) return true;
    if (host.startsWith('10.')) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
    // Tailscale / CGNAT range (100.64.0.0/10) — for VPN-connected LAN clients
    if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)) return true;

    // Electron file://
    if (url.protocol === 'file:') return true;

    // Lovable preview URLs (for development)
    if (host.endsWith('.lovable.app')) return true;
    if (host.endsWith('.lovableproject.com')) return true;

    return false;
  } catch {
    return false;
  }
}

/**
 * Security headers (lightweight helmet replacement)
 */
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.removeHeader('X-Powered-By');
  next();
}

function normalizeClientIp(ip) {
  return String(ip || '').replace(/^::ffff:/, '').trim();
}

function isPrivateLanIp(ip) {
  const s = normalizeClientIp(ip);
  if (!s || s === '127.0.0.1' || s === '::1') return true;
  if (s.startsWith('192.168.')) return true;
  if (s.startsWith('10.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(s)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(s)) return true;
  return false;
}

/**
 * Simple in-memory rate limiter
 * @param {number} windowMs - Time window in ms
 * @param {number} maxRequests - Max requests per IP per window (public / unknown IPs)
 * @param {number} lanMaxRequests - Higher cap for private LAN / Tailscale clients
 */
function rateLimiter(windowMs = 60000, maxRequests = 200, lanMaxRequests = 2000) {
  const hits = new Map();

  // Cleanup every windowMs
  setInterval(() => {
    const now = Date.now();
    for (const [key, data] of hits) {
      if (now - data.start > windowMs) hits.delete(key);
    }
  }, windowMs);

  function isLocalRequest(req) {
    const ip = normalizeClientIp(req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || '');
    return ip === '127.0.0.1' || ip === '::1';
  }

  // Expensive read endpoints still count (reports, inventory grid, export dumps).
  // Cheap probes and tiny lookups stay exempt so POS / purchase pages stay snappy.
  const EXPENSIVE_GET_PREFIXES = [
    '/api/products/inventory-grid',
    '/api/products/inventory-consolidated',
    '/api/reports',
    '/api/dashboard',
    '/api/saft',
    '/api/journal-entries',
    '/api/audit',
    '/api/sales',
    '/api/purchase-invoices',
    '/api/stock-transfers',
    '/api/search',
  ];

  function isExpensiveGet(req) {
    if (req.method !== 'GET' || !req.path.startsWith('/api/')) return false;
    return EXPENSIVE_GET_PREFIXES.some(
      (pre) => req.path === pre || req.path.startsWith(`${pre}/`) || req.path.startsWith(`${pre}?`),
    );
  }

  return (req, res, next) => {
    if (isLocalRequest(req) || req.path === '/api/health') {
      return next();
    }

    // Cheap GETs (lookups, health-adjacent) do not count; expensive list/report GETs do.
    if (req.method === 'GET' && req.path.startsWith('/api/') && !isExpensiveGet(req)) {
      return next();
    }

    const ip = normalizeClientIp(req.ip || req.connection?.remoteAddress || 'unknown');
    // GET-heavy LAN clients get a higher cap than mutating traffic.
    const baseCap = isPrivateLanIp(ip) ? lanMaxRequests : maxRequests;
    const cap = req.method === 'GET' ? Math.max(baseCap, lanMaxRequests) : baseCap;
    const now = Date.now();
    const record = hits.get(ip);

    if (!record || now - record.start > windowMs) {
      hits.set(ip, { start: now, count: 1 });
      return next();
    }

    record.count++;
    if (record.count > cap) {
      console.warn(`[RATE LIMIT] ${ip}: ${record.count}/${cap}`);
      return res.status(429).json({ error: 'Too many requests. Please slow down.' });
    }

    next();
  };
}

// ── Global API authentication gate ──────────────────────────────────────────
// Public API paths reachable without a user JWT. Sync routes carry their own
// API-key auth; auth routes expose the public login and self-guarded admin
// endpoints; health is an unauthenticated liveness probe.
const PUBLIC_API_EXACT = new Set([
  '/api/health',
  '/api/auth/login',
  '/api/auth/refresh',
]);
// Sync carries its own API-key auth. Installation bootstrap/register stays public;
// list/config endpoints require JWT after setup (see isPublicApiPath).
const PUBLIC_API_PREFIXES = ['/api/sync'];
const PUBLIC_INSTALLATION_PATHS = new Set([
  '/api/installations/register-main',
  '/api/installations/register-city',
]);

/** Electron embedded backend calls these from 127.0.0.1 without a user JWT. */
const LOOPBACK_INTERNAL_PATHS = new Set(['/api/caixa/gl/sync-record']);

function isLoopbackRequest(req) {
  const ip = String(req.ip || req.socket?.remoteAddress || '').trim();
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function isPublicApiPath(pathname) {
  if (PUBLIC_API_EXACT.has(pathname)) return true;
  if (PUBLIC_INSTALLATION_PATHS.has(pathname)) return true;
  // Auth login helpers that must work before a session exists
  if (pathname.startsWith('/api/auth/login')) return true;
  return PUBLIC_API_PREFIXES.some((pre) => pathname === pre || pathname.startsWith(`${pre}/`));
}

/**
 * Requires a valid user JWT for every /api route except the public allowlist.
 * Non-/api requests pass through. Set NEXOR_OPEN_API=1 to disable (emergency only).
 */
function apiAuthGate(req, res, next) {
  if (process.env.NEXOR_OPEN_API === '1') return next();
  const p = req.path;
  if (!p.startsWith('/api/') && p !== '/api') return next();
  if (req.method === 'OPTIONS') return next();
  if (isPublicApiPath(p)) return next();
  if (LOOPBACK_INTERNAL_PATHS.has(p) && isLoopbackRequest(req)) {
    req.user = {
      id: 'system-internal',
      email: 'system@localhost',
      name: 'System',
      role: 'admin',
      branchId: null,
      permissionOverrides: null,
    };
    return next();
  }
  // Lazy require avoids a circular dependency at module load time.
  const { requireAuth } = require('./requireAuth');
  return requireAuth(req, res, next);
}

/**
 * Optimistic lock conflict helper
 * Returns 409 Conflict if rowCount is 0 after a versioned update
 */
function checkOptimisticLock(result, res, entityName = 'Record') {
  if (result.rowCount === 0) {
    res.status(409).json({
      error: 'Conflict',
      message: `${entityName} was modified by another user. Please refresh and try again.`,
      code: 'VERSION_CONFLICT',
    });
    return false;
  }
  return true;
}

module.exports = { lanCors, securityHeaders, rateLimiter, isAllowedOrigin, checkOptimisticLock, apiAuthGate, isPublicApiPath };
