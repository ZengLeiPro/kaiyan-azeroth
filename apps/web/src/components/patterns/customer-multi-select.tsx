import type { ICustomerResponse } from '@ky-azeroth/shared/types/customer';
import { useQueries, useQuery } from '@tanstack/react-query';
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

interface CustomerOption {
  id: string;
  serialNumber: string;
  customerName: string;
}

export interface CustomerMultiSelectProps {
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
}

const normalizeCustomers = (data: unknown): CustomerOption[] => {
  if (Array.isArray(data)) {
    return data as CustomerOption[];
  }
  return [];
};

export function CustomerMultiSelect({
  value,
  onChange,
  placeholder = '搜索并选择客户',
  disabled = false,
  className,
  contentClassName,
}: CustomerMultiSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [keyword, setKeyword] = React.useState('');
  const debouncedKeyword = useDebouncedValue(keyword.trim(), 300);

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['customer-multi-select', debouncedKeyword],
    queryFn: async () => {
      const response = await api.get('/customers/all', {
        params: {
          ...(debouncedKeyword ? { keyword: debouncedKeyword } : {}),
        },
      });
      return normalizeCustomers(response.data);
    },
    staleTime: 60 * 1000,
  });

  // 使用 useQueries 对 value 中每个 id 并发拉取详情，回填已选项 label
  const selectedQueries = useQueries({
    queries: value.map((id) => ({
      queryKey: ['customer-multi-select', 'selected', id],
      queryFn: async () => {
        const response = await api.get<ICustomerResponse>(`/customers/${id}`);
        return response.data;
      },
      staleTime: 5 * 60 * 1000,
      enabled: Boolean(id),
    })),
  });

  // 已选项 id → label 映射
  const selectedLabels = React.useMemo(() => {
    const map = new Map<string, string>();
    // 先从搜索结果填充
    customers.forEach((c) => {
      if (value.includes(c.id)) {
        map.set(c.id, c.customerName);
      }
    });
    // 再用 useQueries 的结果覆盖（确保权威 label）
    selectedQueries.forEach((q, idx) => {
      const id = value[idx];
      if (q.data && id) {
        map.set(id, q.data.customerName);
      }
    });
    return map;
  }, [customers, selectedQueries, value]);

  const displayText = React.useMemo(() => {
    if (value.length === 0) return '';
    return value.map((id) => selectedLabels.get(id) || '...').join(', ');
  }, [value, selectedLabels]);

  const handleToggle = (customerId: string) => {
    if (value.includes(customerId)) {
      onChange(value.filter((id) => id !== customerId));
    } else {
      onChange([...value, customerId]);
    }
  };

  const handleRemove = (customerId: string) => {
    onChange(value.filter((id) => id !== customerId));
  };

  const handleClearAll = () => {
    onChange([]);
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
          <span className={cn('truncate', !displayText && 'text-muted-foreground')}>
            {displayText || placeholder}
          </span>
          <div className="ml-2 flex items-center gap-1">
            {value.length > 0 ? (
              <span
                role="button"
                className="rounded-sm p-0.5 hover:bg-accent"
                onClick={(event) => {
                  event.stopPropagation();
                  handleClearAll();
                }}
              >
                <X className="h-3.5 w-3.5" />
              </span>
            ) : null}
            <ChevronDown className="h-4 w-4 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn('w-[--radix-popover-trigger-width] p-0', contentClassName)}
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput placeholder="搜索客户名称..." value={keyword} onValueChange={setKeyword} />
          <CommandList>
            {isLoading && <CommandEmpty>加载中...</CommandEmpty>}
            {!isLoading && customers.length === 0 && <CommandEmpty>未找到匹配客户</CommandEmpty>}
            <CommandGroup>
              {customers.map((customer) => (
                <CommandItem
                  key={customer.id}
                  value={`${customer.serialNumber} ${customer.customerName}`}
                  onSelect={() => handleToggle(customer.id)}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      value.includes(customer.id) ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <span>{customer.customerName}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        {value.length > 0 && (
          <div className="border-t p-2">
            <div className="flex flex-wrap gap-1">
              {value.map((id) => (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-xs"
                >
                  {selectedLabels.get(id) || '...'}
                  <button
                    type="button"
                    className="rounded-sm hover:bg-accent-foreground/20"
                    onClick={() => handleRemove(id)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
