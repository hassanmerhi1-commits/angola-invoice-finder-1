/**
 * Request correlation + structured access log for /api routes.
 * Sets X-Request-Id (echo client header or generate) and logs one JSON line per request.
 */
const crypto = require('crypto');
const { observeHttp } = require('../lib/metrics');

function requestContext(req, res, next) {
  const incoming = String(req.headers['x-request-id'] || '').trim();
  const requestId = incoming || crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  const started = Date.now();
  res.on('finish', () => {
    if (!req.path?.startsWith('/api')) return;
    const ms = Date.now() - started;
    // Health pings are noisy — skip unless non-200.
    if (req.path === '/api/health' && res.statusCode < 400) return;
    if (req.path !== '/api/metrics') {
      observeHttp(req.method, res.statusCode, ms);
    }

    const line = {
      ts: new Date().toISOString(),
      level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      msg: 'http_request',
      requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      status: res.statusCode,
      ms,
      userId: req.user?.id || null,
      role: req.user?.role || null,
      ip: req.ip || req.socket?.remoteAddress || null,
    };
    const text = JSON.stringify(line);
    if (line.level === 'error') console.error(text);
    else if (line.level === 'warn') console.warn(text);
    else console.log(text);
  });

  next();
}

module.exports = { requestContext };
