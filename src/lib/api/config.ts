// API Configuration
// Change this to your server's local IP address

// Default to localhost for local development
const DEFAULT_API_URL = 'http://localhost:3000';

// Detect if running in a cloud preview (Lovable, Vercel, etc.)
// where localhost:3000 is unreachable — the backend runs on the user's local PC
let _isDemoMode: boolean | null = null;
export function isDemoMode(): boolean {
  if (_isDemoMode !== null) return _isDemoMode;
  if (typeof window === 'undefined') { _isDemoMode = true; return true; }
  const host = window.location.hostname;
  // Cloud preview hosts — backend is unreachable
  const isCloudPreview = host.includes('lovableproject.com')
    || host.includes('lovable.app')
    || host.includes('vercel.app')
    || host.includes('netlify.app');
  // User explicitly set a custom API URL → they have a backend
  const hasCustomUrl = !!localStorage.getItem('kwanza_api_url');
  _isDemoMode = isCloudPreview && !hasCustomUrl;
  return _isDemoMode;
}

// Get API URL from localStorage or use default.
// In Electron, prefer the dynamic port chosen by backendManager (3000..3009),
// injected as window.__KWANZA_BACKEND_PORT__ before the React app loads.
export function getApiUrl(): string {
  if (typeof window !== 'undefined') {
    const isElectron = !!(window as any).electronAPI?.isElectron;
    if (isElectron) {
      const origin = (window as any).electronAPI?.backendHttpOrigin;
      if (typeof origin === 'string' && /^https?:\/\//i.test(origin)) {
        return origin.replace(/\/$/, '');
      }
      const p = (window as any).__KWANZA_BACKEND_PORT__;
      if (typeof p === 'number' && p > 0 && p < 65536) {
        return `http://localhost:${p}`;
      }
      return DEFAULT_API_URL;
    }

    const savedUrl = localStorage.getItem('kwanza_api_url');
    if (savedUrl) {
      const normalized = savedUrl.trim().toLowerCase();
      const isLegacyDbString = normalized.startsWith('postgres://')
        || normalized.startsWith('postgresql://')
        || normalized.includes('docker');
      if (!isLegacyDbString) return savedUrl;
      localStorage.removeItem('kwanza_api_url');
    }
  }
  return DEFAULT_API_URL;
}

// Set API URL (for settings page)
export function setApiUrl(url: string): void {
  localStorage.setItem('kwanza_api_url', url);
  // Reload to reconnect with new URL
  window.location.reload();
}

// Get WebSocket URL from API URL
export function getWsUrl(): string {
  const apiUrl = getApiUrl();
  return apiUrl.replace('http://', 'ws://').replace('https://', 'wss://');
}

// Check if we're in local network mode (custom API) or demo mode (localStorage)
export function isLocalNetworkMode(): boolean {
  const apiUrl = getApiUrl();
  return apiUrl !== DEFAULT_API_URL || localStorage.getItem('kwanza_force_api') === 'true';
}

// Force API mode even on localhost (for testing)
export function setForceApiMode(enabled: boolean): void {
  localStorage.setItem('kwanza_force_api', enabled ? 'true' : 'false');
  window.location.reload();
}

// Detect if running in web preview (no Electron, no setup configured)
// Used to disable background polling that would spam ECONNREFUSED errors
export function isWebPreview(): boolean {
  if (isDemoMode()) return true;
  const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI?.isElectron;
  if (isElectron) return false;
  const setupComplete = typeof window !== 'undefined' && localStorage.getItem('kwanza_setup_complete') === 'true';
  return !setupComplete;
}
