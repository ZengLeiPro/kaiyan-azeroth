import type { IPaymentResponse } from '@ky-azeroth/shared/types/payment';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, X } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * 回款下拉选择器（退款表单专用）
 *
 * 用途：退款表单中选择「关联的原回款」。
 *   - 仅展示 direction='IN' 且 flowStatus='approved' 的回款
 *   - 显示编号 / 业务日期 / ¥金额 / 已退¥X / 可退¥Y
 *
 * 与 sale-order-select 同构：useQuery 拉列表 + selected 单独 fetch 兜底，
 * 当 customerId/saleOrderId 切换时自动清空 value。
 */
export interface PaymentForRefundSelection {
  id: string;
  serialNumber: string;
  businessDate: string | null;
  paymentAmount: number;
  /** 已退金额（由后端或前端计算） */
  refundedAmount?: number;
  /** 可退余额（paymentAmount - refundedAmount） */
  refundableAmount?: number;
}

export interface PaymentSelectProps {
  value?: string;
  onChange: (value: string) => void;
  onSelect?: (payment: PaymentForRefundSelection | null) => void;
  /** 过滤同客户 */
  customerId?: string;
  /** 过滤同订单 */
  saleOrderId?: string;
  /** direction 过滤，默认 'IN' */
  direction?: 'IN' | 'OUT';
  /** flowStatus 过滤，默认 'approved' */
  flowStatus?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  clearable?: boolean;
}

const amountFormatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatAmount(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '-';
  return amountFormatter.format(Number(value));
}

function normalizePayments(items: IPaymentResponse[]): PaymentForRefundSelection[] {
  return items.map((p) => ({
    id: p.id,
    serialNumber: p.serialNumber,
    businessDate: p.businessDate ?? null,
    paymentAmount: Number(p.paymentAmount),
    // refundedAmount / refundableAmount 由后端 serializePayment 注入（仅 IN 行）。
    // 老 API 兼容：若字段不在响应里则保持 undefined，前端不做余额过滤
    refundedAmount: p.refundedAmount != null ? Number(p.refundedAmount) : undefined,
    refundableAmount: p.refundableAmount != null ? Number(p.refundableAmount) : undefined,
  }));
}

export function PaymentSelect({
  value,
  onChange,
  onSelect,
  customerId,
  saleOrderId,
  direction = 'IN',
  flowStatus = 'approved',
  placeholder = '搜索并选择关联的原回款',
  disabled = false,
  className,
  clearable = true,
}: PaymentSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [keyword, setKeyword] = React.useState('');
  const debouncedKeyword = useDebouncedValue(keyword.trim(), 300);

  // 标记：正在 handleSelect 中，跳过 customerId/saleOrderId 变化清空逻辑
  const isSelectingRef = React.useRef(false);

  // 当 customerId / saleOrderId 切换时清空当前选中值
  const prevDepsRef = React.useRef({ customerId, saleOrderId });
  React.useEffect(() => {
    const prev = prevDepsRef.current;
    if (prev.customerId !== customerId || prev.saleOrderId !== saleOrderId) {
      prevDepsRef.current = { customerId, saleOrderId };
      if (value && !isSelectingRef.current) {
        onChange('');
        onSelect?.(null);
      }
    }
  }, [customerId, saleOrderId, value, onChange, onSelect]);

  const { data: payments = [], isLoading } = useQuery({
    queryKey: ['payment-select', debouncedKeyword, customerId, saleOrderId, direction, flowStatus],
    queryFn: async () => {
      const response = await api.get<{ items: IPaymentResponse[] }>('/payments', {
        params: {
          ...(debouncedKeyword ? { keyword: debouncedKeyword } : {}),
          ...(customerId ? { customerId } : {}),
          ...(saleOrderId ? { saleOrderId } : {}),
          direction,
          // 后端 filter-registry 支持 flowStatus（沿用通用过滤器）
          flowStatus,
          page: 1,
          pageSize: 50,
        },
      });
      return normalizePayments(response.data.items ?? []);
    },
    staleTime: 60 * 1000,
  });

  const { data: selectedPayment } = useQuery({
    queryKey: ['payment-select', 'selected', value],
    enabled: Boolean(value),
    queryFn: async () => {
      if (!value) return null;
      const response = await api.get<IPaymentResponse>(`/payments/${value}`);
      return normalizePayments([response.data])[0] ?? null;
    },
    staleTime: 5 * 60 * 1000,
  });

  const merged = React.useMemo(() => {
    const map = new Map<string, PaymentForRefundSelection>();
    payments.forEach((p) => map.set(p.id, p));
    if (selectedPayment) {
      // 当前已选中的项即使余额=0 也要保留，否则编辑场景下选择器会"显示为空"
      map.set(selectedPayment.id, selectedPayment);
    }
    // 过滤掉余额 ≤ 0 的候选（已全额退完的 IN 不应再出现在退款选择列表）。
    // 后端返回的字段缺失时不过滤，由后端 assertRefundWithinReceived 兜底拒绝。
    return Array.from(map.values()).filter((p) => {
      if (p.id === value) return true; // 当前已选项例外
      if (p.refundableAmount == null) return true; // 老接口兼容
      return p.refundableAmount > 0;
    });
  }, [payments, selectedPayment, value]);

  const selectedLabel = React.useMemo(() => {
    if (!value) return '';
    return merged.find((p) => p.id === value)?.serialNumber ?? '';
  }, [merged, value]);

  const handleSelect = (paymentId: string) => {
    isSelectingRef.current = true;
    onChange(paymentId);
    const payment = merged.find((p) => p.id === paymentId);
    onSelect?.(payment ?? null);
    setOpen(false);
    setKeyword('');
    setTimeout(() => {
      isSelectingRef.current = false;
    }, 0);
  };

  const handleClear = () => {
    onChange('');
    onSelect?.(null);
    setOpen(false);
    setKeyword('');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('h-9 w-full justify-between px-3 py-2 text-left font-normal', className)}
        >
          <span className={cn('truncate', !selectedLabel && 'text-muted-foreground')}>
            {selectedLabel || placeholder}
          </span>
          <div className="ml-2 flex items-center gap-1">
            {clearable && value ? (
              <span
                role="button"
                className="rounded-sm p-0.5 hover:bg-accent"
                onClick={(event) => {
                  event.stopPropagation();
                  handleClear();
                }}
              >
                <X className="h-3.5 w-3.5" />
              </span>
            ) : null}
            <ChevronDown className="h-4 w-4 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="搜索回款编号..." value={keyword} onValueChange={setKeyword} />
          <CommandList>
            {isLoading && <CommandEmpty>加载中...</CommandEmpty>}
            {!isLoading && merged.length === 0 && (
              <CommandEmpty>未找到匹配的已审批回款</CommandEmpty>
            )}
            <CommandGroup>
              {merged.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`${p.serialNumber}`}
                  className="items-start py-2"
                  onSelect={() => handleSelect(p.id)}
                >
                  <Check
                    className={cn('mt-0.5 h-4 w-4', value === p.id ? 'opacity-100' : 'opacity-0')}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{p.serialNumber}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {p.businessDate || '-'} · ¥{formatAmount(p.paymentAmount)}
                      {p.refundedAmount != null ? ` · 已退 ¥${formatAmount(p.refundedAmount)}` : ''}
                      {p.refundableAmount != null
                        ? ` · 可退 ¥${formatAmount(p.refundableAmount)}`
                        : ''}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
