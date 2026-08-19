import { useCompanyLogo } from '@/hooks/useCompanyLogo';
import { useReportsPeriodOptional } from '@/contexts/ReportsPeriodContext';
import { useTranslation } from '@/i18n';
import type { BuildReportHtmlOptions } from '@/lib/reportExport';

export type ReportPreviewMeta = Pick<
  BuildReportHtmlOptions,
  'title' | 'subtitle' | 'companyName' | 'periodLabel' | 'branchLabel' | 'generatedAt' | 'landscape'
>;

/** Company + period + branch + generated-at for print / PDF / Excel headers. */
export function useReportExportMeta() {
  const { companyName } = useCompanyLogo();
  const period = useReportsPeriodOptional();
  const { t, language } = useTranslation();
  const locale = language === 'pt' ? 'pt-AO' : 'en-GB';

  const preview = (title: string, extra?: Partial<ReportPreviewMeta>): ReportPreviewMeta => {
    const generatedAt = new Date().toLocaleString(locale);
    return {
      title,
      companyName,
      periodLabel: extra?.periodLabel ?? period?.periodLabel,
      branchLabel: extra?.branchLabel ?? period?.branchLabel,
      generatedAt: extra?.generatedAt ?? `${t.reportsCenterUi.generatedAt}: ${generatedAt}`,
      subtitle: extra?.subtitle,
      landscape: extra?.landscape,
    };
  };

  return { companyName, preview };
}
