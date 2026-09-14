interface DailyTotalIndicatorProps {
  totalHours: number;
}

export function DailyTotalIndicator({ totalHours }: DailyTotalIndicatorProps) {
  if (totalHours === 0) {
    return <span className="text-sm text-muted-foreground">今日尚未填报</span>;
  }

  if (totalHours > 12) {
    return (
      <span className="text-sm font-medium text-red-500">
        当日合计 {totalHours.toFixed(1)}h，超过 12h 请确认
      </span>
    );
  }

  if (totalHours >= 8) {
    return (
      <span className="text-sm font-medium text-green-600">当日合计 {totalHours.toFixed(1)}h</span>
    );
  }

  return (
    <span className="text-sm font-medium text-orange-500">
      当日合计 {totalHours.toFixed(1)}h，不足 8h
    </span>
  );
}
