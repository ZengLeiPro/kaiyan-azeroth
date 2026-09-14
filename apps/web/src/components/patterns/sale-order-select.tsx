import type {
  ISaleOrderResponse,
  SaleOrderForSelection,
} from '@ky-azeroth/shared/types/sale-order';
import { getEntityDisplayName } from '@ky-azeroth/shared/utils';
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

export interface SaleOrderSelectProps {
  value?: string;
  onChange: (value: string) => void;
  onSelect?: (order: SaleOrderForSelection | null) => void;
  customerId?: string;
  opportunityId?: string;
  amountHint?: 'uncollected' | 'uninvoiced';
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  clearable?: boolean;
}

const normalizeSaleOrders = (data: unknown): SaleOrderForSelection[] => {
  if (Array.isArray(data)) {
    return data as SaleOrderForSelection[];
  }
  return [];
};

const amountFormatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatUncollectedAmount = (value: SaleOrderForSelection['totalUncollected']) => {
  if (value == null) return '未收 -';
  return `未收 ¥${amountFormatter.format(Number(value))}`;
};

const formatUninvoicedAmount = (order: SaleOrderForSelection) => {
  if (order.orderAmount == null) return '未开票 -';
  const orderAmount = Number(order.orderAmount);
  const invoicedAmount = Number(order.invoicedAmount ?? 0);
  return `未开票 ¥${amountFormatter.format(Math.max(orderAmount - invoicedAmount, 0))}`;
};

const formatAmountHint = (
  order: SaleOrderForSelection,
  amountHint: SaleOrderSelectProps['amountHint']
) => {
  if (amountHint === 'uninvoiced') return formatUninvoicedAmount(order);
  return formatUncollectedAmount(order.totalUncollected);
};

export function SaleOrderSelect({
  value,
  onChange,
  onSelect,
  customerId,
  opportunityId,
  amountHint = 'uncollected',
  placeholder = '搜索并选择合同订单',
  disabled = false,
  className,
  clearable = true,
}: SaleOrderSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [keyword, setKeyword] = React.useState('');
  const debouncedKeyword = useDebouncedValue(keyword.trim(), 300);

  // 标记：正在 handleSelect 中，跳过 customerId 变化清空逻辑
  const isSelectingRef = React.useRef(false);

  // 当客户或商机变化时，清空当前选中值（但排除 handleSelect 触发的联动）
  const relationKey = `${customerId ?? ''}:${opportunityId ?? ''}`;
  const prevRelationKeyRef = React.useRef(relationKey);
  React.useEffect(() => {
    if (prevRelationKeyRef.current !== relationKey) {
      prevRelationKeyRef.current = relationKey;
      if (value && !isSelectingRef.current) {
        onChange('');
        onSelect?.(null);
      }
    }
  }, [relationKey, value, onChange, onSelect]);

  const { data: saleOrders = [], isLoading } = useQuery({
    queryKey: ['sale-order-select', debouncedKeyword, customerId, opportunityId],
    queryFn: async () => {
      const response = await api.get('/sale-orders/all', {
        params: {
          ...(debouncedKeyword ? { keyword: debouncedKeyword } : {}),
          ...(customerId ? { customerId } : {}),
          ...(opportunityId ? { opportunityId } : {}),
        },
      });
      return normalizeSaleOrders(response.data);
    },
    staleTime: 60 * 1000,
  });

  const { data: selectedOrder } = useQuery({
    queryKey: ['sale-order-select', 'selected', value],
    enabled: Boolean(value),
    queryFn: async () => {
      if (!value) return null;
      const response = await api.get<ISaleOrderResponse>(`/sale-orders/${value}`);
      const data = response.data;
      return {
        id: data.id,
        serialNumber: data.serialNumber,
        orderName: getEntityDisplayName('sale-order', data, 'short'),
        customerId: data.customerId,
        customerName: data.customer?.customerName,
        opportunityId: data.opportunityId,
        chargerId: data.chargerId,
        orderAmount: data.orderAmount != null ? Number(data.orderAmount) : null,
        totalReceived: data.totalReceived != null ? Number(data.totalReceived) : null,
        totalUncollected: data.totalUncollected != null ? Number(data.totalUncollected) : null,
        orderStatus: data.orderStatus ?? null,
        invoicedAmount: data.invoicedAmount != null ? Number(data.invoicedAmount) : null,
        legacyAdjustment: data.legacyAdjustment,
      } satisfies SaleOrderForSelection;
    },
    staleTime: 5 * 60 * 1000,
  });

  const mergedOrders = React.useMemo(() => {
    const map = new Map<string, SaleOrderForSelection>();
    saleOrders.forEach((order) => map.set(order.id, order));
    if (selectedOrder) {
      map.set(selectedOrder.id, selectedOrder);
    }
    return Array.from(map.values());
  }, [saleOrders, selectedOrder]);

  const selectedLabel = React.useMemo(() => {
    if (!value) return '';
    return mergedOrders.find((order) => order.id === value)?.orderName ?? '';
  }, [mergedOrders, value]);

  const handleSelect = (orderId: string) => {
    isSelectingRef.current = true;
    onChange(orderId);
    const order = mergedOrders.find((o) => o.id === orderId);
    onSelect?.(order ?? null);
    setOpen(false);
    setKeyword('');
    // 在下一个微任务中重置标记，确保 useEffect 已完成
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
          <CommandInput
            placeholder="搜索合同编号/名称..."
            value={keyword}
            onValueChange={setKeyword}
          />
          <CommandList>
            {isLoading && <CommandEmpty>加载中...</CommandEmpty>}
            {!isLoading && mergedOrders.length === 0 && (
              <CommandEmpty>未找到匹配的合同订单</CommandEmpty>
            )}
            <CommandGroup>
              {mergedOrders.map((order) => (
                <CommandItem
                  key={order.id}
                  value={`${order.serialNumber} ${order.orderName}`}
                  className="items-start py-2"
                  onSelect={() => handleSelect(order.id)}
                >
                  <Check
                    className={cn(
                      'mt-0.5 h-4 w-4',
                      value === order.id ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{order.orderName}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {order.serialNumber} {formatAmountHint(order, amountHint)}
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
