import { Injectable } from '@nestjs/common';

import { FilterSchemesService } from '../../modules/filter-schemes/filter-schemes.service';
import type {
  FilterDateValue,
  FilterFieldBuildValue,
  FilterFieldDef,
  FilterRangeValue,
  FilterRegistry,
  FilterWhereFragment,
} from './define';

interface BuildWhereParams {
  registry: FilterRegistry;
  rawQuery: unknown;
  chargerScope: string[] | null;
  baseWhere: Record<string, unknown>;
  legacyFilters?: Record<string, unknown>;
  legacyKeyword?: string;
}

interface NormalizedRawQuery {
  keyword?: string;
  filters: Record<string, unknown>;
}

@Injectable()
export class FilterApplierService {
  constructor(private readonly schemesService: FilterSchemesService) {}

  async buildWhere<TWhere extends Record<string, unknown>>(
    params: BuildWhereParams & { baseWhere: TWhere }
  ): Promise<TWhere> {
    const active = await this.schemesService.getActive(params.registry.pageKey);
    const normalizedRawQuery = normalizeRawQuery(params.rawQuery);
    const rawFilters = normalizedRawQuery.filters;
    const legacyFilters = params.legacyFilters ?? {};

    const andClauses: FilterWhereFragment[] = [];
    const scopeFieldKey = findScopeFieldKey(params.registry);
    const scopeFieldDef = params.registry.fields[scopeFieldKey];
    let scopeSelection: string[] | undefined;

    const keyword = normalizedRawQuery.keyword ?? normalizeSingleString(params.legacyKeyword);
    if (keyword && active.config.keyword.enabled) {
      const orClauses = active.config.keyword.fieldKeys
        .filter((fieldKey) => {
          const field = params.registry.fields[fieldKey];
          return field?.searchable === true && field.dataType === 'string';
        })
        .map((fieldKey) => {
          const field = params.registry.fields[fieldKey];
          return field?.build(keyword);
        })
        .filter((fragment): fragment is FilterWhereFragment => fragment != null);

      if (orClauses.length > 0) {
        andClauses.push({ OR: orClauses });
      }
    }

    // rawQuery 优先（与既有 spread 行为一致：raw 覆盖 legacy 的同名字段）。
    // registry 是可执行筛选字段的安全白名单；全员/个人方案只决定界面展示，不能决定
    // 后端是否执行字段，否则个人新增的筛选项会在请求到达后被静默丢弃。
    // legacyFilters 是 service 内部从 DTO 显式映射而来的硬过滤条件，同样受 registry 约束。
    const filterEntries: Array<[string, unknown]> = [];
    const consumedKeys = new Set<string>();
    for (const [fieldKey, rawValue] of Object.entries(rawFilters)) {
      filterEntries.push([fieldKey, rawValue]);
      consumedKeys.add(fieldKey);
    }
    for (const [fieldKey, rawValue] of Object.entries(legacyFilters)) {
      if (consumedKeys.has(fieldKey)) continue;
      filterEntries.push([fieldKey, rawValue]);
    }

    for (const [fieldKey, rawValue] of filterEntries) {
      const fieldDef = params.registry.fields[fieldKey];
      if (!fieldDef) continue;

      const normalizedValue = normalizeFieldValue(fieldDef, rawValue);
      if (normalizedValue === undefined) continue;

      if (params.chargerScope !== null && fieldKey === scopeFieldKey) {
        scopeSelection = toStringList(normalizedValue);
        continue;
      }

      const fragment = fieldDef.build(normalizedValue);
      if (fragment) {
        andClauses.push(fragment);
      }
    }

    if (params.chargerScope !== null) {
      const allowedScope = scopeSelection
        ? params.chargerScope.filter((scopeId) => scopeSelection?.includes(scopeId))
        : params.chargerScope;
      andClauses.push({
        [scopeFieldKey]: {
          in: allowedScope,
        },
      });
    } else if (scopeSelection && scopeFieldDef) {
      const fragment = scopeFieldDef.build(scopeSelection);
      if (fragment) {
        andClauses.push(fragment);
      }
    }

    const where: Record<string, unknown> = { ...params.baseWhere };
    const existingAnd = normalizeAndClause(where.AND);
    if (andClauses.length > 0) {
      where.AND = [...existingAnd, ...andClauses];
    }
    return where as TWhere;
  }
}

function normalizeRawQuery(rawQuery: unknown): NormalizedRawQuery {
  if (!isRecord(rawQuery)) {
    return { filters: {} };
  }

  const filters: Record<string, unknown> = {};
  const nestedFilters = rawQuery.filters;
  if (isRecord(nestedFilters)) {
    mergeFilterRecord(filters, nestedFilters);
  }

  for (const [rawKey, rawValue] of Object.entries(rawQuery)) {
    if (rawKey === 'filters') {
      continue;
    }

    const nestedBracketKey = rawKey.match(/^filters\[([^\]]+)\]\[([^\]]+)\]$/);
    if (nestedBracketKey) {
      const fieldKey = nestedBracketKey[1];
      const nestedKey = nestedBracketKey[2];
      if (fieldKey && nestedKey) {
        assignNestedFilter(filters, fieldKey, nestedKey, rawValue);
      }
      continue;
    }

    const arrayBracketKey = rawKey.match(/^filters\[([^\]]+)\]\[\]$/);
    if (arrayBracketKey) {
      const fieldKey = arrayBracketKey[1];
      if (fieldKey) {
        filters[fieldKey] = rawValue;
      }
      continue;
    }

    const simpleBracketKey = rawKey.match(/^filters\[([^\]]+)\]$/);
    if (simpleBracketKey) {
      const fieldKey = simpleBracketKey[1];
      if (fieldKey) {
        filters[fieldKey] = rawValue;
      }
      continue;
    }

    const nestedDotKey = rawKey.match(/^filters\.([^.]+)\.([^.]+)$/);
    if (nestedDotKey) {
      const fieldKey = nestedDotKey[1];
      const nestedKey = nestedDotKey[2];
      if (fieldKey && nestedKey) {
        assignNestedFilter(filters, fieldKey, nestedKey, rawValue);
      }
      continue;
    }

    const simpleDotKey = rawKey.match(/^filters\.([^.]+)$/);
    if (simpleDotKey) {
      const fieldKey = simpleDotKey[1];
      if (fieldKey) {
        filters[fieldKey] = rawValue;
      }
    }
  }

  return {
    keyword: normalizeSingleString(rawQuery.keyword),
    filters,
  };
}

function mergeFilterRecord(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [fieldKey, value] of Object.entries(source)) {
    if (isRecord(value) && isRecord(target[fieldKey])) {
      target[fieldKey] = {
        ...target[fieldKey],
        ...value,
      };
      continue;
    }
    target[fieldKey] = value;
  }
}

function assignNestedFilter(
  target: Record<string, unknown>,
  fieldKey: string,
  nestedKey: string,
  value: unknown
): void {
  const existing = isRecord(target[fieldKey]) ? target[fieldKey] : {};
  target[fieldKey] = {
    ...existing,
    [nestedKey]: value,
  };
}

function normalizeFieldValue(
  fieldDef: FilterFieldDef,
  rawValue: unknown
): FilterFieldBuildValue | undefined {
  switch (fieldDef.dataType) {
    case 'enum':
    case 'foreignKey':
      return normalizeStringArray(rawValue);
    case 'string':
      return normalizeSingleString(rawValue);
    case 'date':
      return normalizeDateValue(rawValue);
    case 'decimal':
      return normalizeNumericValue(rawValue, false);
    case 'int':
      return normalizeNumericValue(rawValue, true);
    case 'boolean':
      return normalizeBooleanValue(rawValue);
  }
}

function normalizeSingleString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') {
        const trimmed = item.trim();
        if (trimmed.length > 0) {
          return trimmed;
        }
      }
    }
  }

  return undefined;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? [trimmed] : undefined;
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeDateValue(value: unknown): FilterDateValue | undefined {
  if (typeof value === 'string') {
    const dateValue = value.trim();
    if (!dateValue) return undefined;
    return { from: dateValue, to: dateValue };
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const from =
    normalizeSingleString(value.from) ??
    normalizeSingleString(value.start) ??
    normalizeSingleString(value.startDate);
  const to =
    normalizeSingleString(value.to) ??
    normalizeSingleString(value.end) ??
    normalizeSingleString(value.endDate);

  if (!from && !to) {
    return undefined;
  }

  return { from, to };
}

function normalizeNumericValue(
  value: unknown,
  integerOnly: boolean
): number | FilterRangeValue | undefined {
  const exact = parseNumber(value, integerOnly);
  if (exact !== undefined) {
    return exact;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const scalarValue =
    parseNumber(value.value, integerOnly) ??
    parseNumber(value.equal, integerOnly) ??
    parseNumber(value.exact, integerOnly);
  if (scalarValue !== undefined) {
    return scalarValue;
  }

  const min =
    parseNumber(value.min, integerOnly) ??
    parseNumber(value.from, integerOnly) ??
    parseNumber(value.gte, integerOnly);
  const max =
    parseNumber(value.max, integerOnly) ??
    parseNumber(value.to, integerOnly) ??
    parseNumber(value.lte, integerOnly);

  if (min === undefined && max === undefined) {
    return undefined;
  }

  return {
    min,
    max,
  };
}

function parseNumber(value: unknown, integerOnly: boolean): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (integerOnly && !Number.isInteger(value)) {
      return undefined;
    }
    return value;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  if (integerOnly && !Number.isInteger(parsed)) {
    return undefined;
  }
  return parsed;
}

function normalizeBooleanValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === '0') {
    return false;
  }
  return undefined;
}

function toStringList(value: FilterFieldBuildValue): string[] | undefined {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  return undefined;
}

function findScopeFieldKey(registry: FilterRegistry): string {
  const scopeFieldEntry = Object.entries(registry.fields).find(([, field]) => field.isScopeField);
  return scopeFieldEntry?.[0] ?? 'chargerId';
}

function normalizeAndClause(value: unknown): FilterWhereFragment[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  if (isRecord(value)) {
    return [value];
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
