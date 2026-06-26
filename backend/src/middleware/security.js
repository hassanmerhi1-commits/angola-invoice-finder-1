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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Filename');
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

/**
 * Simple in-memory rate limiter
 * @param {number} windowMs - Time window in ms
 * @param {number} maxRequests - Max requests per IP per window
 */
function rateLimiter(windowMs = 60000, maxRequests = 200) {
  const hits = new Map();

  // Cleanup every windowMs
  setInterval(() => {
    const now = Date.now();
    for (const [key, data] of hits) {
      if (now - data.start > windowMs) hits.delete(key);
    }
  }, windowMs);

  function isLocalRequest(req) {
    const ip = String(req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || '');
    return ip === '127.0.0.1'
      || ip === '::1'
      || ip === '::ffff:127.0.0.1'
      || ip.endsWith('127.0.0.1');
  }

  return (req, res, next) => {
    if (isLocalRequest(req) || req.path === '/api/health') {
      return next();
    }

    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const record = hits.get(ip);

    if (!record || now - record.start > windowMs) {
      hits.set(ip, { start: now, count: 1 });
      return next();
    }

    record.count++;
    if (record.count > maxRequests) {
      console.warn(`[RATE LIMIT] ${ip}: ${record.count}/${maxRequests}`);
      return res.status(429).json({ error: 'Too many requests. Please slow down.' });
    }

    next();
  };
}

// ── Global API authentication gate ──────────────────────────────────────────
// Public API paths reachable without a user JWT. Sync routes carry their own
// API-key auth; auth routes expose the public login and self-guarded admin
// endpoints; health is an unauthenticated liveness probe.
const PUBLIC_API_EXACT = new Set(['/api/health']);
const PUBLIC_API_PREFIXES = ['/api/auth', '/api/sync', '/api/installations'];

function isPublicApiPath(pathname) {
  if (PUBLIC_API_EXACT.has(pathname)) return true;
  return PUBLIC_API_PREFIXES.some((pre) => pathname === pre || pathname.startsWith(pre + '/'));
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
