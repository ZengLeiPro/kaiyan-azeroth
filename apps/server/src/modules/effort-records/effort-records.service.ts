import type { EffortRecordResponseOutput } from '@ky-azeroth/shared/schemas';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { FilterApplierService } from '../../common/filter-scheme';
import type { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import { auditCreate, auditUpdate } from '../../common/utils/audit-helper';
import {
  calculatePagination,
  serializeEntity,
  toDecimalNumber,
} from '../../common/utils/response-helpers';
import { HolidaysService } from '../holidays/holidays.service';
import { BatchCreateEffortRecordDto } from './dto/batch-create-effort-record.dto';
import { CreateEffortRecordDto } from './dto/create-effort-record.dto';
import { QueryEffortRecordDto } from './dto/query-effort-record.dto';
import { UpdateEffortRecordDto } from './dto/update-effort-record.dto';
import { EFFORT_RECORD_FILTER_REGISTRY } from './effort-records.filter-registry';

@Injectable()
export class EffortRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly filterApplier: FilterApplierService,
    private readonly holidaysService: HolidaysService
  ) {}

  /**
   * 校验：PLAN 类型工时不允许落在非工作日（节假日/周末），以 system/holidays 配置为准。
   *
   * 仅对 recordType=PLAN 启用——ACTUAL 工时存在合法的"节假日加班补录"场景，
   * 维持现状不限制。日期入参为 ISO YYYY-MM-DD（DTO 已校验格式）；非 PLAN 或无 workDate 时直通。
   */
  private async assertPlanOnWorkday(
    recordType: string | undefined | null,
    workDate: string | undefined | null
  ): Promise<void> {
    if (recordType !== 'PLAN' || !workDate) return;
    const iso = workDate.slice(0, 10);
    const isRest = await this.holidaysService.isRestDay(iso);
    if (isRest) {
      throw new UnprocessableEntityException(
        `工作计划日期 ${iso} 是节假日/休息日，不允许填报。请改选工作日，或先在「系统设置 → 节假日」中调整该日期的设置。`
      );
    }
  }

  /**
   * 创建工时记录
   * @param tx 可选的 Prisma 事务客户端，用于在事务中复用
   */
  async create(
    createEffortRecordDto: CreateEffortRecordDto,
    currentUser: { id: string; employeeId?: string | null },
    tx?: Prisma.TransactionClient
  ): Promise<EffortRecordResponseOutput> {
    const client = tx ?? this.prisma;
    // ownerId 由 service 强制为当前登录人，剔除 client 传入值（防写侧越权）
    const { startDate, endDate, workDate, ownerId: _ignored, ...restDto } = createEffortRecordDto;
    const ownerId = currentUser.employeeId ?? currentUser.id;
    await this.assertPlanOnWorkday(restDto.recordType, workDate);
    const record = await client.effortRecord.create({
      data: {
        ...restDto,
        ownerId,
        actualTime: String(restDto.actualTime),
        ...(workDate ? { workDate: new Date(workDate) } : {}),
        ...(startDate ? { startDate: new Date(startDate) } : {}),
        ...(endDate ? { endDate: new Date(endDate) } : {}),
        ...auditCreate(currentUser),
      },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            customer: { select: { customerName: true } },
          },
        },
      },
    });
    return serializeEntity<EffortRecordResponseOutput>({
      ...record,
      actualTime: toDecimalNumber(record.actualTime),
      project: record.project
        ? {
            id: record.project.id,
            name: record.project.name,
            customerName: record.project.customer?.customerName ?? null,
          }
        : undefined,
    });
  }

  /**
   * 批量创建工时记录
   * @no-optimistic-lock: 批量创建是纯新建操作，无需乐观锁
   */
  async batchCreate(
    dto: BatchCreateEffortRecordDto,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<{ created: number; records: EffortRecordResponseOutput[] }> {
    const records: EffortRecordResponseOutput[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const item of dto.items) {
        // workDate 必填：如果缺少则从 startDate 或当天日期自动填充
        if (!item.workDate) {
          const fallback = item.startDate
            ? item.startDate.slice(0, 10)
            : new Date().toISOString().slice(0, 10);
          item.workDate = fallback;
        }
        records.push(await this.create(item, currentUser, tx));
      }
    });
    return { created: records.length, records };
  }

  /**
   * 查询工时记录列表
   *
   * 数据范围由 controller 根据 (projects, effort_records) 的 viewScope 解析后传入。
   * 通过 chargerScope 把 ownerId 作为强制下推上限，与 registry 中 ownerId 的
   * `isScopeField: true` 标记接线。
   */
  async findAll(
    query: QueryEffortRecordDto,
    rawQuery: unknown,
    chargerScope: string[] | null
  ): Promise<PaginatedResponse<EffortRecordResponseOutput>> {
    const { startDate, endDate, page = 1, pageSize = 20 } = query;
    const { skip } = calculatePagination(page, pageSize);

    // 旧参数 startDate / endDate 的"workDate 优先、缺失时回退到 startDate"兜底逻辑
    // 保留在 service 层作为业务硬规则——registry 只暴露 workDate dateRange，
    // 因为新前端不再走 startDate/endDate 这对历史参数。
    const baseWhereAnd: Prisma.EffortRecordWhereInput[] = [];
    if (startDate || endDate) {
      const workDateFilter: Prisma.DateTimeNullableFilter = {};
      const startDateFilter: Prisma.DateTimeNullableFilter = {};

      if (startDate) {
        workDateFilter.gte = new Date(startDate);
        startDateFilter.gte = new Date(startDate);
      }
      if (endDate) {
        const endDateTime = endDate.includes('T')
          ? new Date(endDate)
          : new Date(endDate + 'T23:59:59.999Z');
        workDateFilter.lte = endDateTime;
        startDateFilter.lte = endDateTime;
      }

      baseWhereAnd.push({
        OR: [
          { workDate: { not: null, ...workDateFilter } },
          { workDate: null, startDate: startDateFilter },
        ],
      });
    }

    const baseWhere: Prisma.EffortRecordWhereInput = {
      deletedAt: null,
      ...(baseWhereAnd.length > 0 ? { AND: baseWhereAnd } : {}),
    };

    const where = await this.filterApplier.buildWhere<Prisma.EffortRecordWhereInput>({
      registry: EFFORT_RECORD_FILTER_REGISTRY,
      rawQuery,
      legacyKeyword: query.keyword,
      legacyFilters: {
        ownerId: query.ownerId,
        projectId: query.projectId,
        workType: query.workType,
        recordType: query.recordType,
      },
      chargerScope,
      baseWhere,
    });

    const [total, data] = await Promise.all([
      this.prisma.effortRecord.count({ where }),
      this.prisma.effortRecord.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          owner: { select: { id: true, name: true } },
          project: {
            select: {
              id: true,
              name: true,
              customer: { select: { customerName: true } },
            },
          },
        },
      }),
    ]);

    return {
      items: data.map((item) =>
        serializeEntity<EffortRecordResponseOutput>({
          ...item,
          ownerName: item.owner?.name ?? item.ownerName,
          actualTime: toDecimalNumber(item.actualTime),
          project: item.project
            ? {
                id: item.project.id,
                name: item.project.name,
                customerName: item.project.customer?.customerName ?? null,
              }
            : undefined,
        })
      ),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 查询工时记录详情
   */
  async findOne(id: string): Promise<EffortRecordResponseOutput> {
    const record = await this.prisma.effortRecord.findFirst({
      where: { id, deletedAt: null },
      include: {
        owner: { select: { id: true, name: true } },
        project: {
          select: {
            id: true,
            name: true,
            customer: { select: { customerName: true } },
          },
        },
      },
    });

    if (!record) {
      throw new NotFoundException('工时记录不存在');
    }

    return serializeEntity<EffortRecordResponseOutput>({
      ...record,
      ownerName: record.owner?.name ?? record.ownerName,
      actualTime: toDecimalNumber(record.actualTime),
      project: record.project
        ? {
            id: record.project.id,
            name: record.project.name,
            customerName: record.project.customer?.customerName ?? null,
          }
        : undefined,
    });
  }

  /**
   * 更新工时记录
   */
  async update(
    id: string,
    updateEffortRecordDto: UpdateEffortRecordDto,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<EffortRecordResponseOutput> {
    const existing = await this.findOne(id);

    const {
      version: requestVersion,
      startDate,
      endDate,
      workDate,
      ownerId: _ignoredOwnerId,
      ...restDto
    } = updateEffortRecordDto;

    // PLAN 校验：用 dto.recordType 优先、否则继承 existing.recordType；
    // workDate 同理——dto 没传则用现有值。任何一边构成 PLAN+非工作日组合都拒绝。
    const effectiveRecordType = restDto.recordType ?? existing.recordType;
    const effectiveWorkDate =
      workDate !== undefined
        ? workDate
        : existing.workDate
          ? String(existing.workDate).slice(0, 10)
          : null;
    await this.assertPlanOnWorkday(effectiveRecordType, effectiveWorkDate);

    const updateData: Prisma.EffortRecordUncheckedUpdateInput = {
      ...restDto,
      ...(restDto.actualTime !== undefined ? { actualTime: String(restDto.actualTime) } : {}),
      ...(workDate !== undefined ? { workDate: workDate ? new Date(workDate) : null } : {}),
      ...(startDate !== undefined ? { startDate: startDate ? new Date(startDate) : null } : {}),
      ...(endDate !== undefined ? { endDate: endDate ? new Date(endDate) : null } : {}),
      ...auditUpdate(currentUser),
      version: { increment: 1 },
    };

    try {
      const record = await this.prisma.effortRecord.update({
        where: {
          id,
          version: requestVersion,
          deletedAt: null,
        },
        data: updateData,
        include: {
          project: {
            select: {
              id: true,
              name: true,
              customer: { select: { customerName: true } },
            },
          },
        },
      });
      return serializeEntity<EffortRecordResponseOutput>({
        ...record,
        actualTime: toDecimalNumber(record.actualTime),
        project: record.project
          ? {
              id: record.project.id,
              name: record.project.name,
              customerName: record.project.customer?.customerName ?? null,
            }
          : undefined,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException(
          `数据已被其他用户修改，当前版本 ${existing.version}。请刷新后重试。`
        );
      }
      throw error;
    }
  }

  /**
   * 删除工时记录（软删除）
   */
  async remove(
    id: string,
    requestVersion: number,
    currentUser: { id: string; employeeId?: string | null }
  ) {
    const existing = await this.findOne(id);
    try {
      await this.prisma.effortRecord.update({
        where: { id, version: requestVersion, deletedAt: null },
        data: {
          deletedAt: new Date(),
          ...auditUpdate(currentUser),
          version: { increment: 1 },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException(
          `数据已被其他用户修改，当前版本 ${existing.version}。请刷新后重试。`
        );
      }
      throw error;
    }

    return { success: true };
  }

  // ========== 我的工时 ==========

  /**
   * 获取我的工时表（按日期分组）
   */
  async getMyTimesheet(ownerId: string, startDate: string, endDate: string, recordType?: string) {
    const records = await this.prisma.effortRecord.findMany({
      where: {
        deletedAt: null,
        ownerId,
        workDate: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        },
        ...(recordType && { recordType }),
      },
      orderBy: { workDate: 'asc' },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            customer: { select: { customerName: true } },
          },
        },
      },
    });

    // 按 workDate 分组
    const grouped: Record<string, Array<EffortRecordResponseOutput>> = {};
    for (const record of records) {
      const dateKey = record.workDate ? record.workDate.toISOString().slice(0, 10) : 'unknown';
      if (!grouped[dateKey]) {
        grouped[dateKey] = [];
      }
      grouped[dateKey].push(
        serializeEntity<EffortRecordResponseOutput>({
          ...record,
          actualTime: toDecimalNumber(record.actualTime),
          project: record.project
            ? {
                id: record.project.id,
                name: record.project.name,
                customerName: record.project.customer?.customerName ?? null,
              }
            : undefined,
        })
      );
    }

    return grouped;
  }

  /**
   * 获取最近使用的项目（去重，按最近使用排序）
   */
  async getMyRecentProjects(
    ownerId: string
  ): Promise<Array<{ id: string; name: string; customerName: string | null }>> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const records = await this.prisma.effortRecord.findMany({
      where: {
        deletedAt: null,
        ownerId,
        recordType: 'ACTUAL',
        createdAt: { gte: thirtyDaysAgo },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            customer: { select: { customerName: true } },
          },
        },
      },
    });

    // 去重，保留最近使用的
    const seen = new Set<string>();
    const result: Array<{
      id: string;
      name: string;
      customerName: string | null;
    }> = [];

    for (const record of records) {
      if (!seen.has(record.projectId)) {
        seen.add(record.projectId);
        result.push({
          id: record.project.id,
          name: record.project.name,
          customerName: record.project.customer?.customerName ?? null,
        });
      }
    }

    return result;
  }
}
