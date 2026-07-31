import { useMemo, useState } from 'react';
import {
  buildAuditDetailSections,
  type AuditDetailFormatLabels,
  type AuditDetailRow,
} from '@/lib/auditLogDisplay';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronRight } from 'lucide-react';

type Props = {
  details?: Record<string, unknown>;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  labels: AuditDetailFormatLabels & {
    detailRawJson: string;
    detailChanges?: string;
    detailSnapshot?: string;
    detailContext?: string;
  };
  locale: string;
};

function DetailTable({ rows }: { rows: AuditDetailRow[] }) {
  if (rows.length === 0) return null;
  return (
    <dl className="grid grid-cols-[minmax(7rem,38%)_1fr] gap-x-3 gap-y-2 text-xs rounded-md border bg-muted/30 p-3">
      {rows.map((row) => (
        <div key={`${row.label}:${row.value}`} className="contents">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="font-medium break-words">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AuditDetailPanel({
  details,
  oldValues,
  newValues,
  metadata,
  labels,
  locale,
}: Props) {
  const [showRaw, setShowRaw] = useState(false);
  const sections = useMemo(
    () => buildAuditDetailSections({ oldValues, newValues, metadata, details }, labels, locale),
    [oldValues, newValues, metadata, details, labels, locale],
  );

  const hasAny =
    sections.changes.length > 0
    || sections.snapshot.length > 0
    || sections.context.length > 0
    || Object.keys(sections.raw).length > 0;

  if (!hasAny) return null;

  return (
    <div className="space-y-3">
      {sections.changes.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-muted-foreground">
            {labels.detailChanges || 'Changes'}
          </p>
          <DetailTable rows={sections.changes} />
        </div>
      )}
      {sections.snapshot.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-muted-foreground">
            {labels.detailSnapshot || 'Values'}
          </p>
          <DetailTable rows={sections.snapshot} />
        </div>
      )}
      {sections.context.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-muted-foreground">
            {labels.detailContext || 'Context'}
          </p>
          <DetailTable rows={sections.context} />
        </div>
      )}
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
        <pre className="text-[10px] bg-muted/50 p-2 rounded overflow-auto max-h-40 font-mono">
          {JSON.stringify(sections.raw, null, 2)}
        </pre>
      )}
    </div>
  );
}
