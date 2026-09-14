import type { DepartmentForSelection } from '@ky-azeroth/shared/types';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, ChevronRight, X } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/ui/badge';
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
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

export interface DepartmentSelectProps {
  /** 选中的部门 ID（单选时为 string，多选时为 string[]） */
  value?: string | string[];
  /** 选择变更回调 */
  onChange?: (value: string | string[]) => void;
  /** 是否多选模式 */
  multiple?: boolean;
  /** 占位符文本 */
  placeholder?: string;
  /** 是否禁用 */
  disabled?: boolean;
  /** 自定义样式类名 */
  className?: string;
  /** 下拉弹层样式类名 */
  contentClassName?: string;
  /** 是否可清除选择 */
  clearable?: boolean;
}

/**
 * 部门选择器组件
 * 支持单选和多选模式，使用 Combobox 模式（可搜索）
 * 树形展示部门层级
 */
export function DepartmentSelect({
  value,
  onChange,
  multiple = false,
  placeholder = '选择部门',
  disabled = false,
  className,
  contentClassName,
  clearable = true,
}: DepartmentSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [keyword, setKeyword] = React.useState('');
  const [expandedIds, setExpandedIds] = React.useState<Set<string>>(new Set());

  // 获取部门列表
  const { data: departments = [], isLoading } = useQuery({
    queryKey: ['departments', 'all'],
    queryFn: async () => {
      const res = await api.get<DepartmentForSelection[]>('/departments/all');
      return res.data;
    },
  });

  // 构建部门路径映射（用于搜索）
  const departmentPathMap = React.useMemo(() => {
    const pathMap = new Map<string, string>();

    const buildPath = (deptId: string, visited = new Set<string>()): string => {
      if (visited.has(deptId)) return '';
      visited.add(deptId);

      const dept = departments.find((d) => d.id === deptId);
      if (!dept) return '';

      if (dept.parentId) {
        const parentPath = buildPath(dept.parentId, visited);
        return parentPath ? `${parentPath} / ${dept.name}` : dept.name;
      }
      return dept.name;
    };

    departments.forEach((dept) => {
      pathMap.set(dept.id, buildPath(dept.id));
    });

    return pathMap;
  }, [departments]);

  // 构建子部门映射（判断是否有子级）
  const hasChildrenMap = React.useMemo(() => {
    const map = new Set<string>();
    departments.forEach((dept) => {
      if (dept.parentId) {
        map.add(dept.parentId);
      }
    });
    return map;
  }, [departments]);

  // 计算每个部门的层级深度（根节点为 0）
  const depthMap = React.useMemo(() => {
    const map = new Map<string, number>();

    const getDepth = (deptId: string, visited = new Set<string>()): number => {
      if (map.has(deptId)) return map.get(deptId)!;
      if (visited.has(deptId)) return 0;
      visited.add(deptId);

      const dept = departments.find((d) => d.id === deptId);
      if (!dept?.parentId) {
        map.set(deptId, 0);
        return 0;
      }

      const depth = getDepth(dept.parentId, visited) + 1;
      map.set(deptId, depth);
      return depth;
    };

    departments.forEach((dept) => getDepth(dept.id));
    return map;
  }, [departments]);

  // 按树形结构排序部门（子级紧跟父级）
  const sortedDepartments = React.useMemo(() => {
    const result: DepartmentForSelection[] = [];

    // 递归添加部门及其子级
    const addWithChildren = (parentId: string | null) => {
      const children = departments
        .filter((d) => d.parentId === parentId)
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

      for (const child of children) {
        result.push(child);
        addWithChildren(child.id);
      }
    };

    // 从根节点开始
    addWithChildren(null);

    return result;
  }, [departments]);

  // 获取部门的所有祖先 ID
  const getAncestorIds = React.useCallback(
    (deptId: string): string[] => {
      const ancestors: string[] = [];
      let current = departments.find((d) => d.id === deptId);
      while (current?.parentId) {
        ancestors.push(current.parentId);
        current = departments.find((d) => d.id === current?.parentId);
      }
      return ancestors;
    },
    [departments]
  );

  // 判断部门是否可见（所有祖先都已展开，或正在搜索时）
  const isVisible = React.useCallback(
    (dept: DepartmentForSelection): boolean => {
      // 搜索时显示所有匹配项
      if (keyword) return true;
      // 根节点始终可见
      if (!dept.parentId) return true;
      // 检查所有祖先是否都已展开
      const ancestors = getAncestorIds(dept.id);
      return ancestors.every((id) => expandedIds.has(id));
    },
    [keyword, expandedIds, getAncestorIds]
  );

  // 切换展开/折叠
  const toggleExpand = (deptId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(deptId)) {
        next.delete(deptId);
      } else {
        next.add(deptId);
      }
      return next;
    });
  };

  // 选中的部门列表
  const selectedDepartments = React.useMemo(() => {
    if (!value) return [];
    const ids = Array.isArray(value) ? value : [value];
    return ids
      .map((id) => departments.find((d) => d.id === id))
      .filter(Boolean) as DepartmentForSelection[];
  }, [value, departments]);

  // 根据关键字过滤部门（保持树形结构顺序）+ 展开/折叠过滤
  const filteredDepartments = React.useMemo(() => {
    let result = sortedDepartments;

    // 关键字过滤
    if (keyword) {
      const lowerKeyword = keyword.toLowerCase();
      result = result.filter((dept) => {
        const path = departmentPathMap.get(dept.id) || '';
        return (
          dept.name.toLowerCase().includes(lowerKeyword) ||
          path.toLowerCase().includes(lowerKeyword)
        );
      });
    } else {
      // 非搜索时，根据展开状态过滤
      result = result.filter(isVisible);
    }

    return result;
  }, [sortedDepartments, keyword, departmentPathMap, isVisible]);

  // 处理选择
  const handleSelect = (deptId: string) => {
    if (multiple) {
      const currentValue = Array.isArray(value) ? value : [];
      const newValue = currentValue.includes(deptId)
        ? currentValue.filter((id) => id !== deptId)
        : [...currentValue, deptId];
      onChange?.(newValue);
    } else {
      onChange?.(deptId);
      setOpen(false);
      setKeyword('');
    }
  };

  // 清除选择
  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange?.(multiple ? [] : '');
    setKeyword('');
  };

  // 移除单个选中项（多选模式）
  const handleRemove = (deptId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (multiple && Array.isArray(value)) {
      onChange?.(value.filter((id) => id !== deptId));
    }
  };

  // 显示文本
  const displayText = React.useMemo(() => {
    if (selectedDepartments.length === 0) return '';
    if (selectedDepartments.length === 1) {
      return selectedDepartments[0]?.name || '';
    }
    return `已选择 ${selectedDepartments.length} 个部门`;
  }, [selectedDepartments]);

  // 判断是否有选中值
  const hasValue = multiple ? Array.isArray(value) && value.length > 0 : Boolean(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || isLoading}
          className={cn('h-9 w-full justify-between px-3 py-2 text-left font-normal', className)}
        >
          {multiple && selectedDepartments.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {selectedDepartments.slice(0, 2).map((dept) => (
                <Badge key={dept.id} variant="secondary" className="h-5 px-1.5 text-xs">
                  {dept.name}
                  <span
                    role="button"
                    className="ml-1 rounded-sm hover:bg-accent"
                    onClick={(e) => handleRemove(dept.id, e)}
                  >
                    <X className="h-3 w-3" />
                  </span>
                </Badge>
              ))}
              {selectedDepartments.length > 2 && (
                <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                  +{selectedDepartments.length - 2}
                </Badge>
              )}
            </div>
          ) : (
            <span className={cn('truncate', !displayText && 'text-muted-foreground')}>
              {isLoading ? '加载中...' : displayText || placeholder}
            </span>
          )}
          <div className="ml-2 flex shrink-0 items-center gap-1">
            {clearable && hasValue ? (
              <span
                role="button"
                className="rounded-sm p-0.5 hover:bg-accent"
                onClick={handleClear}
              >
                <X className="h-3.5 w-3.5" />
              </span>
            ) : null}
            <ChevronDown className="h-4 w-4 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn('w-[--radix-popover-trigger-width] min-w-[300px] p-0', contentClassName)}
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput placeholder="搜索部门名称..." value={keyword} onValueChange={setKeyword} />
          <CommandList>
            {isLoading && <CommandEmpty>加载中...</CommandEmpty>}
            {!isLoading && filteredDepartments.length === 0 && (
              <CommandEmpty>未找到匹配部门</CommandEmpty>
            )}
            <CommandGroup>
              {filteredDepartments.map((dept) => {
                const isSelected = Array.isArray(value)
                  ? value.includes(dept.id)
                  : value === dept.id;
                const indent = (depthMap.get(dept.id) ?? 0) * 20;
                const hasChildren = hasChildrenMap.has(dept.id);
                const isExpanded = expandedIds.has(dept.id);

                return (
                  <CommandItem
                    key={dept.id}
                    value={dept.name}
                    onSelect={() => handleSelect(dept.id)}
                    className="flex items-center gap-1"
                    style={{ paddingLeft: `${8 + indent}px` }}
                  >
                    {/* 展开/折叠按钮 */}
                    {hasChildren && !keyword ? (
                      <span
                        role="button"
                        className="shrink-0 rounded p-0.5 hover:bg-accent"
                        onClick={(e) => toggleExpand(dept.id, e)}
                      >
                        <ChevronRight
                          className={cn('h-4 w-4 transition-transform', isExpanded && 'rotate-90')}
                        />
                      </span>
                    ) : (
                      <span className="w-5 shrink-0" />
                    )}
                    <Check
                      className={cn('h-4 w-4 shrink-0', isSelected ? 'opacity-100' : 'opacity-0')}
                    />
                    <span className="flex-1 truncate">{dept.name}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
