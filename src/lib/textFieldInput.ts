export function isTextFieldElement(el: EventTarget | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (!(el instanceof HTMLInputElement)) return false;
  const type = (el.type || 'text').toLowerCase();
  if (['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'hidden', 'color', 'range'].includes(type)) {
    return false;
  }
  if (el.disabled || el.readOnly) return false;
  return true;
}
