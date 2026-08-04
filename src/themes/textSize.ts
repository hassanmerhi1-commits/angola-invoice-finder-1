export type TextSizeId = 'small' | 'medium' | 'large';

export const TEXT_SIZE_STORAGE_KEY = 'nexor:text-size';
export const DEFAULT_TEXT_SIZE: TextSizeId = 'medium';

export const TEXT_SIZE_IDS: TextSizeId[] = ['small', 'medium', 'large'];

/** Root font-size — Tailwind rem utilities scale with this. */
export const TEXT_SIZE_ROOT: Record<TextSizeId, string> = {
  small: '87.5%', // ~14px
  medium: '100%', // ~16px
  large: '112.5%', // ~18px
};

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

export function applyTextSize(size: TextSizeId = resolveTextSize()) {
  const root = document.documentElement;
  root.dataset.textSize = size;
  root.style.fontSize = TEXT_SIZE_ROOT[size];
  try {
    localStorage.setItem(TEXT_SIZE_STORAGE_KEY, size);
  } catch {
    /* ignore */
  }
}

/** Instant — no reload required (unlike color chrome class maps). */
export function setTextSize(size: TextSizeId) {
  if (!isTextSizeId(size)) return;
  applyTextSize(size);
}

export function getCurrentTextSize(): TextSizeId {
  return resolveTextSize();
}
