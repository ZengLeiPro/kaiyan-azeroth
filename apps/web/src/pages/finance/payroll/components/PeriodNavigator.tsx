import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface PeriodNavigatorProps {
  currentPeriodKey: string;
  headcount: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onGoToLatest: () => void;
  isEmpty: boolean;
}

function formatPeriodLabel(periodKey: string): string {
  if (!periodKey) return '';
  const [year, month] = periodKey.split('-');
  return `${year}年${month}月`;
}

export function PeriodNavigator({
  currentPeriodKey,
  headcount,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onGoToLatest,
  isEmpty,
}: PeriodNavigatorProps) {
  if (isEmpty) {
    return (
      <div className="flex items-center justify-center py-2 text-sm text-muted-foreground">
        暂无薪资数据
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onPrev}
          disabled={!hasPrev}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-[140px] text-center text-base font-semibold">
          {formatPeriodLabel(currentPeriodKey)}
          {headcount > 0 && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">({headcount}人)</span>
          )}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onNext}
          disabled={!hasNext}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="h-7 text-xs"
        onClick={onGoToLatest}
        disabled={!hasNext}
      >
        最新
      </Button>
    </div>
  );
}
