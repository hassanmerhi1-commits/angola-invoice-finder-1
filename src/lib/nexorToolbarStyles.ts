import { getActivePreset } from '@/themes/active';
import { subscribeColorTheme } from '@/themes/colorTheme';

function toolbar() {
  return getActivePreset().toolbar;
}

/** Theme-aware toolbar buttons — TopNav row 3 and page toolbars. */
export let NEXOR_TOOLBAR_BTN = toolbar().btn;
export let NEXOR_TOOLBAR_BTN_SM = toolbar().btnSm;
export let NEXOR_ACTION_BTN = toolbar().action;
export let NEXOR_TAB_TRIGGER = toolbar().tab;

/** Polished pill buttons — dashboard shortcuts, ledger exports, feature actions. */
export let NEXOR_PILL_BTN = toolbar().pill;
export let NEXOR_PILL_BTN_PRIMARY = toolbar().pillPrimary;

/** Large feature shortcut — dashboard BI sidebar (chart of accounts / SAF-T, etc.). */
export let NEXOR_FEATURE_SHORTCUT_BTN = toolbar().feature;

export function refreshNexorToolbarStyles() {
  const t = toolbar();
  NEXOR_TOOLBAR_BTN = t.btn;
  NEXOR_TOOLBAR_BTN_SM = t.btnSm;
  NEXOR_ACTION_BTN = t.action;
  NEXOR_TAB_TRIGGER = t.tab;
  NEXOR_PILL_BTN = t.pill;
  NEXOR_PILL_BTN_PRIMARY = t.pillPrimary;
  NEXOR_FEATURE_SHORTCUT_BTN = t.feature;
}

subscribeColorTheme(() => {
  refreshNexorToolbarStyles();
});
