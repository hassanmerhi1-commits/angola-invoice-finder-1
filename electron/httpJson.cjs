/**
 * Node HTTP(S) JSON requests — same path as curl, bypasses renderer fetch / CORS.
 *
 * Shop → city over Tailscale often drops long-idle TCP. We use a *short-lived*
 * keep-alive pool (few seconds) so bursty UI clicks reuse one socket, then fall
 * back to a fresh Connection:close hop on retriable network errors.
 */
const http = require('http');
const https = require('https');

/** Keep idle sockets only briefly — Tailscale/NAT often kills longer idles. */
const KEEP_ALIVE_MSECS = 4000;
const MAX_SOCKETS = 6;
const MAX_FREE_SOCKETS = 3;

const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: KEEP_ALIVE_MSECS,
  maxSockets: MAX_SOCKETS,
  maxFreeSockets: MAX_FREE_SOCKETS,
  scheduling: 'lifo',
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: KEEP_ALIVE_MSECS,
  maxSockets: MAX_SOCKETS,
  maxFreeSockets: MAX_FREE_SOCKETS,
  scheduling: 'lifo',
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableNetworkError(err) {
  const code = String(err?.code || '');
  const msg = String(err?.message || err || '');
  return (
    ['ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'EPIPE', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND'].includes(code)
    || /socket hang up|ECONNRESET|EPIPE|timed out|timeout|network/i.test(msg)
  );
}

function agentFor(protocol, forceNewConnection) {
  if (forceNewConnection) return false;
  return protocol === 'https:' ? httpsAgent : httpAgent;
}

function httpJsonRequestOnce(targetUrl, opts = {}) {
  const method = String(opts.method || 'GET').toUpperCase();
  const timeoutMs = Number(opts.timeoutMs) || 20000;
  const headers = opts.headers && typeof opts.headers === 'object' ? opts.headers : {};
  const forceNewConnection = opts.forceNewConnection === true;
  const bodyRaw = opts.body != null
    ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body))
    : null;

  return new Promise((resolve) => {
    try {
      const u = new URL(String(targetUrl));
      const mod = u.protocol === 'https:' ? https : http;
      const agent = agentFor(u.protocol, forceNewConnection);
      const req = mod.request(
        {
          hostname: u.hostname,
          port: u.port || (u.protocol === 'https:' ? 443 : 80),
          path: `${u.pathname}${u.search}`,
          method,
          agent,
          headers: {
            Accept: 'application/json',
            // Short keep-alive when pooled; force close on explicit fresh-socket retry.
            Connection: forceNewConnection ? 'close' : 'keep-alive',
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
      req.on('error', (e) => resolve({
        ok: false,
        status: 0,
        error: e.message,
        code: e.code,
        json: null,
        text: '',
      }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, status: 0, error: 'timeout', code: 'ETIMEDOUT', json: null, text: '' });
      });
      if (bodyRaw) req.write(bodyRaw);
      req.end();
    } catch (e) {
      resolve({ ok: false, status: 0, error: e.message, code: e.code, json: null, text: '' });
    }
  });
}

async function httpJsonRequest(targetUrl, opts = {}) {
  const first = await httpJsonRequestOnce(targetUrl, opts);
  if (first.ok || first.status > 0) return first;
  if (!isRetriableNetworkError(first)) return first;

  // Dead keep-alive socket: one fresh TCP hop (Connection: close).
  await sleep(120);
  const second = await httpJsonRequestOnce(targetUrl, { ...opts, forceNewConnection: true });
  if (second.ok || second.status > 0) return second;
  return {
    ...second,
    error: second.error || first.error || 'socket hang up',
  };
}

module.exports = { httpJsonRequest, isRetriableNetworkError };
