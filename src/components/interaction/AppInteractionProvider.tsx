import { GlobalContextMenu } from '@/components/interaction/GlobalContextMenu';
import { useGlobalAppShortcuts } from '@/hooks/useGlobalAppShortcuts';

export function AppInteractionProvider({ children }: { children: React.ReactNode }) {
  useGlobalAppShortcuts();

  return (
    <>
      {children}
      <GlobalContextMenu />
    </>
  );
}
