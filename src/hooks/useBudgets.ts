import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api/client';
import { getCachedList, setCachedList } from '@/lib/listCache';

export interface CostCenterRow {
  id: string;
  code: string;
  name: string;
  description?: string;
  is_active?: boolean;
  isActive?: boolean;
}

export interface BudgetRow {
  id: string;
  cost_center_id?: string;
  costCenterId?: string;
  cost_center_code?: string;
  costCenterCode?: string;
  cost_center_name?: string;
  costCenterName?: string;
  account_code?: string;
  accountCode?: string;
  period_year?: number;
  periodYear?: number;
  period_month?: number;
  periodMonth?: number;
  budget_amount?: number;
  budgetAmount?: number;
  actual_amount?: number;
  actualAmount?: number;
  utilization_pct?: number;
  utilizationPct?: number;
  notes?: string;
}

function mapCostCenter(row: Record<string, unknown>): CostCenterRow {
  return {
    id: String(row.id),
    code: String(row.code || ''),
    name: String(row.name || ''),
    description: String(row.description || ''),
    isActive: row.is_active !== false && row.is_active !== 0 && row.isActive !== false,
  };
}

function mapBudget(row: Record<string, unknown>): BudgetRow {
  const budgetAmount = Number(row.budget_amount ?? row.budgetAmount ?? 0);
  const actualAmount = Number(row.actual_amount ?? row.actualAmount ?? 0);
  const utilization = row.utilization_pct ?? row.utilizationPct;
  const utilizationPct = utilization != null
    ? Number(utilization)
    : (budgetAmount > 0 ? Math.round((actualAmount / budgetAmount) * 1000) / 10 : 0);

  return {
    id: String(row.id),
    costCenterId: String(row.cost_center_id ?? row.costCenterId ?? ''),
    costCenterCode: String(row.cost_center_code ?? row.costCenterCode ?? ''),
    costCenterName: String(row.cost_center_name ?? row.costCenterName ?? ''),
    accountCode: String(row.account_code ?? row.accountCode ?? ''),
    periodYear: Number(row.period_year ?? row.periodYear ?? 0),
    periodMonth: Number(row.period_month ?? row.periodMonth ?? 0),
    budgetAmount,
    actualAmount,
    utilizationPct,
    notes: String(row.notes ?? ''),
  };
}

export function useBudgets(year: number, month: number) {
  const ccKey = 'budgetCostCenters';
  const budgetKey = `budgets:${year}-${month}`;
  const cachedCostCenters = getCachedList<CostCenterRow[]>(ccKey);
  const cachedBudgets = getCachedList<BudgetRow[]>(budgetKey);
  const [costCenters, setCostCenters] = useState<CostCenterRow[]>(() => cachedCostCenters ?? []);
  const [budgets, setBudgets] = useState<BudgetRow[]>(() => cachedBudgets ?? []);
  const [loading, setLoading] = useState(() => !(cachedBudgets && cachedBudgets.length));
  const hasRowsRef = useRef((cachedBudgets?.length ?? 0) > 0);

  const refresh = useCallback(async () => {
    if (!hasRowsRef.current) setLoading(true);
    try {
      const [ccRes, budgetRes] = await Promise.all([
        api.budgets.costCenters(),
        api.budgets.list({ year, month }),
      ]);
      if (Array.isArray(ccRes.data)) {
        const mappedCc = ccRes.data.map(mapCostCenter);
        setCostCenters(mappedCc);
        setCachedList(ccKey, mappedCc);
      }
      if (Array.isArray(budgetRes.data)) {
        const mappedBudgets = budgetRes.data.map(mapBudget);
        setBudgets(mappedBudgets);
        setCachedList(budgetKey, mappedBudgets);
        hasRowsRef.current = mappedBudgets.length > 0;
      }
    } catch (error) {
      console.error('[BUDGETS] Failed to load:', error);
    } finally {
      setLoading(false);
    }
  }, [year, month, budgetKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createCostCenter = useCallback(async (data: { code: string; name: string; description?: string }) => {
    const result = await api.budgets.createCostCenter({
      code: data.code.trim(),
      name: data.name.trim(),
      description: data.description?.trim() || '',
    });
    if (!result.data) throw new Error(result.error || 'Failed to create cost center');
    await refresh();
    return mapCostCenter(result.data);
  }, [refresh]);

  const updateCostCenter = useCallback(async (
    id: string,
    data: { name?: string; description?: string; isActive?: boolean },
  ) => {
    const result = await api.budgets.updateCostCenter(id, {
      name: data.name,
      description: data.description,
      isActive: data.isActive,
    });
    if (!result.data) throw new Error(result.error || 'Failed to update cost center');
    await refresh();
    return mapCostCenter(result.data);
  }, [refresh]);

  const saveBudget = useCallback(async (data: {
    costCenterId: string;
    periodYear: number;
    periodMonth: number;
    budgetAmount: number;
    notes?: string;
    accountCode?: string;
  }) => {
    const result = await api.budgets.create({
      costCenterId: data.costCenterId,
      accountCode: data.accountCode || '__total__',
      periodYear: data.periodYear,
      periodMonth: data.periodMonth,
      budgetAmount: data.budgetAmount,
      notes: data.notes || '',
    });
    if (!result.data) throw new Error(result.error || 'Failed to save budget');
    await refresh();
    return mapBudget(result.data);
  }, [refresh]);

  return {
    costCenters,
    budgets,
    loading,
    refresh,
    createCostCenter,
    updateCostCenter,
    saveBudget,
  };
}
