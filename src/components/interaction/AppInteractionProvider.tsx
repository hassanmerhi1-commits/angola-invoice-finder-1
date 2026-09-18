import { GlobalContextMenu } from '@/components/interaction/GlobalContextMenu';
import { useGlobalAppShortcuts } from '@/hooks/useGlobalAppShortcuts';

export function AppInteractionProvider({ children }: { children: React.ReactNode }) {
  useGlobalAppShortcuts();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      {children}
      <GlobalContextMenu />
    </div>
  );
}
