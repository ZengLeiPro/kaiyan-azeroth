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

export interface EmployeeSelectProps {
  value?: string;
  onChange: (value: string) => void;
  onSelect?: (employee: EmployeeOption | null) => void;
  placeholder?: string;
  disabled?: boolean;
  /**
   * 登录状态过滤，默认仅显示登录启用（active）的员工。
   * 可选值：'active' | 'disabled' | 'locked'。
   */
  loginStatus?: string;
  department?: string;
  excludeIds?: string[];
  /**
   * 按角色 code 过滤候选员工（如 ['PM', 'DEVELOPER']）。
   * 用于工时统计「记录人」等场景下的角色定向筛选；不传则不过滤。
   */
  roleCodes?: string[];
  className?: string;
  contentClassName?: string;
  clearable?: boolean;
}

const formatLabel = (employee: EmployeeOption) => employee.name;

const formatSearchValue = (employee: EmployeeOption) =>
  `${employee.serialNumber} ${employee.name}`.trim();

export function EmployeeSelect({
  value,
  onChange,
  onSelect,
  placeholder = '搜索并选择员工',
  disabled = false,
  loginStatus,
  department,
  excludeIds,
  roleCodes,
  className,
  contentClassName,
  clearable = true,
}: EmployeeSelectProps) {
  const [open, setOpen] = React.useState(false);

  // 本地缓存"刚选中的员工"，用于触发器姓名显示。
  // 修复：用户在选中员工后，hook 的 keyword 被清空触发列表 refetch，
  // 而详情接口 /employees/:id 受 organization:employees:view 权限限制，
  // 销售/PM 等业务角色权限缺失时会 403，list 兜底也可能因列表已切换到无关键词
  // 的前 50 条而找不到刚选中的人，最终触发器渲染为空白（看起来像被清空）。
  // 在组件层缓存被选中员工的 {id, name}，让 label 显示不再依赖网络请求。
  const [pickedEmployee, setPickedEmployee] = React.useState<{
    id: string;
    name: string;
  } | null>(null);

  // 外部 value 与本地缓存 id 不一致时（form reset / 切换记录 / 清空），
  // 丢弃缓存，避免显示过期姓名。
  React.useEffect(() => {
    if (!value) {
      if (pickedEmployee !== null) setPickedEmployee(null);
      return;
    }
    if (pickedEmployee && pickedEmployee.id !== value) {
      setPickedEmployee(null);
    }
  }, [value, pickedEmployee]);

  const { keyword, setKeyword, isLoading, filteredEmployees, selectedEmployee } = useEmployeeSearch(
    {
      value,
      loginStatus,
      department,
      excludeIds,
      roleCodes,
    }
  );

  const selectedLabel = React.useMemo(() => {
    if (!value) return '';
    if (pickedEmployee && pickedEmployee.id === value) return pickedEmployee.name;
    return selectedEmployee ? formatLabel(selectedEmployee) : '';
  }, [value, pickedEmployee, selectedEmployee]);

  const handleSelect = (employeeId: string) => {
    const employee = filteredEmployees.find((e) => e.id === employeeId) ?? null;
    if (employee) {
      setPickedEmployee({ id: employee.id, name: employee.name });
    }
    onChange(employeeId);
    onSelect?.(employee);
    setOpen(false);
    setKeyword('');
  };

  const handleClear = () => {
    setPickedEmployee(null);
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
                  onSelect={() => handleSelect(employee.id)}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      value === employee.id ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <span>{formatLabel(employee)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
