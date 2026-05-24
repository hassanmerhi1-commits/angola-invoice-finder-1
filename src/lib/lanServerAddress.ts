/** Parse `192.168.1.5`, `192.168.1.5:3000`, `http://192.168.1.5:3000/` → host + port. */
export function parseLanServerEndpoint(raw: string): { host: string; port: number | null } {
  let s = String(raw || '').trim().replace(/^\uFEFF/, '');
  if (!s) return { host: '', port: null };
  s = s.replace(/^https?:\/\//i, '');
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

/** Fix localStorage when serverIp accidentally includes `:port`. */
export function repairLanClientConfigStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem('kwanza_client_config');
    if (!raw) return;
    const cfg = JSON.parse(raw) as { serverIp?: string; httpPort?: number; apiPort?: number };
    const ip = typeof cfg?.serverIp === 'string' ? cfg.serverIp.trim() : '';
    if (!ip || !ip.includes(':')) return;
    const parsed = parseLanServerEndpoint(ip);
    if (!parsed.host) return;
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
