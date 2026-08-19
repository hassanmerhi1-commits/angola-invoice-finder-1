import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useTranslation } from '@/i18n';
import { REPORT_SALES_LIMIT } from '@/contexts/ReportsPeriodContext';

export function ReportTruncationBanner({ truncated }: { truncated: boolean }) {
  const { t } = useTranslation();
  if (!truncated) return null;
  return (
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>{t.reportsCenterUi.truncatedTitle}</AlertTitle>
      <AlertDescription>
        {t.reportsCenterUi.truncatedHint.replace('{limit}', String(REPORT_SALES_LIMIT))}
      </AlertDescription>
    </Alert>
  );
}
