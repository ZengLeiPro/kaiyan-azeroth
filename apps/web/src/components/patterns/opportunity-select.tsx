import { OPPORTUNITY_STAGE_LABELS } from '@ky-azeroth/shared/constants/status-labels';
import type { OpportunityForSelection } from '@ky-azeroth/shared/types';
import type { IOpportunityResponse } from '@ky-azeroth/shared/types/opportunity';
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

export interface OpportunitySelectProps {
  value?: string;
  onChange: (value: string) => void;
  onSelectedOpportunityChange?: (opportunity: IOpportunityResponse | null) => void;
  customerId?: string;
  availableForSaleOrder?: boolean;
  currentSaleOrderId?: string | null;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  clearable?: boolean;
}

const normalizeOpportunities = (data: unknown): OpportunityForSelection[] => {
  if (Array.isArray(data)) {
    return data as OpportunityForSelection[];
  }
  return [];
};

const formatOpportunityLabel = (opportunity: OpportunityForSelection): string => {
  return opportunity.opportunityName;
};

const formatOpportunityStage = (opportunity: OpportunityForSelection): string => {
  if (!opportunity.opportunityStage) return '阶段未知';
  return (
    (OPPORTUNITY_STAGE_LABELS as Record<string, string>)[opportunity.opportunityStage] ||
    opportunity.opportunityStage
  );
};

const formatOpportunityProducts = (opportunity: OpportunityForSelection): string => {
  const names = (opportunity.productNames ?? []).filter((n) => n && n.trim().length > 0);
  if (names.length === 0) return '无产品';
  return names.join(' ');
};

export function OpportunitySelect({
  value,
  onChange,
  onSelectedOpportunityChange,
  customerId,
  availableForSaleOrder = false,
  currentSaleOrderId,
  placeholder = '搜索并选择商机',
  disabled = false,
  className,
  clearable = true,
}: OpportunitySelectProps) {
  const [open, setOpen] = React.useState(false);
  const [keyword, setKeyword] = React.useState('');
  const debouncedKeyword = useDebouncedValue(keyword.trim(), 300);

  // 标记：正在 handleSelect 中，跳过 customerId 变化清空逻辑
  const isSelectingRef = React.useRef(false);

  const { data: opportunities = [], isLoading } = useQuery({
    queryKey: [
      'opportunity-select',
      debouncedKeyword,
      customerId,
      availableForSaleOrder,
      currentSaleOrderId,
    ],
    queryFn: async () => {
      const response = await api.get('/opportunities/all', {
        params: {
          ...(debouncedKeyword ? { keyword: debouncedKeyword } : {}),
          ...(customerId ? { customerId } : {}),
          ...(availableForSaleOrder ? { availableForSaleOrder: true } : {}),
          ...(availableForSaleOrder && currentSaleOrderId ? { currentSaleOrderId } : {}),
        },
      });
      return normalizeOpportunities(response.data);
    },
    staleTime: 60 * 1000,
  });

  // 查询已选中项的详情，确保选中项始终能显示
  const { data: selectedOpportunity } = useQuery({
    queryKey: ['opportunity-select', 'selected', value],
    enabled: Boolean(value),
    queryFn: async () => {
      if (!value) return null;
      const response = await api.get<IOpportunityResponse>(`/opportunities/${value}`);
      return response.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  React.useEffect(() => {
    if (!onSelectedOpportunityChange) return;
    if (!value) {
      onSelectedOpportunityChange(null);
      return;
    }
    if (selectedOpportunity?.id === value) {
      onSelectedOpportunityChange(selectedOpportunity);
    }
  }, [value, selectedOpportunity, onSelectedOpportunityChange]);

  // 当 customerId 变化时，仅在新 customerId 与已选商机的客户不一致时才清空
  // （父组件基于商机自动回填客户的场景下，customerId 与 selectedOpportunity.customerId 一致，应保留商机）
  const prevCustomerIdRef = React.useRef(customerId);
  React.useEffect(() => {
    if (prevCustomerIdRef.current === customerId) return;
    if (!value || isSelectingRef.current) {
      prevCustomerIdRef.current = customerId;
      return;
    }
    if (!selectedOpportunity) {
      // 等商机详情加载完再判断，避免误清空（依赖 selectedOpportunity 重新触发）
      return;
    }
    if (selectedOpportunity.customerId !== customerId) {
      onChange('');
    }
    prevCustomerIdRef.current = customerId;
  }, [customerId, value, onChange, selectedOpportunity]);

  const mergedOpportunities = React.useMemo(() => {
    const map = new Map<string, OpportunityForSelection>();
    opportunities.forEach((opp) => map.set(opp.id, opp));
    if (selectedOpportunity) {
      const existing = map.get(selectedOpportunity.id);
      map.set(selectedOpportunity.id, {
        id: selectedOpportunity.id,
        serialNumber: selectedOpportunity.serialNumber,
        opportunityName: selectedOpportunity.opportunityName,
        customerName: selectedOpportunity.customer?.customerName,
        opportunityAmount: selectedOpportunity.opportunityAmount,
        opportunityStage: selectedOpportunity.opportunityStage,
        productNames:
          existing?.productNames ??
          selectedOpportunity.products?.map((p) => p.productName).filter(Boolean),
      });
    }
    return Array.from(map.values());
  }, [opportunities, selectedOpportunity]);

  const selectedLabel = React.useMemo(() => {
    if (!value) return '';
    if (selectedOpportunity) return formatOpportunityLabel(selectedOpportunity);
    const found = opportunities.find((o) => o.id === value);
    return found ? formatOpportunityLabel(found) : '';
  }, [selectedOpportunity, value, opportunities]);

  const handleSelect = (opportunityId: string) => {
    isSelectingRef.current = true;
    onChange(opportunityId);
    setOpen(false);
    setKeyword('');
    // 在下一个微任务中重置标记，确保 useEffect 已完成
    setTimeout(() => {
      isSelectingRef.current = false;
    }, 0);
  };

  const handleClear = () => {
    onChange('');
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
          <CommandInput placeholder="搜索商机..." value={keyword} onValueChange={setKeyword} />
          <CommandList>
            {isLoading && <CommandEmpty>加载中...</CommandEmpty>}
            {!isLoading && mergedOpportunities.length === 0 && (
              <CommandEmpty>未找到匹配商机</CommandEmpty>
            )}
            <CommandGroup>
              {mergedOpportunities.map((opportunity) => (
                <CommandItem
                  key={opportunity.id}
                  value={`${opportunity.serialNumber} ${opportunity.opportunityName}`}
                  onSelect={() => handleSelect(opportunity.id)}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      value === opportunity.id ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{formatOpportunityLabel(opportunity)}</div>
                    <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                      <span className="shrink-0">{formatOpportunityStage(opportunity)}</span>
                      <span
                        className="min-w-0 flex-1 truncate"
                        title={formatOpportunityProducts(opportunity)}
                      >
                        {formatOpportunityProducts(opportunity)}
                      </span>
                    </div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
