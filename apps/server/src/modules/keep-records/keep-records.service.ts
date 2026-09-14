import { APPROVAL_INSTANCE_STATUS, KEEP_RECORD_SOURCE } from '@ky-azeroth/shared/constants';
import type { KeepRecordResponseOutput } from '@ky-azeroth/shared/schemas/keep-record';
import type { IAttachment } from '@ky-azeroth/shared/types/common';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { FilterApplierService } from '../../common/filter-scheme';
import type { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import { applyCustomerCollabViaCustomerScope } from '../../common/services/data-scope.service';
import { auditCreate, auditUpdate } from '../../common/utils/audit-helper';
import { parseClientDateTime } from '../../common/utils/date-helpers';
import { fromJsonValue, toJsonValue } from '../../common/utils/json-type-helpers';
import { resolveOrderBy } from '../../common/utils/order-by.helper';
import {
  calculatePagination,
  serializeEntity,
  toDateOnlyString,
} from '../../common/utils/response-helpers';
import { CustomerLifecycleService } from '../customers/customer-lifecycle.service';
import { CrmChangeLogService } from '../operation-logs/crm-change-log.service';
import { CreateKeepRecordDto } from './dto/create-keep-record.dto';
import { QueryKeepRecordDto } from './dto/query-keep-record.dto';
import { UpdateKeepRecordDto } from './dto/update-keep-record.dto';
import { KEEP_RECORD_FILTER_REGISTRY } from './keep-records.filter-registry';

/**
 * 跟进记录列表允许的排序字段白名单。
 * 修复历史 BUG：keepRecordTime 在 schema 上已标 sortable: true，
 * 但 service 之前硬编码 createdAt desc 忽略前端 sortBy，点击表头无效。
 */
const KEEP_RECORD_SORT_WHITELIST: ReadonlySet<string> = new Set([
  'keepRecordTime',
  'createdAt',
  'updatedAt',
]);

@Injectable()
export class KeepRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customerLifecycle: CustomerLifecycleService,
    private readonly filterApplier: FilterApplierService,
    private readonly changeLog?: CrmChangeLogService
  ) {}

  /**
   * 创建跟进记录
   */
  async create(
    dto: CreateKeepRecordDto,
    currentUser: { id: string; employeeId?: string | null },
    // 内部调用方可透传现有事务；真实跟进必须在该 tx 内完成派生刷新。
    opts?: { tx?: Prisma.TransactionClient }
  ): Promise<KeepRecordResponseOutput> {
    const createInTransaction = async (tx: Prisma.TransactionClient) => {
      await this.assertActiveCustomer(tx, dto.customerId);
      const created = await tx.keepRecord.create({
        data: {
          customerId: dto.customerId,
          contactId: dto.contactId ?? undefined,
          keepRecordType: dto.keepRecordType ?? undefined,
          keepRecordTime: parseClientDateTime(dto.keepRecordTime) ?? undefined,
          keepRecordContent: dto.keepRecordContent ?? undefined,
          keepRecordStatus: dto.keepRecordStatus ?? undefined,
          intentTemperature: dto.intentTemperature ?? undefined,
          intentReasons: dto.intentReasons ? toJsonValue(dto.intentReasons) : undefined,
          nextFollowUpAt: dto.nextFollowUpAt
            ? new Date(`${dto.nextFollowUpAt}T00:00:00.000Z`)
            : undefined,
          // 跟进当前无审批流程，因此创建即为 approved 完成事实。
          flowStatus: APPROVAL_INSTANCE_STATUS.APPROVED,
          // 负责人通常由前端默认选中当前用户；这里保留兜底，避免外部调用缺省时生成不可见记录。
          chargerId: dto.chargerId ?? currentUser.employeeId ?? currentUser.id,
          attachments: dto.attachments ? toJsonValue(dto.attachments) : undefined,
          // 闭环来源：采纳写入时由 SalesActionItemsService.adopt 注入 source='action_item' + sourceActionItemId
          source: dto.source ?? undefined,
          sourceActionItemId: dto.sourceActionItemId ?? undefined,
          ...auditCreate(currentUser),
        },
        include: {
          customer: { select: { id: true, customerName: true, shortName: true } },
          contact: { select: { id: true, contactName: true } },
        },
      });

      // 关联记录 trigger 已按 customerId 加行锁；主写后再校验一次，封住检查与写入之间
      // 客户被并发软删的窗口。校验失败抛错会回滚刚才的跟进写入，客户正常删除只会等待。
      await this.assertActiveCustomer(tx, created.customerId);
      const isFieldChangeAudit = dto.source === KEEP_RECORD_SOURCE.FIELD_CHANGE;
      if (!isFieldChangeAudit) {
        await this.customerLifecycle.refresh(created.customerId, currentUser, tx);
      }
      return created;
    };

    const record = opts?.tx
      ? await createInTransaction(opts.tx)
      : await this.prisma.$transaction(createInTransaction);

    const response = this.serializeKeepRecord({
      ...record,
      attachments: fromJsonValue<IAttachment[]>(record.attachments) ?? [],
    });

    if (!opts?.tx) {
      await this.changeLog?.logChange({
        module: 'keep-records',
        action: 'create',
        target: response.id,
        targetName: response.keepRecordContent ?? response.customer?.customerName ?? null,
        currentUser,
        after: response,
      });
    }

    return response;
  }

  /**
   * 查询跟进记录列表
   */
  async findAll(
    query: QueryKeepRecordDto,
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null,
    rawQuery?: unknown
  ): Promise<PaginatedResponse<KeepRecordResponseOutput>> {
    const { page = 1, pageSize = 20, sortBy, sortOrder } = query;
    const { skip } = calculatePagination(page, pageSize);

    // RBAC：三路径 OR（自身 chargerId / customer.chargerId / customer.collaboratorIds 含我）。
    // chargerScope 传 null 让 applier 不再注入 isScopeField AND，避免覆盖 OR；
    // 配套地，filter-registry 的 chargerId 字段已去掉 isScopeField 标记。
    const baseWhere: Prisma.KeepRecordWhereInput = { deletedAt: null };
    applyCustomerCollabViaCustomerScope(baseWhere, chargerScope, currentEmployeeId);

    const where = await this.filterApplier.buildWhere<Prisma.KeepRecordWhereInput>({
      registry: KEEP_RECORD_FILTER_REGISTRY,
      rawQuery,
      legacyKeyword: query.keyword,
      legacyFilters: this.buildLegacyFilters(query),
      chargerScope: null,
      baseWhere,
    });

    const orderBy = resolveOrderBy<Prisma.KeepRecordOrderByWithRelationInput>(sortBy, sortOrder, {
      whitelist: KEEP_RECORD_SORT_WHITELIST,
      fallback: { createdAt: 'desc' },
    });

    const [total, items] = await Promise.all([
      this.prisma.keepRecord.count({ where }),
      this.prisma.keepRecord.findMany({
        where,
        skip,
        take: pageSize,
        orderBy,
        include: {
          charger: { select: { id: true, name: true } },
          customer: { select: { id: true, customerName: true, shortName: true } },
          contact: { select: { id: true, contactName: true } },
        },
      }),
    ]);

    return {
      items: items.map((item) =>
        this.serializeKeepRecord({
          ...item,
          chargerName: item.charger?.name ?? item.chargerName,
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
   * 查询跟进记录详情
   */
  async findOne(
    id: string,
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<KeepRecordResponseOutput> {
    const where: Prisma.KeepRecordWhereInput = { id, deletedAt: null };
    applyCustomerCollabViaCustomerScope(where, chargerScope, currentEmployeeId);
    const record = await this.prisma.keepRecord.findFirst({
      where,
      include: {
        charger: { select: { id: true, name: true } },
        customer: { select: { id: true, customerName: true, shortName: true } },
        contact: { select: { id: true, contactName: true } },
      },
    });

    if (!record) {
      throw new NotFoundException(`跟进记录 ${id} 不存在`);
    }

    return this.serializeKeepRecord({
      ...record,
      chargerName: record.charger?.name ?? record.chargerName,
      attachments: fromJsonValue<IAttachment[]>(record.attachments) ?? [],
    });
  }

  /**
   * 更新跟进记录
   */
  async update(
    id: string,
    dto: UpdateKeepRecordDto,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<KeepRecordResponseOutput> {
    const requestVersion = requirePositiveVersion(dto.version, '更新跟进记录');
    const existing = await this.findOne(id, chargerScope, currentEmployeeId);
    if (existing.version !== requestVersion) {
      throw new ConflictException(
        `数据已被其他用户修改，当前版本 ${existing.version}。请刷新后重试。`
      );
    }

    try {
      const record = await this.prisma.$transaction(async (tx) => {
        const targetCustomerId = dto.customerId ?? existing.customerId;
        await this.assertActiveCustomer(tx, targetCustomerId);
        const updated = await tx.keepRecord.update({
          where: { id, version: requestVersion },
          data: {
            ...(dto.customerId !== undefined && { customerId: dto.customerId }),
            ...(dto.contactId !== undefined && { contactId: dto.contactId }),
            ...(dto.keepRecordType !== undefined && { keepRecordType: dto.keepRecordType }),
            ...(dto.keepRecordTime !== undefined && {
              keepRecordTime: parseClientDateTime(dto.keepRecordTime),
            }),
            ...(dto.keepRecordContent !== undefined && {
              keepRecordContent: dto.keepRecordContent,
            }),
            ...(dto.keepRecordStatus !== undefined && { keepRecordStatus: dto.keepRecordStatus }),
            ...(dto.intentTemperature !== undefined && {
              intentTemperature: dto.intentTemperature,
            }),
            ...(dto.intentReasons !== undefined && {
              intentReasons: dto.intentReasons ? toJsonValue(dto.intentReasons) : Prisma.JsonNull,
            }),
            ...(dto.nextFollowUpAt !== undefined && {
              nextFollowUpAt: dto.nextFollowUpAt
                ? new Date(`${dto.nextFollowUpAt}T00:00:00.000Z`)
                : null,
            }),
            ...(dto.chargerId !== undefined && { chargerId: dto.chargerId }),
            ...(dto.attachments !== undefined && {
              attachments: dto.attachments ? toJsonValue(dto.attachments) : Prisma.JsonNull,
            }),
            ...auditUpdate(currentUser),
            version: { increment: 1 },
          },
          include: {
            customer: { select: { id: true, customerName: true, shortName: true } },
            contact: { select: { id: true, contactName: true } },
          },
        });

        // UPDATE trigger 已按旧、新 customerId 排序锁行；锁内复核新客户仍为活动状态。
        await this.assertActiveCustomer(tx, updated.customerId);
        await this.customerLifecycle.refresh(
          [existing.customerId, updated.customerId],
          currentUser,
          tx
        );
        return updated;
      });

      const response = this.serializeKeepRecord({
        ...record,
        attachments: fromJsonValue<IAttachment[]>(record.attachments) ?? [],
      });

      await this.changeLog?.logChange({
        module: 'keep-records',
        action: 'update',
        target: id,
        targetName: response.keepRecordContent ?? response.customer?.customerName ?? null,
        currentUser,
        before: existing,
        after: response,
      });

      return response;
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
   * 删除跟进记录（软删除）
   */
  async remove(
    id: string,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null,
    requestVersion?: number,
    // 外部事务客户端参数保留给待办采纳撤销等内部原子写路径。
    opts?: { tx?: Prisma.TransactionClient }
  ): Promise<void> {
    const requiredVersion = requirePositiveVersion(requestVersion, '删除跟进记录');
    // 鉴权查询保留在主写前；只有它读到的 version 与请求 CAS 一致且 CAS 成功时，
    // 事务外快照中的 old customerId 才可信，可安全用于迁移/删除后的生命周期回算。
    const record = await this.findOne(id, chargerScope, currentEmployeeId);
    if (record.version !== requiredVersion) {
      throw new ConflictException(
        `数据已被其他用户修改，当前版本 ${record.version}。请刷新后重试。`
      );
    }
    const customerId = record.customerId;

    const removeInTransaction = async (tx: Prisma.TransactionClient) => {
      const updated = await tx.keepRecord.update({
        where: { id, version: requiredVersion },
        data: {
          deletedAt: new Date(),
          ...auditUpdate(currentUser),
          version: { increment: 1 },
        },
      });
      const isFieldChangeAudit = record.source === KEEP_RECORD_SOURCE.FIELD_CHANGE;
      if (!isFieldChangeAudit) {
        await this.customerLifecycle.refresh(customerId, currentUser, tx);
      }
      return updated;
    };

    let deleted: Awaited<ReturnType<typeof removeInTransaction>>;
    try {
      deleted = opts?.tx
        ? await removeInTransaction(opts.tx)
        : await this.prisma.$transaction(removeInTransaction);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException(
          `数据已被其他用户修改，当前版本 ${record.version}。请刷新后重试。`
        );
      }
      throw error;
    }

    if (!opts?.tx) {
      await this.changeLog?.logChange({
        module: 'keep-records',
        action: 'delete',
        target: id,
        targetName: record.keepRecordContent ?? record.customer?.customerName ?? null,
        currentUser,
        before: record,
        after: deleted,
      });
    }
  }

  private async assertActiveCustomer(
    tx: Prisma.TransactionClient,
    customerId: string
  ): Promise<void> {
    const customer = await tx.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { id: true },
    });
    if (!customer) {
      throw new NotFoundException(`客户 ${customerId} 不存在或已删除`);
    }
  }

  private buildLegacyFilters(query: QueryKeepRecordDto): Record<string, unknown> {
    return {
      customerId: query.customerId,
      contactId: query.contactId,
      keepRecordType: query.keepRecordType,
    };
  }

  private serializeKeepRecord(record: Record<string, unknown>): KeepRecordResponseOutput {
    const { signLocation: _signLocation, signAddress: _signAddress, ...responseRecord } = record;
    const nextFollowUpAt = responseRecord.nextFollowUpAt;
    return serializeEntity<KeepRecordResponseOutput>({
      ...responseRecord,
      nextFollowUpAt: toDateOnlyString(
        nextFollowUpAt instanceof Date || typeof nextFollowUpAt === 'string' ? nextFollowUpAt : null
      ),
    });
  }
}

function requirePositiveVersion(raw: number | undefined, action: string): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
    throw new BadRequestException(`${action}必须携带有效的 version`);
  }
  return raw;
}
