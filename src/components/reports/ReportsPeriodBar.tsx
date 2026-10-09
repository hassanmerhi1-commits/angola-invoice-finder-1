import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useReportsPeriod, type ReportsPeriodPreset } from '@/contexts/ReportsPeriodContext';
import { useTranslation } from '@/i18n';
import { formatBranchDisplayName } from '@/lib/branchDisplay';

const PRESETS: ReportsPeriodPreset[] = ['today', 'thisMonth', 'lastMonth', 'thisYear'];

export function ReportsPeriodBar({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const {
    dateFrom,
    dateTo,
    setDateFrom,
    setDateTo,
    applyPreset,
    comparePrevious,
    setComparePrevious,
    branchFilter,
  } = useReportsPeriod();
  const { branches, currentBranch, canPickBranch, selectedBranch, setSelectedBranch } = branchFilter;
  const [preset, setPreset] = useState<ReportsPeriodPreset>('thisMonth');
  const [showOptions, setShowOptions] = useState(false);
  const showDates = !compact || showOptions;

  return (
    <div className="rounded-lg border bg-card px-4 py-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((item) => (
          <Button
            key={item}
            type="button"
            variant={preset === item ? 'default' : 'outline'}
            size="sm"
            className="h-8"
            onClick={() => {
              setPreset(item);
              applyPreset(item);
            }}
          >
            {t.reportsCenterUi.presets[item]}
          </Button>
        ))}
        {compact && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1 text-muted-foreground"
            onClick={() => setShowOptions((open) => !open)}
          >
            {t.reportsCenterUi.options}
            <ChevronDown className={`h-4 w-4 transition-transform ${showOptions ? 'rotate-180' : ''}`} />
          </Button>
        )}
      </div>
      {showDates && (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs">{t.reportsUi.dateFrom}</Label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t.reportsUi.dateTo}</Label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t.salesAnalysisUi.branch}</Label>
          <Select value={selectedBranch} onValueChange={setSelectedBranch} disabled={!canPickBranch}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder={t.common.all} />
            </SelectTrigger>
            <SelectContent>
              {canPickBranch && <SelectItem value="all">{t.salesAnalysisUi.allBranches}</SelectItem>}
              {(canPickBranch ? branches : currentBranch ? [currentBranch] : []).map((branch) => (
                <SelectItem key={branch.id} value={branch.id}>
                  {formatBranchDisplayName(branch)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {!compact && (
        <div className="flex items-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 gap-1 text-muted-foreground"
            onClick={() => setShowOptions((open) => !open)}
          >
            {t.reportsCenterUi.options}
            <ChevronDown className={`h-4 w-4 transition-transform ${showOptions ? 'rotate-180' : ''}`} />
          </Button>
        </div>
        )}
      </div>
      )}
      {showOptions && (
        <div className="flex items-center gap-2 pt-1">
          <Checkbox
            id="reports-compare-previous"
            checked={comparePrevious}
            onCheckedChange={(v) => setComparePrevious(v === true)}
          />
          <Label htmlFor="reports-compare-previous" className="cursor-pointer font-normal text-sm">
            {t.reportsCenterUi.comparePrevious}
          </Label>
        </div>
      )}
    </div>
  );
}
