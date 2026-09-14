import type {
  FilterSchemeConfig,
  FilterSchemeDetailResponse,
  FilterSchemeListResponse,
  FilterSchemeVersionMapResponse,
  UpdateFilterSchemeInput,
} from '@ky-azeroth/shared/schemas/filter-scheme';
import { filterSchemeConfigSchema } from '@ky-azeroth/shared/schemas/filter-scheme';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { FilterRegistry } from '../../common/filter-scheme/define';
import { serializeFilterRegistry } from '../../common/filter-scheme/define';
import { FilterSchemeRegistry } from '../../common/filter-scheme/registry.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { auditUpdateOnly } from '../../common/utils/audit-helper';
import { fromJsonValue, toJsonValue } from '../../common/utils/json-type-helpers';

interface CacheEntry {
  config: FilterSchemeConfig;
  version: number;
  expiresAt: number;
}

interface SanitizeResult {
  config: FilterSchemeConfig;
  changed: boolean;
  prunedFieldCount: number;
  fallbackControlCount: number;
  keywordPrunedCount: number;
  keywordDisabled: boolean;
  usedDefaults: boolean;
}

@Injectable()
export class FilterSchemesService implements OnModuleInit {
  private readonly logger = new Logger(FilterSchemesService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs = 5 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registryStore: FilterSchemeRegistry
  ) {}

  async onModuleInit(): Promise<void> {
    this.registryStore.subscribe(async (registry) => {
      await this.reconcilePage(registry.pageKey);
    });
    await this.bootstrapRegisteredSchemes();
  }

  async list(): Promise<FilterSchemeListResponse> {
    const registries = this.registryStore.list();
    const pageKeys = registries.map((registry) => registry.pageKey);
    const records = pageKeys.length
      ? await this.prisma.filterScheme.findMany({
          where: { pageKey: { in: pageKeys } },
          select: {
            pageKey: true,
            version: true,
            updatedAt: true,
            configJson: true,
          },
        })
      : [];

    const recordMap = new Map(records.map((record) => [record.pageKey, record]));
    const items = registries.map((registry) => {
      const record = recordMap.get(registry.pageKey);
      const sanitized = record
        ? this.sanitizeConfig(registry, fromJsonValue<unknown>(record.configJson))
        : this.buildDefaultSanitizeResult(registry);

      return {
        pageKey: registry.pageKey,
        pageName: registry.pageName ?? null,
        fieldCount: Object.keys(registry.fields).length,
        activeFieldCount: sanitized.config.fields.length,
        version: record?.version ?? 1,
        updatedAt: record?.updatedAt?.toISOString() ?? null,
      };
    });

    return {
      items,
      total: items.length,
    };
  }

  async getDetail(pageKey: string): Promise<FilterSchemeDetailResponse> {
    const registry = this.getRegistryOrThrow(pageKey);
    const active = await this.getActive(pageKey);

    return {
      registry: serializeFilterRegistry(registry),
      config: active.config,
      version: active.version,
    };
  }

  async getActive(pageKey: string): Promise<{ config: FilterSchemeConfig; version: number }> {
    const cached = this.cache.get(pageKey);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        config: cloneConfig(cached.config),
        version: cached.version,
      };
    }

    const registry = this.getRegistryOrThrow(pageKey);
    const record = await this.prisma.filterScheme.findUnique({
      where: { pageKey },
      select: {
        configJson: true,
        version: true,
      },
    });

    const sanitized = record
      ? this.sanitizeConfig(registry, fromJsonValue<unknown>(record.configJson))
      : this.buildDefaultSanitizeResult(registry);
    const version = record?.version ?? 1;

    if (record && sanitized.changed) {
      void this.reconcilePage(pageKey);
    }

    this.cache.set(pageKey, {
      config: cloneConfig(sanitized.config),
      version,
      expiresAt: Date.now() + this.cacheTtlMs,
    });

    return {
      config: cloneConfig(sanitized.config),
      version,
    };
  }

  async replace(
    pageKey: string,
    input: UpdateFilterSchemeInput,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<FilterSchemeDetailResponse> {
    const registry = this.getRegistryOrThrow(pageKey);
    const { version: requestVersion, ...configInput } = input;
    const validatedConfig = this.validateConfig(registry, configInput);
    const existing = await this.prisma.filterScheme.findUnique({
      where: { pageKey },
      select: {
        id: true,
        version: true,
      },
    });

    try {
      if (existing) {
        await this.prisma.filterScheme.update({
          where: {
            id: existing.id,
            ...(requestVersion !== undefined ? { version: requestVersion } : {}),
          },
          data: {
            configJson: toJsonValue(validatedConfig) ?? Prisma.JsonNull,
            ...auditUpdateOnly(currentUser),
            version: { increment: 1 },
          },
        });
      } else {
        await this.prisma.filterScheme.create({
          data: {
            pageKey,
            configJson: toJsonValue(validatedConfig) ?? Prisma.JsonNull,
            ...auditUpdateOnly(currentUser),
            version: 1,
          },
        });
      }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        const currentVersion = existing?.version ?? 1;
        throw new ConflictException(
          `数据已被其他用户修改，当前版本 ${currentVersion}。请刷新后重试。`
        );
      }
      throw error;
    }

    this.invalidate(pageKey);
    return this.getDetail(pageKey);
  }

  async reset(
    pageKey: string,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<FilterSchemeDetailResponse> {
    const registry = this.getRegistryOrThrow(pageKey);

    return this.replace(
      pageKey,
      {
        ...cloneConfig(registry.defaults),
      },
      currentUser
    );
  }

  async getVersionMap(): Promise<FilterSchemeVersionMapResponse> {
    const registries = this.registryStore.list();
    const pageKeys = registries.map((registry) => registry.pageKey);
    const records = pageKeys.length
      ? await this.prisma.filterScheme.findMany({
          where: { pageKey: { in: pageKeys } },
          select: {
            pageKey: true,
            version: true,
          },
        })
      : [];

    const result: FilterSchemeVersionMapResponse = {};
    for (const registry of registries) {
      result[registry.pageKey] = 1;
    }
    for (const record of records) {
      result[record.pageKey] = record.version;
    }

    return result;
  }

  validateConfig(registry: FilterRegistry, config: unknown): FilterSchemeConfig {
    const parsed = filterSchemeConfigSchema.safeParse(config);
    if (!parsed.success) {
      throw new UnprocessableEntityException(parsed.error.flatten());
    }

    const fieldKeys = new Set<string>();
    for (const field of parsed.data.fields) {
      if (fieldKeys.has(field.fieldKey)) {
        throw new UnprocessableEntityException(`字段 ${field.fieldKey} 重复配置`);
      }
      fieldKeys.add(field.fieldKey);

      const registryField = registry.fields[field.fieldKey];
      if (!registryField) {
        throw new UnprocessableEntityException(`字段 ${field.fieldKey} 未在 registry 中声明`);
      }
      if (!registryField.allowedControls.includes(field.control)) {
        throw new UnprocessableEntityException(
          `字段 ${field.fieldKey} 不支持控件 ${field.control}`
        );
      }
    }

    const keywordFieldKeys = new Set<string>();
    for (const fieldKey of parsed.data.keyword.fieldKeys) {
      if (keywordFieldKeys.has(fieldKey)) {
        throw new UnprocessableEntityException(`关键词字段 ${fieldKey} 重复配置`);
      }
      keywordFieldKeys.add(fieldKey);

      const registryField = registry.fields[fieldKey];
      if (
        !registryField ||
        registryField.searchable !== true ||
        registryField.dataType !== 'string'
      ) {
        throw new UnprocessableEntityException(`关键词字段 ${fieldKey} 不是 searchable string`);
      }
    }

    if (parsed.data.keyword.enabled && parsed.data.keyword.fieldKeys.length === 0) {
      throw new UnprocessableEntityException('开启关键词搜索时，至少需要配置一个 searchable 字段');
    }

    return cloneConfig(parsed.data);
  }

  async reconcilePage(pageKey: string): Promise<void> {
    const registry = this.registryStore.get(pageKey);
    if (!registry) {
      return;
    }

    const record = await this.prisma.filterScheme.findUnique({
      where: { pageKey },
      select: {
        id: true,
        configJson: true,
      },
    });
    if (!record) {
      return;
    }

    const sanitized = this.sanitizeConfig(registry, fromJsonValue<unknown>(record.configJson));
    if (!sanitized.changed) {
      return;
    }

    await this.prisma.filterScheme.update({
      where: { id: record.id },
      data: {
        configJson: toJsonValue(sanitized.config) ?? Prisma.JsonNull,
        version: { increment: 1 },
      },
    });

    this.invalidate(pageKey);
    this.logger.warn(
      `[FilterScheme] pageKey=${pageKey} pruned ${sanitized.prunedFieldCount} stale fields, ` +
        `reset ${sanitized.fallbackControlCount} invalid controls, ` +
        `removed ${sanitized.keywordPrunedCount} keyword fields` +
        `${sanitized.keywordDisabled ? ', disabled keyword' : ''}` +
        `${sanitized.usedDefaults ? ', fallback to defaults' : ''}`
    );
  }

  private async bootstrapRegisteredSchemes(): Promise<void> {
    for (const registry of this.registryStore.list()) {
      this.validateConfig(registry, registry.defaults);
      await this.reconcilePage(registry.pageKey);
    }
  }

  private getRegistryOrThrow(pageKey: string): FilterRegistry {
    const registry = this.registryStore.get(pageKey);
    if (!registry) {
      throw new NotFoundException(`筛选方案 pageKey=${pageKey} 未注册`);
    }
    return registry;
  }

  private sanitizeConfig(registry: FilterRegistry, config: unknown): SanitizeResult {
    const parsed = filterSchemeConfigSchema.safeParse(config);
    if (!parsed.success) {
      return {
        ...this.buildDefaultSanitizeResult(registry),
        changed: true,
        usedDefaults: true,
      };
    }

    let changed = false;
    let prunedFieldCount = 0;
    let fallbackControlCount = 0;
    let keywordPrunedCount = 0;
    let keywordDisabled = false;
    const seenFieldKeys = new Set<string>();
    const sanitizedFields = parsed.data.fields.flatMap((field) => {
      const registryField = registry.fields[field.fieldKey];
      if (!registryField || seenFieldKeys.has(field.fieldKey)) {
        changed = true;
        prunedFieldCount += 1;
        return [];
      }

      seenFieldKeys.add(field.fieldKey);
      if (registryField.allowedControls.includes(field.control)) {
        return [field];
      }

      changed = true;
      fallbackControlCount += 1;
      const fallbackControl = registryField.allowedControls[0];
      if (!fallbackControl) {
        prunedFieldCount += 1;
        return [];
      }
      return [
        {
          ...field,
          control: fallbackControl,
        },
      ];
    });

    const seenKeywordFieldKeys = new Set<string>();
    const sanitizedKeywordFieldKeys = parsed.data.keyword.fieldKeys.filter((fieldKey) => {
      if (seenKeywordFieldKeys.has(fieldKey)) {
        changed = true;
        keywordPrunedCount += 1;
        return false;
      }

      seenKeywordFieldKeys.add(fieldKey);
      const registryField = registry.fields[fieldKey];
      const valid = registryField?.searchable === true && registryField.dataType === 'string';
      if (!valid) {
        changed = true;
        keywordPrunedCount += 1;
      }
      return valid;
    });

    let keywordEnabled = parsed.data.keyword.enabled;
    if (keywordEnabled && sanitizedKeywordFieldKeys.length === 0) {
      keywordEnabled = false;
      keywordDisabled = true;
      changed = true;
    }

    const sanitizedConfig: FilterSchemeConfig = {
      fields: sanitizedFields,
      keyword: {
        enabled: keywordEnabled,
        fieldKeys: sanitizedKeywordFieldKeys,
        placeholder: parsed.data.keyword.placeholder ?? null,
      },
    };

    try {
      this.validateConfig(registry, sanitizedConfig);
      return {
        config: cloneConfig(sanitizedConfig),
        changed,
        prunedFieldCount,
        fallbackControlCount,
        keywordPrunedCount,
        keywordDisabled,
        usedDefaults: false,
      };
    } catch {
      return {
        ...this.buildDefaultSanitizeResult(registry),
        changed: true,
        prunedFieldCount,
        fallbackControlCount,
        keywordPrunedCount,
        keywordDisabled,
        usedDefaults: true,
      };
    }
  }

  private buildDefaultSanitizeResult(registry: FilterRegistry): SanitizeResult {
    return {
      config: cloneConfig(this.validateConfig(registry, registry.defaults)),
      changed: false,
      prunedFieldCount: 0,
      fallbackControlCount: 0,
      keywordPrunedCount: 0,
      keywordDisabled: false,
      usedDefaults: false,
    };
  }

  private invalidate(pageKey: string): void {
    this.cache.delete(pageKey);
  }
}

function cloneConfig(config: FilterSchemeConfig): FilterSchemeConfig {
  return structuredClone(config);
}
