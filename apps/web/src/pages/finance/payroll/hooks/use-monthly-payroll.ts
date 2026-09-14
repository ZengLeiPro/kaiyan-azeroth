import type { IPayrollPeriodSummary, IPayrollResponse } from '@ky-azeroth/shared/types/payroll';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

import { api } from '@/lib/api';

// ── Types ──

export interface MonthlySummary {
  headcount: number;
  grossTotal: number;
  deductionTotal: number;
  netSalaryTotal: number;
  companyBurdenTotal: number;
  totalLaborCost: number;
}

export interface DepartmentGroup {
  departmentName: string;
  records: IPayrollResponse[];
  subtotal: MonthlySummary;
}

const EMPTY_SUMMARY: MonthlySummary = {
  headcount: 0,
  grossTotal: 0,
  deductionTotal: 0,
  netSalaryTotal: 0,
  companyBurdenTotal: 0,
  totalLaborCost: 0,
};

// ── Helpers ──

function sumRecords(records: IPayrollResponse[]): MonthlySummary {
  return records.reduce<MonthlySummary>(
    (acc, r) => ({
      headcount: acc.headcount + 1,
      grossTotal: acc.grossTotal + Number(r.grossTotal ?? 0),
      deductionTotal: acc.deductionTotal + Number(r.deductionTotal ?? 0),
      netSalaryTotal: acc.netSalaryTotal + Number(r.netSalary ?? 0),
      companyBurdenTotal: acc.companyBurdenTotal + Number(r.companyBurdenTotal ?? 0),
      totalLaborCost: acc.totalLaborCost + Number(r.totalLaborCost ?? 0),
    }),
    { ...EMPTY_SUMMARY }
  );
}

function groupByDepartment(records: IPayrollResponse[]): DepartmentGroup[] {
  const map = new Map<string, IPayrollResponse[]>();

  for (const record of records) {
    const dept = record.departmentNameSnapshot || '未分配部门';
    const list = map.get(dept);
    if (list) {
      list.push(record);
    } else {
      map.set(dept, [record]);
    }
  }

  return Array.from(map.entries()).map(([departmentName, deptRecords]) => ({
    departmentName,
    records: deptRecords,
    subtotal: sumRecords(deptRecords),
  }));
}

// ── Hook ──

export function useMonthlyPayroll() {
  const [periodIndex, setPeriodIndex] = useState(0);

  // Fetch all periods (sorted desc by year, month)
  const {
    data: periods = [],
    isLoading: isPeriodsLoading,
    isError: isPeriodsError,
  } = useQuery({
    queryKey: ['payroll-periods'],
    queryFn: async () => {
      const response = await api.get('/payroll/periods');
      const items = response.data?.items ?? response.data?.data ?? response.data;
      return Array.isArray(items) ? (items as IPayrollPeriodSummary[]) : [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const currentPeriod = periods[periodIndex] ?? null;
  const currentPeriodKey = currentPeriod?.periodKey ?? '';

  // Fetch records for current period
  const {
    data: records = [],
    isLoading: isRecordsLoading,
    isError: isRecordsError,
    refetch,
  } = useQuery({
    queryKey: ['payroll-monthly', currentPeriodKey],
    enabled: Boolean(currentPeriodKey),
    queryFn: async () => {
      const response = await api.get('/payroll', {
        params: { periodKey: currentPeriodKey, pageSize: 100 },
      });
      const data = response.data;
      const items = data?.items ?? data?.data ?? data;
      return Array.isArray(items) ? (items as IPayrollResponse[]) : [];
    },
    staleTime: 60 * 1000,
  });

  // Navigation
  const hasPrevPeriod = periodIndex < periods.length - 1;
  const hasNextPeriod = periodIndex > 0;

  const goToPrevPeriod = useCallback(() => {
    setPeriodIndex((i) => Math.min(i + 1, periods.length - 1));
  }, [periods.length]);

  const goToNextPeriod = useCallback(() => {
    setPeriodIndex((i) => Math.max(i - 1, 0));
  }, []);

  const goToLatestPeriod = useCallback(() => {
    setPeriodIndex(0);
  }, []);

  // Aggregation
  const summary = useMemo(() => sumRecords(records), [records]);
  const departmentGroups = useMemo(() => groupByDepartment(records), [records]);

  return {
    // Period navigation
    periods,
    currentPeriodKey,
    currentPeriod,
    hasPrevPeriod,
    hasNextPeriod,
    goToPrevPeriod,
    goToNextPeriod,
    goToLatestPeriod,

    // Data
    records,
    isLoading: isPeriodsLoading || isRecordsLoading,
    isError: isPeriodsError || isRecordsError,
    refetch,

    // Aggregations
    summary,
    departmentGroups,
  };
}
