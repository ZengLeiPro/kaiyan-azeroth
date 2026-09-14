import type { CrmWorkDailyResponseOutput } from '@ky-azeroth/shared/schemas/crm-work-daily';
import type { IAttachment } from '@ky-azeroth/shared/types/common';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { FilterApplierService } from '../../common/filter-scheme';
import type { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import { auditCreate, auditUpdate } from '../../common/utils/audit-helper';
import { fromJsonValue, toJsonValue } from '../../common/utils/json-type-helpers';
import { calculatePagination, serializeEntity } from '../../common/utils/response-helpers';
import { CRM_WORK_DAILY_FILTER_REGISTRY } from './crm-work-dailies.filter-registry';
import { CreateCrmWorkDailyDto } from './dto/create-crm-work-daily.dto';
import { QueryCrmWorkDailyDto } from './dto/query-crm-work-daily.dto';
import { UpdateCrmWorkDailyDto } from './dto/update-crm-work-daily.dto';

@Injectable()
export class CrmWorkDailiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly filterApplier: FilterApplierService
  ) {}

  /**
   * 按 Asia/Shanghai 时区把 Date 转为 YYYY-MM-DD 字符串
   */
  private toShanghaiDateString(d: Date): string {
    const shifted = new Date(d.getTime() + 8 * 60 * 60 * 1000);
    return shifted.toISOString().slice(0, 10);
  }

  /**
   * 按"录入时间 vs 日报业务日期"自动判定提交状态：
   * - createdAt 的中国时区日期 ≤ reportDate 当天 → 按时提交
   * - 否则 → 迟交
   *
   * 调用方在 dto 已显式传 submitStatus 时（如 yccrm 同步数据）会跳过此计算。
   */
  private computeSubmitStatus(
    reportDateInput: string | null | undefined,
    createdAt: Date
  ): string | undefined {
    if (!reportDateInput) return undefined;
    // dto.reportDate 形如 "2026-05-18" 或 ISO string，统一截前 10 位作为业务日期
    const reportDateStr = String(reportDateInput).slice(0, 10);
    const createdDateStr = this.toShanghaiDateString(createdAt);
    return createdDateStr <= reportDateStr ? '按时提交' : '迟交';
  }

  /**
   * 创建工作日报
   */
  async create(
    dto: CreateCrmWorkDailyDto,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<CrmWorkDailyResponseOutput> {
    // 优先尊重 dto 显式传入的 submitStatus（如 yccrm 同步数据），否则按规则派生
    const resolvedSubmitStatus =
      dto.submitStatus !== undefined && dto.submitStatus !== null
        ? dto.submitStatus
        : this.computeSubmitStatus(dto.reportDate, new Date());

    const daily = await this.prisma.crmWorkDaily.create({
      data: {
        reportDate: dto.reportDate ? new Date(dto.reportDate) : undefined,
        reportType: dto.reportType ?? 'daily',
        submitStatus: resolvedSubmitStatus ?? undefined,
        senderId: dto.senderId ?? currentUser.employeeId ?? undefined,
        keyCustomerSummary: dto.keyCustomerSummary ?? undefined,
        tomorrowVisitPlan: dto.tomorrowVisitPlan ?? undefined,
        otherPlanArrangements: dto.otherPlanArrangements ?? undefined,
        coordinationItems: dto.coordinationItems ?? undefined,
        callsMadeCount: dto.callsMadeCount ?? undefined,
        callsConnectedCount: dto.callsConnectedCount ?? undefined,
        callsOver30sCount: dto.callsOver30sCount ?? undefined,
        totalCallMinutes: dto.totalCallMinutes ?? undefined,
        visitCustomerCount: dto.visitCustomerCount ?? undefined,
        newCustomerCount: dto.newCustomerCount ?? undefined,
        newContactMethodCount: dto.newContactMethodCount ?? undefined,
        remark: dto.remark ?? undefined,
        attachments: dto.attachments ? toJsonValue(dto.attachments) : undefined,
        ...auditCreate(currentUser),
      },
    });

    return serializeEntity<CrmWorkDailyResponseOutput>({
      ...daily,
      attachments: fromJsonValue<IAttachment[]>(daily.attachments) ?? [],
    });
  }

  /**
   * 查询工作日报列表
   */
  async findAll(
    query: QueryCrmWorkDailyDto,
    chargerScope?: string[] | null,
    rawQuery?: unknown
  ): Promise<PaginatedResponse<CrmWorkDailyResponseOutput>> {
    const { page = 1, pageSize = 20 } = query;
    const { skip } = calculatePagination(page, pageSize);

    // 此模型用 senderId 作为数据范围字段；registry 里已将 senderId 标记为 isScopeField
    // FilterApplier 会把 chargerScope 正确注入到 senderId。
    const where = await this.filterApplier.buildWhere<Prisma.CrmWorkDailyWhereInput>({
      registry: CRM_WORK_DAILY_FILTER_REGISTRY,
      rawQuery,
      legacyKeyword: query.keyword,
      legacyFilters: this.buildLegacyFilters(query),
      chargerScope: chargerScope ?? null,
      baseWhere: { deletedAt: null },
    });

    const [total, items] = await Promise.all([
      this.prisma.crmWorkDaily.count({ where }),
      this.prisma.crmWorkDaily.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          sender: { select: { id: true, name: true } },
        },
      }),
    ]);

    return {
      items: items.map((item) =>
        serializeEntity<CrmWorkDailyResponseOutput>({
          ...item,
          senderName: item.sender?.name ?? item.senderName,
          attachments: fromJsonValue<IAttachment[]>(item.attachments) ?? [],
        })
      ),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 查询工作日报详情
   */
  async findOne(id: string, chargerScope?: string[] | null): Promise<CrmWorkDailyResponseOutput> {
    const where: Prisma.CrmWorkDailyWhereInput = { id, deletedAt: null };
    // 数据范围过滤（此 model 用 senderId 而非 chargerId）
    if (chargerScope !== undefined && chargerScope !== null) {
      where.senderId = { in: chargerScope };
    }
    const daily = await this.prisma.crmWorkDaily.findFirst({
      where,
      include: {
        sender: { select: { id: true, name: true } },
      },
    });

    if (!daily) {
      throw new NotFoundException(`工作日报 ${id} 不存在`);
    }

    return serializeEntity<CrmWorkDailyResponseOutput>({
      ...daily,
      senderName: daily.sender?.name ?? daily.senderName,
      attachments: fromJsonValue<IAttachment[]>(daily.attachments) ?? [],
    });
  }

  /**
   * 更新工作日报
   */
  async update(
    id: string,
    dto: UpdateCrmWorkDailyDto,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null
  ): Promise<CrmWorkDailyResponseOutput> {
    const existing = await this.findOne(id, chargerScope);

    const { version: requestVersion } = dto;

    try {
      const daily = await this.prisma.crmWorkDaily.update({
        where: {
          id,
          ...(requestVersion !== undefined ? { version: requestVersion } : {}),
        },
        data: {
          ...(dto.reportDate !== undefined && {
            reportDate: dto.reportDate ? new Date(dto.reportDate) : null,
          }),
          ...(dto.reportType !== undefined && { reportType: dto.reportType }),
          ...(dto.submitStatus !== undefined && { submitStatus: dto.submitStatus }),
          ...(dto.senderId !== undefined && { senderId: dto.senderId }),
          ...(dto.keyCustomerSummary !== undefined && {
            keyCustomerSummary: dto.keyCustomerSummary,
          }),
          ...(dto.tomorrowVisitPlan !== undefined && { tomorrowVisitPlan: dto.tomorrowVisitPlan }),
          ...(dto.otherPlanArrangements !== undefined && {
            otherPlanArrangements: dto.otherPlanArrangements,
          }),
          ...(dto.coordinationItems !== undefined && { coordinationItems: dto.coordinationItems }),
          ...(dto.callsMadeCount !== undefined && { callsMadeCount: dto.callsMadeCount }),
          ...(dto.callsConnectedCount !== undefined && {
            callsConnectedCount: dto.callsConnectedCount,
          }),
          ...(dto.callsOver30sCount !== undefined && {
            callsOver30sCount: dto.callsOver30sCount,
          }),
          ...(dto.totalCallMinutes !== undefined && {
            totalCallMinutes: dto.totalCallMinutes,
          }),
          ...(dto.visitCustomerCount !== undefined && {
            visitCustomerCount: dto.visitCustomerCount,
          }),
          ...(dto.newCustomerCount !== undefined && { newCustomerCount: dto.newCustomerCount }),
          ...(dto.newContactMethodCount !== undefined && {
            newContactMethodCount: dto.newContactMethodCount,
          }),
          ...(dto.remark !== undefined && { remark: dto.remark }),
          ...(dto.attachments !== undefined && {
            attachments: dto.attachments ? toJsonValue(dto.attachments) : Prisma.JsonNull,
          }),
          ...auditUpdate(currentUser),
          version: { increment: 1 },
        },
      });

      return serializeEntity<CrmWorkDailyResponseOutput>({
        ...daily,
        attachments: fromJsonValue<IAttachment[]>(daily.attachments) ?? [],
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
   * 删除工作日报（软删除）
   */
  async remove(
    id: string,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null
  ): Promise<void> {
    await this.findOne(id, chargerScope);

    await this.prisma.crmWorkDaily.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        ...auditUpdate(currentUser),
      },
    });
  }

  private buildLegacyFilters(query: QueryCrmWorkDailyDto): Record<string, unknown> {
    return {
      senderId: query.senderId,
      reportType: query.reportType,
      submitStatus: query.submitStatus,
    };
  }
}
