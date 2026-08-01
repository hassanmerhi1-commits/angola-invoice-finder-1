import { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { useTranslation } from '@/i18n';

export type FilterOperator =
  | 'equals'
  | 'not_equals'
  | 'less_than'
  | 'less_equal'
  | 'greater_than'
  | 'greater_equal'
  | 'contains'
  | 'not_contains'
  | 'begins_with'
  | 'ends_with'
  | 'is_blank'
  | 'is_not_blank';

export interface FilterCondition {
  operator: FilterOperator;
  value: string;
}

export interface CustomFilterState {
  condition1: FilterCondition;
  condition2: FilterCondition;
  logic: 'and' | 'or';
}

interface CustomFilterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columnLabel: string;
  columnType?: string;
  onApply: (filter: CustomFilterState) => void;
  initialFilter?: CustomFilterState;
}

const emptyCondition: FilterCondition = { operator: 'equals', value: '' };

export function CustomFilterDialog({
  open,
  onOpenChange,
  columnLabel,
  columnType,
  onApply,
  initialFilter,
}: CustomFilterDialogProps) {
  const { t } = useTranslation();
  const g = t.inventoryGridUi;
  const [condition1, setCondition1] = useState<FilterCondition>(
    initialFilter?.condition1 ?? { ...emptyCondition }
  );
  const [condition2, setCondition2] = useState<FilterCondition>(
    initialFilter?.condition2 ?? { ...emptyCondition }
  );
  const [logic, setLogic] = useState<'and' | 'or'>(initialFilter?.logic ?? 'and');

  const operators = useMemo(() => {
    if (columnType === 'number') {
      return [
        { value: 'equals' as const, label: g.opEquals },
        { value: 'not_equals' as const, label: g.opNotEquals },
        { value: 'less_than' as const, label: g.opLessThan },
        { value: 'less_equal' as const, label: g.opLessEqual },
        { value: 'greater_than' as const, label: g.opGreaterThan },
        { value: 'greater_equal' as const, label: g.opGreaterEqual },
        { value: 'is_blank' as const, label: g.opIsBlank },
        { value: 'is_not_blank' as const, label: g.opIsNotBlank },
      ];
    }
    return [
      { value: 'equals' as const, label: g.opEquals },
      { value: 'not_equals' as const, label: g.opNotEquals },
      { value: 'contains' as const, label: g.opContains },
      { value: 'not_contains' as const, label: g.opNotContains },
      { value: 'begins_with' as const, label: g.opBeginsWith },
      { value: 'ends_with' as const, label: g.opEndsWith },
      { value: 'is_blank' as const, label: g.opIsBlank },
      { value: 'is_not_blank' as const, label: g.opIsNotBlank },
    ];
  }, [columnType, g]);

  const noValueOps: FilterOperator[] = ['is_blank', 'is_not_blank'];

  const handleApply = () => {
    onApply({ condition1, condition2, logic });
    onOpenChange(false);
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{g.customFilterTitle}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            {g.customFilterShowRows} <strong>{columnLabel}</strong>
          </p>

          <div className="flex items-center gap-2">
            <Select
              value={condition1.operator}
              onValueChange={(v) =>
                setCondition1((prev) => ({ ...prev, operator: v as FilterOperator }))
              }
            >
              <SelectTrigger className="w-[200px] h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {operators.map((op) => (
                  <SelectItem key={op.value} value={op.value} className="text-xs">
                    {op.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={condition1.value}
              onChange={(e) =>
                setCondition1((prev) => ({ ...prev, value: e.target.value }))
              }
              disabled={noValueOps.includes(condition1.operator)}
              className="h-9 text-xs flex-1"
              placeholder=""
            />
          </div>

          <RadioGroup
            value={logic}
            onValueChange={(v) => setLogic(v as 'and' | 'or')}
            className="flex items-center gap-4"
          >
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="and" id="logic-and" />
              <Label htmlFor="logic-and" className="text-xs font-medium">AND</Label>
            </div>
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="or" id="logic-or" />
              <Label htmlFor="logic-or" className="text-xs font-medium">OR</Label>
            </div>
          </RadioGroup>

          <div className="flex items-center gap-2">
            <Select
              value={condition2.operator}
              onValueChange={(v) =>
                setCondition2((prev) => ({ ...prev, operator: v as FilterOperator }))
              }
            >
              <SelectTrigger className="w-[200px] h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {operators.map((op) => (
                  <SelectItem key={op.value} value={op.value} className="text-xs">
                    {op.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={condition2.value}
              onChange={(e) =>
                setCondition2((prev) => ({ ...prev, value: e.target.value }))
              }
              disabled={noValueOps.includes(condition2.operator)}
              className="h-9 text-xs flex-1"
              placeholder=""
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={handleCancel}>
            {g.filterCancel}
          </Button>
          <Button size="sm" onClick={handleApply}>
            {g.filterOk}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
