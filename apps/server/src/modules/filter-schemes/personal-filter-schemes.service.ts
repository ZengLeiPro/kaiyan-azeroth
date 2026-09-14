import type {
  CreatePersonalFilterPresetInput,
  FilterValues,
  PersonalFilterPreferenceResponse,
  PersonalFilterPreset,
  PersonalFilterPresetListResponse,
  UpdatePersonalFilterPreferenceInput,
  UpdatePersonalFilterPresetInput,
} from '@ky-azeroth/shared/schemas/personal-filter-scheme';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { FilterSchemeRegistry } from '../../common/filter-scheme';
import { PrismaService } from '../../common/prisma/prisma.service';
import { fromJsonValue, toJsonValue } from '../../common/utils/json-type-helpers';
import { FilterSchemesService } from './filter-schemes.service';

@Injectable()
export class PersonalFilterSchemesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registryStore: FilterSchemeRegistry,
    private readonly filterSchemesService: FilterSchemesService
  ) {}

  async getPreference(
    pageKey: string,
    employeeId: string
  ): Promise<PersonalFilterPreferenceResponse | null> {
    this.getRegistry(pageKey);
    const record = await this.prisma.personalFilterPreference.findUnique({
      where: { employeeId_pageKey: { employeeId, pageKey } },
    });
    if (!record) return null;
    return {
      pageKey,
      config: this.filterSchemesService.validateConfig(
        this.getRegistry(pageKey),
        fromJsonValue(record.configJson)
      ),
      version: record.version,
    };
  }

  async replacePreference(
    pageKey: string,
    input: UpdatePersonalFilterPreferenceInput,
    employeeId: string
  ): Promise<PersonalFilterPreferenceResponse> {
    const registry = this.getRegistry(pageKey);
    const { version, ...configInput } = input;
    const config = this.filterSchemesService.validateConfig(registry, configInput);
    const existing = await this.prisma.personalFilterPreference.findUnique({
      where: { employeeId_pageKey: { employeeId, pageKey } },
      select: { id: true, version: true },
    });

    try {
      if (existing) {
        const updated = await this.prisma.personalFilterPreference.update({
          where: {
            id: existing.id,
            ...(version === undefined ? {} : { version }),
          },
          data: {
            configJson: toJsonValue(config) ?? Prisma.JsonNull,
            version: { increment: 1 },
          },
        });
        return { pageKey, config, version: updated.version };
      }
      const created = await this.prisma.personalFilterPreference.create({
        data: {
          employeeId,
          pageKey,
          configJson: toJsonValue(config) ?? Prisma.JsonNull,
        },
      });
      return { pageKey, config, version: created.version };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException('筛选配置已被更新，请刷新后重试');
      }
      throw error;
    }
  }

  async resetPreference(pageKey: string, employeeId: string): Promise<void> {
    this.getRegistry(pageKey);
    await this.prisma.personalFilterPreference.deleteMany({ where: { employeeId, pageKey } });
  }

  async listPresets(
    pageKey: string,
    employeeId: string
  ): Promise<PersonalFilterPresetListResponse> {
    this.getRegistry(pageKey);
    const records = await this.prisma.personalFilterPreset.findMany({
      where: { employeeId, pageKey },
      orderBy: { updatedAt: 'desc' },
    });
    const items = records.map((record) => this.toPreset(record));
    return { items, total: items.length };
  }

  async createPreset(
    pageKey: string,
    input: CreatePersonalFilterPresetInput,
    employeeId: string
  ): Promise<PersonalFilterPreset> {
    this.getRegistry(pageKey);
    try {
      const record = await this.prisma.personalFilterPreset.create({
        data: {
          employeeId,
          pageKey,
          name: input.name,
          filtersJson: toJsonValue(input.filters) ?? Prisma.JsonNull,
        },
      });
      return this.toPreset(record);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('该页面已有同名筛选方案');
      }
      throw error;
    }
  }

  async updatePreset(
    id: string,
    input: UpdatePersonalFilterPresetInput,
    employeeId: string
  ): Promise<PersonalFilterPreset> {
    const existing = await this.prisma.personalFilterPreset.findFirst({
      where: { id, employeeId },
    });
    if (!existing) throw new NotFoundException('筛选方案不存在');

    const data: Prisma.PersonalFilterPresetUpdateInput = {
      version: { increment: 1 },
    };
    if (input.name !== undefined) data.name = input.name;
    if (input.filters !== undefined)
      data.filtersJson = toJsonValue(input.filters) ?? Prisma.JsonNull;

    try {
      const record = await this.prisma.personalFilterPreset.update({
        where: { id, version: input.version },
        data,
      });
      return this.toPreset(record);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException('筛选方案已被更新，请刷新后重试');
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('该页面已有同名筛选方案');
      }
      throw error;
    }
  }

  async deletePreset(id: string, version: number, employeeId: string): Promise<void> {
    const deleted = await this.prisma.personalFilterPreset.deleteMany({
      where: { id, employeeId, version },
    });
    if (deleted.count === 0) throw new NotFoundException('筛选方案不存在或已被更新');
  }

  private getRegistry(pageKey: string) {
    const registry = this.registryStore.get(pageKey);
    if (!registry) throw new NotFoundException(`筛选方案 pageKey=${pageKey} 未注册`);
    return registry;
  }

  private toPreset(record: {
    id: string;
    pageKey: string;
    name: string;
    filtersJson: Prisma.JsonValue;
    version: number;
    createdAt: Date;
    updatedAt: Date;
  }): PersonalFilterPreset {
    return {
      id: record.id,
      pageKey: record.pageKey,
      name: record.name,
      filters: (fromJsonValue<FilterValues>(record.filtersJson) ?? {}) as FilterValues,
      version: record.version,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}
