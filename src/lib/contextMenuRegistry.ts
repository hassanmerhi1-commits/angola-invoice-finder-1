export type ContextMenuItemDef = {
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  destructive?: boolean;
  onSelect: () => void;
};

export type ContextMenuResolver = (target: HTMLElement) => ContextMenuItemDef[];

let resolver: ContextMenuResolver | null = null;

export function setContextMenuResolver(fn: ContextMenuResolver | null) {
  resolver = fn;
}

export function resolvePageContextMenu(target: HTMLElement): ContextMenuItemDef[] {
  if (!resolver) return [];
  try {
    return resolver(target).filter((item) => item.label);
  } catch {
    return [];
  }
}
