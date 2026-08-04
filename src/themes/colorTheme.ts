/**
 * Color theme switcher for the colorful UI experiment.
 * Cool (teal/cyan) is preserved; warm (coral/amber) is the current try-out.
 *
 * Flip ACTIVE_COLOR_THEME or call setColorTheme('cool'|'warm') to restore.
 */
export type ColorThemeId = 'cool' | 'warm';

export const COLOR_THEME_STORAGE_KEY = 'nexor:color-theme';

/** Default while we try warmer colors. Cool teal remains available. */
export const ACTIVE_COLOR_THEME: ColorThemeId = 'warm';

export function resolveColorTheme(preferred?: ColorThemeId | null): ColorThemeId {
  if (preferred === 'cool' || preferred === 'warm') return preferred;
  try {
    const stored = localStorage.getItem(COLOR_THEME_STORAGE_KEY);
    if (stored === 'cool' || stored === 'warm') return stored;
  } catch {
    /* ignore */
  }
  return ACTIVE_COLOR_THEME;
}

export function applyColorTheme(theme: ColorThemeId = resolveColorTheme()) {
  document.documentElement.dataset.colorTheme = theme;
  try {
    localStorage.setItem(COLOR_THEME_STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
}

export function setColorTheme(theme: ColorThemeId) {
  applyColorTheme(theme);
  // Soft reload so Tailwind class maps that are imported statically refresh if needed.
  // Most chrome is CSS-variable driven; tone class maps still need a refresh when flipping mid-session.
  window.location.reload();
}
