let cachedLanClient: boolean | null = null;

export function invalidateElectronLanClientCache(): void {
  cachedLanClient = null;
}

/** True when this Electron install talks to a remote server (not embedded localhost DB). */
export async function isElectronLanClient(): Promise<boolean> {
  if (cachedLanClient !== null) return cachedLanClient;
  if (typeof window === 'undefined' || !window.electronAPI?.isElectron) {
    cachedLanClient = false;
    return false;
  }
  // IP file is authoritative — .db path = server PC, never a LAN client.
  try {
    const ip = window.electronAPI?.ipfile?.parseSync?.();
    if (ip?.valid && ip.isServer) {
      cachedLanClient = false;
      return false;
    }
    if (ip?.valid && !ip.isServer && ip.serverAddress) {
      cachedLanClient = true;
      return true;
    }
  } catch {
    /* ignore */
  }
  if (localStorage.getItem('kwanza_is_server') === 'true') {
    cachedLanClient = false;
    return false;
  }
  if (localStorage.getItem('kwanza_is_server') === 'false') {
    cachedLanClient = true;
    return true;
  }
  try {
    const st = await window.electronAPI.db.getStatus();
    cachedLanClient = st?.mode === 'client';
  } catch {
    cachedLanClient = false;
  }
  return cachedLanClient;
}

export type ElectronHttpJsonResult = {
  ok: boolean;
  status: number;
  json?: unknown;
  text?: string;
  error?: string;
};

export async function electronHttpJson(
  url: string,
  opts?: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    timeoutMs?: number;
  },
): Promise<ElectronHttpJsonResult> {
  const api = window.electronAPI?.network?.httpJson;
  if (!api) {
    return { ok: false, status: 0, error: 'network:httpJson unavailable' };
  }
  return api({
    url,
    method: opts?.method || 'GET',
    body: opts?.body,
    headers: opts?.headers,
    timeoutMs: opts?.timeoutMs ?? 20000,
  });
}

export type ElectronAwareJsonResponse = {
  ok: boolean;
  status: number;
  json: unknown;
  text: string;
};

/** JSON HTTP — uses main-process Node on LAN clients (same path as login). */
export async function electronAwareJsonRequest(
  url: string,
  opts?: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    timeoutMs?: number;
  },
): Promise<ElectronAwareJsonResponse> {
  if (await isElectronLanClient()) {
    const r = await electronHttpJson(url, opts);
    return {
      ok: r.ok,
      status: r.status,
      json: r.json ?? null,
      text: typeof r.text === 'string' ? r.text : '',
    };
  }

  const payload =
    opts?.body != null
      ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body))
      : undefined;
  const res = await fetch(url, {
    method: opts?.method || 'GET',
    headers: opts?.headers,
    body: payload,
    signal: AbortSignal.timeout(opts?.timeoutMs ?? 20000),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text };
}
