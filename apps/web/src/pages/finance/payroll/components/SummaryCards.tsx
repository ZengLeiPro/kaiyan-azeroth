import { Building2, TrendingDown, TrendingUp, Users, Wallet } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';

import type { MonthlySummary } from '../hooks/use-monthly-payroll';

interface SummaryCardsProps {
  summary: MonthlySummary;
  isLoading: boolean;
}

function formatCurrency(value: number): string {
  return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const CARD_ITEMS = [
  { key: 'headcount', label: '在职人数', icon: Users, color: 'text-blue-600' },
  { key: 'grossTotal', label: '应发总额', icon: TrendingUp, color: 'text-green-600' },
  { key: 'deductionTotal', label: '扣款总额', icon: TrendingDown, color: 'text-amber-600' },
  { key: 'netSalaryTotal', label: '实发总额', icon: Wallet, color: 'text-emerald-600' },
  { key: 'companyBurdenTotal', label: '公司负担', icon: Building2, color: 'text-violet-600' },
] as const;

export function SummaryCards({ summary, isLoading }: SummaryCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {CARD_ITEMS.map(({ key, label, icon: Icon, color }) => (
        <Card key={key}>
          <CardContent className="px-4 py-3">
            <div className="flex items-center gap-2">
              <Icon className={`h-4 w-4 ${color}`} />
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
            <div className="mt-1 text-lg font-bold tabular-nums">
              {isLoading ? (
                <span className="text-muted-foreground">--</span>
              ) : key === 'headcount' ? (
                summary.headcount
              ) : (
                formatCurrency(summary[key])
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
