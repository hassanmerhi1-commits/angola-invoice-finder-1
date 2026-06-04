export interface AppInteractionSettings {
  contextMenu: boolean;
  globalShortcuts: boolean;
}

const STORAGE_KEY = 'nexor_app_interaction_settings_v1';

const DEFAULTS: AppInteractionSettings = {
  contextMenu: true,
  globalShortcuts: true,
};

export function getAppInteractionSettings(): AppInteractionSettings {
  if (typeof window === 'undefined') return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<AppInteractionSettings> & {
      onScreenKeyboard?: string;
    };
    return {
      contextMenu: parsed.contextMenu ?? DEFAULTS.contextMenu,
      globalShortcuts: parsed.globalShortcuts ?? DEFAULTS.globalShortcuts,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveAppInteractionSettings(next: Partial<AppInteractionSettings>): AppInteractionSettings {
  const merged = { ...getAppInteractionSettings(), ...next };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  window.dispatchEvent(new CustomEvent('nexor:interaction-settings'));
  return merged;
}
