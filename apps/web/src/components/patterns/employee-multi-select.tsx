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
import { EmployeeOption, useEmployeeSearch } from '@/hooks/use-employee-search';
import { cn } from '@/lib/utils';

export interface EmployeeMultiSelectProps {
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
  /** 需要从候选下拉中排除的员工 ID（例如协作人不能是负责人本人） */
  excludeIds?: string[];
  /**
   * 按角色 code 过滤候选员工（如 ['PM', 'DEVELOPER']）。
   * 用于工时统计「记录人」等场景下的角色定向筛选；不传则不过滤。
   */
  roleCodes?: string[];
}

const formatLabel = (employee: EmployeeOption) => employee.name;

const formatSearchValue = (employee: EmployeeOption) =>
  `${employee.serialNumber} ${employee.name}`.trim();

export function EmployeeMultiSelect({
  value,
  onChange,
  placeholder = '搜索并选择员工',
  disabled = false,
  className,
  contentClassName,
  excludeIds,
  roleCodes,
}: EmployeeMultiSelectProps) {
  const [open, setOpen] = React.useState(false);

  const {
    keyword,
    setKeyword,
    isLoading,
    filteredEmployees: rawEmployees,
  } = useEmployeeSearch({
    roleCodes,
  });
  const excludeSet = React.useMemo(() => new Set(excludeIds ?? []), [excludeIds]);
  const filteredEmployees = React.useMemo(
    () =>
      excludeSet.size === 0 ? rawEmployees : rawEmployees.filter((e) => !excludeSet.has(e.id)),
    [rawEmployees, excludeSet]
  );

  // 查询已选中但不在搜索结果中的员工名称
  const [selectedNames, setSelectedNames] = React.useState<Map<string, string>>(new Map());

  // 当 filteredEmployees 更新时，缓存已选中员工的名称
  React.useEffect(() => {
    setSelectedNames((prev) => {
      const updated = new Map(prev);
      for (const emp of filteredEmployees) {
        if (value.includes(emp.id)) {
          updated.set(emp.id, formatLabel(emp));
        }
      }
      return updated;
    });
  }, [filteredEmployees, value]);

  const displayText = React.useMemo(() => {
    if (value.length === 0) return '';
    return value.map((id) => selectedNames.get(id) || '...').join(', ');
  }, [value, selectedNames]);

  const handleToggle = (employeeId: string) => {
    const employee = filteredEmployees.find((e) => e.id === employeeId);
    if (value.includes(employeeId)) {
      onChange(value.filter((id) => id !== employeeId));
    } else {
      onChange([...value, employeeId]);
      if (employee) {
        setSelectedNames((prev) => new Map(prev).set(employeeId, formatLabel(employee)));
      }
    }
  };

  const handleRemove = (employeeId: string) => {
    onChange(value.filter((id) => id !== employeeId));
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
          <CommandInput
            placeholder="搜索员工姓名或工号..."
            value={keyword}
            onValueChange={setKeyword}
          />
          <CommandList>
            {isLoading && <CommandEmpty>加载中...</CommandEmpty>}
            {!isLoading && filteredEmployees.length === 0 && (
              <CommandEmpty>未找到匹配员工</CommandEmpty>
            )}
            <CommandGroup>
              {filteredEmployees.map((employee) => (
                <CommandItem
                  key={employee.id}
                  value={formatSearchValue(employee)}
                  onSelect={() => handleToggle(employee.id)}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      value.includes(employee.id) ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <span>{formatLabel(employee)}</span>
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
                  {selectedNames.get(id) || '...'}
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
