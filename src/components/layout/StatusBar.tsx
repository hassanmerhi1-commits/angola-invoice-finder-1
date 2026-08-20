import { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { useInventoryBranchScope } from '@/hooks/useInventoryBranchScope';
import { looksLikeHeadOfficeBranch } from '@/lib/branchAccess';
import { resolveAppPathname } from '@/lib/nexorPurchaseCreate';

export function StatusBar() {
  const [now, setNow] = useState(new Date());
  const [version, setVersion] = useState('2025 R7');
  const location = useLocation();
  const { t } = useTranslation();
  const {
    canSwitchBranch,
    isInventoryConsolidated,
    inventoryBranch,
  } = useInventoryBranchScope();

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);

    if (window.electronAPI?.app?.getVersion) {
      window.electronAPI.app.getVersion().then((v: string) => setVersion(v)).catch(() => {});
    }

    return () => clearInterval(timer);
  }, []);

  const formatDate = () => {
    const d = now;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${hh}:${min}:${ss}`;
  };

  const inventoryHint = useMemo(() => {
    const path = resolveAppPathname(location.pathname);
    if (path !== '/inventory' && !path.startsWith('/inventory/')) return null;
    if (isInventoryConsolidated) {
      return `${t.inventoryPageUi.headOfficeTitle} ${t.inventoryPageUi.headOfficeDesc}`;
    }
    if (canSwitchBranch && looksLikeHeadOfficeBranch(inventoryBranch)) {
      return `${t.inventoryPageUi.sedeStockOnlyTitle} ${t.inventoryPageUi.sedeStockOnlyDesc}`;
    }
    return null;
  }, [
    location.pathname,
    isInventoryConsolidated,
    canSwitchBranch,
    inventoryBranch,
    t.inventoryPageUi.headOfficeTitle,
    t.inventoryPageUi.headOfficeDesc,
    t.inventoryPageUi.sedeStockOnlyTitle,
    t.inventoryPageUi.sedeStockOnlyDesc,
  ]);

  return (
    <div className="h-7 bg-sidebar text-sidebar-foreground/70 flex items-center justify-end px-3 text-[10px] font-medium select-none gap-3">
      {inventoryHint ? (
        <span
          className="min-w-0 flex-1 flex items-center gap-1.5 text-red-500 font-semibold truncate"
          title={inventoryHint}
        >
          <Building2 className="w-3 h-3 shrink-0" />
          <span className="truncate">{inventoryHint}</span>
        </span>
      ) : (
        <span className="flex-1" />
      )}
      <span className="px-2 py-0.5 rounded-full bg-sidebar-primary/20 text-sidebar-primary text-[9px] font-bold shrink-0">
        ERP {version}
      </span>
      <span className="font-mono shrink-0">{formatDate()}</span>
    </div>
  );
}
