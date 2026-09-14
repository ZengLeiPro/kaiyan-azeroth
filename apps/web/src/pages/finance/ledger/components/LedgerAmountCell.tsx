import { formatLedgerAmount } from '../shared';

/**
 * 流水视图通用金额单元：正数绿、负数红、muted 灰。
 * 与 PnLView 的 AmountCell 业务逻辑不同（按 income/expense tone 着色），不共用。
 */
export function LedgerAmountCell({
  value,
  muted,
}: {
  value: number | null | undefined;
  muted?: boolean;
}) {
  const n = value == null ? null : Number(value);
  const color = muted
    ? 'text-muted-foreground'
    : n != null && n > 0
      ? 'text-emerald-600'
      : n != null && n < 0
        ? 'text-rose-600'
        : 'text-muted-foreground';
  return <span className={`font-mono tabular-nums ${color}`}>{formatLedgerAmount(value)}</span>;
}
