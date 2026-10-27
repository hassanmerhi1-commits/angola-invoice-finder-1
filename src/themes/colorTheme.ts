import { useEffect, useState } from 'react';
import { getThemePreset, isColorThemeId, type ColorThemeId } from '@/themes/registry';

export type { ColorThemeId } from '@/themes/types';
export { COLOR_THEME_IDS, THEME_PRESET_LIST, getThemePreset } from '@/themes/registry';

export const COLOR_THEME_STORAGE_KEY = 'nexor:color-theme';

/** Default when nothing is stored yet. */
export const DEFAULT_COLOR_THEME: ColorThemeId = 'medium';

function migrateLegacyThemeId(raw: string | null): ColorThemeId | null {
  if (!raw) return null;
  if (raw === 'cool') return 'cold';
  if (raw === 'ink') return 'medium';
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

const THEME_WINDOW_HEX: Record<ColorThemeId, string> = {
  frost: '#f4f6fb',
  light: '#f7f8fb',
  medium: '#f3f6f9',
  warm: '#fbf6ef',
  cold: '#eff7fb',
};

export function themeWindowChrome(theme: ColorThemeId = resolveColorTheme()) {
  return {
    id: theme,
    dark: false,
    background: THEME_WINDOW_HEX[theme],
    colorScheme: 'light' as const,
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
  // Paint CSS first. Native caption restyle is deferred so the click is not frozen.
  const applyNative = () => {
    try {
      void window.electronAPI?.app?.setColorTheme?.(theme);
    } catch {
      /* browser / older desktop */
    }
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(applyNative);
  else applyNative();
}

export function applyColorTheme(theme: ColorThemeId = resolveColorTheme()) {
  syncDocumentWindowChrome(theme);
  try {
    localStorage.setItem(COLOR_THEME_STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
}

type ColorThemeListener = (theme: ColorThemeId) => void;
const colorThemeListeners = new Set<ColorThemeListener>();

export function subscribeColorTheme(listener: ColorThemeListener) {
  colorThemeListeners.add(listener);
  return () => {
    colorThemeListeners.delete(listener);
  };
}

/** Apply CSS + Windows chrome immediately. No full reload. */
export function setColorTheme(theme: ColorThemeId) {
  if (!isColorThemeId(theme)) return;
  applyColorTheme(theme);
  colorThemeListeners.forEach((listener) => listener(theme));
}

export function getCurrentColorTheme(): ColorThemeId {
  return resolveColorTheme();
}

export function useColorThemeId(): ColorThemeId {
  const [theme, setTheme] = useState<ColorThemeId>(() => resolveColorTheme());
  useEffect(() => subscribeColorTheme(setTheme), []);
  return theme;
}

/** Live preset — use this instead of module-level themeChrome / tile copies. */
export function useThemePreset() {
  return getThemePreset(useColorThemeId());
}
