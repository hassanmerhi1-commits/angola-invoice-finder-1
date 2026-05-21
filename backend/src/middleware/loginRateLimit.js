/**
 * Stricter rate limit for POST /api/auth/login (brute-force protection).
 */
function loginRateLimiter(windowMs = 15 * 60 * 1000, maxAttempts = 10) {
  const hits = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [key, data] of hits) {
      if (now - data.start > windowMs) hits.delete(key);
    }
  }, windowMs);

  return (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    const record = hits.get(ip);

    if (!record || now - record.start > windowMs) {
      hits.set(ip, { start: now, count: 1 });
      return next();
    }

    record.count += 1;
    if (record.count > maxAttempts) {
      console.warn(`[AUTH] Login rate limit exceeded for ${ip}`);
      return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
    }

    return next();
  };
}

module.exports = { loginRateLimiter };
