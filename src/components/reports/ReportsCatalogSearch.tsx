import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/i18n';

export type ReportCatalogItem = {
  family: string;
  sub?: string;
  label: string;
  group: string;
};

export function ReportsCatalogSearch({
  items,
  onSelect,
}: {
  items: ReportCatalogItem[];
  onSelect: (item: ReportCatalogItem) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const matches = useMemo(() => {
    if (!q) return [];
    return items.filter((item) =>
      `${item.label} ${item.group} ${item.family} ${item.sub || ''}`.toLowerCase().includes(q),
    ).slice(0, 12);
  }, [items, q]);

  return (
    <div className="space-y-2">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.reportsCenterUi.searchPlaceholder}
          className="pl-9 h-9"
        />
      </div>
      {q && matches.length === 0 && (
        <p className="text-sm text-muted-foreground">{t.reportsCenterUi.noReportsMatch}</p>
      )}
      {matches.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {matches.map((item) => (
            <Button
              key={`${item.family}:${item.sub || ''}`}
              type="button"
              variant="secondary"
              size="sm"
              className="h-8"
              onClick={() => {
                onSelect(item);
                setQuery('');
              }}
            >
              <span className="text-muted-foreground mr-1.5">{item.group}</span>
              {item.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
