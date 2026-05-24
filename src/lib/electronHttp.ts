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

export type ElectronHttpBinaryResult = {
  ok: boolean;
  status: number;
  contentType?: string;
  body?: Uint8Array;
  text?: string;
  json?: unknown;
  error?: string;
};

export async function electronHttpBinary(
  url: string,
  opts?: {
    method?: string;
    body?: ArrayBuffer | Uint8Array;
    headers?: Record<string, string>;
    timeoutMs?: number;
  },
): Promise<ElectronHttpBinaryResult> {
  const api = window.electronAPI?.network?.httpBinary;
  if (!api) {
    return { ok: false, status: 0, error: 'network:httpBinary unavailable' };
  }
  const raw = await api({
    url,
    method: opts?.method || 'GET',
    body: opts?.body != null ? new Uint8Array(opts.body) : undefined,
    headers: opts?.headers,
    timeoutMs: opts?.timeoutMs ?? 120000,
  });
  const body =
    raw?.body != null
      ? (raw.body instanceof Uint8Array ? raw.body : new Uint8Array(raw.body as ArrayBuffer))
      : undefined;
  return {
    ok: !!raw?.ok,
    status: raw?.status ?? 0,
    contentType: raw?.contentType,
    body,
    text: typeof raw?.text === 'string' ? raw.text : '',
    json: raw?.json,
    error: raw?.error,
  };
}

export type ElectronAwareBinaryResponse = {
  ok: boolean;
  status: number;
  contentType: string;
  body: Uint8Array;
  text: string;
  json: unknown;
};

/** Binary HTTP — main-process Node on LAN clients (backup download/upload). */
export async function electronAwareBinaryRequest(
  url: string,
  opts?: {
    method?: string;
    body?: ArrayBuffer | Uint8Array;
    headers?: Record<string, string>;
    timeoutMs?: number;
  },
): Promise<ElectronAwareBinaryResponse> {
  if (await isElectronLanClient()) {
    const r = await electronHttpBinary(url, opts);
    return {
      ok: r.ok,
      status: r.status,
      contentType: r.contentType || '',
      body: r.body ?? new Uint8Array(0),
      text: r.text || '',
      json: r.json ?? null,
    };
  }

  const res = await fetch(url, {
    method: opts?.method || 'GET',
    headers: opts?.headers,
    body: opts?.body,
    signal: AbortSignal.timeout(opts?.timeoutMs ?? 120000),
  });
  const buffer = await res.arrayBuffer();
  const text = new TextDecoder().decode(buffer);
  let json: unknown = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json') && text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return {
    ok: res.ok,
    status: res.status,
    contentType: ct,
    body: new Uint8Array(buffer),
    text,
    json,
  };
}
