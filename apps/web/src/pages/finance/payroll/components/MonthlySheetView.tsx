import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

import { useMonthlyPayroll } from '../hooks/use-monthly-payroll';
import { DepartmentPayrollTable } from './DepartmentPayrollTable';
import { PeriodNavigator } from './PeriodNavigator';
import { SummaryCards } from './SummaryCards';

export function MonthlySheetView() {
  const {
    periods,
    currentPeriodKey,
    hasPrevPeriod,
    hasNextPeriod,
    goToPrevPeriod,
    goToNextPeriod,
    goToLatestPeriod,
    isLoading,
    isError,
    refetch,
    summary,
    departmentGroups,
  } = useMonthlyPayroll();

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PeriodNavigator
        currentPeriodKey={currentPeriodKey}
        headcount={summary.headcount}
        hasPrev={hasPrevPeriod}
        hasNext={hasNextPeriod}
        onPrev={goToPrevPeriod}
        onNext={goToNextPeriod}
        onGoToLatest={goToLatestPeriod}
        isEmpty={!isLoading && periods.length === 0}
      />

      <SummaryCards summary={summary} isLoading={isLoading} />

      {isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-8">
            <p className="text-sm text-muted-foreground">加载失败</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              重试
            </Button>
          </CardContent>
        </Card>
      ) : (
        <DepartmentPayrollTable
          departmentGroups={departmentGroups}
          grandTotal={summary}
          isLoading={isLoading}
        />
      )}
    </div>
  );
}
