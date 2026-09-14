import {
  DEAL_STATUS,
  OPPORTUNITY_STAGE,
  PAYMENT_DIRECTION,
  SALES_ACTION_ITEM_DONE_TYPE,
} from '@ky-azeroth/shared/constants/status-values';
import {
  createSalesActionItemSchema,
  type DoneSalesActionItemInput,
  type SalesActionItemCustomerInfoOutput,
  type SalesActionItemResponseOutput,
  sanitizeSalesActionEvidence,
  updateSalesActionItemSchema,
} from '@ky-azeroth/shared/schemas/sales-action-item';
import type { ISalesActionItemAiDraft } from '@ky-azeroth/shared/types/sales-action-item';
import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { FilterApplierService } from '../../common/filter-scheme';
import type { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import { auditCreate, auditUpdate } from '../../common/utils/audit-helper';
import { fromJsonValue, toJsonValue } from '../../common/utils/json-type-helpers';
import { resolveOrderBy } from '../../common/utils/order-by.helper';
import { calculatePagination, serializeEntity } from '../../common/utils/response-helpers';
import { ACTIVE_EMPLOYEE_WHERE } from '../employees/employees.helper';
import { KeepRecordsService } from '../keep-records/keep-records.service';
import { CreateSalesActionItemDto } from './dto/create-sales-action-item.dto';
import { QuerySalesActionItemDto } from './dto/query-sales-action-item.dto';
import { UpdateSalesActionItemDto } from './dto/update-sales-action-item.dto';
import { SALES_ACTION_ITEMS_FILTER_REGISTRY } from './sales-action-items.filter-registry';

/**
 * 销售待办列表允许的排序字段白名单。
 * 默认 fallback 为 [priority desc, createdAt desc]（高优先级优先、同分新→旧）。
 * 注：customerName 不在此白名单——它非表字段，是 service 内存 resolveCustomerMap 反查的，
 * 若要支持需 denormalize 一列 + 回填 migration。
 */
const SALES_ACTION_ITEM_SORT_WHITELIST: ReadonlySet<string> = new Set([
  'priority',
  'createdAt',
  'updatedAt',
  'resolvedAt',
]);

const SALES_ACTION_ITEM_DEFAULT_ORDER: Prisma.SalesActionItemOrderByWithRelationInput[] = [
  { priority: 'desc' },
  { createdAt: 'desc' },
];

/** 处置动作允许的前置状态：仅 pending 可处置（防双击/多端） */
const PENDING = 'pending';
const DONE = 'done';
const SNOOZED = 'snoozed';
const TRANSFERRED = 'transferred';
const FOLLOW_RECORDED = SALES_ACTION_ITEM_DONE_TYPE.FOLLOW_RECORDED;
const ACTIVE_ASSIGNMENT_STATUSES = [PENDING, SNOOZED];

/** 当前用户最小契约（HTTP 走 JWT、cron 构造 {id,employeeId} 即可，无需真实 JWT） */
type ActorUser = { id: string; employeeId?: string | null };

type SalesActionRecordForCustomer = {
  id: string;
  refType: string | null;
  refId: string | null;
  aiDraft: Prisma.JsonValue | null;
};

type PendingActionRecord = SalesActionRecordForCustomer & {
  employeeId: string;
  status: string;
  version: number;
};

type DoneKeepRecordInput = NonNullable<DoneSalesActionItemInput['keepRecord']>;

type SalesActionValidationError = {
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>;
};

function salesActionValidationException(error: SalesActionValidationError): BadRequestException {
  const issue = error.issues[0];
  const path = issue?.path.map(String).join('.') || 'body';
  return new BadRequestException(
    `销售待办参数校验失败（${path}）：${issue?.message ?? '输入不合法'}`
  );
}

function parseCreateSalesActionItemInput(input: unknown) {
  const result = createSalesActionItemSchema.safeParse(input);
  if (!result.success) throw salesActionValidationException(result.error);
  return result.data;
}

function parseUpdateSalesActionItemInput(input: unknown) {
  const result = updateSalesActionItemSchema.safeParse(input);
  if (!result.success) throw salesActionValidationException(result.error);
  return result.data;
}

@Injectable()
export class SalesActionItemsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => KeepRecordsService))
    private readonly keepRecordsService: KeepRecordsService,
    private readonly filterApplier: FilterApplierService
  ) {}

  // ============================================================
  // 标准 CRUD
  // ============================================================

  /**
   * 创建待办（夜间 cron / 管理端建待办）。
   * 注意：夜间防重首选 upsertCandidate（按活跃 partial unique 去重 + merge evidence），
   * 本 create 用于一次性/管理端建单。
   */
  async create(
    dto: CreateSalesActionItemDto,
    currentUser: ActorUser
  ): Promise<SalesActionItemResponseOutput> {
    const input = parseCreateSalesActionItemInput(dto);
    const record = await this.prisma.salesActionItem.create({
      data: {
        employeeId: input.employeeId,
        category: input.category,
        priority: input.priority,
        refType: input.refType ?? undefined,
        refId: input.refId ?? undefined,
        title: input.title,
        reason: input.reason,
        suggestedAction: input.suggestedAction ?? undefined,
        aiDraft: input.aiDraft ? toJsonValue(input.aiDraft) : undefined,
        evidence: input.evidence ? toJsonValue(input.evidence) : undefined,
        confidence: input.confidence,
        dedupKey: input.dedupKey,
        sourceRunId: input.sourceRunId ?? undefined,
        createdVia: input.createdVia ?? undefined,
        ...auditCreate(currentUser),
      },
    });
    return this.serialize(record);
  }

  /**
   * 列表查询（管理端 GET /：ADMIN/林审批 按 employeeId/sourceRunId/status/category 筛）。
   * scope 注入：employeeId IN scope（非 null 时）。
   * 全员视图（管理端，forceEmployeeId 为空）对【当前页】pending 项就地重算 auto-expire（开销随当前页 pending 数，
   * 不全表扫）；findMine 走 forceEmployeeId 分支、已在入口 autoExpireForEmployee 全量重算，此处跳过避免重复。
   */
  async findAll(
    query: QuerySalesActionItemDto,
    scope?: string[] | null,
    forceEmployeeId?: string,
    rawQuery?: unknown
  ): Promise<PaginatedResponse<SalesActionItemResponseOutput>> {
    const { page = 1, pageSize = 20, sortBy, sortOrder } = query;
    const { skip } = calculatePagination(page, pageSize);

    const baseWhere: Prisma.SalesActionItemWhereInput = { deletedAt: null };
    if (forceEmployeeId) {
      baseWhere.employeeId = forceEmployeeId;
    }

    const where = await this.filterApplier.buildWhere<Prisma.SalesActionItemWhereInput>({
      registry: SALES_ACTION_ITEMS_FILTER_REGISTRY,
      rawQuery,
      legacyKeyword: query.keyword,
      legacyFilters: this.buildLegacyFilters(query),
      chargerScope: forceEmployeeId ? [forceEmployeeId] : (scope ?? null),
      baseWhere,
    });

    // 排序策略：
    //  - 未传 sortBy / 传 'priority' → 复合排序 [priority desc, createdAt desc]（保留原优先级语义）
    //  - 其他白名单字段（createdAt / updatedAt / resolvedAt）→ 单字段 + createdAt tiebreaker（分页稳定）
    //  - 非白名单字段 → 兜底为 DEFAULT_ORDER
    let orderBy: Prisma.SalesActionItemOrderByWithRelationInput[];
    if (!sortBy || sortBy === 'priority') {
      orderBy = SALES_ACTION_ITEM_DEFAULT_ORDER;
    } else if (SALES_ACTION_ITEM_SORT_WHITELIST.has(sortBy)) {
      const primary = resolveOrderBy<Prisma.SalesActionItemOrderByWithRelationInput>(
        sortBy,
        sortOrder,
        {
          whitelist: SALES_ACTION_ITEM_SORT_WHITELIST,
          fallback: { createdAt: 'desc' },
        }
      );
      orderBy = sortBy === 'createdAt' ? [primary] : [primary, { createdAt: 'desc' }];
    } else {
      orderBy = SALES_ACTION_ITEM_DEFAULT_ORDER;
    }

    const [total, items] = await Promise.all([
      this.prisma.salesActionItem.count({ where }),
      this.prisma.salesActionItem.findMany({
        where,
        skip,
        take: pageSize,
        orderBy,
        include: {
          employee: { select: { id: true, name: true } },
          resolvedBy: { select: { id: true, name: true } },
        },
      }),
    ]);

    // 全员视图（管理端）对当前页 pending 项就地重算 auto-expire；findMine（forceEmployeeId）已全量重算，跳过。
    const expiredSet = forceEmployeeId
      ? new Set<string>()
      : await this.expireRecoveredInPage(items);

    const customerMap = await this.resolveCustomerMap(items);

    return {
      items: items.map((item) =>
        this.serialize(
          expiredSet.has(item.id) ? { ...item, status: 'auto_expired' } : item,
          customerMap.get(item.id)
        )
      ),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 我的待办（强制 employeeId = user.id）。
   * 展示前对结果做 auto-expire 重算（对应缺口已被其它动作回收 → auto_expired）。
   */
  async findMine(
    query: QuerySalesActionItemDto,
    employeeId: string,
    rawQuery?: unknown
  ): Promise<PaginatedResponse<SalesActionItemResponseOutput>> {
    // 展示前重算：把已被回收的 pending 置 auto_expired（做完消失=正反馈）
    await this.autoExpireForEmployee(employeeId);
    return this.findAll(query, undefined, employeeId, rawQuery);
  }

  /** 我的未处理数量（卡片 badge / 红点）。category 可选过滤 */
  async countMine(employeeId: string, category?: string[]): Promise<{ count: number }> {
    await this.autoExpireForEmployee(employeeId);
    const where: Prisma.SalesActionItemWhereInput = {
      deletedAt: null,
      employeeId,
      status: PENDING,
    };
    if (category?.length) where.category = { in: category };
    const count = await this.prisma.salesActionItem.count({ where });
    return { count };
  }

  /**
   * 单条详情（校验归属：非本人且非 ADMIN 返 403 由 controller 经 scope 决定；
   * 此处 scope=null=ADMIN 全可见，否则限定 employeeId IN scope）。
   */
  async findOne(id: string, scope?: string[] | null): Promise<SalesActionItemResponseOutput> {
    const record = await this.findEntityOrThrow(id, scope);
    const customerMap = await this.resolveCustomerMap([record]);
    return this.serialize(record, customerMap.get(record.id));
  }

  /**
   * 更新（乐观锁 version + P2025→Conflict）。
   * 仅管理端/内部修正用；处置动作走专用方法。
   */
  async update(
    id: string,
    dto: UpdateSalesActionItemDto,
    currentUser: ActorUser,
    scope?: string[] | null
  ): Promise<SalesActionItemResponseOutput> {
    const input = parseUpdateSalesActionItemInput(dto);
    const existing = await this.findEntityOrThrow(id, scope);
    const { version: requestVersion } = input;

    try {
      const record = await this.prisma.salesActionItem.update({
        where: {
          id,
          ...(requestVersion !== undefined ? { version: requestVersion } : {}),
        },
        data: {
          ...(input.category !== undefined && { category: input.category }),
          ...(input.priority !== undefined && { priority: input.priority }),
          ...(input.refType !== undefined && { refType: input.refType }),
          ...(input.refId !== undefined && { refId: input.refId }),
          ...(input.title !== undefined && { title: input.title }),
          ...(input.reason !== undefined && { reason: input.reason }),
          ...(input.suggestedAction !== undefined && {
            suggestedAction: input.suggestedAction,
          }),
          ...(input.aiDraft !== undefined && {
            aiDraft: input.aiDraft ? toJsonValue(input.aiDraft) : Prisma.JsonNull,
          }),
          ...(input.evidence !== undefined && {
            evidence: input.evidence ? toJsonValue(input.evidence) : Prisma.JsonNull,
          }),
          ...(input.confidence !== undefined && { confidence: input.confidence }),
          ...(input.sourceRunId !== undefined && { sourceRunId: input.sourceRunId }),
          ...auditUpdate(currentUser),
          version: { increment: 1 },
        },
      });
      return this.serialize(record);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException(
          `数据已被其他用户修改，当前版本 ${existing.version}。请刷新后重试。`
        );
      }
      throw error;
    }
  }

  /** 删除（软删） */
  async remove(id: string, currentUser: ActorUser, scope?: string[] | null): Promise<void> {
    await this.findEntityOrThrow(id, scope);
    await this.prisma.salesActionItem.update({
      where: { id },
      data: { deletedAt: new Date(), ...auditUpdate(currentUser) },
    });
  }

  // ============================================================
  // 夜间 cron 防重 upsert
  // ============================================================

  /**
   * 按 (employeeId, dedupKey) 活跃 partial unique 去重 upsert（夜间 cron 用）。
   * 已存在未处理(pending/snoozed)同 dedupKey → 更新 evidence/priority/reason 等、不新建；
   * 否则新建。对应交底 6.1 partial unique index + 设计稿"查重 merge evidence"。
   *
   * 入参 asEmployee 仅需 {id, employeeId}，无需真实 JWT（cron 以销售身份写候选）。
   */
  async upsertCandidate(
    dto: CreateSalesActionItemDto,
    asEmployee: ActorUser
  ): Promise<SalesActionItemResponseOutput> {
    const input = parseCreateSalesActionItemInput(dto);

    // 抽出合并逻辑，供首次命中与 P2002 回退共用：查活跃同类（pending/snoozed + 未软删）并合并。
    const tryMergeExisting = async (): Promise<SalesActionItemResponseOutput | null> => {
      const existing = await this.prisma.salesActionItem.findFirst({
        where: {
          employeeId: input.employeeId,
          dedupKey: input.dedupKey,
          status: { in: ['pending', 'snoozed'] },
          deletedAt: null,
        },
      });
      if (!existing) return null;
      const merged = await this.prisma.salesActionItem.update({
        where: { id: existing.id },
        data: {
          // 刷新可变内容（合并 evidence、更新优先级与措辞），保留状态与 remindCount
          category: input.category,
          priority: input.priority,
          refType: input.refType ?? undefined,
          refId: input.refId ?? undefined,
          title: input.title,
          reason: input.reason,
          suggestedAction: input.suggestedAction ?? undefined,
          aiDraft: input.aiDraft ? toJsonValue(input.aiDraft) : undefined,
          evidence: input.evidence ? toJsonValue(input.evidence) : undefined,
          confidence: input.confidence,
          sourceRunId: input.sourceRunId ?? undefined,
          remindCount: { increment: 1 },
          ...auditUpdate(asEmployee),
        },
      });
      return this.serialize(merged);
    };

    // 1) 先尝试合并已存在的活跃项
    const mergedFirst = await tryMergeExisting();
    if (mergedFirst) return mergedFirst;

    // 2) 不存在 → create；若与并发请求 race 撞活跃 partial unique（sales_action_items_active_uniq），
    //    catch P2002 后回退再合并到对方刚建的行（标准「乐观 create、撞唯一约束再合并」幂等模式，
    //    不冒泡 500、不堆重复待办）。
    try {
      return await this.create(input, asEmployee);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const mergedRetry = await tryMergeExisting();
        if (mergedRetry) return mergedRetry;
        // 极端：撞 P2002 但回查不到活跃行（对方刚把状态改走）→ 再 create 一次。
        return await this.create(input, asEmployee);
      }
      throw error;
    }
  }

  // ============================================================
  // 处置动作（adopt / ignore / done / undo）
  // ============================================================

  /**
   * 一键采纳（adopt）。写错客户的最后机器闸门（D6 / Codex A4）。
   *
   * 强校验：aiDraft 必须含 kind='keep_record' + matchMode='FULL_NAME_EXPLICIT'
   * + matchedCustomerId + matchedFullName + evidenceMessageId，缺一拒绝（抛错，绝不静默写）。
   * 仅 keep_record kind 放行；订单/回款/发票一律拒绝。
   * 满足后复用 KeepRecordsService.create()（同套校验、不绕业务规则）写跟进记录，
   * 回填 resultType/resultId/source='action_item'/sourceActionItemId，置 adopted。
   */
  async adopt(
    id: string,
    currentUser: ActorUser,
    scope?: string[] | null
  ): Promise<SalesActionItemResponseOutput> {
    const record = await this.findEntityOrThrow(id, scope);

    // 防双击：非 pending 直接返回当前状态、不抛错
    if (record.status !== PENDING) {
      return this.serialize(record);
    }

    const draft = fromJsonValue<ISalesActionItemAiDraft>(record.aiDraft as Prisma.JsonValue);
    // 校验在事务外，纯计算无副作用，失败直接抛（根本不进事务、不写库）。
    this.assertAdoptableDraft(draft);

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        // (1) 原子抢占：带前置 status=PENDING + version 的条件更新（CAS）。
        // 复用本文件 autoExpireForEmployee 的 updateMany 守卫范式：命中 0 行即冲突。
        const guard = await tx.salesActionItem.updateMany({
          where: { id, status: PENDING, version: record.version },
          data: {
            status: 'adopted',
            resultType: 'keep_record',
            resolvedAt: new Date(),
            resolvedById: currentUser.employeeId ?? currentUser.id,
            ...auditUpdate(currentUser),
            version: { increment: 1 },
          },
        });
        // 命中 0 行 = 已被其它请求/版本抢先 → 抛出，让事务回滚、外层转 409。
        // 注意：adopt 的 count===0 选择抛 409（区别于 ignore/done 的「非 pending 不报错」幂等契约）——
        // 因为 adopt race 失败若静默返回，前端会以为采纳成功但实际是另一请求采纳的、本请求没写自己的跟进记录。
        if (guard.count === 0) {
          throw new ConflictException('该待办已被处理或已被其他用户修改，请刷新后重试。');
        }

        // (2) 抢到了才写跟进记录；KeepRecordsService 会用同一 tx 完成客户生命周期刷新。
        const keepRecord = await this.keepRecordsService.create(
          {
            customerId: draft.payload.customerId,
            contactId: draft.payload.contactId ?? null,
            keepRecordType: draft.payload.keepRecordType,
            keepRecordTime: draft.payload.keepRecordTime,
            keepRecordContent: draft.payload.keepRecordContent,
            // 跟进状态：草稿未给则默认「客户维护」（钉钉同步类多为日常维护）
            keepRecordStatus: '客户维护',
            // chargerId 兜底为收件销售本人（采纳者归属）
            chargerId: record.employeeId,
            source: 'action_item',
            sourceActionItemId: record.id,
          },
          currentUser,
          { tx }
        );

        // (3) 回填 resultId（拿到 keepRecord.id 后再写一次，仍在事务内）。
        const updated = await tx.salesActionItem.update({
          where: { id },
          data: { resultId: keepRecord.id },
        });

        return updated;
      });

      return this.serialize(updated);
    } catch (error) {
      // updateMany 命中 0 行返回 count:0（不抛 P2025），故这里只兜底真正的 P2025（极端并发软删等）。
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException('数据已被其他用户修改，请刷新后重试。');
      }
      throw error;
    }
  }

  /** 忽略（必填 resolveNote，D7）。非 pending 返回当前状态、不抛错 */
  async ignore(
    id: string,
    resolveNote: string,
    currentUser: ActorUser,
    scope?: string[] | null
  ): Promise<SalesActionItemResponseOutput> {
    const record = await this.findEntityOrThrow(id, scope);
    // 快路径：非 pending 直接返回当前状态、不抛错。
    if (record.status !== PENDING) {
      return this.serialize(record);
    }
    // 原子守卫：带前置 status=PENDING（与 autoExpireForEmployee 同款）。
    // count===0 = 并发已被处置：保持「非 pending 不报错」契约（区别于 adopt 抛 409），返回当前状态。
    await this.prisma.salesActionItem.updateMany({
      where: { id, status: PENDING },
      data: {
        status: 'ignored',
        resolveNote,
        resolvedAt: new Date(),
        resolvedById: currentUser.employeeId ?? currentUser.id,
        ...auditUpdate(currentUser),
        version: { increment: 1 },
      },
    });
    return this.serialize(await this.findEntityOrThrow(id, scope));
  }

  /** 标记已办（doneType + resolveNote 必填）。非 pending 返回当前状态、不抛错 */
  async done(
    id: string,
    resolveNote: string,
    doneType: string,
    currentUser: ActorUser,
    scope?: string[] | null,
    keepRecordInput?: DoneSalesActionItemInput['keepRecord']
  ): Promise<SalesActionItemResponseOutput> {
    const record = await this.findEntityOrThrow(id, scope);
    // 快路径：非 pending 直接返回当前状态、不抛错。
    if (record.status !== PENDING) {
      return this.serialize(record);
    }

    if (doneType === FOLLOW_RECORDED) {
      if (!keepRecordInput) {
        throw new BadRequestException('选择跟进情况时必须填写跟进记录');
      }
      return this.doneWithKeepRecord(record, resolveNote, doneType, keepRecordInput, currentUser);
    }

    if (keepRecordInput) {
      throw new BadRequestException('只有办结类型为跟进情况时才能同步跟进记录');
    }

    // 原子守卫：带前置 status=PENDING。count===0（并发已被处置）保持「非 pending 不报错」契约，返回当前状态。
    await this.prisma.salesActionItem.updateMany({
      where: { id, status: PENDING },
      data: {
        status: 'done',
        resolveNote,
        doneType,
        resolvedAt: new Date(),
        resolvedById: currentUser.employeeId ?? currentUser.id,
        ...auditUpdate(currentUser),
        version: { increment: 1 },
      },
    });
    return this.serialize(await this.findEntityOrThrow(id, scope));
  }

  /** 标记已办并同步生成跟进记录。 */
  private async doneWithKeepRecord(
    record: PendingActionRecord,
    resolveNote: string,
    doneType: string,
    keepRecordInput: DoneKeepRecordInput,
    currentUser: ActorUser
  ): Promise<SalesActionItemResponseOutput> {
    const customer = (await this.resolveCustomerMap([record])).get(record.id);
    if (!customer) {
      throw new BadRequestException(
        '无法从待办结构化关联解析客户，不能自动同步跟进记录。请进入客户或商机详情手动补录。'
      );
    }
    await this.assertContactBelongsToCustomer(keepRecordInput.contactId, customer.id);

    const updated = await this.prisma.$transaction(async (tx) => {
      const guard = await tx.salesActionItem.updateMany({
        where: { id: record.id, status: PENDING, version: record.version },
        data: {
          status: DONE,
          resolveNote,
          doneType,
          resultType: 'keep_record',
          resolvedAt: new Date(),
          resolvedById: currentUser.employeeId ?? currentUser.id,
          ...auditUpdate(currentUser),
          version: { increment: 1 },
        },
      });

      if (guard.count === 0) {
        throw new ConflictException('该待办已被处理或已被其他用户修改，请刷新后重试。');
      }

      const keepRecord = await this.keepRecordsService.create(
        {
          customerId: customer.id,
          contactId: keepRecordInput.contactId ?? null,
          keepRecordType: keepRecordInput.keepRecordType,
          keepRecordTime: keepRecordInput.keepRecordTime,
          keepRecordContent: keepRecordInput.keepRecordContent,
          keepRecordStatus: keepRecordInput.keepRecordStatus,
          chargerId: record.employeeId,
          source: 'action_item',
          sourceActionItemId: record.id,
        },
        currentUser,
        { tx }
      );

      const updated = await tx.salesActionItem.update({
        where: { id: record.id },
        data: { resultId: keepRecord.id },
      });

      return updated;
    });

    return this.serialize(updated);
  }

  /**
   * 转交待办：源待办置 transferred，目标员工获得一条 pending 待办。
   *
   * 不直接原地改 employeeId，原因：
   * - employeeId 参与夜间 dedupKey 活跃唯一约束；
   * - 原地改会让旧负责人侧失去已转交流转记录，也可能触发次日重复生成。
   */
  async transfer(
    id: string,
    targetEmployeeId: string,
    reason: string,
    currentUser: ActorUser,
    scope?: string[] | null
  ): Promise<SalesActionItemResponseOutput> {
    const record = await this.findEntityOrThrow(id, scope);

    if (!ACTIVE_ASSIGNMENT_STATUSES.includes(record.status)) {
      throw new BadRequestException(`仅待处理/已稍后的待办可转交，当前状态：${record.status}`);
    }
    if (targetEmployeeId === record.employeeId) {
      throw new BadRequestException('转交对象不能与当前收件销售相同');
    }

    const targetEmployee = await this.prisma.employee.findFirst({
      where: { ...ACTIVE_EMPLOYEE_WHERE, id: targetEmployeeId },
      select: { id: true, name: true },
    });
    if (!targetEmployee) {
      throw new NotFoundException(`员工 ${targetEmployeeId} 不存在或已停用`);
    }

    const actorEmployeeId = currentUser.employeeId ?? currentUser.id;
    const transferNote = `转交给${targetEmployee.name}：${reason}`;
    // 历史 JSON 可能早于 strict evidence 契约：进入事务前先白名单重建，绝不复制原对象。
    const sanitizedEvidence = sanitizeSalesActionEvidence(record.evidence);

    try {
      const targetId = await this.prisma.$transaction(async (tx) => {
        const existingTarget = await tx.salesActionItem.findFirst({
          where: {
            employeeId: targetEmployeeId,
            dedupKey: record.dedupKey,
            status: { in: ACTIVE_ASSIGNMENT_STATUSES },
            deletedAt: null,
          },
          select: { id: true },
        });

        const target = existingTarget
          ? await tx.salesActionItem.update({
              where: { id: existingTarget.id },
              data: {
                remindCount: { increment: 1 },
                ...auditUpdate(currentUser),
                version: { increment: 1 },
              },
            })
          : await tx.salesActionItem.create({
              data: {
                employeeId: targetEmployeeId,
                category: record.category,
                priority: record.priority,
                refType: record.refType ?? undefined,
                refId: record.refId ?? undefined,
                title: record.title,
                reason: record.reason,
                suggestedAction: record.suggestedAction ?? undefined,
                aiDraft: toJsonValue(record.aiDraft),
                evidence: toJsonValue(sanitizedEvidence),
                confidence: record.confidence,
                dedupKey: record.dedupKey,
                sourceRunId: record.sourceRunId ?? undefined,
                createdVia: 'transfer',
                ...auditCreate(currentUser),
              },
            });

        const guard = await tx.salesActionItem.updateMany({
          where: {
            id,
            status: { in: ACTIVE_ASSIGNMENT_STATUSES },
            version: record.version,
          },
          data: {
            status: TRANSFERRED,
            resolveNote: transferNote,
            resultType: 'sales_action_item',
            resultId: target.id,
            resolvedAt: new Date(),
            resolvedById: actorEmployeeId,
            ...auditUpdate(currentUser),
            version: { increment: 1 },
          },
        });
        if (guard.count === 0) {
          throw new ConflictException('该待办已被处理或已被其他用户修改，请刷新后重试。');
        }

        await tx.operationLog.create({
          data: {
            employeeId: actorEmployeeId,
            module: 'sales_action_items',
            action: 'transfer',
            target: id,
            details: toJsonValue({
              sourceItemId: id,
              targetItemId: target.id,
              fromEmployeeId: record.employeeId,
              toEmployeeId: targetEmployeeId,
              reason,
              mergedIntoExisting: Boolean(existingTarget),
            }),
          },
        });

        return target.id;
      });

      return this.findOne(targetId, null);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException('该待办已被处理或已被其他用户修改，请刷新后重试。');
      }
      throw error;
    }
  }

  /** 撤回已办：仅 done 可回 pending；若本次办结自动生成了跟进记录，同步软删回收。 */
  async reopen(
    id: string,
    currentUser: ActorUser,
    scope?: string[] | null
  ): Promise<SalesActionItemResponseOutput> {
    const record = await this.findEntityOrThrow(id, scope);

    if (record.status !== DONE) {
      throw new BadRequestException(`仅已办结的待办可改回待办，当前状态：${record.status}`);
    }

    const hasGeneratedKeepRecord = record.resultType === 'keep_record' && !!record.resultId;
    const guard = await this.prisma.$transaction(async (tx) => {
      const guard = await tx.salesActionItem.updateMany({
        where: { id, status: DONE, version: record.version },
        data: {
          status: PENDING,
          resolveNote: null,
          doneType: null,
          resultType: null,
          resultId: null,
          resolvedAt: null,
          resolvedById: null,
          ...auditUpdate(currentUser),
          version: { increment: 1 },
        },
      });

      if (guard.count > 0 && hasGeneratedKeepRecord && record.resultId) {
        const keep = await tx.keepRecord.findUnique({
          where: { id: record.resultId },
          select: { version: true },
        });
        await this.keepRecordsService.remove(
          record.resultId,
          currentUser,
          null,
          currentUser.id,
          keep?.version,
          { tx }
        );
      }

      return guard;
    });

    if (guard.count === 0) {
      throw new ConflictException('该待办状态已变化，请刷新后重试。');
    }

    return this.serialize(await this.findEntityOrThrow(id, scope));
  }

  /**
   * 撤销已采纳（undo）。软删 resultId 指向的 keep_record，待办回 pending。
   * 权限/时间窗：限当日（resolvedAt 为今天）或 ADMIN。
   */
  async undo(
    id: string,
    currentUser: ActorUser,
    isAdmin: boolean,
    scope?: string[] | null
  ): Promise<SalesActionItemResponseOutput> {
    const record = await this.findEntityOrThrow(id, scope);

    if (record.status !== 'adopted') {
      throw new BadRequestException(`仅已采纳的待办可撤销，当前状态：${record.status}`);
    }

    // 时间窗：非 ADMIN 仅限当日撤销
    if (!isAdmin && !this.isSameDay(record.resolvedAt, new Date())) {
      throw new BadRequestException('撤销仅限当日；如需撤销历史采纳请联系管理员。');
    }

    const hasKeepRecord = record.resultType === 'keep_record' && !!record.resultId;

    const updated = await this.prisma.$transaction(async (tx) => {
      // CAS 抢占：带前置 status='adopted' + version，命中 0 行即冲突回滚 → 外层转 409。
      const guard = await tx.salesActionItem.updateMany({
        where: { id, status: 'adopted', version: record.version },
        data: {
          status: PENDING,
          resultType: null,
          resultId: null,
          resolvedAt: null,
          resolvedById: null,
          ...auditUpdate(currentUser),
          version: { increment: 1 },
        },
      });
      if (guard.count === 0) {
        throw new ConflictException('该待办状态已变化，请刷新后重试。');
      }

      // 抢到才软删生成的跟进记录；KeepRecordsService 在同一 tx 内完成生命周期回算。
      if (hasKeepRecord && record.resultId) {
        const keep = await tx.keepRecord.findUnique({
          where: { id: record.resultId },
          select: { version: true },
        });
        await this.keepRecordsService.remove(
          record.resultId,
          currentUser,
          null,
          currentUser.id,
          keep?.version,
          { tx }
        );
      }

      return tx.salesActionItem.findUniqueOrThrow({ where: { id } });
    });

    return this.serialize(updated);
  }

  private buildLegacyFilters(query: QuerySalesActionItemDto): Record<string, unknown> {
    const filters: Record<string, unknown> = {};
    if (query.status?.length) filters.status = query.status;
    if (query.category?.length) filters.category = query.category;
    if (query.doneType?.length) filters.doneType = query.doneType;
    if (query.confidence?.length) filters.confidence = query.confidence;
    if (query.employeeId) filters.employeeId = query.employeeId;
    if (query.customerId?.length) filters.customerId = query.customerId;
    if (query.sourceRunId) filters.sourceRunId = query.sourceRunId;
    return filters;
  }

  // ============================================================
  // auto-expire（展示前/每日重算）
  // ============================================================

  /**
   * 对某销售名下的 pending 待办做 auto-expire 重算：
   * 对应商机已推进/客户已有新 keep|visit|回款（晚于待办创建时间）→ 置 auto_expired（做完消失=正反馈）。
   * 仅处理带 refType/refId 的待办；无 ref 的（纯软信号）保留。
   */
  async autoExpireForEmployee(employeeId: string): Promise<number> {
    const pendings = await this.prisma.salesActionItem.findMany({
      where: {
        employeeId,
        status: PENDING,
        deletedAt: null,
        refType: { not: null },
        refId: { not: null },
      },
      select: { id: true, refType: true, refId: true, createdAt: true, category: true },
    });
    if (pendings.length === 0) return 0;

    const expiredIds: string[] = [];
    for (const item of pendings) {
      if (!item.refId) continue;
      const recovered = await this.isGapRecovered(item.refType, item.refId, item.createdAt);
      if (recovered) expiredIds.push(item.id);
    }

    if (expiredIds.length === 0) return 0;
    const res = await this.prisma.salesActionItem.updateMany({
      where: { id: { in: expiredIds }, status: PENDING },
      data: { status: 'auto_expired', updatedAt: new Date() },
    });
    return res.count;
  }

  /**
   * 对一批「已查出的 item」就地重算 auto-expire（findAll 全员视图用）。
   * 把已被回收的 pending 项（带 refType/refId）在 DB 置 auto_expired，返回被失效的 id 集，
   * 供调用方同步修正返回给前端的内存状态。开销随传入 pending 数（分页内可控），不全表扫。
   */
  private async expireRecoveredInPage(
    items: Array<{
      id: string;
      status: string;
      refType: string | null;
      refId: string | null;
      createdAt: Date;
    }>
  ): Promise<Set<string>> {
    const candidates = items.filter((it) => it.status === PENDING && it.refType && it.refId);
    if (candidates.length === 0) return new Set();
    const expiredIds: string[] = [];
    for (const it of candidates) {
      if (!it.refId) continue;
      if (await this.isGapRecovered(it.refType, it.refId, it.createdAt)) {
        expiredIds.push(it.id);
      }
    }
    if (expiredIds.length === 0) return new Set();
    await this.prisma.salesActionItem.updateMany({
      where: { id: { in: expiredIds }, status: PENDING },
      data: { status: 'auto_expired', updatedAt: new Date() },
    });
    return new Set(expiredIds);
  }

  /**
   * 判断某缺口是否已被新动作回收（晚于 since）。
   * - Customer 类：客户有新 keep_record / visit_record / IN 回款；或商机已赢/已搁置
   * - Opportunity 类：商机 stage 已变（推进/赢单/输单）或 expectedDealDate 已改到未来
   */
  private async isGapRecovered(
    refType: string | null,
    refId: string,
    since: Date
  ): Promise<boolean> {
    if (refType === 'Customer') {
      const [keep, visit, payment] = await Promise.all([
        this.prisma.keepRecord.findFirst({
          where: { customerId: refId, deletedAt: null, createdAt: { gt: since } },
          select: { id: true },
        }),
        this.prisma.visitRecord.findFirst({
          where: { customerId: refId, deletedAt: null, createdAt: { gt: since } },
          select: { id: true },
        }),
        this.prisma.payment.findFirst({
          where: {
            customerId: refId,
            direction: PAYMENT_DIRECTION.IN,
            deletedAt: null,
            createdAt: { gt: since },
          },
          select: { id: true },
        }),
      ]);
      return Boolean(keep || visit || payment);
    }

    if (refType === 'Opportunity') {
      const opp = await this.prisma.opportunity.findFirst({
        where: { id: refId, deletedAt: null },
        select: { opportunityStage: true, updatedAt: true, expectedDealDate: true },
      });
      if (!opp) return true; // 商机已不存在 → 视为回收
      // 已赢/已输 → 回收
      if (
        opp.opportunityStage === OPPORTUNITY_STAGE.WON ||
        opp.opportunityStage === OPPORTUNITY_STAGE.LOST
      ) {
        return true;
      }
      // 待办创建后商机被改动（推进阶段/改期）→ 回收
      if (opp.updatedAt && opp.updatedAt.getTime() > since.getTime()) return true;
      return false;
    }

    return false;
  }

  // ============================================================
  // 缺口侦探只读查询（夜间 cron / 管理端用；派生字段只读，绝不写库）
  // ============================================================

  /**
   * 沉睡客户（客户失联）：S/A 级客户 lastKeepRecordTime 超阈值（交底简报②阈值 30 天）。
   * 照抄 crm-analytics getSleeping 口径，cutoff 改 30 天。chargerScope 限定到目标销售。
   */
  async getSleepingCustomers(
    chargerScope: string[] | null,
    days = 30
  ): Promise<
    Array<{
      customerId: string;
      customerName: string;
      customerLevel: string | null;
      chargerId: string | null;
      lastKeepRecordTime: string | null;
      daysSinceLastKeep: number | null;
    }>
  > {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const where: Prisma.CustomerWhereInput = {
      deletedAt: null,
      ...(Array.isArray(chargerScope) ? { chargerId: { in: chargerScope } } : {}),
      customerLevel: { in: ['S', 'A'] },
      OR: [{ lastKeepRecordTime: null }, { lastKeepRecordTime: { lt: cutoff } }],
      NOT: { dealStatus: { in: [DEAL_STATUS.WON, DEAL_STATUS.MULTI_WON] } },
    };
    const items = await this.prisma.customer.findMany({
      where,
      select: {
        id: true,
        customerName: true,
        customerLevel: true,
        chargerId: true,
        lastKeepRecordTime: true,
      },
      orderBy: [{ lastKeepRecordTime: 'asc' }],
      take: 500,
    });
    const now = Date.now();
    return items.map((c) => ({
      customerId: c.id,
      customerName: c.customerName,
      customerLevel: c.customerLevel ?? null,
      chargerId: c.chargerId,
      lastKeepRecordTime: c.lastKeepRecordTime?.toISOString() ?? null,
      daysSinceLastKeep: c.lastKeepRecordTime
        ? Math.floor((now - c.lastKeepRecordTime.getTime()) / 86400000)
        : null,
    }));
  }

  /**
   * 商机今天到期 / 已过期未成交未改期。
   * expectedDealDate <= 今天 且 stage NOT IN [赢单, 输单流失]。
   */
  async getDueOpportunities(chargerScope: string[] | null): Promise<
    Array<{
      opportunityId: string;
      opportunityName: string | null;
      customerId: string | null;
      opportunityStage: string | null;
      expectedDealDate: string | null;
      chargerId: string | null;
    }>
  > {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const where: Prisma.OpportunityWhereInput = {
      deletedAt: null,
      ...(Array.isArray(chargerScope) ? { chargerId: { in: chargerScope } } : {}),
      expectedDealDate: { lte: today },
      NOT: { opportunityStage: { in: [OPPORTUNITY_STAGE.WON, OPPORTUNITY_STAGE.LOST] } },
    };
    const items = await this.prisma.opportunity.findMany({
      where,
      select: {
        id: true,
        opportunityName: true,
        customerId: true,
        opportunityStage: true,
        expectedDealDate: true,
        chargerId: true,
      },
      orderBy: [{ expectedDealDate: 'asc' }],
      take: 500,
    });
    return items.map((o) => ({
      opportunityId: o.id,
      opportunityName: o.opportunityName ?? null,
      customerId: o.customerId,
      opportunityStage: o.opportunityStage,
      expectedDealDate: o.expectedDealDate ? o.expectedDealDate.toISOString().slice(0, 10) : null,
      chargerId: o.chargerId,
    }));
  }

  /**
   * 应收静默：客户 accountsReceivable > 0 且近 N 天无 IN 方向回款。
   * 应收 = 物化字段 accountsReceivable（=SUM 订单 totalUncollected）。
   * 静默 = 该客户最近一条 IN approved 回款 businessDate 距今超阈值（或从无回款）。
   */
  async getSilentReceivables(
    chargerScope: string[] | null,
    silentDays = 30
  ): Promise<
    Array<{
      customerId: string;
      customerName: string;
      chargerId: string | null;
      accountsReceivable: number;
      lastInPaymentDate: string | null;
      daysSinceLastIn: number | null;
    }>
  > {
    const customers = await this.prisma.customer.findMany({
      where: {
        deletedAt: null,
        ...(Array.isArray(chargerScope) ? { chargerId: { in: chargerScope } } : {}),
        accountsReceivable: { gt: 0 },
      },
      select: { id: true, customerName: true, chargerId: true, accountsReceivable: true },
      take: 500,
    });

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - silentDays);
    const now = Date.now();
    const result: Array<{
      customerId: string;
      customerName: string;
      chargerId: string | null;
      accountsReceivable: number;
      lastInPaymentDate: string | null;
      daysSinceLastIn: number | null;
    }> = [];

    for (const c of customers) {
      const lastIn = await this.prisma.payment.findFirst({
        where: { customerId: c.id, direction: PAYMENT_DIRECTION.IN, deletedAt: null },
        orderBy: { businessDate: 'desc' },
        select: { businessDate: true },
      });
      const lastDate = lastIn?.businessDate ?? null;
      const isSilent = !lastDate || lastDate.getTime() < cutoff.getTime();
      if (!isSilent) continue;
      result.push({
        customerId: c.id,
        customerName: c.customerName,
        chargerId: c.chargerId,
        accountsReceivable: c.accountsReceivable ? Number(c.accountsReceivable) : 0,
        lastInPaymentDate: lastDate?.toISOString().slice(0, 10) ?? null,
        daysSinceLastIn: lastDate ? Math.floor((now - lastDate.getTime()) / 86400000) : null,
      });
    }
    return result;
  }

  // ============================================================
  // 内部 helper
  // ============================================================

  /** 取实体并做归属可见性校验（scope=null=ADMIN 全可见，否则 employeeId 必须 IN scope） */
  private async findEntityOrThrow(id: string, scope?: string[] | null) {
    const where: Prisma.SalesActionItemWhereInput = { id, deletedAt: null };
    if (Array.isArray(scope)) where.employeeId = { in: scope };
    const record = await this.prisma.salesActionItem.findFirst({
      where,
      include: {
        employee: { select: { id: true, name: true } },
        resolvedBy: { select: { id: true, name: true } },
      },
    });
    if (!record) {
      throw new NotFoundException(`销售待办 ${id} 不存在或无权访问`);
    }
    return record;
  }

  /** D6 强校验：aiDraft 必须是可采纳的 keep_record 全称明确草稿，否则拒绝 */
  private assertAdoptableDraft(
    draft: ISalesActionItemAiDraft | null | undefined
  ): asserts draft is ISalesActionItemAiDraft {
    if (!draft || typeof draft !== 'object') {
      throw new BadRequestException('该待办无可采纳草稿（aiDraft 缺失），请走「去补充」手动录入。');
    }
    if (draft.kind !== 'keep_record') {
      throw new BadRequestException(
        `仅「跟进记录」草稿可一键采纳；订单/回款/发票等（kind=${String(draft.kind)}）一律请手动录入。`
      );
    }
    if (draft.matchMode !== 'FULL_NAME_EXPLICIT') {
      throw new BadRequestException(
        '客户匹配不够确定（需客户全称被明确点到），为防写错客户，请走「去补充」手动确认。'
      );
    }
    if (!draft.matchedCustomerId || !draft.matchedFullName || !draft.evidenceMessageId) {
      throw new BadRequestException(
        '采纳草稿缺少必要字段（matchedCustomerId / matchedFullName / evidenceMessageId），拒绝采纳。'
      );
    }
    if (!draft.payload?.customerId) {
      throw new BadRequestException('采纳草稿缺少 payload.customerId，拒绝采纳。');
    }
    // 一致性：草稿匹配客户必须与写入 payload 客户一致（防错配）
    if (draft.payload.customerId !== draft.matchedCustomerId) {
      throw new BadRequestException(
        '采纳草稿客户不一致（payload.customerId ≠ matchedCustomerId），拒绝采纳。'
      );
    }
  }

  private isSameDay(a: Date | null | undefined, b: Date): boolean {
    if (!a) return false;
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  private async assertContactBelongsToCustomer(
    contactId: string | null | undefined,
    customerId: string
  ): Promise<void> {
    if (!contactId) return;
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, customerId, deletedAt: null },
      select: { id: true },
    });
    if (!contact) {
      throw new BadRequestException('联系人不存在，或不属于该待办解析出的客户');
    }
  }

  /**
   * 只用结构化 UUID 解析待办关联客户：
   * - 优先 aiDraft.matchedCustomerId / aiDraft.payload.customerId
   * - 其次按 refType/refId 追到对应 CRM 实体的 customer 关系
   * - 解析不到就留空；禁止从 title/reason/evidence 文本里猜客户名
   */
  private async resolveCustomerMap(
    records: SalesActionRecordForCustomer[]
  ): Promise<Map<string, SalesActionItemCustomerInfoOutput>> {
    const result = new Map<string, SalesActionItemCustomerInfoOutput>();
    if (records.length === 0) return result;

    const directCustomerIds = new Set<string>();
    const directCustomerIdByRecordId = new Map<string, string>();
    const customerRefs = new Map<string, string[]>();
    const opportunityRefs = new Map<string, string[]>();
    const saleOrderRefs = new Map<string, string[]>();
    const paymentRefs = new Map<string, string[]>();
    const invoiceRefs = new Map<string, string[]>();
    const keepRecordRefs = new Map<string, string[]>();
    const visitRecordRefs = new Map<string, string[]>();
    const contactRefs = new Map<string, string[]>();

    const addRef = (bucket: Map<string, string[]>, refId: string, recordId: string) => {
      const existing = bucket.get(refId) ?? [];
      existing.push(recordId);
      bucket.set(refId, existing);
    };

    const normalizeRefType = (refType: string | null): string | null => {
      if (!refType) return null;
      return refType.toLowerCase().replace(/[\s_-]/g, '');
    };

    for (const record of records) {
      const draft = fromJsonValue<ISalesActionItemAiDraft>(record.aiDraft);
      const draftCustomerId = draft?.matchedCustomerId || draft?.payload?.customerId;
      if (draftCustomerId) {
        directCustomerIds.add(draftCustomerId);
        directCustomerIdByRecordId.set(record.id, draftCustomerId);
        continue;
      }

      if (!record.refId) continue;
      const refType = normalizeRefType(record.refType);
      switch (refType) {
        case 'customer':
          directCustomerIds.add(record.refId);
          directCustomerIdByRecordId.set(record.id, record.refId);
          addRef(customerRefs, record.refId, record.id);
          break;
        case 'opportunity':
          addRef(opportunityRefs, record.refId, record.id);
          break;
        case 'saleorder':
          addRef(saleOrderRefs, record.refId, record.id);
          break;
        case 'payment':
          addRef(paymentRefs, record.refId, record.id);
          break;
        case 'invoice':
          addRef(invoiceRefs, record.refId, record.id);
          break;
        case 'keeprecord':
          addRef(keepRecordRefs, record.refId, record.id);
          break;
        case 'visitrecord':
          addRef(visitRecordRefs, record.refId, record.id);
          break;
        case 'contact':
          addRef(contactRefs, record.refId, record.id);
          break;
      }
    }

    const customerIds = Array.from(directCustomerIds);
    const opportunityIds = Array.from(opportunityRefs.keys());
    const saleOrderIds = Array.from(saleOrderRefs.keys());
    const paymentIds = Array.from(paymentRefs.keys());
    const invoiceIds = Array.from(invoiceRefs.keys());
    const keepRecordIds = Array.from(keepRecordRefs.keys());
    const visitRecordIds = Array.from(visitRecordRefs.keys());
    const contactIds = Array.from(contactRefs.keys());

    const customerSelect = { id: true, customerName: true } as const;
    const refCustomerSelect = { id: true, customer: { select: customerSelect } } as const;

    const [
      customers,
      opportunities,
      saleOrders,
      payments,
      invoices,
      keepRecords,
      visitRecords,
      contacts,
    ] = await Promise.all([
      customerIds.length
        ? this.prisma.customer.findMany({
            where: { id: { in: customerIds } },
            select: customerSelect,
          })
        : Promise.resolve([]),
      opportunityIds.length
        ? this.prisma.opportunity.findMany({
            where: { id: { in: opportunityIds } },
            select: refCustomerSelect,
          })
        : Promise.resolve([]),
      saleOrderIds.length
        ? this.prisma.saleOrder.findMany({
            where: { id: { in: saleOrderIds } },
            select: refCustomerSelect,
          })
        : Promise.resolve([]),
      paymentIds.length
        ? this.prisma.payment.findMany({
            where: { id: { in: paymentIds } },
            select: refCustomerSelect,
          })
        : Promise.resolve([]),
      invoiceIds.length
        ? this.prisma.invoice.findMany({
            where: { id: { in: invoiceIds } },
            select: refCustomerSelect,
          })
        : Promise.resolve([]),
      keepRecordIds.length
        ? this.prisma.keepRecord.findMany({
            where: { id: { in: keepRecordIds } },
            select: refCustomerSelect,
          })
        : Promise.resolve([]),
      visitRecordIds.length
        ? this.prisma.visitRecord.findMany({
            where: { id: { in: visitRecordIds } },
            select: refCustomerSelect,
          })
        : Promise.resolve([]),
      contactIds.length
        ? this.prisma.contact.findMany({
            where: { id: { in: contactIds } },
            select: refCustomerSelect,
          })
        : Promise.resolve([]),
    ]);

    const customerById = new Map(customers.map((customer) => [customer.id, customer]));
    for (const [recordId, customerId] of directCustomerIdByRecordId) {
      const customer = customerById.get(customerId);
      if (customer) result.set(recordId, customer);
    }

    const applyRefCustomers = (
      refs: Map<string, string[]>,
      rows: Array<{ id: string; customer: SalesActionItemCustomerInfoOutput }>
    ) => {
      for (const row of rows) {
        const recordIds = refs.get(row.id) ?? [];
        for (const recordId of recordIds) {
          result.set(recordId, row.customer);
        }
      }
    };

    applyRefCustomers(
      customerRefs,
      customers.map((customer) => ({ id: customer.id, customer }))
    );
    applyRefCustomers(opportunityRefs, opportunities);
    applyRefCustomers(saleOrderRefs, saleOrders);
    applyRefCustomers(paymentRefs, payments);
    applyRefCustomers(invoiceRefs, invoices);
    applyRefCustomers(keepRecordRefs, keepRecords);
    applyRefCustomers(visitRecordRefs, visitRecords);
    applyRefCustomers(contactRefs, contacts);

    return result;
  }

  private serialize(
    record: Record<string, unknown>,
    customer?: SalesActionItemCustomerInfoOutput
  ): SalesActionItemResponseOutput {
    // JSON 字段反序列化为强类型 shape；legacy 文档危险 URL 仅在响应副本中降级为无链接。
    const aiDraft = fromJsonValue<ISalesActionItemAiDraft>(record.aiDraft as Prisma.JsonValue);
    const evidence = sanitizeSalesActionEvidence(record.evidence);
    const resolvedBy = record.resolvedBy as SalesActionItemResponseOutput['resolvedBy'] | undefined;
    return serializeEntity<SalesActionItemResponseOutput>({
      ...record,
      aiDraft: aiDraft ?? null,
      evidence: evidence ?? null,
      resolvedByName: resolvedBy?.name ?? null,
      customerName: customer?.customerName ?? null,
      customer,
    });
  }
}
