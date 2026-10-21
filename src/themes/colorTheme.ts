import { getThemePreset, isColorThemeId, type ColorThemeId } from '@/themes/registry';

export type { ColorThemeId } from '@/themes/types';
export { COLOR_THEME_IDS, THEME_PRESET_LIST, getThemePreset } from '@/themes/registry';

export const COLOR_THEME_STORAGE_KEY = 'nexor:color-theme';

/** Default when nothing is stored yet. */
export const DEFAULT_COLOR_THEME: ColorThemeId = 'ink';

function migrateLegacyThemeId(raw: string | null): ColorThemeId | null {
  if (!raw) return null;
  if (raw === 'cool') return 'cold';
  if (isColorThemeId(raw)) return raw;
  return null;
}

export function resolveColorTheme(preferred?: ColorThemeId | null): ColorThemeId {
  if (preferred && isColorThemeId(preferred)) return preferred;
  try {
    const migrated = migrateLegacyThemeId(localStorage.getItem(COLOR_THEME_STORAGE_KEY));
    if (migrated) return migrated;
  } catch {
    /* ignore */
  }
  return DEFAULT_COLOR_THEME;
}

const DARK_COLOR_THEMES = new Set<ColorThemeId>(['ink']);

const THEME_WINDOW_HEX: Record<ColorThemeId, string> = {
  ink: '#070b16',
  frost: '#f4f6fb',
  light: '#f7f8fb',
  medium: '#f3f6f9',
  warm: '#fbf6ef',
  cold: '#eff7fb',
};

export function themeWindowChrome(theme: ColorThemeId = resolveColorTheme()) {
  const dark = DARK_COLOR_THEMES.has(theme);
  return {
    id: theme,
    dark,
    background: THEME_WINDOW_HEX[theme],
    colorScheme: dark ? 'dark' : 'light',
  };
}

function syncDocumentWindowChrome(theme: ColorThemeId) {
  const chrome = themeWindowChrome(theme);
  document.documentElement.dataset.colorTheme = theme;
  document.documentElement.style.colorScheme = chrome.colorScheme;
  document.documentElement.classList.toggle('dark', chrome.dark);
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', chrome.background);
  try {
    void window.electronAPI?.app?.setColorTheme?.(theme);
  } catch {
    /* browser / older desktop */
  }
}

export function applyColorTheme(theme: ColorThemeId = resolveColorTheme()) {
  syncDocumentWindowChrome(theme);
  try {
    localStorage.setItem(COLOR_THEME_STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
}

/** Persist and reload so Tailwind chrome class maps pick up the new preset.
 *  Do not flip the Windows title bar before reload — that is what made ink feel stuck. */
export function setColorTheme(theme: ColorThemeId) {
  if (!isColorThemeId(theme)) return;
  try {
    localStorage.setItem(COLOR_THEME_STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
  window.location.reload();
}

export function getCurrentColorTheme(): ColorThemeId {
  return resolveColorTheme();
}
