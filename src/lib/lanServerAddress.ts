/**
 * Repair a possibly-malformed API base URL to a valid `http(s)://host[:port]` form.
 * Handles missing colon (`http//host`), single slash (`http:/host`), and bare hosts
 * (`192.168.1.5` → `http://192.168.1.5`). Returns '' for empty input.
 */
export function normalizeApiBaseUrl(raw: string): string {
  let s = String(raw || '').trim().replace(/^\uFEFF/, '').replace(/\/+$/, '');
  if (!s) return '';
  const scheme = s.match(/^(https?)\b[:/]*(.*)$/i);
  if (scheme) {
    return `${scheme[1].toLowerCase()}://${scheme[2]}`;
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    s = `http://${s}`;
  }
  return s;
}

/** Parse `192.168.1.5`, `192.168.1.5:3000`, `http://192.168.1.5:3000/` → host + port. */
export function parseLanServerEndpoint(raw: string): { host: string; port: number | null } {
  let s = String(raw || '').trim().replace(/^\uFEFF/, '');
  if (!s) return { host: '', port: null };
  // Strip any scheme prefix, tolerating malformed ones like `http//` or `http:/`.
  s = s.replace(/^https?[:/]+/i, '');
  s = s.split(/[/?#]/)[0].trim();
  const withPort = s.match(/^(.+):(\d{1,5})$/);
  if (withPort) {
    const port = Number(withPort[2]);
    if (port > 0 && port < 65536) {
      return { host: withPort[1].trim(), port };
    }
  }
  return { host: s, port: null };
}

export function buildLanServerApiBase(hostOrEndpoint: string, port?: number | null): string | null {
  const parsed = parseLanServerEndpoint(hostOrEndpoint);
  if (!parsed.host) return null;
  const p = port ?? parsed.port ?? 3000;
  if (!Number.isFinite(p) || p <= 0 || p >= 65536) return null;
  return `http://${parsed.host}:${p}`;
}

/**
 * Fix localStorage when serverIp is malformed — a stray `:port`, a scheme prefix
 * (`http://`, or the broken `http//host` with a missing colon), or trailing path.
 * Rewrites it to a clean host so the LAN client always builds a valid API base.
 */
export function repairLanClientConfigStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    // Clean up a malformed full URL saved as the custom API endpoint.
    const savedApiUrl = localStorage.getItem('kwanza_api_url');
    if (savedApiUrl && /^https?/i.test(savedApiUrl.trim())) {
      const fixed = normalizeApiBaseUrl(savedApiUrl);
      if (fixed && fixed !== savedApiUrl.trim()) {
        localStorage.setItem('kwanza_api_url', fixed);
      }
    }

    const raw = localStorage.getItem('kwanza_client_config');
    if (!raw) return;
    const cfg = JSON.parse(raw) as { serverIp?: string; httpPort?: number; apiPort?: number };
    const ip = typeof cfg?.serverIp === 'string' ? cfg.serverIp.trim() : '';
    if (!ip) return;
    // A clean host has no scheme, no slash, and no port — nothing to repair.
    const isDirty = /[/:]/.test(ip) || /^https?/i.test(ip);
    if (!isDirty) return;
    const parsed = parseLanServerEndpoint(ip);
    if (!parsed.host || parsed.host === ip) return;
    localStorage.setItem(
      'kwanza_client_config',
      JSON.stringify({
        ...cfg,
        serverIp: parsed.host,
        httpPort: parsed.port ?? cfg.httpPort ?? cfg.apiPort ?? 3000,
      }),
    );
  } catch {
    /* ignore */
  }
}
