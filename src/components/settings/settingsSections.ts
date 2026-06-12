export type SettingsSectionId =
  | 'general'
  | 'fiscal'
  | 'security'
  | 'system'
  | 'data'
  | 'advanced';

import type { LucideIcon } from 'lucide-react';
import {
  User,
  FileCheck,
  Shield,
  Monitor,
  Database,
  Wrench,
} from 'lucide-react';

export const SETTINGS_SECTIONS: {
  id: SettingsSectionId;
  icon: LucideIcon;
}[] = [
  { id: 'general', icon: User },
  { id: 'fiscal', icon: FileCheck },
  { id: 'security', icon: Shield },
  { id: 'system', icon: Monitor },
  { id: 'data', icon: Database },
  { id: 'advanced', icon: Wrench },
];

export function isSettingsSectionId(value: string | null): value is SettingsSectionId {
  return SETTINGS_SECTIONS.some((s) => s.id === value);
}
