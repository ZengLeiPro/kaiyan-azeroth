/**
 * CrudFilterBar v1.2 — 列表页筛选栏的字段配置化渲染器
 *
 * 设计哲学:
 * - "shared query schema 驱动字段契约,页面 filterFields 驱动 UI 元数据,
 *   patterns 层统一渲染"
 * - 页面只声明 FilterFieldConfig<TState>[],不再手写 filters JSX
 * - useManualFilter 负责 tempFilters/activeFilters 状态,本组件只消费 values + onChange
 *
 * v1.2 已支持的 kind:
 *   - text              (含 inputType?: 'text' | 'month' | 'date')
 *   - select            (单选下拉,使用 select-legacy 的 Select,非原生)
 *   - multiSelect       (多选下拉)
 *   - entitySelect      (异步实体单选:customer | employee | department | project)
 *   - entityMultiSelect (异步实体多选:customer | employee | department | project)
 *   - date              (单日期,独立 kind,比 text+inputType:'date' 更清晰)
 *   - dateRange         (双日期 + 可选快捷选项,映射到两个 string key)
 *   - numberEqual       (单个数字输入,单 key)
 *   - numberRange       (两个数字输入,fromKey + toKey 双 key)
 *
 * v1.2 明确不支持,新增前必须先讨论:
 *   - 依赖行内其他字段值的联动(如切换 customerId 后刷新 contactId 选项)
 *   - 自定义 render 函数、custom kind
 *   - 非 string / string[] 的值类型(numberEqual/numberRange 仍用 string 承载)
 *
 * 扩展底线:
 *   新增 kind 必须由 ≥2 个真实页面驱动;不做"万能 DSL",不做插件系统,
 *   不做自定义 render 逃生口。
 *
 * 使用规范:
 *   - 标准列表页若字段能被 v1.2 覆盖,禁止再手写
 *     <div className="flex flex-wrap items-center gap-4"> + label + Input/MultiSelect 模式
 *   - 页面在文件顶部声明 initialFilters、xxxFilterFields、transformParams
 *     或使用 useFilterScheme 从服务端配置动态生成
 *   - 布尔/数值转换留在 transformParams 里,不在 CrudFilterBar 层做
 */

import type {
  FilterRegistryMeta,
  FilterSchemeConfig,
} from '@ky-azeroth/shared/schemas/filter-scheme';
import { ReactNode } from 'react';

import { CustomerMultiSelect } from '@/components/patterns/customer-multi-select';
import { CustomerSelect } from '@/components/patterns/customer-select';
import { DateRangeFilter } from '@/components/patterns/date-range-filter';
import { DepartmentMultiSelect } from '@/components/patterns/department-multi-select';
import { DepartmentSelect } from '@/components/patterns/department-select';
import { EmployeeMultiSelect } from '@/components/patterns/employee-multi-select';
import { EmployeeSelect } from '@/components/patterns/employee-select';
import { PersonalFilterControls } from '@/components/patterns/personal-filter-controls';
import { ProjectMultiSelect } from '@/components/patterns/project-multi-select';
import { ProjectSelect } from '@/components/patterns/project-select';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { MultiSelect, Select } from '@/components/ui/select';
import type { FilterValue } from '@/hooks/use-manual-filter';
import { formatDateToLocalDateString, parseLocalDateString } from '@/lib/date-utils';
import { cn } from '@/lib/utils';

// tuple 包装避免条件类型分配:
// [string | string[]] extends [string] → false(不会错挂到 string 组)
type StringKeys<T> = {
  [K in keyof T]: [T[K]] extends [string] ? K : never;
}[keyof T];

type StringArrayKeys<T> = {
  [K in keyof T]: [T[K]] extends [string[]] ? K : never;
}[keyof T];

export interface FilterOption {
  value: string;
  label: string;
}

export type FilterEntity = 'customer' | 'employee' | 'department' | 'project';

interface FilterFieldBase {
  label: string;
  width?: string;
}

export type FilterFieldConfig<TState> =
  | (FilterFieldBase & {
      kind: 'text';
      key: StringKeys<TState>;
      placeholder?: string;
      inputType?: 'text' | 'month' | 'date';
    })
  | (FilterFieldBase & {
      kind: 'select';
      key: StringKeys<TState>;
      options: FilterOption[];
      placeholder?: string;
      searchable?: boolean;
    })
  | (FilterFieldBase & {
      kind: 'multiSelect';
      key: StringArrayKeys<TState>;
      options: FilterOption[];
      placeholder?: string;
      searchable?: boolean;
    })
  | (FilterFieldBase & {
      kind: 'entitySelect';
      key: StringKeys<TState>;
      entity: FilterEntity;
      placeholder?: string;
      /**
       * 仅在 entity='employee' 时生效:按角色 code 过滤候选员工(如 ['PM', 'DEVELOPER'])。
       * 由调用页面注入（不走 filter-scheme registry），用于工时统计「记录人」等
       * 角色定向场景。其他 entity 类型当前忽略此字段。
       */
      roleCodes?: string[];
    })
  | (FilterFieldBase & {
      kind: 'entityMultiSelect';
      key: StringArrayKeys<TState>;
      entity: FilterEntity;
      placeholder?: string;
      /** 同 entitySelect.roleCodes;仅 entity='employee' 时生效。 */
      roleCodes?: string[];
    })
  | (FilterFieldBase & {
      kind: 'date';
      key: StringKeys<TState>;
      placeholder?: string;
    })
  | (FilterFieldBase & {
      kind: 'dateRange';
      fromKey: StringKeys<TState>;
      toKey: StringKeys<TState>;
      showQuickOptions?: boolean;
    })
  | (FilterFieldBase & {
      kind: 'numberEqual';
      key: StringKeys<TState>;
      placeholder?: string;
    })
  | (FilterFieldBase & {
      kind: 'numberRange';
      fromKey: StringKeys<TState>;
      toKey: StringKeys<TState>;
      fromPlaceholder?: string;
      toPlaceholder?: string;
    });

export interface CrudFilterBarProps<TState extends Record<string, FilterValue>> {
  fields: FilterFieldConfig<TState>[];
  values: TState;
  onChange: <K extends keyof TState>(key: K, value: TState[K]) => void;
  personalFilter?: {
    pageKey: string;
    registry: FilterRegistryMeta;
    config: FilterSchemeConfig;
    defaultConfig: FilterSchemeConfig;
    onApply: (filters: Record<string, FilterValue>) => void;
  };
}

const FILTER_SELECT_CONTENT_CLASS = 'min-w-[240px] max-w-[calc(100vw-2rem)]';
const FILTER_ENTITY_CONTENT_CLASS = 'min-w-[300px] max-w-[calc(100vw-2rem)]';

export function CrudFilterBar<TState extends Record<string, FilterValue>>({
  fields,
  values,
  onChange,
  personalFilter,
}: CrudFilterBarProps<TState>) {
  // FilterFieldConfig 的 kind 判别已保证 key 指向正确类型,这里统一收窄调用端
  const setString = (key: keyof TState, value: string) => {
    onChange(key, value as TState[typeof key]);
  };
  const setArray = (key: keyof TState, value: string[]) => {
    onChange(key, value as TState[typeof key]);
  };

  return (
    <div className="flex flex-wrap items-center gap-4">
      {personalFilter ? (
        <PersonalFilterControls
          pageKey={personalFilter.pageKey}
          registry={personalFilter.registry}
          config={personalFilter.config}
          defaultConfig={personalFilter.defaultConfig}
          values={values}
          onApply={personalFilter.onApply}
        />
      ) : null}
      {fields.map((field, idx) => {
        const reactKey =
          field.kind === 'dateRange' || field.kind === 'numberRange'
            ? `${field.kind}-${String(field.fromKey)}-${idx}`
            : `${field.kind}-${String(field.key)}-${idx}`;
        return (
          <div key={reactKey} className="flex items-center gap-2">
            <label className="whitespace-nowrap text-sm text-muted-foreground">{field.label}</label>
            {renderControl<TState>(field, values, setString, setArray)}
          </div>
        );
      })}
    </div>
  );
}

function renderControl<TState extends Record<string, FilterValue>>(
  field: FilterFieldConfig<TState>,
  values: TState,
  setString: (key: keyof TState, value: string) => void,
  setArray: (key: keyof TState, value: string[]) => void
): ReactNode {
  const width = resolveControlWidth(field);
  const className = cn('h-9', width);

  switch (field.kind) {
    case 'text': {
      const key = field.key as keyof TState;
      return (
        <Input
          type={field.inputType ?? 'text'}
          value={values[key] as string}
          onChange={(e) => setString(key, e.target.value)}
          placeholder={field.placeholder}
          className={className}
        />
      );
    }
    case 'select': {
      const key = field.key as keyof TState;
      return (
        <Select<string>
          value={values[key] as string}
          onChange={(v) => setString(key, v ?? '')}
          options={field.options}
          placeholder={field.placeholder ?? '全部'}
          searchable={field.searchable}
          className={className}
          contentClassName={FILTER_SELECT_CONTENT_CLASS}
        />
      );
    }
    case 'multiSelect': {
      const key = field.key as keyof TState;
      return (
        <MultiSelect
          value={values[key] as string[]}
          onChange={(vs) => setArray(key, vs)}
          options={field.options}
          placeholder={field.placeholder ?? '全部'}
          searchable={field.searchable}
          className={className}
          contentClassName={FILTER_SELECT_CONTENT_CLASS}
        />
      );
    }
    case 'entitySelect': {
      const key = field.key as keyof TState;
      const value = values[key] as string;
      const handleChange = (v: string) => setString(key, v);
      if (field.entity === 'customer') {
        return (
          <CustomerSelect
            value={value}
            onChange={handleChange}
            placeholder={field.placeholder}
            className={className}
            contentClassName={FILTER_ENTITY_CONTENT_CLASS}
            clearable
          />
        );
      }
      if (field.entity === 'employee') {
        return (
          <EmployeeSelect
            value={value}
            onChange={handleChange}
            placeholder={field.placeholder}
            className={className}
            contentClassName={FILTER_ENTITY_CONTENT_CLASS}
            clearable
            roleCodes={field.roleCodes}
          />
        );
      }
      if (field.entity === 'project') {
        return (
          <ProjectSelect
            value={value}
            onChange={handleChange}
            placeholder={field.placeholder}
            className={className}
            contentClassName={FILTER_ENTITY_CONTENT_CLASS}
            clearable
          />
        );
      }
      return (
        <DepartmentSelect
          value={value}
          onChange={(v) => setString(key, typeof v === 'string' ? v : '')}
          placeholder={field.placeholder}
          className={className}
          contentClassName={FILTER_ENTITY_CONTENT_CLASS}
          clearable
        />
      );
    }
    case 'entityMultiSelect': {
      const key = field.key as keyof TState;
      const value = (values[key] as string[]) ?? [];
      const handleChange = (vs: string[]) => setArray(key, vs);
      if (field.entity === 'customer') {
        return (
          <CustomerMultiSelect
            value={value}
            onChange={handleChange}
            placeholder={field.placeholder}
            className={className}
            contentClassName={FILTER_ENTITY_CONTENT_CLASS}
          />
        );
      }
      if (field.entity === 'employee') {
        return (
          <EmployeeMultiSelect
            value={value}
            onChange={handleChange}
            placeholder={field.placeholder}
            className={className}
            contentClassName={FILTER_ENTITY_CONTENT_CLASS}
            roleCodes={field.roleCodes}
          />
        );
      }
      if (field.entity === 'project') {
        return (
          <ProjectMultiSelect
            value={value}
            onChange={handleChange}
            placeholder={field.placeholder}
            className={className}
            contentClassName={FILTER_ENTITY_CONTENT_CLASS}
          />
        );
      }
      return (
        <DepartmentMultiSelect
          value={value}
          onChange={handleChange}
          placeholder={field.placeholder}
          className={className}
          contentClassName={FILTER_ENTITY_CONTENT_CLASS}
        />
      );
    }
    case 'date': {
      const key = field.key as keyof TState;
      const dateStr = values[key] as string;
      return (
        <DatePicker
          date={parseLocalDateString(dateStr)}
          onDateChange={(d) => setString(key, d ? formatDateToLocalDateString(d) : '')}
          placeholder={field.placeholder}
          dateFormat="yyyy-MM-dd"
          className={cn('h-9 w-[140px]', className)}
        />
      );
    }
    case 'dateRange': {
      const fromKey = field.fromKey as keyof TState;
      const toKey = field.toKey as keyof TState;
      return (
        <DateRangeFilter
          startDate={values[fromKey] as string}
          endDate={values[toKey] as string}
          onStartDateChange={(v) => setString(fromKey, v)}
          onEndDateChange={(v) => setString(toKey, v)}
          onClear={() => {
            setString(fromKey, '');
            setString(toKey, '');
          }}
          showQuickOptions={field.showQuickOptions}
        />
      );
    }
    case 'numberEqual': {
      const key = field.key as keyof TState;
      return (
        <Input
          type="number"
          value={values[key] as string}
          onChange={(e) => setString(key, e.target.value)}
          placeholder={field.placeholder}
          className={className}
        />
      );
    }
    case 'numberRange': {
      const fromKey = field.fromKey as keyof TState;
      const toKey = field.toKey as keyof TState;
      return (
        <div className="flex items-center gap-1">
          <Input
            type="number"
            value={values[fromKey] as string}
            onChange={(e) => setString(fromKey, e.target.value)}
            placeholder={field.fromPlaceholder ?? '最小值'}
            className={cn('h-9', 'w-24')}
          />
          <span className="text-xs text-muted-foreground">~</span>
          <Input
            type="number"
            value={values[toKey] as string}
            onChange={(e) => setString(toKey, e.target.value)}
            placeholder={field.toPlaceholder ?? '最大值'}
            className={cn('h-9', 'w-24')}
          />
        </div>
      );
    }
  }
}

function resolveControlWidth<TState>(field: FilterFieldConfig<TState>): string {
  if (field.width) return field.width;

  switch (field.kind) {
    case 'select':
    case 'multiSelect':
      return 'w-28';
    case 'entitySelect':
    case 'entityMultiSelect':
      return 'w-36';
    case 'numberEqual':
      return 'w-24';
    case 'text':
    case 'date':
    case 'dateRange':
    case 'numberRange':
      return 'w-32';
  }
}
