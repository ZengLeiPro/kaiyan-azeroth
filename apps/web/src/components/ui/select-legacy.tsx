import { Check, ChevronDown, Search } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { logger } from '@/lib/logger';
import { cn } from '@/lib/utils';

interface SelectOption<T extends string | null = string | null> {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean;
}

interface SelectProps<T extends string | null = string | null> {
  options: SelectOption<T>[];
  value?: T;
  onChange?: (value: T) => void;
  onValueChange?: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  testId?: string;
  'data-testid'?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  contentClassName?: string;
  direction?: 'up' | 'down';
}

function getFirstEnabledIndex<T extends string | null>(options: SelectOption<T>[]) {
  return options.findIndex((option) => !option.disabled);
}

function getNextEnabledIndex<T extends string | null>(
  options: SelectOption<T>[],
  currentIndex: number,
  step: 1 | -1
) {
  if (options.length === 0) return -1;

  const firstEnabled = getFirstEnabledIndex(options);
  if (firstEnabled === -1) return -1;

  let nextIndex = currentIndex;
  for (let i = 0; i < options.length; i += 1) {
    nextIndex = (nextIndex + step + options.length) % options.length;
    if (!options[nextIndex]?.disabled) {
      return nextIndex;
    }
  }

  return firstEnabled;
}

export function Select<T extends string | null = string | null>({
  options,
  value,
  onChange,
  onValueChange,
  placeholder = '请选择...',
  disabled = false,
  className,
  testId,
  'data-testid': dataTestId,
  searchable,
  searchPlaceholder = '搜索...',
  contentClassName,
  direction = 'down',
}: SelectProps<T>) {
  const actualTestId = testId || dataTestId;
  const [open, setOpen] = React.useState(false);
  const [searchTerm, setSearchTerm] = React.useState('');
  const [highlightedIndex, setHighlightedIndex] = React.useState(-1);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const optionRefs = React.useRef<Array<HTMLDivElement | null>>([]);

  // 智能判断是否显示搜索框：
  // 1. 如果显式传入了 searchable，则以传入值为准
  // 2. 否则，如果选项数量大于 6 个，自动开启搜索
  const shouldShowSearch = searchable !== undefined ? searchable : options.length > 6;

  const selectedOption = options.find((opt) => opt.value === value);

  // 过滤选项
  const filteredOptions = React.useMemo(() => {
    if (!searchTerm) return options;
    const lowerSearchTerm = searchTerm.toLowerCase();
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(lowerSearchTerm) ||
        (opt.value?.toLowerCase().includes(lowerSearchTerm) ?? false)
    );
  }, [options, searchTerm]);

  // 打开时聚焦搜索框
  React.useEffect(() => {
    if (open && shouldShowSearch && searchInputRef.current) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }
  }, [open, shouldShowSearch]);

  React.useEffect(() => {
    if (!open) {
      setHighlightedIndex(-1);
      return;
    }

    const selectedIndex = filteredOptions.findIndex(
      (option) => option.value === value && !option.disabled
    );
    setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : getFirstEnabledIndex(filteredOptions));
  }, [filteredOptions, open, value]);

  React.useEffect(() => {
    if (highlightedIndex < 0) return;
    optionRefs.current[highlightedIndex]?.scrollIntoView?.({ block: 'nearest' });
  }, [highlightedIndex]);

  const handleSelect = (optValue: T) => {
    onChange?.(optValue);
    onValueChange?.(optValue);
    setOpen(false);
    setSearchTerm('');
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      setSearchTerm('');
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      setHighlightedIndex((current) =>
        getNextEnabledIndex(filteredOptions, current, event.key === 'ArrowDown' ? 1 : -1)
      );
      return;
    }

    if (event.key === 'Enter') {
      const highlightedOption = filteredOptions[highlightedIndex];
      if (!highlightedOption || highlightedOption.disabled) return;
      event.preventDefault();
      event.stopPropagation();
      handleSelect(highlightedOption.value);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          data-testid={actualTestId}
          onKeyDown={handleKeyDown}
          className={cn(
            'h-10 w-full justify-between px-3 font-normal',
            !selectedOption && 'text-muted-foreground',
            className
          )}
        >
          <span className="truncate">{selectedOption ? selectedOption.label : placeholder}</span>
          <ChevronDown
            className={cn(
              'h-4 w-4 flex-shrink-0 opacity-50 transition-transform',
              open && 'rotate-180'
            )}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn(
          'w-[--radix-popover-trigger-width] min-w-[var(--radix-popover-trigger-width)] p-0',
          contentClassName
        )}
        align="start"
        side={direction === 'up' ? 'top' : 'bottom'}
        onKeyDown={handleKeyDown}
      >
        <div className="w-full">
          {/* 搜索框 */}
          {shouldShowSearch && (
            <div className="border-b p-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={searchInputRef}
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="h-8 pl-8 pr-2"
                  data-testid="select-search-input"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={handleKeyDown}
                />
              </div>
            </div>
          )}

          {/* 选项列表 */}
          <div
            className="max-h-60 overflow-auto overscroll-contain p-1"
            onWheel={(e) => e.stopPropagation()}
          >
            {filteredOptions.length === 0 ? (
              <div
                className="px-2 py-4 text-center text-sm text-muted-foreground"
                data-testid="select-no-results"
              >
                {searchTerm ? '无匹配结果' : '无可用选项'}
              </div>
            ) : (
              filteredOptions.map((option, index) => (
                <div
                  key={option.value ?? 'null-option'}
                  ref={(node) => {
                    optionRefs.current[index] = node;
                  }}
                  onClick={() => !option.disabled && handleSelect(option.value)}
                  data-testid={`select-option-${option.value}`}
                  className={cn(
                    'relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none',
                    'hover:bg-accent hover:text-accent-foreground',
                    (highlightedIndex === index || value === option.value) &&
                      'bg-accent text-accent-foreground',
                    option.disabled && 'cursor-not-allowed opacity-50'
                  )}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      value === option.value ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <div className={cn('flex-1', option.disabled && 'text-muted-foreground')}>
                    <div>{option.label}</div>
                    {option.description && (
                      <div className="text-xs text-muted-foreground">{option.description}</div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// 多选组件
interface MultiSelectProps {
  options: SelectOption[];
  value?: string[];
  onChange?: (value: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  testId?: string;
  'data-testid'?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  contentClassName?: string;
}

// 异步加载选择组件
interface AsyncSelectProps<T extends string | null = string | null> {
  loadOptions: () => Promise<SelectOption<T>[]>;
  value?: T;
  onChange?: (value: T) => void;
  onValueChange?: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  testId?: string;
  'data-testid'?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  contentClassName?: string;
}

export function AsyncSelect<T extends string | null = string | null>({
  loadOptions,
  value,
  onChange,
  onValueChange,
  placeholder = '请选择...',
  disabled = false,
  className,
  testId,
  'data-testid': dataTestId,
  searchable,
  searchPlaceholder = '搜索...',
  contentClassName,
}: AsyncSelectProps<T>) {
  const actualTestId = testId || dataTestId;
  const [open, setOpen] = React.useState(false);
  const [searchTerm, setSearchTerm] = React.useState('');
  const [highlightedIndex, setHighlightedIndex] = React.useState(-1);
  const [options, setOptions] = React.useState<SelectOption<T>[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const optionRefs = React.useRef<Array<HTMLDivElement | null>>([]);

  // 智能判断是否显示搜索框：
  // 1. 如果显式传入了 searchable，则以传入值为准
  // 2. 否则，如果选项数量大于 6 个，自动开启搜索
  const shouldShowSearch = searchable !== undefined ? searchable : options.length > 6;

  const selectedOption = options.find((opt) => opt.value === value);

  // 过滤选项
  const filteredOptions = React.useMemo(() => {
    if (!searchTerm) return options;
    const lowerSearchTerm = searchTerm.toLowerCase();
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(lowerSearchTerm) ||
        (opt.value?.toLowerCase().includes(lowerSearchTerm) ?? false)
    );
  }, [options, searchTerm]);

  // 打开时或有初始值时加载数据
  React.useEffect(() => {
    if ((open || value) && !loaded && !loading) {
      setLoading(true);
      loadOptions()
        .then((data) => {
          setOptions(data);
          setLoaded(true);
        })
        .catch((error) => {
          logger.error('AsyncSelect', '加载选项失败:', error);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [open, value, loaded, loading, loadOptions]);

  // 打开时聚焦搜索框
  React.useEffect(() => {
    if (open && shouldShowSearch && searchInputRef.current && !loading) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }
  }, [open, shouldShowSearch, loading]);

  React.useEffect(() => {
    if (!open || loading) {
      setHighlightedIndex(-1);
      return;
    }

    const selectedIndex = filteredOptions.findIndex(
      (option) => option.value === value && !option.disabled
    );
    setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : getFirstEnabledIndex(filteredOptions));
  }, [filteredOptions, loading, open, value]);

  React.useEffect(() => {
    if (highlightedIndex < 0) return;
    optionRefs.current[highlightedIndex]?.scrollIntoView?.({ block: 'nearest' });
  }, [highlightedIndex]);

  const handleSelect = (optValue: T) => {
    onChange?.(optValue);
    onValueChange?.(optValue);
    setOpen(false);
    setSearchTerm('');
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      setSearchTerm('');
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }

    if (loading) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      setHighlightedIndex((current) =>
        getNextEnabledIndex(filteredOptions, current, event.key === 'ArrowDown' ? 1 : -1)
      );
      return;
    }

    if (event.key === 'Enter') {
      const highlightedOption = filteredOptions[highlightedIndex];
      if (!highlightedOption || highlightedOption.disabled) return;
      event.preventDefault();
      event.stopPropagation();
      handleSelect(highlightedOption.value);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          data-testid={actualTestId}
          onKeyDown={handleKeyDown}
          className={cn(
            'h-10 w-full justify-between px-3 font-normal',
            !selectedOption && 'text-muted-foreground',
            className
          )}
        >
          <span className="truncate">{selectedOption ? selectedOption.label : placeholder}</span>
          <ChevronDown
            className={cn(
              'h-4 w-4 flex-shrink-0 opacity-50 transition-transform',
              open && 'rotate-180'
            )}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn(
          'w-[--radix-popover-trigger-width] min-w-[var(--radix-popover-trigger-width)] p-0',
          contentClassName
        )}
        align="start"
        onKeyDown={handleKeyDown}
      >
        <div className="w-full">
          {/* 加载状态 */}
          {loading && (
            <div
              className="flex items-center justify-center p-4"
              data-testid="async-select-loading"
            >
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <svg
                  className="h-4 w-4 animate-spin"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                <span>加载中...</span>
              </div>
            </div>
          )}

          {/* 加载完成后显示内容 */}
          {!loading && (
            <>
              {/* 搜索框 */}
              {shouldShowSearch && (
                <div className="border-b p-2">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      ref={searchInputRef}
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder={searchPlaceholder}
                      className="h-8 pl-8 pr-2"
                      data-testid="async-select-search-input"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={handleKeyDown}
                    />
                  </div>
                </div>
              )}

              {/* 选项列表 */}
              <div
                className="max-h-60 overflow-auto overscroll-contain p-1"
                data-testid="async-select-options"
                onWheel={(e) => e.stopPropagation()}
              >
                {filteredOptions.length === 0 ? (
                  <div
                    className="px-2 py-4 text-center text-sm text-muted-foreground"
                    data-testid="async-select-no-results"
                  >
                    {searchTerm ? '无匹配结果' : '无可用选项'}
                  </div>
                ) : (
                  filteredOptions.map((option, index) => (
                    <div
                      key={option.value ?? 'null-option'}
                      ref={(node) => {
                        optionRefs.current[index] = node;
                      }}
                      onClick={() => !option.disabled && handleSelect(option.value)}
                      data-testid={`async-select-option-${option.value}`}
                      className={cn(
                        'relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none',
                        'hover:bg-accent hover:text-accent-foreground',
                        (highlightedIndex === index || value === option.value) &&
                          'bg-accent text-accent-foreground',
                        option.disabled && 'cursor-not-allowed opacity-50'
                      )}
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4',
                          value === option.value ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      {option.label}
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// 多选组件
export function MultiSelect({
  options,
  value = [],
  onChange,
  placeholder = '请选择...',
  disabled = false,
  className,
  testId,
  'data-testid': dataTestId,
  searchable,
  searchPlaceholder = '搜索...',
  contentClassName,
}: MultiSelectProps) {
  const actualTestId = testId || dataTestId;
  const [open, setOpen] = React.useState(false);
  const [searchTerm, setSearchTerm] = React.useState('');
  const [highlightedIndex, setHighlightedIndex] = React.useState(-1);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const optionRefs = React.useRef<Array<HTMLDivElement | null>>([]);

  // 智能判断是否显示搜索框：
  // 1. 如果显式传入了 searchable，则以传入值为准
  // 2. 否则，如果选项数量大于 6 个，自动开启搜索
  const shouldShowSearch = searchable !== undefined ? searchable : options.length > 6;

  // 过滤选项
  const filteredOptions = React.useMemo(() => {
    if (!searchTerm) return options;
    const lowerSearchTerm = searchTerm.toLowerCase();
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(lowerSearchTerm) ||
        (opt.value?.toLowerCase().includes(lowerSearchTerm) ?? false)
    );
  }, [options, searchTerm]);

  // 打开时聚焦搜索框
  React.useEffect(() => {
    if (open && shouldShowSearch && searchInputRef.current) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }
  }, [open, shouldShowSearch]);

  React.useEffect(() => {
    if (!open) {
      setHighlightedIndex(-1);
      return;
    }

    const selectedIndex = filteredOptions.findIndex(
      (option) => option.value !== null && value.includes(option.value) && !option.disabled
    );
    setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : getFirstEnabledIndex(filteredOptions));
  }, [filteredOptions, open, value]);

  React.useEffect(() => {
    if (highlightedIndex < 0) return;
    optionRefs.current[highlightedIndex]?.scrollIntoView?.({ block: 'nearest' });
  }, [highlightedIndex]);

  const selectedLabels = options
    .filter((opt) => opt.value !== null && value.includes(opt.value))
    .map((opt) => opt.label)
    .join(', ');

  const handleToggle = (optValue: string | null) => {
    if (optValue === null) return;
    const newValue = value.includes(optValue)
      ? value.filter((v) => v !== optValue)
      : [...value, optValue];
    onChange?.(newValue);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      setHighlightedIndex((current) =>
        getNextEnabledIndex(filteredOptions, current, event.key === 'ArrowDown' ? 1 : -1)
      );
      return;
    }

    if (event.key === 'Enter') {
      const highlightedOption = filteredOptions[highlightedIndex];
      if (!highlightedOption || highlightedOption.disabled) return;
      event.preventDefault();
      event.stopPropagation();
      handleToggle(highlightedOption.value);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          data-testid={actualTestId}
          onKeyDown={handleKeyDown}
          className={cn(
            'h-10 w-full justify-between px-3 font-normal',
            !selectedLabels && 'text-muted-foreground',
            className
          )}
        >
          <span className="truncate">{selectedLabels || placeholder}</span>
          <ChevronDown
            className={cn(
              'h-4 w-4 flex-shrink-0 opacity-50 transition-transform',
              open && 'rotate-180'
            )}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn(
          'w-[--radix-popover-trigger-width] min-w-[var(--radix-popover-trigger-width)] p-0',
          contentClassName
        )}
        align="start"
        onKeyDown={handleKeyDown}
      >
        <div className="w-full">
          {/* 搜索框 */}
          {shouldShowSearch && (
            <div className="border-b p-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={searchInputRef}
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="h-8 pl-8 pr-2"
                  data-testid="multiselect-search-input"
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={handleKeyDown}
                />
              </div>
            </div>
          )}

          <div
            className="max-h-60 overflow-auto overscroll-contain p-1"
            onWheel={(e) => e.stopPropagation()}
          >
            {filteredOptions.length === 0 ? (
              <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                {searchTerm ? '无匹配结果' : '无可用选项'}
              </div>
            ) : (
              filteredOptions.map((option, index) => (
                <div
                  key={option.value ?? 'null-option'}
                  ref={(node) => {
                    optionRefs.current[index] = node;
                  }}
                  onClick={() => !option.disabled && handleToggle(option.value)}
                  data-testid={`multiselect-option-${option.value}`}
                  className={cn(
                    'relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none',
                    'hover:bg-accent hover:text-accent-foreground',
                    (highlightedIndex === index ||
                      (option.value !== null && value.includes(option.value))) &&
                      'bg-accent text-accent-foreground',
                    option.disabled && 'cursor-not-allowed opacity-50'
                  )}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      option.value !== null && value.includes(option.value)
                        ? 'opacity-100'
                        : 'opacity-0'
                    )}
                  />
                  {option.label}
                </div>
              ))
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
