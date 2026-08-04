export type TextSizeId = 'small' | 'medium' | 'large';

export const TEXT_SIZE_STORAGE_KEY = 'nexor:text-size';
export const DEFAULT_TEXT_SIZE: TextSizeId = 'medium';

export const TEXT_SIZE_IDS: TextSizeId[] = ['small', 'medium', 'large'];

export function isTextSizeId(value: string | null | undefined): value is TextSizeId {
  return value === 'small' || value === 'medium' || value === 'large';
}

export function resolveTextSize(preferred?: TextSizeId | null): TextSizeId {
  if (preferred && isTextSizeId(preferred)) return preferred;
  try {
    const stored = localStorage.getItem(TEXT_SIZE_STORAGE_KEY);
    if (isTextSizeId(stored)) return stored;
  } catch {
    /* ignore */
  }
  return DEFAULT_TEXT_SIZE;
}

/**
 * Prefer dataset + CSS zoom on main content (not html font-size),
 * so the dense top nav / menus stay readable and don't wrap.
 */
export function applyTextSize(size: TextSizeId = resolveTextSize()) {
  const root = document.documentElement;
  root.dataset.textSize = size;
  // Clear any legacy root font-size from earlier builds.
  root.style.removeProperty('font-size');
  try {
    localStorage.setItem(TEXT_SIZE_STORAGE_KEY, size);
  } catch {
    /* ignore */
  }
}

/** Instant — no reload required. */
export function setTextSize(size: TextSizeId) {
  if (!isTextSizeId(size)) return;
  applyTextSize(size);
}

export function getCurrentTextSize(): TextSizeId {
  return resolveTextSize();
}
