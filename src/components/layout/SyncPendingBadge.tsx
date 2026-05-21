import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { CloudOff } from 'lucide-react';
import { getOfflinePendingCount } from '@/lib/sync/offlineSales';

export function SyncPendingBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const tick = async () => {
      setCount(await getOfflinePendingCount());
    };
    tick();
    const id = window.setInterval(tick, 10000);
    return () => window.clearInterval(id);
  }, []);

  if (count <= 0) return null;

  return (
    <Badge variant="outline" className="gap-1 text-amber-700 border-amber-300">
      <CloudOff className="h-3 w-3" />
      {count} pendente{count > 1 ? 's' : ''}
    </Badge>
  );
}
