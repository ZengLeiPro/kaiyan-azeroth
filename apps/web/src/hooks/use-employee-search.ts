import { useQuery } from '@tanstack/react-query';
import * as React from 'react';

import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { api } from '@/lib/api';

const DEFAULT_PAGE_SIZE = 50;

export interface EmployeeOption {
  id: string;
  serialNumber: string;
  name: string;
  department: string | null;
  position: string | null;
  status: string | null;
}

const normalizeEmployees = (data: unknown): EmployeeOption[] => {
  if (Array.isArray(data)) {
    return data as EmployeeOption[];
  }
  if (data && typeof data === 'object') {
    const maybeItems = (data as { items?: unknown }).items;
    if (Array.isArray(maybeItems)) {
      return maybeItems as EmployeeOption[];
    }
  }
  return [];
};

interface UseEmployeeSearchOptions {
  value?: string;
  /**
   * 登录状态过滤，默认仅返回 active（登录启用）的员工。
   * 可选值：'active' | 'disabled' | 'locked'。
   */
  loginStatus?: string;
  department?: string;
  excludeIds?: string[];
  /**
   * 按角色 code 过滤（如 ['PM', 'DEVELOPER']），仅返回拥有指定角色之一的员工。
   * 用于工时统计「记录人」等场景下的角色定向筛选；不传或空数组则不过滤。
   */
  roleCodes?: string[];
}

export function useEmployeeSearch({
  value,
  loginStatus,
  department,
  excludeIds,
  roleCodes,
}: UseEmployeeSearchOptions = {}) {
  const [keyword, setKeyword] = React.useState('');
  const debouncedKeyword = useDebouncedValue(keyword.trim(), 300);

  // queryKey 需稳定的 roleCodes 字符串形态，避免数组引用变化引起多余请求
  const roleCodesKey = React.useMemo(
    () => (roleCodes && roleCodes.length > 0 ? [...roleCodes].sort().join(',') : ''),
    [roleCodes]
  );

  const { data: employees = [], isLoading } = useQuery({
    queryKey: ['employee-select', debouncedKeyword, loginStatus, department, roleCodesKey],
    queryFn: async () => {
      const response = await api.get('/employees/all', {
        params: {
          pageSize: DEFAULT_PAGE_SIZE,
          ...(debouncedKeyword ? { keyword: debouncedKeyword } : {}),
          ...(loginStatus ? { loginStatus } : {}),
          ...(department ? { departmentId: department } : {}),
          ...(roleCodes && roleCodes.length > 0 ? { roleCodes } : {}),
        },
        // 与 use-effort-stats 同理：axios 默认 `roleCodes[]=PM&roleCodes[]=DEVELOPER`
        // 在 FC 网关 + NestJS zod 链路上不稳定，改用 `indexes: null` 序列化为
        // `roleCodes=PM&roleCodes=DEVELOPER`，后端 stringOrStringArray 可正确解析。
        // 单值参数（如 loginStatus）不受影响。
        paramsSerializer: { indexes: null },
      });
      return normalizeEmployees(response.data);
    },
    staleTime: 60 * 1000,
  });

  // 详情接口 /employees/:id 受 organization:employees:view 权限限制，
  // 销售等业务角色没该权限会 403，所以失败不应阻断 UI；
  // 后续从 list 中兜底查找选中员工，确保 Trigger 能正确显示姓名。
  const { data: selectedEmployee } = useQuery({
    queryKey: ['employee-select', 'selected', value],
    enabled: Boolean(value),
    queryFn: async () => {
      if (!value) return null;
      const response = await api.get(`/employees/${value}`);
      return response.data as EmployeeOption;
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // 当 detail 接口未返回（无权限/异常/未触发），从已加载的列表中按 id 兜底查找。
  const effectiveSelectedEmployee = React.useMemo<EmployeeOption | null>(() => {
    if (!value) return null;
    if (selectedEmployee) return selectedEmployee;
    return employees.find((employee) => employee.id === value) ?? null;
  }, [value, selectedEmployee, employees]);

  const mergedEmployees = React.useMemo(() => {
    const map = new Map<string, EmployeeOption>();
    employees.forEach((employee) => map.set(employee.id, employee));
    if (effectiveSelectedEmployee) {
      map.set(effectiveSelectedEmployee.id, effectiveSelectedEmployee);
    }
    return Array.from(map.values());
  }, [employees, effectiveSelectedEmployee]);

  const filteredEmployees = React.useMemo(() => {
    const excludeSet = new Set(excludeIds ?? []);
    return mergedEmployees.filter((employee) => {
      if (excludeSet.has(employee.id) && employee.id !== value) {
        return false;
      }
      return true;
    });
  }, [mergedEmployees, excludeIds, value]);

  return {
    keyword,
    setKeyword,
    isLoading,
    filteredEmployees,
    selectedEmployee: effectiveSelectedEmployee,
  };
}
