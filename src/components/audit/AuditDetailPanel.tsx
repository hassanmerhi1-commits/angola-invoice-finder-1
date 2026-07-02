import { useMemo, useState } from 'react';
import { buildAuditDetailRows, type AuditDetailFormatLabels } from '@/lib/auditLogDisplay';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight } from 'lucide-react';

type Props = {
  details: Record<string, unknown>;
  labels: AuditDetailFormatLabels & { detailRawJson: string };
  locale: string;
};

export function AuditDetailPanel({ details, labels, locale }: Props) {
  const [showRaw, setShowRaw] = useState(false);
  const rows = useMemo(
    () => buildAuditDetailRows(details, labels, locale),
    [details, labels, locale],
  );

  if (rows.length === 0) return null;

  return (
    <div className="space-y-2">
      <dl className="grid grid-cols-[minmax(7rem,38%)_1fr] gap-x-3 gap-y-2 text-xs rounded-md border bg-muted/30 p-3">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="font-medium break-words">{row.value}</dd>
          </div>
        ))}
      </dl>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-[11px] text-muted-foreground"
        onClick={() => setShowRaw((v) => !v)}
      >
        {showRaw ? <ChevronDown className="w-3 h-3 mr-1" /> : <ChevronRight className="w-3 h-3 mr-1" />}
        {labels.detailRawJson}
      </Button>
      {showRaw && (
        <pre className="text-[10px] bg-muted/50 p-2 rounded overflow-auto max-h-32 font-mono">
          {JSON.stringify(details, null, 2)}
        </pre>
      )}
    </div>
  );
}
