import * as React from 'react';

import { DepartmentSelect } from '@/components/patterns/department-select';

export interface DepartmentMultiSelectProps {
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
}

/**
 * 部门多选组件
 *
 * 薄封装：底层复用 `DepartmentSelect` 的 `multiple` 模式，保证与单选的
 * 树形展开/搜索/样式一致；对外暴露严格的 `string[]` 类型签名，与
 * CustomerMultiSelect / EmployeeMultiSelect / ProjectMultiSelect 对齐。
 */
export function DepartmentMultiSelect({
  value,
  onChange,
  placeholder = '搜索并选择部门',
  disabled = false,
  className,
  contentClassName,
}: DepartmentMultiSelectProps) {
  const handleChange = React.useCallback(
    (next: string | string[]) => {
      onChange(Array.isArray(next) ? next : next ? [next] : []);
    },
    [onChange]
  );

  return (
    <DepartmentSelect
      multiple
      value={value}
      onChange={handleChange}
      placeholder={placeholder}
      disabled={disabled}
      className={className}
      contentClassName={contentClassName}
      clearable
    />
  );
}
