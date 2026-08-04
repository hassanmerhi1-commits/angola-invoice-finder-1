import { getThemePreset, isColorThemeId, type ColorThemeId } from '@/themes/registry';

export type { ColorThemeId } from '@/themes/types';
export { COLOR_THEME_IDS, THEME_PRESET_LIST, getThemePreset } from '@/themes/registry';

export const COLOR_THEME_STORAGE_KEY = 'nexor:color-theme';

/** Default when nothing is stored yet. */
export const DEFAULT_COLOR_THEME: ColorThemeId = 'medium';

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

export function applyColorTheme(theme: ColorThemeId = resolveColorTheme()) {
  document.documentElement.dataset.colorTheme = theme;
  try {
    localStorage.setItem(COLOR_THEME_STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
}

/** Persist and reload so Tailwind chrome class maps pick up the new preset. */
export function setColorTheme(theme: ColorThemeId) {
  if (!isColorThemeId(theme)) return;
  applyColorTheme(theme);
  window.location.reload();
}

export function getCurrentColorTheme(): ColorThemeId {
  return resolveColorTheme();
}
