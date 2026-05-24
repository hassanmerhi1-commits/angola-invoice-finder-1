/**
 * Node HTTP(S) JSON requests — same path as curl, bypasses renderer fetch / CORS.
 */
const http = require('http');
const https = require('https');

function httpJsonRequest(targetUrl, opts = {}) {
  const method = String(opts.method || 'GET').toUpperCase();
  const timeoutMs = Number(opts.timeoutMs) || 20000;
  const headers = opts.headers && typeof opts.headers === 'object' ? opts.headers : {};
  const bodyRaw = opts.body != null
    ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body))
    : null;

  return new Promise((resolve) => {
    try {
      const u = new URL(String(targetUrl));
      const mod = u.protocol === 'https:' ? https : http;
      const req = mod.request(
        {
          hostname: u.hostname,
          port: u.port || (u.protocol === 'https:' ? 443 : 80),
          path: `${u.pathname}${u.search}`,
          method,
          headers: {
            Accept: 'application/json',
            ...(bodyRaw
              ? {
                  'Content-Type': headers['Content-Type'] || 'application/json',
                  'Content-Length': Buffer.byteLength(bodyRaw),
                }
              : {}),
            ...headers,
          },
          timeout: timeoutMs,
        },
        (res) => {
          let raw = '';
          res.on('data', (c) => {
            raw += c;
          });
          res.on('end', () => {
            let json = null;
            try {
              json = raw ? JSON.parse(raw) : null;
            } catch {
              json = null;
            }
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode || 0,
              json,
              text: raw,
            });
          });
        },
      );
      req.on('error', (e) => resolve({ ok: false, status: 0, error: e.message, json: null, text: '' }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, status: 0, error: 'timeout', json: null, text: '' });
      });
      if (bodyRaw) req.write(bodyRaw);
      req.end();
    } catch (e) {
      resolve({ ok: false, status: 0, error: e.message, json: null, text: '' });
    }
  });
}

module.exports = { httpJsonRequest };
