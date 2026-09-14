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

interface ProductOption {
  id: string;
  productName: string;
  productNumber: string | null;
  productUnit: string | null;
  standardPrice: number | null;
}

export interface ProductSelectValue {
  productName: string;
  productNumber: string | null;
  standardPrice: number | null;
}

export interface ProductSelectProps {
  value: string | null | undefined;
  onSelect: (product: ProductSelectValue) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  clearable?: boolean;
  onSaleOnly?: boolean;
}

export function ProductSelect({
  value,
  onSelect,
  placeholder = '搜索并选择产品',
  disabled = false,
  className,
  clearable = true,
  onSaleOnly = false,
}: ProductSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [keyword, setKeyword] = React.useState('');
  const debouncedKeyword = useDebouncedValue(keyword.trim(), 300);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['product-select', debouncedKeyword, onSaleOnly],
    queryFn: async () => {
      const response = await api.get<ProductOption[]>('/crm-products/all', {
        params: {
          ...(debouncedKeyword ? { keyword: debouncedKeyword } : {}),
          ...(onSaleOnly ? { productStatus: 'on_sale' } : {}),
        },
      });
      return Array.isArray(response.data) ? response.data : [];
    },
    staleTime: 60 * 1000,
  });

  const handleSelect = (product: ProductOption) => {
    onSelect({
      productName: product.productName,
      productNumber: product.productNumber ?? null,
      standardPrice: product.standardPrice ?? null,
    });
    setOpen(false);
    setKeyword('');
  };

  const handleClear = () => {
    onSelect({ productName: '', productNumber: null, standardPrice: null });
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
          <span className={cn('truncate', !value && 'text-muted-foreground')}>
            {value || placeholder}
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
            placeholder="搜索产品名称或编号..."
            value={keyword}
            onValueChange={setKeyword}
          />
          <CommandList>
            {isLoading && <CommandEmpty>加载中...</CommandEmpty>}
            {!isLoading && products.length === 0 && <CommandEmpty>未找到匹配产品</CommandEmpty>}
            <CommandGroup>
              {products.map((product) => (
                <CommandItem
                  key={product.id}
                  value={`${product.productNumber ?? ''} ${product.productName}`}
                  onSelect={() => handleSelect(product)}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      value === product.productName ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{product.productName}</div>
                    {(product.productNumber || product.standardPrice != null) && (
                      <div className="text-xs text-muted-foreground">
                        {product.productNumber ?? ''}
                        {product.productNumber && product.standardPrice != null ? ' · ' : ''}
                        {product.standardPrice != null
                          ? `¥${Number(product.standardPrice).toFixed(2)}`
                          : ''}
                      </div>
                    )}
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
