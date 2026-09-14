import {
  APPROVAL_EVENT_TYPE,
  APPROVAL_INSTANCE_STATUS,
  CONTACT_STATUS,
  DEAL_STATUS,
  KEEP_RECORD_SOURCE,
  LEAD_PROGRESS_STATUS,
} from '@ky-azeroth/shared';
import type {
  BatchCollaboratorsCustomerInput,
  BatchRemoveCustomerInput,
  BatchTransferCustomerInput,
  BatchUpdateCustomerInput,
  CheckCustomerDuplicateInput,
  ClaimCustomerInput,
  CorrectLeadStageInput,
  CustomerDuplicateCheckResponseOutput,
  CustomerDuplicateMatchFieldOutput,
  CustomerDuplicateMatchOutput,
  CustomerResponseOutput,
  PermanentRemoveCustomerInput,
  RestoreCustomerInput,
  SubmitLeadStageChangeInput,
  UpdateLeadProgressInput,
} from '@ky-azeroth/shared/schemas/customer';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Customer } from '@prisma/client';
import { Prisma } from '@prisma/client';

import { SerialNumberType } from '../../common/constants/serial-number.constants';
import { FilterApplierService } from '../../common/filter-scheme';
import type { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import { applyCustomerCollabSelfScope } from '../../common/services/data-scope.service';
import { SerialNumberService } from '../../common/services/serial-number.service';
import { auditCreate, auditUpdate } from '../../common/utils/audit-helper';
import { fromJsonValue, toJsonValue } from '../../common/utils/json-type-helpers';
import { resolveOrderBy } from '../../common/utils/order-by.helper';
import {
  calculatePagination,
  serializeEntity,
  toDateOnlyString,
  toDecimalNumber,
} from '../../common/utils/response-helpers';
import { lockApprovalChangeRequestTarget } from '../approvals/approval-change-request-lock.helper';
import { APPROVAL_CHANGE_TARGET_TYPE } from '../approvals/approval-change-requests.service';
import { BusinessApprovalService } from '../approvals/business-approval.service';
import { KeepRecordsService } from '../keep-records/keep-records.service';
import { CrmChangeLogService } from '../operation-logs/crm-change-log.service';
import { CustomerLifecycleService } from './customer-lifecycle.service';
import { CUSTOMER_FILTER_REGISTRY } from './customers.filter-registry';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { QueryCustomerDto } from './dto/query-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

/**
 * 客户列表允许的排序字段白名单。findAll（主列表）与 findTrashed（回收站）共用；
 * 回收站默认 fallback 用 deletedAt desc。
 * 注：findDuplicate（查重）、findAllForSelection（下拉）及客户 lifecycle
 * 等内部辅助查询固定排序，不消费前端 sortBy。
 */
const CUSTOMER_SORT_WHITELIST: ReadonlySet<string> = new Set([
  'customerName',
  'customerLevel',
  'createdAt',
  'updatedAt',
  'deletedAt',
  // 业务字段：跟进时间、应收账款、线索阶段时间（均为 Customer 表直存列）
  'lastKeepRecordTime',
  'accountsReceivable',
  'leadStageQualifiedAt',
  'firstMqlAt',
  'firstSqlAt',
  'leadAppointmentAt',
  'intentTemperature',
  'nextFollowUpAt',
]);

const INTENT_TEMPERATURE_RANK: Readonly<Record<string, number>> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
  NONE: 3,
  UNJUDGED: 4,
};

function sortCustomersByIntentTemperature<T extends { intentTemperature: string; createdAt: Date }>(
  customers: T[],
  sortOrder: 'asc' | 'desc' | undefined
): T[] {
  const direction = sortOrder === 'desc' ? -1 : 1;
  const unjudgedRank = INTENT_TEMPERATURE_RANK.UNJUDGED ?? 4;
  return [...customers].sort((left, right) => {
    const rankDifference =
      (INTENT_TEMPERATURE_RANK[left.intentTemperature] ?? unjudgedRank) -
      (INTENT_TEMPERATURE_RANK[right.intentTemperature] ?? unjudgedRank);
    if (rankDifference !== 0) return rankDifference * direction;
    return right.createdAt.getTime() - left.createdAt.getTime();
  });
}

type DuplicateCustomerCandidate = {
  id: string;
  serialNumber: string;
  customerName: string;
  shortName: string | null;
  uncId: string | null;
  organizationId: string | null;
  chargerId: string | null;
  chargerName: string | null;
  createdAt: Date;
  updatedAt: Date;
  charger: { name: string } | null;
  contacts: { mobile: string | null; phone: string | null }[];
};

type AuditUser = { id: string; employeeId?: string | null };

/**
 * 当前用户的客户数据访问上下文，用于查重结果标注 `accessible`（能否穿透打开详情）。
 * 语义与 DataScopeService.resolveChargerScope 一致：
 * chargerScope 为 null = 全量可见角色；数组 = 仅范围内私海可见。
 */
export interface CustomerAccessContext {
  chargerScope?: string[] | null;
  currentEmployeeId?: string | null;
}

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly serialNumberService: SerialNumberService,
    private readonly filterApplier: FilterApplierService,
    private readonly keepRecordsService: KeepRecordsService,
    private readonly businessApprovalService: BusinessApprovalService,
    private readonly customerLifecycle: CustomerLifecycleService,
    private readonly changeLog?: CrmChangeLogService
  ) {}

  /**
   * 根据 collaboratorIds 查询协作人名称并拼接
   */
  private async resolveCollaboratorName(collaboratorIds: unknown): Promise<string | null> {
    const ids = fromJsonValue<string[]>(collaboratorIds);
    if (!ids || ids.length === 0) return null;
    const employees = await this.prisma.employee.findMany({
      where: { id: { in: ids } },
      select: { name: true },
    });
    return employees.map((e) => e.name).join('、') || null;
  }

  private normalizeDuplicateText(value: string | null | undefined): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }

  private serializeCustomerForLog(customer: Customer): CustomerResponseOutput {
    return serializeEntity<CustomerResponseOutput>({
      ...customer,
      nextFollowUpAt: toDateOnlyString(customer.nextFollowUpAt),
      collaboratorIds: fromJsonValue<string[]>(customer.collaboratorIds) ?? null,
      accountsReceivable: toDecimalNumber(customer.accountsReceivable),
    });
  }

  private async loadCustomerLogRows(ids: string[]): Promise<Customer[]> {
    if (ids.length === 0) return [];
    return this.prisma.customer.findMany({
      where: { id: { in: ids } },
    });
  }

  private async loadCustomerLogSnapshot(id: string): Promise<CustomerResponseOutput | undefined> {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        charger: { select: { id: true, name: true } },
        leadStageUpdatedBy: { select: { id: true, name: true } },
        leadStageQualifiedBy: { select: { id: true, name: true } },
      },
    });
    if (!customer) return undefined;

    return serializeEntity<CustomerResponseOutput>({
      ...customer,
      nextFollowUpAt: toDateOnlyString(customer.nextFollowUpAt),
      chargerName: customer.charger?.name ?? customer.chargerName,
      leadStageUpdatedByName: customer.leadStageUpdatedBy?.name ?? null,
      leadStageQualifiedByName: customer.leadStageQualifiedBy?.name ?? null,
      collaboratorIds: fromJsonValue<string[]>(customer.collaboratorIds) ?? null,
      accountsReceivable: toDecimalNumber(customer.accountsReceivable),
    });
  }

  private async writeCustomerChangeLogs(options: {
    action: string;
    currentUser: AuditUser;
    beforeRows?: Customer[];
    afterRows?: Customer[];
  }): Promise<void> {
    if (!this.changeLog) return;

    const beforeMap = new Map((options.beforeRows ?? []).map((row) => [row.id, row]));
    const afterMap = new Map((options.afterRows ?? []).map((row) => [row.id, row]));
    const ids = [...new Set([...beforeMap.keys(), ...afterMap.keys()])];

    for (const id of ids) {
      const before = beforeMap.get(id);
      const after = afterMap.get(id);
      const beforePayload = before ? this.serializeCustomerForLog(before) : undefined;
      const afterPayload = after ? this.serializeCustomerForLog(after) : undefined;
      await this.changeLog.logChange({
        module: 'customers',
        action: options.action,
        target: id,
        targetName: afterPayload?.customerName ?? beforePayload?.customerName,
        currentUser: options.currentUser,
        before: beforePayload,
        after: afterPayload,
      });
    }
  }

  private normalizeDuplicatePhone(value: string | null | undefined): string | null {
    const normalized = value?.trim().replace(/[\s\-()（）]/g, '');
    return normalized ? normalized : null;
  }

  /**
   * 把名称类输入按空白拆词，用于多词 AND 模糊查重。
   * 例："示例 科技" → ["示例", "科技"]，两个词都需被命中。
   */
  private tokenizeDuplicateText(value: string | null | undefined): string[] {
    const normalized = value?.trim();
    if (!normalized) return [];
    return normalized
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
  }

  private matchesDuplicateTokens(target: string | null | undefined, tokens: string[]): boolean {
    if (!target || tokens.length === 0) return false;
    const lowered = target.toLowerCase();
    return tokens.every((token) => lowered.includes(token.toLowerCase()));
  }

  private isSameDuplicateText(
    source: string | null | undefined,
    target: string | null | undefined
  ): boolean {
    const normalizedSource = this.normalizeDuplicateText(source);
    const normalizedTarget = this.normalizeDuplicateText(target);
    return Boolean(
      normalizedSource &&
      normalizedTarget &&
      normalizedSource.toLowerCase() === normalizedTarget.toLowerCase()
    );
  }

  private isSameDuplicatePhone(
    source: string | null | undefined,
    target: string | null | undefined
  ): boolean {
    const normalizedSource = this.normalizeDuplicatePhone(source);
    const normalizedTarget = this.normalizeDuplicatePhone(target);
    return Boolean(normalizedSource && normalizedTarget && normalizedSource === normalizedTarget);
  }

  private getDuplicateMatchedFields(
    customer: DuplicateCustomerCandidate,
    criteria: CheckCustomerDuplicateInput
  ): CustomerDuplicateMatchFieldOutput[] {
    const fields: CustomerDuplicateMatchFieldOutput[] = [];

    const customerNameTokens = this.tokenizeDuplicateText(criteria.customerName);
    const shortNameTokens = this.tokenizeDuplicateText(criteria.shortName);

    if (
      this.matchesDuplicateTokens(customer.customerName, customerNameTokens) ||
      this.matchesDuplicateTokens(customer.customerName, shortNameTokens)
    ) {
      fields.push('customerName');
    }
    if (
      this.matchesDuplicateTokens(customer.shortName, shortNameTokens) ||
      this.matchesDuplicateTokens(customer.shortName, customerNameTokens)
    ) {
      fields.push('shortName');
    }
    if (
      criteria.phone &&
      customer.contacts.some(
        (contact) =>
          this.isSameDuplicatePhone(criteria.phone, contact.mobile) ||
          this.isSameDuplicatePhone(criteria.phone, contact.phone)
      )
    ) {
      fields.push('contactPhone');
    }
    if (this.isSameDuplicateText(criteria.uncId, customer.uncId)) {
      fields.push('uncId');
    }
    if (this.isSameDuplicateText(criteria.organizationId, customer.organizationId)) {
      fields.push('organizationId');
    }

    return fields;
  }

  async findAll(
    query: QueryCustomerDto,
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null,
    rawQuery?: unknown
  ): Promise<PaginatedResponse<CustomerResponseOutput>> {
    const { page = 1, pageSize = 10, sortBy, sortOrder } = query;
    const { skip, take } = calculatePagination(page, pageSize);
    const pool = query.pool;
    const baseWhere: Prisma.CustomerWhereInput = {
      deletedAt: null,
    };
    // Leads 池：按 leadStage 标签筛分类（=MQL/SQL），归属保持与私海同一可见性规则
    // （销售看自己负责+协作；admin 看全部）。不限定 chargerId，公海中已被打 MQL/SQL
    // 标签的客户也会出现在这里供认领。
    const effectiveChargerScope = pool === 'public' ? null : (chargerScope ?? null);

    if (pool === 'public') {
      baseWhere.chargerId = null;
    } else if (pool === 'leads') {
      baseWhere.leadStage = { in: ['MQL', 'SQL'] };
    } else if (pool === 'private' && effectiveChargerScope === null) {
      baseWhere.chargerId = { not: null };
    }

    // 协作人访问范围：负责人在 scope 内 OR 当前员工在 collaboratorIds 中
    // 公海池（effectiveChargerScope === null）不注入 OR
    applyCustomerCollabSelfScope(baseWhere, effectiveChargerScope, currentEmployeeId);

    const where = await this.filterApplier.buildWhere<Prisma.CustomerWhereInput>({
      registry: CUSTOMER_FILTER_REGISTRY,
      rawQuery,
      legacyKeyword: query.keyword,
      legacyFilters: this.buildLegacyFilters(query),
      // 已通过 helper 把范围拼到 baseWhere.OR，避免 applier 再次注入 AND 把 OR 收紧成空集
      chargerScope: null,
      baseWhere,
    });

    const orderBy = resolveOrderBy<Prisma.CustomerOrderByWithRelationInput>(sortBy, sortOrder, {
      whitelist: CUSTOMER_SORT_WHITELIST,
      fallback: { createdAt: 'desc' },
      // 「最近跟进时间」降序时让 NULL（从未跟进过的客户）排尾，避免空白霸占降序首页；
      // 升序 PG 默认即 NULLS LAST，不需特别声明也是这个效果。
      nullsPolicy: { lastKeepRecordTime: 'nullsLast', nextFollowUpAt: 'nullsLast' },
    });

    const sortByIntentTemperature = sortBy === 'intentTemperature';
    const [rawData, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        ...(sortByIntentTemperature ? {} : { skip, take }),
        orderBy,
        include: {
          charger: { select: { id: true, name: true } },
        },
      }),
      this.prisma.customer.count({ where }),
    ]);
    const data = sortByIntentTemperature
      ? sortCustomersByIntentTemperature(rawData, sortOrder).slice(skip, skip + take)
      : rawData;

    // 协作人和意向更新人共用一次批量查询，避免 N+1。
    const allCollaboratorIds = new Set<string>();
    for (const item of data) {
      if (item.intentUpdatedById) allCollaboratorIds.add(item.intentUpdatedById);
      const ids = fromJsonValue<string[]>(item.collaboratorIds);
      if (ids) {
        for (const id of ids) {
          allCollaboratorIds.add(id);
        }
      }
    }

    const collaboratorMap = new Map<string, string>();
    if (allCollaboratorIds.size > 0) {
      const employees = await this.prisma.employee.findMany({
        where: { id: { in: [...allCollaboratorIds] } },
        select: { id: true, name: true },
      });
      for (const emp of employees) {
        collaboratorMap.set(emp.id, emp.name);
      }
    }

    const items = data.map((item) => {
      const collaboratorIds = fromJsonValue<string[]>(item.collaboratorIds);
      const collaboratorName =
        collaboratorIds && collaboratorIds.length > 0
          ? collaboratorIds
              .map((id) => collaboratorMap.get(id))
              .filter(Boolean)
              .join('、') || null
          : null;
      return serializeEntity<CustomerResponseOutput>({
        ...item,
        nextFollowUpAt: toDateOnlyString(item.nextFollowUpAt),
        chargerName: item.charger?.name ?? item.chargerName,
        intentUpdatedByName: item.intentUpdatedById
          ? (collaboratorMap.get(item.intentUpdatedById) ?? null)
          : null,
        intentReasons: fromJsonValue<string[]>(item.intentReasons) ?? null,
        collaboratorIds: collaboratorIds ?? null,
        collaboratorName: collaboratorName ?? item.collaboratorName,
        accountsReceivable: toDecimalNumber(item.accountsReceivable),
      });
    });

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async findOne(
    id: string,
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null,
    options?: { includePublicPool?: boolean }
  ): Promise<CustomerResponseOutput> {
    const where: Prisma.CustomerWhereInput = { id, deletedAt: null };
    applyCustomerCollabSelfScope(where, chargerScope, currentEmployeeId);
    if (options?.includePublicPool && where.OR) {
      where.OR.push({ chargerId: null });
    }
    const customer = await this.prisma.customer.findFirst({
      where,
      include: {
        charger: { select: { id: true, name: true } },
        leadStageUpdatedBy: { select: { id: true, name: true } },
        leadStageQualifiedBy: { select: { id: true, name: true } },
        contacts: {
          where: { deletedAt: null },
          select: {
            id: true,
            contactName: true,
            mobile: true,
            phone: true,
            position: true,
          },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException(`客户 ${id} 不存在`);
    }

    const collaboratorIds = fromJsonValue<string[]>(customer.collaboratorIds);
    const collaboratorName = await this.resolveCollaboratorName(customer.collaboratorIds);
    const intentUpdatedBy = customer.intentUpdatedById
      ? await this.prisma.employee.findUnique({
          where: { id: customer.intentUpdatedById },
          select: { name: true },
        })
      : null;

    return serializeEntity<CustomerResponseOutput>({
      ...customer,
      nextFollowUpAt: toDateOnlyString(customer.nextFollowUpAt),
      chargerName: customer.charger?.name ?? customer.chargerName,
      leadStageUpdatedByName: customer.leadStageUpdatedBy?.name ?? null,
      leadStageQualifiedByName: customer.leadStageQualifiedBy?.name ?? null,
      intentUpdatedByName: intentUpdatedBy?.name ?? null,
      intentReasons: fromJsonValue<string[]>(customer.intentReasons) ?? null,
      collaboratorIds: collaboratorIds ?? null,
      collaboratorName: collaboratorName ?? customer.collaboratorName,
      accountsReceivable: toDecimalNumber(customer.accountsReceivable),
    });
  }

  async checkDuplicates(
    dto: CheckCustomerDuplicateInput,
    access?: CustomerAccessContext
  ): Promise<CustomerDuplicateCheckResponseOutput> {
    const criteria = {
      customerName: this.normalizeDuplicateText(dto.customerName),
      shortName: this.normalizeDuplicateText(dto.shortName),
      phone: this.normalizeDuplicateText(dto.phone),
      normalizedPhone: this.normalizeDuplicatePhone(dto.phone),
      uncId: this.normalizeDuplicateText(dto.uncId),
      organizationId: this.normalizeDuplicateText(dto.organizationId),
      excludeId: this.normalizeDuplicateText(dto.excludeId),
    };

    const or: Prisma.CustomerWhereInput[] = [];

    // 名称类查重：多词 contains AND（输入"示例 科技"需两个词都命中），
    // 对 customerName/shortName 两个字段分别匹配，再以 OR 串联。
    const nameTokenSets = [criteria.customerName, criteria.shortName]
      .map((name) => this.tokenizeDuplicateText(name))
      .filter((tokens) => tokens.length > 0);
    const seenTokenKeys = new Set<string>();
    for (const tokens of nameTokenSets) {
      const dedupKey = tokens
        .map((t) => t.toLowerCase())
        .sort()
        .join('');
      if (seenTokenKeys.has(dedupKey)) continue;
      seenTokenKeys.add(dedupKey);
      or.push({
        AND: tokens.map((token) => ({
          customerName: { contains: token, mode: 'insensitive' as const },
        })),
      });
      or.push({
        AND: tokens.map((token) => ({
          shortName: { contains: token, mode: 'insensitive' as const },
        })),
      });
    }
    if (criteria.phone) {
      const phoneValues = [
        ...new Set(
          [criteria.phone, criteria.normalizedPhone].filter((phone): phone is string =>
            Boolean(phone)
          )
        ),
      ];
      or.push({
        contacts: {
          some: {
            deletedAt: null,
            OR: phoneValues.flatMap((phone) => [
              { mobile: { equals: phone, mode: 'insensitive' as const } },
              { phone: { equals: phone, mode: 'insensitive' as const } },
            ]),
          },
        },
      });
    }
    if (criteria.uncId) {
      or.push({ uncId: { equals: criteria.uncId, mode: 'insensitive' } });
    }
    if (criteria.organizationId) {
      or.push({ organizationId: { equals: criteria.organizationId, mode: 'insensitive' } });
    }

    if (or.length === 0) {
      return { total: 0, items: [] };
    }

    const where: Prisma.CustomerWhereInput = {
      deletedAt: null,
      ...(criteria.excludeId ? { id: { not: criteria.excludeId } } : {}),
      OR: or,
    };

    const customers = await this.prisma.customer.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        serialNumber: true,
        customerName: true,
        shortName: true,
        uncId: true,
        organizationId: true,
        chargerId: true,
        chargerName: true,
        createdAt: true,
        updatedAt: true,
        charger: { select: { name: true } },
        contacts: {
          where: { deletedAt: null },
          select: { mobile: true, phone: true },
        },
      },
    });

    const queryCriteria: CheckCustomerDuplicateInput = {
      customerName: criteria.customerName,
      shortName: criteria.shortName,
      phone: criteria.normalizedPhone ?? criteria.phone,
      uncId: criteria.uncId,
      organizationId: criteria.organizationId,
    };

    const items = (customers as DuplicateCustomerCandidate[])
      .map((customer) => ({
        id: customer.id,
        serialNumber: customer.serialNumber,
        customerName: customer.customerName,
        shortName: customer.shortName,
        uncId: customer.uncId,
        organizationId: customer.organizationId,
        chargerId: customer.chargerId,
        chargerName: customer.charger?.name ?? customer.chargerName,
        pool: customer.chargerId ? ('private' as const) : ('public' as const),
        matchedFields: this.getDuplicateMatchedFields(customer, queryCriteria),
        createdAt: customer.createdAt.toISOString(),
        updatedAt: customer.updatedAt.toISOString(),
      }))
      .filter((item) => item.matchedFields.length > 0);

    const accessibleIds = await this.resolveAccessibleCustomerIds(
      items.map((item) => item.id),
      access
    );

    return {
      total: items.length,
      items: items.map((item) => ({ ...item, accessible: accessibleIds.has(item.id) })),
    };
  }

  /**
   * 计算查重命中客户中、当前用户可打开详情的子集。
   * 口径必须与 GET /customers/:id（findOne + includePublicPool: true）完全一致：
   * 范围内私海 OR 本人协作 OR 公海；chargerScope 为 null（全量角色）时全部可见。
   * 未传 access（内部调用/测试）时按全部不可见处理，前端不渲染穿透入口。
   */
  private async resolveAccessibleCustomerIds(
    ids: string[],
    access?: CustomerAccessContext
  ): Promise<Set<string>> {
    if (!access || ids.length === 0) return new Set();
    const { chargerScope, currentEmployeeId } = access;
    if (chargerScope === undefined || chargerScope === null) return new Set(ids);
    const where: Prisma.CustomerWhereInput = { id: { in: ids }, deletedAt: null };
    applyCustomerCollabSelfScope(where, chargerScope, currentEmployeeId);
    // 对齐 GET /:id 的 includePublicPool: true——公海客户任何 view 权限都可打开
    where.OR?.push({ chargerId: null });
    const rows = await this.prisma.customer.findMany({ where, select: { id: true } });
    return new Set(rows.map((row) => row.id));
  }

  async create(
    dto: CreateCustomerDto,
    currentUser: { id: string; employeeId?: string | null },
    access?: CustomerAccessContext
  ): Promise<CustomerResponseOutput> {
    // 查重分级（2026-05-30 安全加固）：
    // 始终按 customerName / shortName / uncId / organizationId 调 checkDuplicates，
    // 再把命中项分为「硬命中」和「软命中」：
    //   - 硬命中（完全同名 / uncId / contactPhone / organizationId 精准匹配）：
    //     无论 forceCreate 一律拒绝（DUPLICATE_CUSTOMER_BLOCKED，forceable=false）。
    //   - 软命中（仅名称模糊命中、不完全同名、且无任何精准命中）：
    //     未 forceCreate 抛可强制的 409（DUPLICATE_CUSTOMER，forceable=true）；
    //     forceCreate=true 时放行创建，并在创建成功后写一条审计日志。
    // access 用于给 409 错误体里的 duplicates 标注 accessible（前端预警弹卡渲染穿透链接）
    const dup = await this.checkDuplicates(
      {
        customerName: dto.customerName,
        shortName: dto.shortName ?? undefined,
        uncId: dto.uncId ?? undefined,
        organizationId: dto.organizationId ?? undefined,
      },
      access
    );

    const isHardMatch = (item: CustomerDuplicateMatchOutput): boolean =>
      item.matchedFields.includes('uncId') ||
      item.matchedFields.includes('organizationId') ||
      item.matchedFields.includes('contactPhone') ||
      this.isSameDuplicateText(dto.customerName, item.customerName);

    const hardMatches = dup.items.filter(isHardMatch);
    const softMatches = dup.items.filter((item) => !isHardMatch(item));

    if (hardMatches.length > 0) {
      throw new ConflictException({
        message: `检测到 ${hardMatches.length} 个精准重复客户（完全同名/统一信用代码/联系电话/组织ID），不可强制创建`,
        code: 'DUPLICATE_CUSTOMER_BLOCKED',
        forceable: false,
        duplicates: hardMatches,
      });
    }

    if (softMatches.length > 0 && !dto.forceCreate) {
      throw new ConflictException({
        message: `检测到 ${softMatches.length} 个疑似重复客户，确认后传 forceCreate=true 跳过校验`,
        code: 'DUPLICATE_CUSTOMER',
        forceable: true,
        duplicates: softMatches,
      });
    }

    const serialNumber = await this.serialNumberService.generate(SerialNumberType.CUSTOMER);

    const customer = await this.prisma.customer.create({
      data: {
        serialNumber,
        customerName: dto.customerName,
        shortName: dto.shortName ?? undefined,
        industry: dto.industry ?? undefined,
        customerLevel: dto.customerLevel ?? undefined,
        customerSource: dto.customerSource ?? undefined,
        customerRelationship: dto.customerRelationship ?? undefined,
        customerTags: dto.customerTags ? toJsonValue(dto.customerTags) : undefined,
        country: dto.country ?? undefined,
        province: dto.province ?? undefined,
        city: dto.city ?? undefined,
        district: dto.district ?? undefined,
        address: dto.address ?? undefined,
        remark: dto.remark ?? undefined,
        aiInfoSummary: dto.aiInfoSummary ?? undefined,
        aiInfoGeneratedAt: dto.aiInfoSummary?.trim() ? new Date() : undefined,
        organizationId: dto.organizationId ?? undefined,
        uncId: dto.uncId ?? undefined,
        headcountRange: dto.headcountRange ?? undefined,
        leadValidity: dto.leadValidity ?? undefined,
        leadInvalidReason: dto.leadInvalidReason ?? undefined,
        chargerId: dto.chargerId ?? undefined,
        collaboratorName: dto.collaboratorName ?? undefined,
        collaboratorIds: dto.collaboratorIds ? toJsonValue(dto.collaboratorIds) : undefined,
        // 新客户尚无跟进/拜访/赢单事实，直接在主写中落地确定性派生默认值。
        contactStatus: CONTACT_STATUS.UNTOUCHED,
        dealStatus: DEAL_STATUS.NOT_WON,
        ...auditCreate(currentUser),
      },
    });

    // 软重复被 forceCreate 跳过并成功创建：写审计日志。
    // 用 try/catch 包裹——审计失败仅 Logger.warn，绝不影响已成功的创建（不回滚、不抛错）。
    if (softMatches.length > 0 && dto.forceCreate) {
      try {
        await this.prisma.operationLog.create({
          data: {
            employeeId: currentUser.employeeId ?? currentUser.id,
            module: 'customers',
            action: 'force-create',
            target: customer.id,
            details: toJsonValue({
              customerName: customer.customerName,
              reason: dto.forceCreateReason ?? null,
              skippedDuplicateIds: softMatches.map((m) => m.id),
              skippedDuplicates: softMatches.map((m) => ({
                id: m.id,
                serialNumber: m.serialNumber,
                customerName: m.customerName,
                matchedFields: m.matchedFields,
              })),
            }),
          },
        });
      } catch (e) {
        this.logger.warn(
          `强制创建客户审计日志写入失败（不影响创建结果）：customerId=${customer.id}, error=${
            e instanceof Error ? e.message : String(e)
          }`
        );
      }
    }

    const response = serializeEntity<CustomerResponseOutput>({
      ...customer,
      nextFollowUpAt: toDateOnlyString(customer.nextFollowUpAt),
      collaboratorIds: fromJsonValue<string[]>(customer.collaboratorIds) ?? null,
      accountsReceivable: toDecimalNumber(customer.accountsReceivable),
    });

    await this.changeLog?.logChange({
      module: 'customers',
      action: 'create',
      target: customer.id,
      targetName: response.customerName,
      currentUser,
      after: response,
    });

    return response;
  }

  /**
   * 人工写与 ApprovalChangeRequest 提单共用的目标锁。
   *
   * 多目标必须先按 id 全量排序取锁，再检查 pending；这样相反选择顺序的两个批量请求
   * 也不会形成 advisory-lock 死锁。pending 检查和后续 CAS 必须留在同一事务内。
   */
  private async lockCustomerManualWriteTargets(
    tx: Prisma.TransactionClient,
    customerIds: readonly string[],
    pendingCustomerIds: readonly string[] = customerIds
  ): Promise<string[]> {
    const sortedIds = [...new Set(customerIds)].sort();
    for (const customerId of sortedIds) {
      await lockApprovalChangeRequestTarget(tx, APPROVAL_CHANGE_TARGET_TYPE.CUSTOMER, customerId);
    }

    const pendingIds = [...new Set(pendingCustomerIds)].sort();
    if (pendingIds.length === 0) return sortedIds;
    const pending = await tx.approvalChangeRequest.findFirst({
      where: {
        eventType: APPROVAL_EVENT_TYPE.CUSTOMER_TAG_CHANGE,
        targetType: APPROVAL_CHANGE_TARGET_TYPE.CUSTOMER,
        targetId: { in: pendingIds },
        status: APPROVAL_INSTANCE_STATUS.PENDING,
        deletedAt: null,
      },
      select: { id: true, targetId: true, title: true },
    });
    if (pending) {
      throw new ConflictException(
        `客户 ${pending.targetId} 有进行中的线索阶段变更审批（${pending.title}），请审批人先处理（通过/驳回）后再修改客户`
      );
    }
    return sortedIds;
  }

  private requireCustomerBatchVersion(
    versions: Readonly<Record<string, number>>,
    id: string
  ): number {
    const version = versions[id];
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
      throw new BadRequestException(`客户 ${id} 必须携带有效的 version`);
    }
    return version;
  }

  private buildCustomerBatchCasWhere(
    id: string,
    version: number,
    chargerScope: string[] | null | undefined,
    currentEmployeeId: string | null | undefined
  ): Prisma.CustomerWhereInput {
    const where: Prisma.CustomerWhereInput = { id, version, deletedAt: null };
    applyCustomerCollabSelfScope(where, chargerScope, currentEmployeeId);
    return where;
  }

  private assertCustomerBatchCasCount(actual: number, id: string): void {
    if (actual !== 1) {
      throw new ConflictException(`客户 ${id} 已被其他用户修改，请刷新后重试`);
    }
  }

  async update(
    id: string,
    dto: UpdateCustomerDto,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null,
    // 2026-06 拔掉 leadStage ADMIN 直改特例后，update 不再按角色分支。
    // 签名保留 `_roles` 以维持 controller 调用兼容，避免无关层级的改动。
    _roles: string[] = []
  ): Promise<CustomerResponseOutput> {
    const requestVersion = dto.version;
    if (!Number.isInteger(requestVersion) || requestVersion < 1) {
      throw new BadRequestException('更新客户必须携带有效的 version');
    }
    const existing = await this.findOne(id, chargerScope, currentEmployeeId);

    // DTO 使用 strict schema；service 再做一次字段级防御，避免内部调用绕过 HTTP 校验。
    const PUT_FORBIDDEN_FIELDS = [
      'aiInfoSummary',
      'aiInfoGeneratedAt',
      'collaboratorName',
      'contactStatus',
      'dealStatus',
      'leadStage',
      'leadStageQualifiedById',
      'leadStageUpdatedById',
      'leadStageUpdatedAt',
      'leadStageQualifiedAt',
      'chargerName',
      'createdAt',
      'createdBy',
      'updatedAt',
      'updatedBy',
      'deletedAt',
    ] as const;
    const touchedForbiddenFields = PUT_FORBIDDEN_FIELDS.filter(
      (field) => (dto as unknown as Record<string, unknown>)[field] !== undefined
    );
    if (touchedForbiddenFields.length > 0) {
      throw new BadRequestException(
        `字段 ${touchedForbiddenFields.join('、')} 不允许通过 PUT 修改，请使用对应专用入口`
      );
    }

    const { customerTags, collaboratorIds, version: _version, ...restDto } = dto;

    try {
      const customer = await this.prisma.$transaction(async (tx) => {
        await this.lockCustomerManualWriteTargets(tx, [id]);
        const where: Prisma.CustomerWhereUniqueInput = {
          id,
          version: requestVersion,
          deletedAt: null,
        };
        applyCustomerCollabSelfScope(where, chargerScope, currentEmployeeId);
        return tx.customer.update({
          where,
          data: {
            ...restDto,
            ...(customerTags !== undefined ? { customerTags: toJsonValue(customerTags) } : {}),
            ...(collaboratorIds !== undefined
              ? { collaboratorIds: toJsonValue(collaboratorIds) }
              : {}),
            ...auditUpdate(currentUser),
            version: { increment: 1 },
          },
        });
      });

      const response = serializeEntity<CustomerResponseOutput>({
        ...customer,
        nextFollowUpAt: toDateOnlyString(customer.nextFollowUpAt),
        collaboratorIds: fromJsonValue<string[]>(customer.collaboratorIds) ?? null,
        accountsReceivable: toDecimalNumber(customer.accountsReceivable),
      });

      const logAfter = (await this.loadCustomerLogSnapshot(id)) ?? response;
      await this.changeLog?.logChange({
        module: 'customers',
        action: 'update',
        target: id,
        targetName: logAfter.customerName,
        currentUser,
        before: existing,
        after: logAfter,
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
   * 写一条 leadStage 变更的 KeepRecord 留底。
   *
   * 复用 keepRecordType='other' + source='field_change'，避免新增 type 值；
   * KeepRecordsService 与生命周期查询都按 source 排除该系统留底，因此不会污染真实接触事实。
   */
  async writeLeadStageKeepRecord(args: {
    customerId: string;
    from: string | null;
    to: string | null;
    operator: { id: string; employeeId?: string | null };
    qualifiedById: string | null;
    via: 'direct_edit' | 'approval' | 'business_event' | 'data_correction';
    note?: string;
    tx?: Prisma.TransactionClient;
  }): Promise<void> {
    const action =
      !args.from && args.to
        ? `打 ${args.to} 标签`
        : args.from && !args.to
          ? `移除 ${args.from} 标签`
          : `${args.from} → ${args.to}`;
    const suffix =
      args.via === 'approval'
        ? '（审批通过）'
        : args.via === 'business_event'
          ? '（业务事件自动流转）'
          : args.via === 'data_correction'
            ? '（历史数据修正）'
            : '（管理员直改）';
    const content = `[系统] 线索阶段变更：${action}${suffix}${args.note ? `：${args.note}` : ''}`;
    const chargerId = args.qualifiedById ?? args.operator.employeeId ?? args.operator.id;
    try {
      await this.keepRecordsService.create(
        {
          customerId: args.customerId,
          keepRecordType: 'other',
          keepRecordTime: new Date().toISOString(),
          keepRecordContent: content,
          keepRecordStatus: '客户维护',
          chargerId,
          source: KEEP_RECORD_SOURCE.FIELD_CHANGE,
        } as unknown as Parameters<KeepRecordsService['create']>[0],
        args.operator,
        { tx: args.tx }
      );
    } catch (error) {
      // 留底失败不影响主流程
      this.logger.error(
        `写 leadStage 留底失败 customerId=${args.customerId} from=${args.from} to=${args.to}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * 提交线索阶段（MQL/SQL）变更审批
   *
   * 统一入口：所有角色（含 ADMIN）发起 leadStage 变更都走这里——
   * 2026-06 改造前 ADMIN 走 PUT 直改 + 此端点对 ADMIN 拒绝；改造后封死直改路径，
   * 所有角色统一通过此端点提交，由审批引擎决定路径：
   *
   * - 若审批流首节点（或后续节点）审批人 = 申请人本人，
   *   approvals.service 的 autoPassSelfTasksAndAdvance 会自动通过（可能整条审批链自动通过到终态）
   * - 同一客户有 pending 的 customer_tag_change 时拒绝重复提交
   *   （由 BusinessApprovalService 的 ApprovalChangeRequest 冲突检测兜底）
   * - 审批通过后由 ApprovalChangeRequestsService.applyCustomerChange 落地
   *   （包含字段更新 + KeepRecord 留底）
   */
  async submitLeadStageChangeRequest(
    id: string,
    dto: SubmitLeadStageChangeInput,
    currentUser: { id: string; employeeId?: string | null; roles?: string[] },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ) {
    const existing = await this.findOne(id, chargerScope, currentEmployeeId);
    if (dto.version !== existing.version) {
      throw new ConflictException(
        `数据已被其他用户修改，当前版本 ${existing.version}。请刷新后重试。`
      );
    }
    if (existing.leadStage === dto.leadStage) {
      throw new BadRequestException('线索阶段未发生变化');
    }

    const patch: Record<string, unknown> = { leadStage: dto.leadStage };
    if (dto.leadStageQualifiedById !== undefined && dto.leadStageQualifiedById !== null) {
      patch.leadStageQualifiedById = dto.leadStageQualifiedById;
    }
    if (dto.reason) {
      patch.__reason = dto.reason;
    }

    const customerName = existing.customerName ?? existing.serialNumber ?? id.slice(0, 8);
    const fromLabel = existing.leadStage ?? '无';
    const targetCode = existing.serialNumber ?? id.slice(0, 8);

    return this.businessApprovalService.submitChangeApproval(
      {
        eventType: APPROVAL_EVENT_TYPE.CUSTOMER_TAG_CHANGE,
        targetType: APPROVAL_CHANGE_TARGET_TYPE.CUSTOMER,
        targetId: id,
        targetCode,
        title: `线索阶段变更｜${customerName}｜${fromLabel} → ${dto.leadStage}`,
        baseVersion: dto.version,
        patch,
        beforeSnapshot: existing as unknown as Record<string, unknown>,
        afterSnapshot: { ...(existing as unknown as Record<string, unknown>), ...patch },
        validateInTransaction: async (tx) => {
          const where: Prisma.CustomerWhereInput = {
            id,
            version: dto.version,
            deletedAt: null,
            leadStage: existing.leadStage,
          };
          applyCustomerCollabSelfScope(where, chargerScope, currentEmployeeId);
          const stillEligible = await tx.customer.findFirst({
            where,
            select: { id: true },
          });
          if (!stillEligible) {
            throw new ConflictException('客户状态或数据范围已变化，请刷新后重试');
          }
        },
      },
      currentUser
    );
  }

  /**
   * 管理员修正历史线索阶段脏数据。
   *
   * 只允许显式写入阶段和原始打标时间；推进状态、首次进入时间及合格判定人均保持不变。
   * 当前操作时间写入 leadStageUpdatedAt，历史业务时间写入 leadStageQualifiedAt。
   */
  async correctLeadStage(
    id: string,
    dto: CorrectLeadStageInput,
    currentUser: AuditUser
  ): Promise<CustomerResponseOutput> {
    const existing = await this.findOne(id);
    if (dto.version !== existing.version) {
      throw new ConflictException(
        `数据已被其他用户修改，当前版本 ${existing.version}。请刷新后重试。`
      );
    }

    const now = new Date();
    const employeeId = currentUser.employeeId ?? currentUser.id;
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.lockCustomerManualWriteTargets(tx, [id]);
        await tx.customer.update({
          where: { id, version: dto.version, deletedAt: null },
          data: {
            leadStage: dto.leadStage,
            leadStageUpdatedAt: now,
            leadStageQualifiedAt: new Date(dto.leadStageQualifiedAt),
            leadStageUpdatedBy: { connect: { id: employeeId } },
            updater: { connect: { id: employeeId } },
            version: { increment: 1 },
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException('数据已被其他用户修改，请刷新后重试');
      }
      throw error;
    }

    const response = await this.findOne(id);
    await this.changeLog?.logChange({
      module: 'customers',
      action: 'correct-lead-stage',
      target: id,
      targetName: response.customerName,
      currentUser,
      before: existing,
      after: response,
    });
    await this.writeLeadStageKeepRecord({
      customerId: id,
      from: existing.leadStage ?? null,
      to: dto.leadStage,
      operator: currentUser,
      qualifiedById: existing.leadStageQualifiedById ?? null,
      via: 'data_correction',
      note: dto.reason,
    });
    return response;
  }

  /**
   * Leads 看板人工推进入口。
   *
   * 这里只允许人工触发「活跃 / 毁约 / 待拜访 / 流失」。已完成演示/拜访、已成交必须由
   * KeepRecord(online_demo) / VisitRecord / Opportunity 的事实事件触发，避免销售直接拖卡伪造结果。
   */
  async updateLeadProgress(
    id: string,
    dto: UpdateLeadProgressInput,
    currentUser: AuditUser,
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<CustomerResponseOutput> {
    const existing = await this.findOne(id, chargerScope, currentEmployeeId);
    if (dto.version !== existing.version) {
      throw new ConflictException(
        `数据已被其他用户修改，当前版本 ${existing.version}。请刷新后重试。`
      );
    }
    if (!existing.leadStage) {
      throw new BadRequestException('该客户尚未进入 MQL/SQL，不能使用 Leads 看板推进');
    }
    if (existing.leadProgressStatus === LEAD_PROGRESS_STATUS.WON) {
      throw new BadRequestException('已成交线索不能人工回退，请先修正对应赢单商机');
    }
    if (
      dto.status === LEAD_PROGRESS_STATUS.NO_SHOW &&
      existing.leadProgressStatus !== LEAD_PROGRESS_STATUS.PENDING_VISIT
    ) {
      throw new BadRequestException('只有待拜访线索可以标记毁约');
    }
    if (
      dto.status === LEAD_PROGRESS_STATUS.ACTIVE &&
      existing.leadProgressStatus !== LEAD_PROGRESS_STATUS.NO_SHOW &&
      existing.leadProgressStatus !== LEAD_PROGRESS_STATUS.LOST &&
      existing.leadProgressStatus !== LEAD_PROGRESS_STATUS.ACTIVE
    ) {
      throw new BadRequestException('只有毁约或流失线索可以重新激活');
    }

    const appointmentAt =
      dto.status === LEAD_PROGRESS_STATUS.PENDING_VISIT
        ? new Date(dto.appointmentAt as string)
        : dto.status === LEAD_PROGRESS_STATUS.ACTIVE
          ? null
          : undefined;
    const reason =
      dto.status === LEAD_PROGRESS_STATUS.NO_SHOW || dto.status === LEAD_PROGRESS_STATUS.LOST
        ? dto.reason?.trim() || null
        : null;

    return this.applyLeadProgressState({
      id,
      status: dto.status,
      appointmentAt,
      reason,
      actor: currentUser,
      expectedVersion: dto.version,
    });
  }

  /**
   * 兼容旧调用方的 Leads 事实同步入口；内部复用统一 lifecycle primitive。
   * 传入 tx 时与业务主写同事务，否则本方法自行开启事务并锁定客户行。
   */
  async syncLeadProgressFromFacts(
    customerId: string,
    actor: AuditUser,
    prisma?: PrismaService | Prisma.TransactionClient
  ): Promise<void> {
    await this.customerLifecycle.refresh(customerId, actor, prisma);
  }

  /**
   * 拜访/跟进写路径使用的唯一派生生命周期入口。
   */
  async refreshCustomerLifecycle(
    customerIds: string | readonly string[],
    actor: AuditUser,
    prisma?: PrismaService | Prisma.TransactionClient
  ): Promise<void> {
    await this.customerLifecycle.refresh(customerIds, actor, prisma);
  }

  private async applyLeadProgressState(args: {
    id: string;
    status: string;
    stage?: 'MQL' | 'SQL';
    appointmentAt?: Date | null;
    reason?: string | null;
    actor: AuditUser;
    expectedVersion: number;
  }): Promise<CustomerResponseOutput> {
    const existing = await this.prisma.customer.findFirst({
      where: { id: args.id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException(`客户 ${args.id} 不存在`);
    const now = new Date();
    const employeeId = args.actor.employeeId ?? null;
    const stageChanged = args.stage !== undefined && existing.leadStage !== args.stage;
    const data: Prisma.CustomerUpdateInput = {
      leadProgressStatus: args.status,
      leadProgressUpdatedAt: now,
      leadProgressReason: args.reason ?? null,
      ...(args.appointmentAt !== undefined ? { leadAppointmentAt: args.appointmentAt } : {}),
      ...(employeeId
        ? { leadProgressUpdatedBy: { connect: { id: employeeId } } }
        : { leadProgressUpdatedBy: { disconnect: true } }),
      version: { increment: 1 },
    };

    if (stageChanged && args.stage) {
      data.leadStage = args.stage;
      data.leadStageUpdatedAt = now;
      data.leadStageQualifiedAt = now;
      if (employeeId) {
        data.leadStageUpdatedBy = { connect: { id: employeeId } };
        data.leadStageQualifiedBy = { connect: { id: employeeId } };
      }
      if (args.stage === 'MQL' && existing.firstMqlAt == null) data.firstMqlAt = now;
      if (args.stage === 'SQL' && existing.firstSqlAt == null) data.firstSqlAt = now;
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.lockCustomerManualWriteTargets(tx, [args.id]);
        await tx.customer.update({
          where: { id: args.id, version: args.expectedVersion, deletedAt: null },
          data,
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException('数据已被其他用户修改，请刷新后重试');
      }
      throw error;
    }

    const response = await this.findOne(args.id);
    await this.changeLog?.logChange({
      module: 'customers',
      action: 'update-lead-progress',
      target: args.id,
      targetName: response.customerName,
      currentUser: args.actor,
      before: this.serializeCustomerForLog(existing),
      after: response,
    });

    if (stageChanged && args.stage && employeeId) {
      await this.writeLeadStageKeepRecord({
        customerId: args.id,
        from: existing.leadStage,
        to: args.stage,
        operator: args.actor,
        qualifiedById: employeeId,
        via: 'business_event',
      });
    }
    return response;
  }

  async claim(
    id: string,
    dto: ClaimCustomerInput,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<CustomerResponseOutput> {
    const employeeId = currentUser.employeeId ?? currentUser.id;
    if (!employeeId) {
      throw new ForbiddenException('当前账号未绑定员工，无法认领客户');
    }
    if (!Number.isInteger(dto.version) || dto.version < 1) {
      throw new BadRequestException('认领客户必须携带有效的 version');
    }

    // 锁前只用于区分“请求开始时就不存在”(404)；所有可变状态必须在等待目标锁后重读。
    const initiallyExisting = await this.prisma.customer.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!initiallyExisting) {
      throw new NotFoundException(`客户 ${id} 不存在`);
    }

    const before = await this.prisma.$transaction(async (tx) => {
      await this.lockCustomerManualWriteTargets(tx, [id]);
      const current = await tx.customer.findUnique({ where: { id } });
      if (!current || current.deletedAt !== null) {
        throw new ConflictException('客户状态已在等待锁期间变化，请刷新后重试。');
      }
      if (current.version !== dto.version) {
        throw new ConflictException('客户数据已被其他用户修改，请刷新后重试。');
      }
      if (current.chargerId !== null) {
        throw new ConflictException('客户已被其他用户认领，请刷新后重试。');
      }

      const result = await tx.customer.updateMany({
        where: {
          id,
          version: dto.version,
          deletedAt: null,
          chargerId: null,
        },
        data: {
          chargerId: employeeId,
          chargerName: null,
          ...auditUpdate(currentUser),
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) {
        throw new ConflictException('客户数据已被其他用户修改，请刷新后重试。');
      }
      return current;
    });

    const response = await this.findOne(id, [employeeId]);
    await this.changeLog?.logChange({
      module: 'customers',
      action: 'claim',
      target: id,
      targetName: response.customerName,
      currentUser,
      before,
      after: response,
    });
    return response;
  }

  async remove(
    id: string,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope: string[] | null | undefined,
    currentEmployeeId: string | null | undefined,
    requestVersion: number
  ): Promise<void> {
    if (!Number.isInteger(requestVersion) || requestVersion < 1) {
      throw new BadRequestException('删除客户必须携带有效的 version');
    }
    const existing = await this.findOne(id, chargerScope, currentEmployeeId);

    try {
      const deleted = await this.prisma.$transaction(async (tx) => {
        await this.lockCustomerManualWriteTargets(tx, [id]);
        const where: Prisma.CustomerWhereUniqueInput = {
          id,
          version: requestVersion,
          deletedAt: null,
        };
        applyCustomerCollabSelfScope(where, chargerScope, currentEmployeeId);
        return tx.customer.update({
          where,
          data: {
            deletedAt: new Date(),
            ...auditUpdate(currentUser),
            version: { increment: 1 },
          },
        });
      });

      await this.changeLog?.logChange({
        module: 'customers',
        action: 'delete',
        target: id,
        targetName: existing.customerName,
        currentUser,
        before: existing,
        after: deleted,
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
   * 兼容只刷新联系/成交/最近跟进字段的旧调用方；完成事实仅接受 approved 或 legacy NULL。
   * 新的拜访/跟进写路径应调用 refreshCustomerLifecycle，一次完成全部派生重算。
   */
  async refreshCustomerStatus(
    customerId: string,
    prisma?: PrismaService | Prisma.TransactionClient
  ): Promise<void> {
    await this.customerLifecycle.recompute(customerId, { syncLeadProgress: false }, prisma);
  }

  /**
   * 查询回收站客户列表（已软删除）
   */
  async findTrashed(
    query: QueryCustomerDto,
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<PaginatedResponse<CustomerResponseOutput>> {
    const { keyword, sortBy, sortOrder } = query;
    const { page = 1, pageSize = 10 } = query;
    const { skip, take } = calculatePagination(page, pageSize);

    const where: Prisma.CustomerWhereInput = {
      deletedAt: { not: null },
    };

    // 数据范围过滤：负责人或协作人
    applyCustomerCollabSelfScope(where, chargerScope, currentEmployeeId);

    if (keyword) {
      // keyword 与范围 OR 互斥 —— 用 AND 串联避免覆盖
      const keywordOr = [
        { customerName: { contains: keyword, mode: 'insensitive' as const } },
        { serialNumber: { contains: keyword, mode: 'insensitive' as const } },
      ];
      if (where.OR) {
        where.AND = [{ OR: where.OR }, { OR: keywordOr }];
        delete where.OR;
      } else {
        where.OR = keywordOr;
      }
    }

    // 回收站默认按删除时间倒序；白名单与主列表共用，nulls 策略与主列表对齐。
    const orderBy = resolveOrderBy<Prisma.CustomerOrderByWithRelationInput>(sortBy, sortOrder, {
      whitelist: CUSTOMER_SORT_WHITELIST,
      fallback: { deletedAt: 'desc' },
      nullsPolicy: { lastKeepRecordTime: 'nullsLast', nextFollowUpAt: 'nullsLast' },
    });

    const [data, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          charger: { select: { id: true, name: true } },
        },
      }),
      this.prisma.customer.count({ where }),
    ]);

    const intentUpdatedByIds = [
      ...new Set(data.flatMap((item) => (item.intentUpdatedById ? [item.intentUpdatedById] : []))),
    ];
    const intentUpdaters =
      intentUpdatedByIds.length > 0
        ? await this.prisma.employee.findMany({
            where: { id: { in: intentUpdatedByIds } },
            select: { id: true, name: true },
          })
        : [];
    const intentUpdaterNames = new Map(
      intentUpdaters.map((employee) => [employee.id, employee.name])
    );

    return {
      items: data.map((item) =>
        serializeEntity<CustomerResponseOutput>({
          ...item,
          nextFollowUpAt: toDateOnlyString(item.nextFollowUpAt),
          intentUpdatedByName: item.intentUpdatedById
            ? (intentUpdaterNames.get(item.intentUpdatedById) ?? null)
            : null,
          chargerName: item.charger?.name ?? item.chargerName,
          collaboratorIds: fromJsonValue<string[]>(item.collaboratorIds) ?? null,
          accountsReceivable: toDecimalNumber(item.accountsReceivable),
        })
      ),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 恢复已删除客户。恢复主写与事实生命周期重算同事务提交，且整次人工操作只推进一次 version。
   */
  async restore(
    id: string,
    dto: RestoreCustomerInput,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<CustomerResponseOutput> {
    if (!Number.isInteger(dto.version) || dto.version < 1) {
      throw new BadRequestException('恢复客户必须携带有效的 version');
    }

    // 锁前快照只负责 404/权限语义；最终确认必须始终使用调用方 dto.version。
    const initialWhere: Prisma.CustomerWhereInput = { id };
    applyCustomerCollabSelfScope(initialWhere, chargerScope, currentEmployeeId);
    const customer = await this.prisma.customer.findFirst({ where: initialWhere });
    if (!customer) {
      throw new NotFoundException(`客户 ${id} 不存在`);
    }
    if (customer.deletedAt === null || customer.version !== dto.version) {
      throw new ConflictException('客户删除状态或版本已变化，请刷新后重试');
    }

    await this.prisma.$transaction(async (tx) => {
      await this.lockCustomerManualWriteTargets(tx, [id]);
      const restoreWhere: Prisma.CustomerWhereInput = {
        id,
        version: dto.version,
        deletedAt: { not: null },
      };
      applyCustomerCollabSelfScope(restoreWhere, chargerScope, currentEmployeeId);
      const restored = await tx.customer.updateMany({
        where: restoreWhere,
        data: {
          deletedAt: null,
          ...auditUpdate(currentUser),
          version: { increment: 1 },
        },
      });
      if (restored.count !== 1) {
        throw new ConflictException('客户删除状态、版本或数据范围已变化，请刷新后重试');
      }

      // 主写已经完成唯一一次 version + 1；生命周期只在真实派生值变化时保版本 CAS 回写。
      await this.customerLifecycle.recompute(
        id,
        {
          syncLeadProgress: true,
          actor: currentUser,
          versioning: { mode: 'preserve', expectedVersion: dto.version + 1 },
        },
        tx
      );
    });

    const response = await this.findOne(id, chargerScope, currentEmployeeId);
    await this.changeLog?.logChange({
      module: 'customers',
      action: 'restore',
      target: id,
      targetName: response.customerName,
      currentUser,
      before: customer,
      after: response,
    });
    return response;
  }

  /**
   * 永久删除客户（物理删除）
   *
   * P1-14 防护：物删前必须先扫所有子表（含软删行）的反向引用，>0 抛 409。
   * 最终 DELETE 必须绑定调用方版本；禁止读取最新版本后替调用方确认。
   */
  async permanentRemove(id: string, dto: PermanentRemoveCustomerInput): Promise<void> {
    if (!Number.isInteger(dto.version) || dto.version < 1) {
      throw new BadRequestException('永久删除客户必须携带有效的 version');
    }

    // 锁前只用于区分一开始就不存在；等待锁后的消失/恢复/再次删除统一视为 409。
    const initiallyExisting = await this.prisma.customer.findUnique({ where: { id } });
    if (!initiallyExisting) {
      throw new NotFoundException(`客户 ${id} 不存在`);
    }
    if (initiallyExisting.deletedAt === null || initiallyExisting.version !== dto.version) {
      throw new ConflictException('客户删除状态或版本已变化，请刷新后重试');
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.lockCustomerManualWriteTargets(tx, [id]);
        const customer = await tx.customer.findUnique({ where: { id } });
        if (!customer || customer.deletedAt === null || customer.version !== dto.version) {
          throw new ConflictException('客户删除状态或版本已变化，请刷新后重试');
        }

        // 反向 count 包含 deletedAt 软删行，避免软删子记录被父孤儿化。
        const [contacts, opportunities, saleOrders, payments, invoices, keepRecords, visitRecords] =
          await Promise.all([
            tx.contact.count({ where: { customerId: id } }),
            tx.opportunity.count({ where: { customerId: id } }),
            tx.saleOrder.count({ where: { customerId: id } }),
            tx.payment.count({ where: { customerId: id } }),
            tx.invoice.count({ where: { customerId: id } }),
            tx.keepRecord.count({ where: { customerId: id } }),
            tx.visitRecord.count({ where: { customerId: id } }),
          ]);

        const total =
          contacts + opportunities + saleOrders + payments + invoices + keepRecords + visitRecords;
        if (total > 0) {
          throw new ConflictException(
            `客户 ${id} 仍有 ${total} 条子记录引用` +
              `（联系人 ${contacts} / 商机 ${opportunities} / 订单 ${saleOrders} / ` +
              `回款 ${payments} / 发票 ${invoices} / 跟进 ${keepRecords} / 拜访 ${visitRecords}），` +
              `请先处理子记录再永久删除`
          );
        }

        await tx.customer.delete({
          where: { id, version: dto.version, deletedAt: { not: null } },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException('客户删除状态或版本已变化，请刷新后重试');
      }
      throw error;
    }
  }

  /**
   * 查询所有客户（用于下拉框等场景）
   *
   * 排序策略：
   * - 无 keyword：按 updatedAt desc，让最近活跃客户排前面，历史脏数据（手机号当客户名/纯数字编号等）沉到底部
   * - 有 keyword：应用层按"近似度"重排，命中位置越靠前越优先：
   *   ① customerName 以 keyword 开头（前缀匹配） → 最高
   *   ② customerName 包含 keyword（非前缀） → 次之
   *   ③ 仅 serialNumber 命中 → 最低
   *   同 tier 内按 updatedAt desc
   */
  async findAllForSelection(
    keyword?: string,
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ) {
    const where: Prisma.CustomerWhereInput = {
      deletedAt: null,
    };

    // 数据范围过滤：负责人或协作人
    applyCustomerCollabSelfScope(where, chargerScope, currentEmployeeId);

    if (keyword) {
      const keywordOr = [
        { customerName: { contains: keyword, mode: 'insensitive' as const } },
        { serialNumber: { contains: keyword, mode: 'insensitive' as const } },
      ];
      if (where.OR) {
        where.AND = [{ OR: where.OR }, { OR: keywordOr }];
        delete where.OR;
      } else {
        where.OR = keywordOr;
      }
    }

    const customers = await this.prisma.customer.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        serialNumber: true,
        customerName: true,
        updatedAt: true,
      },
      // 下拉框场景，限制最多返回 200 条，避免大表全表扫描后再做应用层排序
      take: 200,
    });

    const stripUpdatedAt = (c: (typeof customers)[number]) => ({
      id: c.id,
      serialNumber: c.serialNumber,
      customerName: c.customerName,
    });

    // 无 keyword：数据库已按 updatedAt desc 排好，直接返回
    if (!keyword) {
      return customers.map(stripUpdatedAt);
    }

    // 有 keyword：按近似度重排
    const lowerKeyword = keyword.toLowerCase();
    const tier = (c: { customerName: string }): number => {
      const name = (c.customerName ?? '').toLowerCase();
      if (name.startsWith(lowerKeyword)) return 0;
      if (name.includes(lowerKeyword)) return 1;
      return 2; // 仅 serialNumber 命中
    };

    const sorted = [...customers].sort((a, b) => {
      const ta = tier(a);
      const tb = tier(b);
      if (ta !== tb) return ta - tb;
      // 同 tier 按 updatedAt desc
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });

    return sorted.map(stripUpdatedAt);
  }

  private buildLegacyFilters(query: QueryCustomerDto): Record<string, unknown> {
    return {
      status: query.status,
      customerLevel: query.customerLevel,
      customerSource: query.customerSource,
      contactStatus: query.contactStatus,
      dealStatus: query.dealStatus,
      leadProgressStatus: query.leadProgressStatus,
      chargerId: query.chargerId,
      hasContactPhone: query.hasContactPhone,
    };
  }

  /**
   * 五类批量写共用的确定性锁后快照。
   *
   * 事务先记录“请求开始时在 scope 内”的候选集合（不按 deletedAt 过滤），再按 id 固定顺序
   * 等待全部人工写锁。拿锁后必须先无 scope 地读取全部真实行并一次性核对候选的存在性、
   * deletedAt 与调用方 version；随后才重新做 scope 分类。任一原候选在等待期间丢 scope、
   * 被软删或改版都抛 409，写循环尚未开始，整批回滚。最初就越权/不存在的 id 仍按既有
   * 业务语义进入 skipped，不能因等待期间偶然进入 scope 而被本批写入。
   */
  private async loadLockedCustomerBatchTargets(
    tx: Prisma.TransactionClient,
    ids: string[],
    versions: Readonly<Record<string, number>>,
    chargerScope: string[] | null | undefined,
    currentEmployeeId: string | null | undefined
  ): Promise<{ targetRows: Customer[]; skipped: string[] }> {
    const requestedIds = [...new Set(ids)];
    const initialScopeWhere: Prisma.CustomerWhereInput = { id: { in: requestedIds } };
    applyCustomerCollabSelfScope(initialScopeWhere, chargerScope, currentEmployeeId);
    const initialScopedRows = await tx.customer.findMany({ where: initialScopeWhere });
    const initialCandidateIds = new Set(initialScopedRows.map((row) => row.id));

    const sortedIds = await this.lockCustomerManualWriteTargets(tx, requestedIds, [
      ...initialCandidateIds,
    ]);

    // 先读全部真实行，不允许 scope 条件把并发变化后的原候选静默过滤掉。
    const lockedRows = await tx.customer.findMany({ where: { id: { in: sortedIds } } });
    const lockedById = new Map(lockedRows.map((row) => [row.id, row]));
    for (const id of [...initialCandidateIds].sort()) {
      const expectedVersion = this.requireCustomerBatchVersion(versions, id);
      const row = lockedById.get(id);
      if (!row || row.deletedAt !== null || row.version !== expectedVersion) {
        throw new ConflictException(`客户 ${id} 已被删除或修改，请刷新后重试`);
      }
    }

    const candidateIds = sortedIds.filter((id) => initialCandidateIds.has(id));
    let lockedScopedRows: Customer[] = [];
    if (candidateIds.length > 0) {
      const lockedScopeWhere: Prisma.CustomerWhereInput = {
        id: { in: candidateIds },
        deletedAt: null,
      };
      applyCustomerCollabSelfScope(lockedScopeWhere, chargerScope, currentEmployeeId);
      lockedScopedRows = await tx.customer.findMany({ where: lockedScopeWhere });
    }
    const lockedScopedById = new Map(lockedScopedRows.map((row) => [row.id, row]));
    for (const id of candidateIds) {
      if (!lockedScopedById.has(id)) {
        throw new ConflictException(`客户 ${id} 的数据范围已变化，请刷新后重试`);
      }
    }

    return {
      targetRows: candidateIds.map((id) => lockedScopedById.get(id) as Customer),
      skipped: ids.filter((id) => !initialCandidateIds.has(id)),
    };
  }

  private assertCustomerBatchSnapshot(
    row: Pick<Customer, 'id' | 'version' | 'deletedAt'>,
    versions: Readonly<Record<string, number>>
  ): number {
    const expectedVersion = this.requireCustomerBatchVersion(versions, row.id);
    if (row.deletedAt !== null || row.version !== expectedVersion) {
      throw new ConflictException(`客户 ${row.id} 已被删除或修改，请刷新后重试`);
    }
    return expectedVersion;
  }

  /**
   * 批量转交：把选中客户的负责人换成 chargerId
   *
   * 协作人处理（2026-05-18 决策）：保留现有协作人，但如果新负责人本人在协作人列表里，
   * 则把他从协作人移除——避免「既是负责人又是协作人」的悖论。
   * 转交后 chargerName/collaboratorName 置 null，读取时通过 charger 关联和 employee 查询动态拼接。
   */
  async batchTransfer(
    dto: BatchTransferCustomerInput,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<{ success: number; skipped: string[] }> {
    const { ids, versions, chargerId } = dto;

    const newCharger = await this.prisma.employee.findUnique({
      where: { id: chargerId },
      select: { id: true },
    });
    if (!newCharger) {
      throw new NotFoundException(`员工 ${chargerId} 不存在`);
    }

    const { targetRows, skipped, beforeRows } = await this.prisma.$transaction(async (tx) => {
      const lockedTargets = await this.loadLockedCustomerBatchTargets(
        tx,
        ids,
        versions,
        chargerScope,
        currentEmployeeId
      );
      const beforeRows = this.changeLog ? [...lockedTargets.targetRows] : [];
      for (const row of lockedTargets.targetRows) {
        const expectedVersion = this.assertCustomerBatchSnapshot(row, versions);
        const existing = fromJsonValue<string[]>(row.collaboratorIds) ?? [];
        const cleaned = existing.filter((collaboratorId) => collaboratorId !== chargerId);
        const result = await tx.customer.updateMany({
          where: this.buildCustomerBatchCasWhere(
            row.id,
            expectedVersion,
            chargerScope,
            currentEmployeeId
          ),
          data: {
            chargerId,
            chargerName: null,
            ...(cleaned.length !== existing.length
              ? {
                  collaboratorIds: toJsonValue(cleaned),
                  collaboratorName: null,
                }
              : {}),
            ...auditUpdate(currentUser),
            version: { increment: 1 },
          },
        });
        this.assertCustomerBatchCasCount(result.count, row.id);
      }
      return { ...lockedTargets, beforeRows };
    });
    const targetIds = targetRows.map((row) => row.id);

    if (this.changeLog) {
      const afterRows = await this.loadCustomerLogRows(targetIds);
      await this.writeCustomerChangeLogs({
        action: 'batch-transfer',
        currentUser,
        beforeRows,
        afterRows,
      });
    }
    return { success: targetRows.length, skipped };
  }

  /** 批量编辑：仅允许 shared schema 中的四个白名单字段。 */
  async batchUpdate(
    dto: BatchUpdateCustomerInput,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<{ success: number; skipped: string[] }> {
    const { ids, versions, patch } = dto;
    const data: Prisma.CustomerUpdateManyMutationInput = {};
    if (patch.customerLevel !== undefined) data.customerLevel = patch.customerLevel;
    if (patch.industry !== undefined) data.industry = patch.industry;
    if (patch.customerSource !== undefined) data.customerSource = patch.customerSource;
    if (patch.customerRelationship !== undefined) {
      data.customerRelationship = patch.customerRelationship;
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('至少需要修改一个字段');
    }

    const { targetRows, skipped, beforeRows } = await this.prisma.$transaction(async (tx) => {
      const lockedTargets = await this.loadLockedCustomerBatchTargets(
        tx,
        ids,
        versions,
        chargerScope,
        currentEmployeeId
      );
      const beforeRows = this.changeLog ? [...lockedTargets.targetRows] : [];
      for (const row of lockedTargets.targetRows) {
        const expectedVersion = this.assertCustomerBatchSnapshot(row, versions);
        const result = await tx.customer.updateMany({
          where: this.buildCustomerBatchCasWhere(
            row.id,
            expectedVersion,
            chargerScope,
            currentEmployeeId
          ),
          data: {
            ...data,
            ...auditUpdate(currentUser),
            version: { increment: 1 },
          },
        });
        this.assertCustomerBatchCasCount(result.count, row.id);
      }
      return { ...lockedTargets, beforeRows };
    });
    const targetIds = targetRows.map((row) => row.id);

    if (this.changeLog) {
      const afterRows = await this.loadCustomerLogRows(targetIds);
      await this.writeCustomerChangeLogs({
        action: 'batch-update',
        currentUser,
        beforeRows,
        afterRows,
      });
    }
    return { success: targetRows.length, skipped };
  }

  /** 批量添加协作人；每个目标都执行独立 CAS，包含原本已具备协作人的目标。 */
  async batchAddCollaborators(
    dto: BatchCollaboratorsCustomerInput,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<{ success: number; skipped: string[] }> {
    const { ids, versions, collaboratorIds: addIds } = dto;
    const employees = await this.prisma.employee.findMany({
      where: { id: { in: addIds } },
      select: { id: true },
    });
    if (employees.length !== new Set(addIds).size) {
      const found = new Set(employees.map((employee) => employee.id));
      const missing = addIds.filter((employeeId) => !found.has(employeeId));
      throw new NotFoundException(`员工不存在: ${missing.join(', ')}`);
    }

    const { targetRows, skipped, beforeRows } = await this.prisma.$transaction(async (tx) => {
      const lockedTargets = await this.loadLockedCustomerBatchTargets(
        tx,
        ids,
        versions,
        chargerScope,
        currentEmployeeId
      );
      const beforeRows = this.changeLog ? [...lockedTargets.targetRows] : [];
      for (const row of lockedTargets.targetRows) {
        const expectedVersion = this.assertCustomerBatchSnapshot(row, versions);
        const existing = fromJsonValue<string[]>(row.collaboratorIds) ?? [];
        const merged = [...new Set([...existing, ...addIds])];
        const result = await tx.customer.updateMany({
          where: this.buildCustomerBatchCasWhere(
            row.id,
            expectedVersion,
            chargerScope,
            currentEmployeeId
          ),
          data: {
            collaboratorIds: toJsonValue(merged),
            collaboratorName: null,
            ...auditUpdate(currentUser),
            version: { increment: 1 },
          },
        });
        this.assertCustomerBatchCasCount(result.count, row.id);
      }
      return { ...lockedTargets, beforeRows };
    });
    const targetIds = targetRows.map((row) => row.id);

    if (this.changeLog) {
      const afterRows = await this.loadCustomerLogRows(targetIds);
      await this.writeCustomerChangeLogs({
        action: 'batch-add-collab',
        currentUser,
        beforeRows,
        afterRows,
      });
    }
    return { success: targetRows.length, skipped };
  }

  /** 批量移除协作人；无业务差异的目标仍做 CAS，不能把 stale 伪装成跳过。 */
  async batchRemoveCollaborators(
    dto: BatchCollaboratorsCustomerInput,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<{ success: number; skipped: string[] }> {
    const { ids, versions, collaboratorIds: removeIds } = dto;
    const removeSet = new Set(removeIds);
    const { targetRows, skipped, beforeRows } = await this.prisma.$transaction(async (tx) => {
      const lockedTargets = await this.loadLockedCustomerBatchTargets(
        tx,
        ids,
        versions,
        chargerScope,
        currentEmployeeId
      );
      const beforeRows = this.changeLog ? [...lockedTargets.targetRows] : [];
      for (const row of lockedTargets.targetRows) {
        const expectedVersion = this.assertCustomerBatchSnapshot(row, versions);
        const existing = fromJsonValue<string[]>(row.collaboratorIds) ?? [];
        const filtered = existing.filter((collaboratorId) => !removeSet.has(collaboratorId));
        const result = await tx.customer.updateMany({
          where: this.buildCustomerBatchCasWhere(
            row.id,
            expectedVersion,
            chargerScope,
            currentEmployeeId
          ),
          data: {
            collaboratorIds: toJsonValue(filtered),
            collaboratorName: null,
            ...auditUpdate(currentUser),
            version: { increment: 1 },
          },
        });
        this.assertCustomerBatchCasCount(result.count, row.id);
      }
      return { ...lockedTargets, beforeRows };
    });
    const targetIds = targetRows.map((row) => row.id);

    if (this.changeLog) {
      const afterRows = await this.loadCustomerLogRows(targetIds);
      await this.writeCustomerChangeLogs({
        action: 'batch-remove-collab',
        currentUser,
        beforeRows,
        afterRows,
      });
    }
    return { success: targetRows.length, skipped };
  }

  /** 批量软删除；任一目标 stale 时事务抛错并回滚此前可执行写。 */
  async batchRemove(
    dto: BatchRemoveCustomerInput,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<{ success: number; skipped: string[] }> {
    const { ids, versions } = dto;
    const deletedAt = new Date();
    const { targetRows, skipped, beforeRows } = await this.prisma.$transaction(async (tx) => {
      const lockedTargets = await this.loadLockedCustomerBatchTargets(
        tx,
        ids,
        versions,
        chargerScope,
        currentEmployeeId
      );
      const beforeRows = this.changeLog ? [...lockedTargets.targetRows] : [];
      for (const row of lockedTargets.targetRows) {
        const expectedVersion = this.assertCustomerBatchSnapshot(row, versions);
        const result = await tx.customer.updateMany({
          where: this.buildCustomerBatchCasWhere(
            row.id,
            expectedVersion,
            chargerScope,
            currentEmployeeId
          ),
          data: {
            deletedAt,
            ...auditUpdate(currentUser),
            version: { increment: 1 },
          },
        });
        this.assertCustomerBatchCasCount(result.count, row.id);
      }
      return { ...lockedTargets, beforeRows };
    });
    const targetIds = targetRows.map((row) => row.id);

    if (this.changeLog) {
      const afterRows = await this.loadCustomerLogRows(targetIds);
      await this.writeCustomerChangeLogs({
        action: 'batch-delete',
        currentUser,
        beforeRows,
        afterRows,
      });
    }
    return { success: targetRows.length, skipped };
  }
}
