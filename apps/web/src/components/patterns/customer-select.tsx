import type { ICustomerResponse } from '@ky-azeroth/shared/types/customer';
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

interface CustomerOption {
  id: string;
  serialNumber: string;
  customerName: string;
}

export interface CustomerSelectProps {
  value?: string;
  onChange: (value: string) => void;
  onSelectedCustomerChange?: (customer: ICustomerResponse | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
  clearable?: boolean;
}

const normalizeCustomers = (data: unknown): CustomerOption[] => {
  if (Array.isArray(data)) {
    return data as CustomerOption[];
  }
  return [];
};

export function CustomerSelect({
  value,
  onChange,
  onSelectedCustomerChange,
  placeholder = '搜索并选择客户',
  disabled = false,
  className,
  contentClassName,
  clearable = true,
}: CustomerSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [keyword, setKeyword] = React.useState('');
  const lastNotifiedCustomerId = React.useRef<string | null>(null);
  const debouncedKeyword = useDebouncedValue(keyword.trim(), 300);

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['customer-select', debouncedKeyword],
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

  const { data: selectedCustomer } = useQuery({
    queryKey: ['customer-select', 'selected', value],
    enabled: Boolean(value),
    queryFn: async () => {
      if (!value) return null;
      const response = await api.get<ICustomerResponse>(`/customers/${value}`);
      return response.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  React.useEffect(() => {
    if (!selectedCustomer || lastNotifiedCustomerId.current === selectedCustomer.id) return;
    lastNotifiedCustomerId.current = selectedCustomer.id;
    onSelectedCustomerChange?.(selectedCustomer);
  }, [onSelectedCustomerChange, selectedCustomer]);

  const mergedCustomers = React.useMemo(() => {
    const map = new Map<string, CustomerOption>();
    customers.forEach((customer) => map.set(customer.id, customer));
    if (selectedCustomer) {
      map.set(selectedCustomer.id, {
        id: selectedCustomer.id,
        serialNumber: selectedCustomer.serialNumber,
        customerName: selectedCustomer.customerName,
      });
    }
    return Array.from(map.values());
  }, [customers, selectedCustomer]);

  const selectedLabel = React.useMemo(() => {
    if (!value) return '';
    // 优先从已有列表中查找（避免依赖异步查询导致选中后短暂空白）
    const fromList = mergedCustomers.find((c) => c.id === value);
    if (fromList) return fromList.customerName;
    return selectedCustomer?.customerName || '';
  }, [mergedCustomers, selectedCustomer, value]);

  const handleSelect = (customerId: string) => {
    onChange(customerId);
    setOpen(false);
    setKeyword('');
  };

  const handleClear = () => {
    lastNotifiedCustomerId.current = null;
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
      <PopoverContent
        className={cn('w-[--radix-popover-trigger-width] p-0', contentClassName)}
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput placeholder="搜索客户名称..." value={keyword} onValueChange={setKeyword} />
          <CommandList>
            {isLoading && <CommandEmpty>加载中...</CommandEmpty>}
            {!isLoading && mergedCustomers.length === 0 && (
              <CommandEmpty>未找到匹配客户</CommandEmpty>
            )}
            <CommandGroup>
              {mergedCustomers.map((customer) => (
                <CommandItem
                  key={customer.id}
                  value={`${customer.serialNumber} ${customer.customerName}`}
                  onSelect={() => handleSelect(customer.id)}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      value === customer.id ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <span>{customer.customerName}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
