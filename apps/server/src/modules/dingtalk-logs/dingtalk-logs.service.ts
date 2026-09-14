import type {
  DingtalkLogResponseOutput,
  DingtalkLogSection,
} from '@ky-azeroth/shared/schemas/dingtalk-log';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

import { FilterApplierService } from '../../common/filter-scheme';
import type { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import { toJsonValue } from '../../common/utils/json-type-helpers';
import { calculatePagination, serializeEntity } from '../../common/utils/response-helpers';
import { DINGTALK_LOG_FILTER_REGISTRY } from './dingtalk-logs.filter-registry';
import { CreateDingtalkLogDto } from './dto/create-dingtalk-log.dto';
import { QueryDingtalkLogDto } from './dto/query-dingtalk-log.dto';
import { UpdateDingtalkLogDto } from './dto/update-dingtalk-log.dto';

/**
 * 将 sections 数组拼接成 `contents` 纯文本（保持与同步过来的钉钉日志格式一致），
 * 这样列表展示/导出可继续读 contents，无需 contentsJson 兜底。
 */
function sectionsToContents(sections: DingtalkLogSection[]): string {
  return sections.map((s) => `${s.key}: ${s.value ?? ''}`).join('\n');
}

@Injectable()
export class DingtalkLogsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly filterApplier: FilterApplierService
  ) {}

  async findAll(
    query: QueryDingtalkLogDto,
    rawQuery?: unknown
  ): Promise<PaginatedResponse<DingtalkLogResponseOutput>> {
    const { page = 1, pageSize = 20 } = query;
    const { skip } = calculatePagination(page, pageSize);

    const where = await this.filterApplier.buildWhere<Prisma.DingtalkLogWhereInput>({
      registry: DINGTALK_LOG_FILTER_REGISTRY,
      rawQuery,
      legacyKeyword: query.keyword,
      legacyFilters: { creatorId: query.creatorId },
      chargerScope: null,
      baseWhere: {},
    });

    const [total, items] = await Promise.all([
      this.prisma.dingtalkLog.count({ where }),
      this.prisma.dingtalkLog.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createTime: 'desc' },
      }),
    ]);

    return {
      items: items.map((item) =>
        serializeEntity<DingtalkLogResponseOutput>(item as Record<string, unknown>)
      ),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async findOne(reportId: string): Promise<DingtalkLogResponseOutput> {
    const log = await this.prisma.dingtalkLog.findUnique({
      where: { reportId },
    });

    if (!log) {
      throw new NotFoundException('钉钉日志不存在');
    }

    return serializeEntity<DingtalkLogResponseOutput>(log as Record<string, unknown>);
  }

  /**
   * 本地新增日志（不回写钉钉，OAPI 无修改/删除接口故仅本地管理）
   */
  async create(dto: CreateDingtalkLogDto): Promise<DingtalkLogResponseOutput> {
    const reportId = `local-${randomUUID()}`;
    const sections = dto.sections;

    const row = await this.prisma.dingtalkLog.create({
      data: {
        reportId,
        templateName: dto.templateName ?? null,
        creatorId: dto.creatorId ?? null,
        creatorName: dto.creatorName ?? null,
        deptName: dto.deptName ?? null,
        contents: sectionsToContents(sections),
        contentsJson: toJsonValue(sections),
        createTime: dto.createTime ? new Date(dto.createTime) : new Date(),
        source: 'local',
        isLocallyEdited: false, // 本地新增，无需标记编辑
      },
    });

    return serializeEntity<DingtalkLogResponseOutput>(row as Record<string, unknown>);
  }

  /**
   * 本地编辑日志：
   * - source='dingtalk' 的记录被编辑后，isLocallyEdited 置为 true，避免下次同步覆盖
   * - source='local' 的记录正常更新
   *
   * @no-optimistic-lock DingtalkLog 模型本身无 version 字段（同步表 + 单用户/管理员本地编辑场景，并发风险低）
   */
  async update(reportId: string, dto: UpdateDingtalkLogDto): Promise<DingtalkLogResponseOutput> {
    const exist = await this.prisma.dingtalkLog.findUnique({
      where: { reportId },
      select: { reportId: true, source: true },
    });
    if (!exist) {
      throw new NotFoundException('钉钉日志不存在');
    }

    const data: Prisma.DingtalkLogUpdateInput = {};
    if (dto.templateName !== undefined) data.templateName = dto.templateName ?? null;
    if (dto.creatorId !== undefined) data.creatorId = dto.creatorId ?? null;
    if (dto.creatorName !== undefined) data.creatorName = dto.creatorName ?? null;
    if (dto.deptName !== undefined) data.deptName = dto.deptName ?? null;
    if (dto.sections !== undefined) {
      data.contents = sectionsToContents(dto.sections);
      data.contentsJson = toJsonValue(dto.sections);
    }
    if (dto.createTime !== undefined) {
      data.createTime = dto.createTime ? new Date(dto.createTime) : null;
    }
    // 同步过来的记录被编辑后打上标记，防止下次同步覆盖
    if (exist.source !== 'local') {
      data.isLocallyEdited = true;
    }

    const row = await this.prisma.dingtalkLog.update({
      where: { reportId },
      data,
    });
    return serializeEntity<DingtalkLogResponseOutput>(row as Record<string, unknown>);
  }

  /**
   * 删除日志（硬删——钉钉日志表本身无 deletedAt 字段；下次同步会重新拉回钉钉源的日志）
   */
  async remove(reportId: string): Promise<{ success: true }> {
    const exist = await this.prisma.dingtalkLog.findUnique({
      where: { reportId },
      select: { reportId: true },
    });
    if (!exist) {
      throw new NotFoundException('钉钉日志不存在');
    }
    await this.prisma.dingtalkLog.delete({ where: { reportId } });
    return { success: true };
  }
}
