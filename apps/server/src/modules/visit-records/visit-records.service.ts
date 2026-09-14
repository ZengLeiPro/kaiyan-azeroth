import { APPROVAL_EVENT_TYPE } from '@ky-azeroth/shared/constants';
import type { VisitRecordResponseOutput } from '@ky-azeroth/shared/schemas/visit-record';
import type { IAttachment } from '@ky-azeroth/shared/types/common';
import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  pushVisitRecordToDingTalk,
  type VisitRecordNotifyPayload,
} from '../../common/dingtalk/visit-record-notifier';
import { FilterApplierService } from '../../common/filter-scheme';
import { AmapReverseGeocodeService } from '../../common/geocoding/amap-reverse-geocode.service';
import type { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import { applyCustomerCollabViaCustomerScope } from '../../common/services/data-scope.service';
import { auditCreate, auditUpdate } from '../../common/utils/audit-helper';
import { parseClientDateTime } from '../../common/utils/date-helpers';
import { fromJsonValue, toJsonValue } from '../../common/utils/json-type-helpers';
import { resolveOrderBy } from '../../common/utils/order-by.helper';
import { calculatePagination, serializeEntity } from '../../common/utils/response-helpers';
import { APPROVAL_CHANGE_TARGET_TYPE } from '../approvals/approval-change-requests.service';
import { ApprovalGuardService } from '../approvals/approval-guard.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { BusinessApprovalService } from '../approvals/business-approval.service';
import { CustomersService } from '../customers/customers.service';
import { CrmChangeLogService } from '../operation-logs/crm-change-log.service';
import { UploadService } from '../upload/upload.service';
import { CreateVisitRecordDto } from './dto/create-visit-record.dto';
import { QueryVisitRecordDto } from './dto/query-visit-record.dto';
import { UpdateVisitRecordDto } from './dto/update-visit-record.dto';
import { VISIT_RECORD_FILTER_REGISTRY } from './visit-records.filter-registry';

/**
 * 拜访记录列表允许的排序字段白名单。
 * 修复历史 BUG：signInTime 在 schema 上已标 sortable: true，
 * 但 service 之前硬编码 createdAt desc 忽略前端 sortBy，点击表头无效。
 * signOutTime 暂不开放（schema 也未标），避免单次签到未签退时排序歧义。
 */
const VISIT_RECORD_SORT_WHITELIST: ReadonlySet<string> = new Set([
  'signInTime',
  'createdAt',
  'updatedAt',
]);

@Injectable()
export class VisitRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => CustomersService))
    private readonly customersService: CustomersService,
    private readonly approvalGuardService: ApprovalGuardService,
    private readonly approvalsService: ApprovalsService,
    private readonly businessApprovalService: BusinessApprovalService,
    private readonly filterApplier: FilterApplierService,
    private readonly reverseGeocodeService: AmapReverseGeocodeService,
    private readonly uploadService: UploadService,
    private readonly changeLog?: CrmChangeLogService
  ) {}

  /**
   * 创建拜访记录
   */
  async create(
    dto: CreateVisitRecordDto,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<VisitRecordResponseOutput> {
    const resolvedLocation = await this.reverseGeocodeService.ensureAddress(
      dto.signAddress,
      dto.signLocation
    );
    const approvalRequired = await this.approvalGuardService.isRequired(
      APPROVAL_EVENT_TYPE.VISIT_APPROVE
    );
    const flowStatus = approvalRequired ? 'pending' : 'approved';

    let approvalInstanceId: string | undefined;
    const record = await this.prisma.$transaction(async (tx) => {
      // pending 记录也必须绑定有效客户；审批状态只决定是否成为事实，不放宽主数据校验。
      await this.assertActiveCustomer(tx, dto.customerId);
      const created = await tx.visitRecord.create({
        data: {
          flowStatus,
          customerId: dto.customerId,
          contactId: dto.contactId ?? undefined,
          visitType: dto.visitType ?? undefined,
          content: dto.content ?? undefined,
          signInTime: parseClientDateTime(dto.signInTime) ?? undefined,
          signOutTime: parseClientDateTime(dto.signOutTime) ?? undefined,
          signAddress: resolvedLocation.signAddress ?? undefined,
          signLocation: resolvedLocation.signLocation ?? undefined,
          duration: dto.duration ?? undefined,
          visitStatus: dto.visitStatus ?? undefined,
          attachments: dto.attachments ? toJsonValue(dto.attachments) : undefined,
          // 默认负责人 = 当前操作人，避免 NULL chargerId 被列表默认筛选过滤掉
          chargerId: dto.chargerId ?? currentUser.employeeId ?? currentUser.id,
          ...auditCreate(currentUser),
        },
        include: {
          customer: { select: { id: true, customerName: true, shortName: true } },
          contact: { select: { id: true, contactName: true } },
          // 用于钉钉推送时组装「XX 刚提交了一条拜访记录」的提交人姓名
          creator: { select: { name: true } },
        },
      });

      // 关联记录 trigger 已持有客户行锁；主写后复核活动状态，封住并发软删窗口。
      // 失败会回滚 visit（pending 也一样），而正常客户删除仅等待本事务提交后继续。
      await this.assertActiveCustomer(tx, created.customerId);

      if (approvalRequired) {
        approvalInstanceId = await this.businessApprovalService.createApprovalForNewRecord(
          tx,
          APPROVAL_EVENT_TYPE.VISIT_APPROVE,
          created,
          currentUser
        );
      } else {
        // 无需审批的记录创建即 approved；主写与客户派生必须同事务成败。
        await this.customersService.refreshCustomerLifecycle(created.customerId, currentUser, tx);
      }

      return created;
    });

    if (approvalInstanceId) {
      this.approvalsService.notifyOnSubmit(approvalInstanceId).catch(() => {});
    }

    const response = serializeEntity<VisitRecordResponseOutput>({
      ...record,
      attachments: fromJsonValue<IAttachment[]>(record.attachments) ?? [],
    });

    await this.changeLog?.logChange({
      module: 'visit-records',
      action: 'create',
      target: response.id,
      targetName: response.signAddress ?? response.customer?.customerName ?? null,
      currentUser,
      after: response,
    });

    // 钉钉「销售部」群推送：只推 flowStatus=approved（当前无审批开关=创建即 approved）
    // 且非 yccrm 同步数据（yccrmId 为空），防批量回填炸群。异步 fire-and-forget，
    // 推送失败不影响业务主流程。
    if (record.flowStatus === 'approved' && !record.yccrmId) {
      void this.pushVisitRecordNotification(
        {
          id: record.id,
          customerName: record.customer?.customerName ?? null,
          contactName: record.contact?.contactName ?? null,
          visitType: record.visitType,
          content: record.content,
          signInTime: record.signInTime,
          signAddress: record.signAddress,
          signLocation: record.signLocation,
          attachments: fromJsonValue<IAttachment[]>(record.attachments) ?? [],
          creatorName: record.creator?.name ?? null,
        },
        currentUser.employeeId ?? currentUser.id
      );
    }

    return response;
  }

  private async pushVisitRecordNotification(
    payload: VisitRecordNotifyPayload,
    uploaderEmployeeId: string
  ): Promise<void> {
    let attachments = payload.attachments;
    try {
      const previewUrls = await this.uploadService.createRegisteredImagePreviewUrls(
        (attachments ?? []).filter((attachment) => attachment.mimeType.startsWith('image/')),
        uploaderEmployeeId
      );
      attachments = (attachments ?? []).map((attachment) => {
        const previewUrl = previewUrls.get(
          this.uploadService.attachmentCandidateKey(attachment.id, attachment.url)
        );
        return previewUrl ? { ...attachment, previewUrl } : attachment;
      });
    } catch (error) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          msg: 'visit_dingtalk_preview_sign_failed',
          recordId: payload.id,
          error: error instanceof Error ? error.message : String(error),
        })
      );
    }

    await pushVisitRecordToDingTalk(
      { ...payload, attachments },
      {
        webhookUrl: process.env.DINGTALK_SALES_VISIT_WEBHOOK,
        logger: {
          log: (msg) => console.log(msg),
          warn: (msg) => console.warn(msg),
          error: (msg) => console.error(msg),
        },
      }
    );
  }

  /**
   * 查询拜访记录列表
   */
  async findAll(
    query: QueryVisitRecordDto,
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null,
    rawQuery?: unknown
  ): Promise<PaginatedResponse<VisitRecordResponseOutput>> {
    const { page = 1, pageSize = 20, sortBy, sortOrder } = query;
    const { skip } = calculatePagination(page, pageSize);

    // RBAC：三路径 OR（自身 chargerId / customer.chargerId / customer.collaboratorIds 含我）。
    // chargerScope 传 null 让 applier 不再注入 isScopeField AND，避免覆盖 OR；
    // 配套地，filter-registry 的 chargerId 字段已去掉 isScopeField 标记。
    const baseWhere: Prisma.VisitRecordWhereInput = { deletedAt: null };
    applyCustomerCollabViaCustomerScope(baseWhere, chargerScope, currentEmployeeId);

    const where = await this.filterApplier.buildWhere<Prisma.VisitRecordWhereInput>({
      registry: VISIT_RECORD_FILTER_REGISTRY,
      rawQuery,
      legacyKeyword: query.keyword,
      legacyFilters: this.buildLegacyFilters(query),
      chargerScope: null,
      baseWhere,
    });

    const orderBy = resolveOrderBy<Prisma.VisitRecordOrderByWithRelationInput>(sortBy, sortOrder, {
      whitelist: VISIT_RECORD_SORT_WHITELIST,
      fallback: { createdAt: 'desc' },
    });

    const [total, items] = await Promise.all([
      this.prisma.visitRecord.count({ where }),
      this.prisma.visitRecord.findMany({
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
        serializeEntity<VisitRecordResponseOutput>({
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
   * 查询拜访记录详情
   */
  async findOne(
    id: string,
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<VisitRecordResponseOutput> {
    const where: Prisma.VisitRecordWhereInput = { id, deletedAt: null };
    applyCustomerCollabViaCustomerScope(where, chargerScope, currentEmployeeId);
    const record = await this.prisma.visitRecord.findFirst({
      where,
      include: {
        charger: { select: { id: true, name: true } },
        customer: { select: { id: true, customerName: true, shortName: true } },
        contact: { select: { id: true, contactName: true } },
      },
    });

    if (!record) {
      throw new NotFoundException(`拜访记录 ${id} 不存在`);
    }

    return serializeEntity<VisitRecordResponseOutput>({
      ...record,
      chargerName: record.charger?.name ?? record.chargerName,
      attachments: fromJsonValue<IAttachment[]>(record.attachments) ?? [],
    });
  }

  /**
   * 更新拜访记录
   */
  async update(
    id: string,
    dto: UpdateVisitRecordDto,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<VisitRecordResponseOutput> {
    const requestVersion = requirePositiveVersion(dto.version, '更新拜访记录');
    const existing = await this.findOne(id, chargerScope, currentEmployeeId);
    this.businessApprovalService.assertCanDirectEdit(existing.flowStatus, '拜访记录', currentUser);
    if (existing.version !== requestVersion) {
      throw new ConflictException(
        `数据已被其他用户修改，当前版本 ${existing.version}。请刷新后重试。`
      );
    }

    const resolvedLocation = await this.resolveUpdateLocation(dto, existing);

    try {
      const record = await this.prisma.$transaction(async (tx) => {
        const pendingApproval = await this.businessApprovalService.lockPendingFormEdit(
          tx,
          APPROVAL_EVENT_TYPE.VISIT_APPROVE,
          id,
          existing.flowStatus,
          currentUser
        );
        const targetCustomerId = dto.customerId ?? existing.customerId;
        await this.assertActiveCustomer(tx, targetCustomerId);
        const updated = await tx.visitRecord.update({
          where: { id, version: requestVersion },
          data: {
            ...(dto.customerId !== undefined && { customerId: dto.customerId }),
            ...(dto.contactId !== undefined && { contactId: dto.contactId }),
            ...(dto.visitType !== undefined && { visitType: dto.visitType }),
            ...(dto.content !== undefined && { content: dto.content }),
            ...(dto.signInTime !== undefined && {
              signInTime: parseClientDateTime(dto.signInTime),
            }),
            ...(dto.signOutTime !== undefined && {
              signOutTime: parseClientDateTime(dto.signOutTime),
            }),
            ...(resolvedLocation && { signAddress: resolvedLocation.signAddress }),
            ...(resolvedLocation && { signLocation: resolvedLocation.signLocation }),
            ...(dto.duration !== undefined && { duration: dto.duration }),
            ...(dto.visitStatus !== undefined && { visitStatus: dto.visitStatus }),
            ...(dto.attachments !== undefined && {
              attachments: dto.attachments ? toJsonValue(dto.attachments) : Prisma.JsonNull,
            }),
            ...(dto.chargerId !== undefined && { chargerId: dto.chargerId }),
            ...auditUpdate(currentUser),
            version: { increment: 1 },
          },
          include: {
            customer: { select: { id: true, customerName: true, shortName: true } },
            contact: { select: { id: true, contactName: true } },
          },
        });

        await this.businessApprovalService.syncPendingFormEdit(
          tx,
          pendingApproval,
          APPROVAL_EVENT_TYPE.VISIT_APPROVE,
          updated,
          currentUser
        );

        // UPDATE trigger 已按旧、新 customerId 排序锁行；锁内复核新客户仍为活动状态。
        await this.assertActiveCustomer(tx, updated.customerId);
        await this.customersService.refreshCustomerLifecycle(
          [existing.customerId, updated.customerId],
          currentUser,
          tx
        );
        return updated;
      });

      const response = serializeEntity<VisitRecordResponseOutput>({
        ...record,
        attachments: fromJsonValue<IAttachment[]>(record.attachments) ?? [],
      });

      await this.changeLog?.logChange({
        module: 'visit-records',
        action: 'update',
        target: id,
        targetName: response.signAddress ?? response.customer?.customerName ?? null,
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

  async submitChangeRequest(
    id: string,
    dto: UpdateVisitRecordDto,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ) {
    const existing = await this.findOne(id, chargerScope, currentEmployeeId);
    if (existing.flowStatus === 'pending') {
      throw new BadRequestException('拜访记录审批中，不允许发起变更，请先撤回审批');
    }
    if (existing.flowStatus !== 'approved') {
      throw new BadRequestException('只有已审批通过的拜访记录需要发起变更审批');
    }
    if (dto.version !== undefined && dto.version !== existing.version) {
      throw new ConflictException(
        `数据已被其他用户修改，当前版本 ${existing.version}。请刷新后重试。`
      );
    }

    const resolvedLocation = await this.resolveUpdateLocation(dto, existing);
    const patch = stripUndefinedField(
      {
        ...dto,
        ...(resolvedLocation && {
          signAddress: resolvedLocation.signAddress,
          signLocation: resolvedLocation.signLocation,
        }),
      },
      ['version']
    );
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('没有可提交审批的变更内容');
    }

    const targetName =
      existing.customer?.customerName ?? existing.signAddress ?? existing.id.slice(0, 8);
    const baseVersion = requireVersion(existing.version);

    return this.businessApprovalService.submitChangeApproval(
      {
        eventType: APPROVAL_EVENT_TYPE.VISIT_CHANGE,
        targetType: APPROVAL_CHANGE_TARGET_TYPE.VISIT_RECORD,
        targetId: id,
        targetCode: existing.id.slice(0, 8),
        title: `拜访变更｜${targetName}`,
        baseVersion,
        patch,
        beforeSnapshot: existing as unknown as Record<string, unknown>,
        afterSnapshot: { ...(existing as unknown as Record<string, unknown>), ...patch },
      },
      currentUser
    );
  }

  /**
   * 删除拜访记录（软删除）
   */
  async remove(
    id: string,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null,
    requestVersion?: number
  ): Promise<void> {
    const requiredVersion = requirePositiveVersion(requestVersion, '删除拜访记录');
    // 只有事务外鉴权快照的 version 与请求一致且后续 CAS 成功时，其 old customerId 才可信。
    const record = await this.findOne(id, chargerScope, currentEmployeeId);
    this.businessApprovalService.assertCanDelete(record.flowStatus, '拜访记录');
    if (record.version !== requiredVersion) {
      throw new ConflictException(
        `数据已被其他用户修改，当前版本 ${record.version}。请刷新后重试。`
      );
    }
    const customerId = record.customerId;

    const removeInTransaction = async (tx: Prisma.TransactionClient) => {
      const updated = await tx.visitRecord.update({
        where: { id, version: requiredVersion },
        data: {
          deletedAt: new Date(),
          ...auditUpdate(currentUser),
          version: { increment: 1 },
        },
      });
      await this.customersService.refreshCustomerLifecycle(customerId, currentUser, tx);
      return updated;
    };

    let deleted: Awaited<ReturnType<typeof removeInTransaction>>;
    try {
      deleted = await this.prisma.$transaction(removeInTransaction);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException(
          `数据已被其他用户修改，当前版本 ${record.version}。请刷新后重试。`
        );
      }
      throw error;
    }

    await this.changeLog?.logChange({
      module: 'visit-records',
      action: 'delete',
      target: id,
      targetName: record.signAddress ?? record.customer?.customerName ?? null,
      currentUser,
      before: record,
      after: deleted,
    });
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

  private buildLegacyFilters(query: QueryVisitRecordDto): Record<string, unknown> {
    return {
      customerId: query.customerId,
      contactId: query.contactId,
      visitType: query.visitType,
    };
  }

  private async resolveUpdateLocation(
    dto: UpdateVisitRecordDto,
    existing: VisitRecordResponseOutput
  ) {
    if (dto.signAddress === undefined && dto.signLocation === undefined) return null;

    const locationChanged =
      dto.signLocation !== undefined && dto.signLocation !== existing.signLocation;
    const candidateAddress =
      dto.signAddress !== undefined
        ? dto.signAddress
        : locationChanged
          ? null
          : existing.signAddress;
    const candidateLocation =
      dto.signLocation !== undefined ? dto.signLocation : existing.signLocation;
    return this.reverseGeocodeService.ensureAddress(candidateAddress, candidateLocation);
  }
}

function stripUndefinedField<T extends object>(
  input: T,
  omit: string[] = []
): Record<string, unknown> {
  const omitted = new Set(omit);
  return Object.fromEntries(
    Object.entries(input).filter(([key, value]) => !omitted.has(key) && value !== undefined)
  );
}

function requireVersion(version: number | undefined): number {
  if (version === undefined) {
    throw new BadRequestException('单据缺少版本号，无法发起变更审批');
  }
  return version;
}

function requirePositiveVersion(raw: number | undefined, action: string): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
    throw new BadRequestException(`${action}必须携带有效的 version`);
  }
  return raw;
}
