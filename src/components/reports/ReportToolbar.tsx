import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useSyncedBranchFilter } from '@/hooks/useSyncedBranchFilter';
import { useTranslation } from '@/i18n';

type BranchFilterState = ReturnType<typeof useSyncedBranchFilter>;

type ReportToolbarProps = {
  title: ReactNode;
  description?: ReactNode;
  dateFrom: string;
  dateTo: string;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  showBranch?: boolean;
  /** Pass the parent's useSyncedBranchFilter() result so filters stay in sync. */
  branchFilter?: BranchFilterState;
  comparePrevious?: boolean;
  onComparePreviousChange?: (value: boolean) => void;
  compareLabel?: string;
  children?: ReactNode;
  extraFilters?: ReactNode;
};

function BranchSelect({ filter }: { filter: BranchFilterState }) {
  const { t } = useTranslation();
  const { branches, currentBranch, canPickBranch, selectedBranch, setSelectedBranch } = filter;
  return (
    <div>
      <Label>{t.salesAnalysisUi.branch}</Label>
      <Select value={selectedBranch} onValueChange={setSelectedBranch} disabled={!canPickBranch}>
        <SelectTrigger>
          <SelectValue placeholder={t.common.all} />
        </SelectTrigger>
        <SelectContent>
          {canPickBranch && <SelectItem value="all">{t.salesAnalysisUi.allBranches}</SelectItem>}
          {(canPickBranch ? branches : currentBranch ? [currentBranch] : []).map((branch) => (
            <SelectItem key={branch.id} value={branch.id}>
              {branch.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function InternalBranchSelect() {
  const filter = useSyncedBranchFilter();
  return <BranchSelect filter={filter} />;
}

export function ReportToolbar({
  title,
  description,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  showBranch = true,
  branchFilter,
  comparePrevious,
  onComparePreviousChange,
  compareLabel,
  children,
  extraFilters,
}: ReportToolbarProps) {
  const { t } = useTranslation();
  const showCompare = typeof comparePrevious === 'boolean' && typeof onComparePreviousChange === 'function';

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">{title}</CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </div>
          {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
          <div>
            <Label>{t.reportsUi.dateFrom}</Label>
            <Input type="date" value={dateFrom} onChange={(e) => onDateFromChange(e.target.value)} />
          </div>
          <div>
            <Label>{t.reportsUi.dateTo}</Label>
            <Input type="date" value={dateTo} onChange={(e) => onDateToChange(e.target.value)} />
          </div>
          {showBranch ? (branchFilter ? <BranchSelect filter={branchFilter} /> : <InternalBranchSelect />) : null}
          {extraFilters}
          {showCompare ? (
            <div className="flex items-center gap-2 pb-2">
              <Checkbox
                id="report-compare-previous"
                checked={comparePrevious}
                onCheckedChange={(v) => onComparePreviousChange(v === true)}
              />
              <Label htmlFor="report-compare-previous" className="cursor-pointer font-normal">
                {compareLabel || t.reportsCenterUi.comparePrevious}
              </Label>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export default ReportToolbar;
