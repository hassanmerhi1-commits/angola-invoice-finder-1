/**
 * Node HTTP(S) binary requests — download/upload without renderer fetch.
 */
const http = require('http');
const https = require('https');

function toBuffer(body) {
  if (body == null) return null;
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  return null;
}

function httpBinaryRequest(targetUrl, opts = {}) {
  const method = String(opts.method || 'GET').toUpperCase();
  const timeoutMs = Number(opts.timeoutMs) || 120000;
  const headers = opts.headers && typeof opts.headers === 'object' ? opts.headers : {};
  const bodyBuf = toBuffer(opts.body);

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
          agent: false,
          headers: {
            Connection: 'close',
            ...(bodyBuf
              ? {
                  'Content-Length': bodyBuf.length,
                }
              : {}),
            ...headers,
          },
          timeout: timeoutMs,
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const raw = Buffer.concat(chunks);
            const status = res.statusCode || 0;
            const ok = status >= 200 && status < 300;
            const contentType = String(res.headers['content-type'] || '');
            const text = raw.length ? raw.toString('utf8') : '';
            let json = null;
            if (contentType.includes('application/json') && text) {
              try {
                json = JSON.parse(text);
              } catch {
                json = null;
              }
            }
            resolve({
              ok,
              status,
              contentType,
              body: raw,
              text,
              json,
            });
          });
        },
      );
      req.on('error', (e) => {
        resolve({
          ok: false,
          status: 0,
          contentType: '',
          body: Buffer.alloc(0),
          text: '',
          json: null,
          error: e.message,
        });
      });
      req.on('timeout', () => {
        req.destroy();
        resolve({
          ok: false,
          status: 0,
          contentType: '',
          body: Buffer.alloc(0),
          text: '',
          json: null,
          error: 'timeout',
        });
      });
      if (bodyBuf) req.write(bodyBuf);
      req.end();
    } catch (e) {
      resolve({
        ok: false,
        status: 0,
        contentType: '',
        body: Buffer.alloc(0),
        text: '',
        json: null,
        error: e.message,
      });
    }
  });
}

module.exports = { httpBinaryRequest };
