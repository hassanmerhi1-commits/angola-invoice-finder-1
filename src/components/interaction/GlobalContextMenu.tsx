import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/i18n';
import { getAppInteractionSettings } from '@/lib/appInteractionSettings';
import { resolvePageContextMenu, type ContextMenuItemDef } from '@/lib/contextMenuRegistry';
import { isTextFieldElement } from '@/lib/textFieldInput';

type MenuState = {
  x: number;
  y: number;
  items: ContextMenuItemDef[];
};

async function clipboardWrite(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  document.execCommand('copy');
}

async function clipboardRead(): Promise<string> {
  if (navigator.clipboard?.readText) {
    return navigator.clipboard.readText();
  }
  return '';
}

function buildTextFieldItems(
  el: HTMLInputElement | HTMLTextAreaElement,
  t: ReturnType<typeof useTranslation>['t'],
): ContextMenuItemDef[] {
  const hasSelection = (el.selectionEnd ?? 0) > (el.selectionStart ?? 0);
  return [
    {
      id: 'cut',
      label: t.interaction.cut,
      shortcut: 'Ctrl+X',
      disabled: !hasSelection,
      onSelect: () => document.execCommand('cut'),
    },
    {
      id: 'copy',
      label: t.interaction.copy,
      shortcut: 'Ctrl+C',
      disabled: !hasSelection && !el.value,
      onSelect: () => {
        if (hasSelection) document.execCommand('copy');
        else void clipboardWrite(el.value);
      },
    },
    {
      id: 'paste',
      label: t.interaction.paste,
      shortcut: 'Ctrl+V',
      onSelect: async () => {
        try {
          const text = await clipboardRead();
          if (text) document.execCommand('insertText', false, text);
        } catch {
          document.execCommand('paste');
        }
      },
    },
    {
      id: 'select-all',
      label: t.interaction.selectAll,
      shortcut: 'Ctrl+A',
      onSelect: () => {
        el.focus();
        el.select();
      },
    },
  ];
}

function buildSelectionItems(t: ReturnType<typeof useTranslation>['t']): ContextMenuItemDef[] {
  const text = window.getSelection()?.toString()?.trim();
  if (!text) return [];
  return [
    {
      id: 'copy-selection',
      label: t.interaction.copy,
      shortcut: 'Ctrl+C',
      onSelect: () => void clipboardWrite(text),
    },
  ];
}

export function GlobalContextMenu() {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<MenuState | null>(null);

  const close = useCallback(() => setMenu(null), []);

  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      if (!getAppInteractionSettings().contextMenu) return;
      const target = e.target as HTMLElement;
      if (target.closest('[data-radix-popper-content-wrapper], [role="menu"], [data-dialog-close]')) {
        return;
      }

      const items: ContextMenuItemDef[] = [];
      const textField = target.closest('input, textarea');
      if (textField && isTextFieldElement(textField)) {
        items.push(...buildTextFieldItems(textField, t));
      } else {
        items.push(...buildSelectionItems(t));
      }
      items.push(...resolvePageContextMenu(target));

      if (!items.length) return;

      e.preventDefault();
      e.stopPropagation();

      const pad = 8;
      const maxW = 280;
      const maxH = 320;
      let x = e.clientX;
      let y = e.clientY;
      if (typeof window !== 'undefined') {
        x = Math.min(x, window.innerWidth - maxW - pad);
        y = Math.min(y, window.innerHeight - maxH - pad);
      }

      setMenu({ x, y, items });
    };

    const onPointerDown = () => close();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };

    window.addEventListener('contextmenu', onContextMenu, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('contextmenu', onContextMenu, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [t, close]);

  if (!menu) return null;

  return createPortal(
    <div
      className="fixed z-[200] min-w-[200px] max-w-[280px] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg animate-in fade-in-0 zoom-in-95"
      style={{ left: menu.x, top: menu.y }}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.items.map((item, index) => (
        <button
          key={`${item.id}-${index}`}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          className={cn(
            'flex w-full cursor-default items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-sm outline-none',
            'hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50',
            item.destructive && 'text-destructive focus:text-destructive',
          )}
          onClick={() => {
            if (!item.disabled) item.onSelect();
            close();
          }}
        >
          <span>{item.label}</span>
          {item.shortcut ? (
            <span className="text-xs tracking-widest text-muted-foreground">{item.shortcut}</span>
          ) : null}
        </button>
      ))}
    </div>,
    document.body,
  );
}
