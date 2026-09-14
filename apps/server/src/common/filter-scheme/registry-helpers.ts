/**
 * 通用 registry build helpers
 *
 * 阶段 3 把 customers 样板里的辅助函数抽到公共位置，供 18 个业务 registry 复用。
 * 约定：
 * - `build*` 返回 `{ [fieldKey]: PrismaFilterOp }` 或 `null`（无效值）
 * - 日期统一 `[gte beijingMidnight, lt nextDay)`，避免 23:59:59 精度漂移
 * - `toStringArray` 同时接受单值字符串与数组，过滤非字符串元素
 */
import type {
  FilterDateValue,
  FilterFieldBuildValue,
  FilterOption,
  FilterRangeValue,
} from './define';
import { escapeLikeChars } from './escape-like';

export function toOptions(labels: Record<string, string>): FilterOption[] {
  return Object.entries(labels).map(([value, label]) => ({
    value,
    label,
  }));
}

export function toStringArray(value: FilterFieldBuildValue): string[] | undefined {
  if (typeof value === 'string') {
    return [value];
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === 'string');
}

export function buildEnumFilter(
  fieldKey: string,
  allowedValues: Set<string>,
  value: FilterFieldBuildValue
): Record<string, unknown> | null {
  const selected = toStringArray(value)?.filter((item) => allowedValues.has(item));
  if (!selected || selected.length === 0) {
    return null;
  }
  return {
    [fieldKey]: {
      in: selected,
    },
  };
}

/**
 * 不限制枚举白名单的 `in` 过滤器（适用于自由字符串枚举，如 workType）
 */
export function buildStringListFilter(
  fieldKey: string,
  value: FilterFieldBuildValue
): Record<string, unknown> | null {
  const selected = toStringArray(value);
  if (!selected || selected.length === 0) {
    return null;
  }
  return {
    [fieldKey]: {
      in: selected,
    },
  };
}

export function buildForeignKeyFilter(
  fieldKey: string,
  value: FilterFieldBuildValue
): Record<string, unknown> | null {
  const selected = toStringArray(value);
  if (!selected || selected.length === 0) {
    return null;
  }
  return {
    [fieldKey]: {
      in: selected,
    },
  };
}

export function buildStringFilter(
  fieldKey: string,
  value: FilterFieldBuildValue
): Record<string, unknown> | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  return {
    [fieldKey]: {
      contains: escapeLikeChars(value),
      mode: 'insensitive',
    },
  };
}

export function buildStringFilterWithRelationFallback(
  fieldKey: string,
  relationKey: string,
  relationFieldKey: string,
  value: FilterFieldBuildValue
): Record<string, unknown> | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }

  const contains = {
    contains: escapeLikeChars(value),
    mode: 'insensitive',
  };

  return {
    OR: [
      {
        [fieldKey]: contains,
      },
      {
        [relationKey]: {
          [relationFieldKey]: contains,
        },
      },
    ],
  };
}

export interface BuildDateFilterOptions {
  /**
   * 主字段为 NULL 时回退到的字段名。
   * 用于历史数据中主字段（如 workDate）大量为 NULL、需要按另一个时间字段（如 startDate）兜底筛选的场景。
   * 启用后生成 `OR [{ field IS NOT NULL AND in range }, { field IS NULL AND fallback in range }]`。
   */
  nullFallbackField?: string;
}

export function buildDateFilter(
  fieldKey: string,
  value: FilterFieldBuildValue,
  options?: BuildDateFilterOptions
): Record<string, unknown> | null {
  if (!isDateValue(value)) {
    return null;
  }

  const condition: Record<string, Date> = {};
  if (value.from) {
    const fromDate = parseDateInput(value.from);
    if (fromDate) {
      condition.gte = fromDate;
    }
  }
  if (value.to) {
    const toDate = parseDateInput(value.to);
    if (toDate) {
      condition.lt = addDays(toDate, 1);
    }
  }

  if (Object.keys(condition).length === 0) {
    return null;
  }

  if (options?.nullFallbackField) {
    return {
      OR: [
        { [fieldKey]: { not: null, ...condition } },
        { [fieldKey]: null, [options.nullFallbackField]: condition },
      ],
    };
  }

  return {
    [fieldKey]: condition,
  };
}

export function buildNumberFilter(
  fieldKey: string,
  value: FilterFieldBuildValue
): Record<string, unknown> | null {
  if (typeof value === 'number') {
    return {
      [fieldKey]: value,
    };
  }

  if (!isRangeValue(value)) {
    return null;
  }

  const condition: Record<string, number> = {};
  if (value.min !== undefined) {
    condition.gte = value.min;
  }
  if (value.max !== undefined) {
    condition.lte = value.max;
  }

  return Object.keys(condition).length > 0
    ? {
        [fieldKey]: condition,
      }
    : null;
}

export function buildBooleanFilter(
  fieldKey: string,
  value: FilterFieldBuildValue
): Record<string, unknown> | null {
  if (typeof value !== 'boolean') {
    return null;
  }
  return {
    [fieldKey]: value,
  };
}

function isDateValue(value: FilterFieldBuildValue): value is FilterDateValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRangeValue(value: FilterFieldBuildValue): value is FilterRangeValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseDateInput(value: string): Date | undefined {
  // Date-only strings (YYYY-MM-DD) are interpreted as Beijing time (UTC+8) midnight.
  // ECMAScript spec parses date-only strings as UTC midnight; on a UTC server this
  // means Beijing 08:00, excluding records created 00:00–08:00 on the start day.
  // Frontend always sends YYYY-MM-DD (see formatDateToLocalDateString in date-utils.ts).
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    return new Date(Date.UTC(+dateOnly[1]!, +dateOnly[2]! - 1, +dateOnly[3]!) - 8 * 60 * 60 * 1000);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function addDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setDate(result.getDate() + days);
  return result;
}
