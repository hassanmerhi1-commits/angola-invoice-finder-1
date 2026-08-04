export type ColorThemeId = 'light' | 'medium' | 'warm' | 'cold';

export type ToneMap = Record<'sky' | 'indigo' | 'emerald' | 'amber' | 'slate' | 'rose', string>;

export interface ThemeToolbar {
  btn: string;
  btnSm: string;
  action: string;
  tab: string;
  pill: string;
  pillPrimary: string;
  feature: string;
}

export interface ThemeChrome {
  navRow1: string;
  navRow1Mobile: string;
  navBrandBorder: string;
  navLogoRing: string;
  navBrand: string;
  navMenuBtn: string;
  checklistIconBtn: string;
  navTabsRow: string;
  navTabActive: string;
  navTabIdle: string;
  checklistTab: string;
  toolbarRow: string;
  dashboardSurface: string;
  documentFlowCard: string;
  documentFlowArrow: string;
  checklistDialog: string;
  checklistIcon: string;
  checklistTabsList: string;
  checklistStartBtn: string;
  schedulePanel: string;
  scheduleLabel: string;
  rowInvoices: string;
  rowStock: string;
  rowCaixa: string;
  rowAr: string;
  rowAp: string;
  rowPayments: string;
  rowPurchases: string;
  rowDefault: string;
  tabActiveTasks: string;
  tabActiveStock: string;
  tabActiveAr: string;
  tabActiveAp: string;
  tabActivePrint: string;
  tabActivePrices: string;
  badgeTasks: string;
}

export interface ThemePreset {
  id: ColorThemeId;
  /** Preview swatches in the picker (CSS colors). */
  swatches: [string, string, string];
  toneIcon: ToneMap;
  toneTile: ToneMap;
  statCardTone: ToneMap;
  flowStep: string[];
  pageSurface: string;
  sectionLabel: string;
  toolbar: ThemeToolbar;
  chrome: ThemeChrome;
}

export const COLOR_THEME_IDS: ColorThemeId[] = ['light', 'medium', 'warm', 'cold'];

export function isColorThemeId(value: string | null | undefined): value is ColorThemeId {
  return value === 'light' || value === 'medium' || value === 'warm' || value === 'cold';
}
