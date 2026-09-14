import { OPPORTUNITY_STAGE, PROJECT_STATUS } from '@ky-azeroth/shared/constants';
import type { OpportunityResponseOutput } from '@ky-azeroth/shared/schemas/opportunity';
import type { OpportunityForSelection } from '@ky-azeroth/shared/types';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { SerialNumberType } from '../../common/constants/serial-number.constants';
import { FilterApplierService } from '../../common/filter-scheme';
import type { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  applyCustomerCollabSelfScope,
  applyCustomerCollabViaCustomerScope,
} from '../../common/services/data-scope.service';
import { SerialNumberService } from '../../common/services/serial-number.service';
import { auditCreate, auditUpdate } from '../../common/utils/audit-helper';
import { resolveOrderBy } from '../../common/utils/order-by.helper';
import {
  calculatePagination,
  serializeEntity,
  toDateOnlyString,
  toDecimalNumber,
} from '../../common/utils/response-helpers';
import { CustomersService } from '../customers/customers.service';
import { CrmChangeLogService } from '../operation-logs/crm-change-log.service';
import {
  ensureCustomDevelopmentProject,
  hasCustomDevelopmentProduct,
} from '../projects/project-lifecycle.helper';
import {
  decimalProductFingerprint,
  diffProductSnapshots,
} from '../sale-orders/product-snapshot-diff.helper';
import { OPPORTUNITY_WON_SOURCE } from '../sale-orders/sale-order-activation-lifecycle.helper';
import {
  assertOpportunityHasNoActiveSaleOrder,
  lockOpportunityRelationshipGraph,
} from '../sale-orders/sale-order-opportunity-link.helper';
import { CreateOpportunityDto } from './dto/create-opportunity.dto';
import { QueryOpportunityDto } from './dto/query-opportunity.dto';
import { UpdateOpportunityDto } from './dto/update-opportunity.dto';
import { OPPORTUNITY_FILTER_REGISTRY } from './opportunities.filter-registry';
import { resolveOpportunityName } from './opportunity-name.helper';

/**
 * 商机列表允许的排序字段白名单。
 * 预计成交日期 / 实际成交日期 / 失单日期 + 金额 + 创建/更新时间。
 * 注：findAllForSelection 固定 createdAt desc，不消费前端 sortBy。
 */
const OPPORTUNITY_SORT_WHITELIST: ReadonlySet<string> = new Set([
  'opportunityName',
  'opportunityAmount',
  'expectedDealDate',
  'realDealDate',
  'lostDate',
  'createdAt',
  'updatedAt',
]);

interface OpportunityProductSnapshotWrite {
  productName: string;
  productNumber: string | null;
  productPrice: string | null;
  quantity: string | null;
  unitPrice: string | null;
  discount: string | null;
  subtotalAmount: string;
  remark: string | null;
}

interface ExistingOpportunityProductSnapshot {
  id: string;
  version: number;
  productName: string;
  productNumber: string | null;
  productPrice: unknown;
  quantity: unknown;
  unitPrice: unknown;
  discount: unknown;
  subtotalAmount: unknown;
  remark: string | null;
}

@Injectable()
export class OpportunitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly serialNumberService: SerialNumberService,
    @Inject(forwardRef(() => CustomersService))
    private readonly customersService: CustomersService,
    private readonly filterApplier: FilterApplierService,
    private readonly changeLog?: CrmChangeLogService
  ) {}

  async findAll(
    query: QueryOpportunityDto,
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null,
    rawQuery?: unknown
  ): Promise<PaginatedResponse<OpportunityResponseOutput>> {
    const { page = 1, pageSize = 10, sortBy, sortOrder } = query;
    const { skip, take } = calculatePagination(page, pageSize);

    // RBAC：三路径 OR（自身 chargerId / customer.chargerId / customer.collaboratorIds 含我）。
    // chargerScope 传 null 让 applier 不再注入 isScopeField AND，避免覆盖 OR；
    // 配套地，filter-registry 的 chargerId 字段已去掉 isScopeField 标记。
    const baseWhere: Prisma.OpportunityWhereInput = { deletedAt: null };
    applyCustomerCollabViaCustomerScope(baseWhere, chargerScope, currentEmployeeId);

    const where = await this.filterApplier.buildWhere<Prisma.OpportunityWhereInput>({
      registry: OPPORTUNITY_FILTER_REGISTRY,
      rawQuery,
      legacyKeyword: query.keyword,
      legacyFilters: this.buildLegacyFilters(query),
      chargerScope: null,
      baseWhere,
    });

    const orderBy = resolveOrderBy<Prisma.OpportunityOrderByWithRelationInput>(sortBy, sortOrder, {
      whitelist: OPPORTUNITY_SORT_WHITELIST,
      fallback: { createdAt: 'desc' },
    });

    const [items, total] = await Promise.all([
      this.prisma.opportunity.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          charger: { select: { id: true, name: true, avatar: true } },
          customer: {
            select: { id: true, customerName: true, shortName: true },
          },
          contact: {
            select: { id: true, contactName: true },
          },
          ...(query.withProducts
            ? {
                products: {
                  where: { deletedAt: null },
                  select: { id: true, productName: true },
                  orderBy: { createdAt: 'asc' as const },
                },
              }
            : {}),
        },
      }),
      this.prisma.opportunity.count({ where }),
    ]);

    const data = items.map((item) =>
      serializeEntity<OpportunityResponseOutput>({
        ...item,
        chargerName: item.charger?.name ?? item.chargerName,
        chargerAvatar: item.charger?.avatar ?? null,
        expectedDealDate: toDateOnlyString(item.expectedDealDate),
        realDealDate: toDateOnlyString(item.realDealDate),
        lostDate: toDateOnlyString(item.lostDate),
        opportunityAmount: toDecimalNumber(item.opportunityAmount),
        winRate: toDecimalNumber(item.winRate),
        wonSourcePreviousDealDate: toDateOnlyString(item.wonSourcePreviousDealDate),
        wonSourcePreviousWinRate:
          item.wonSourcePreviousWinRate == null
            ? null
            : toDecimalNumber(item.wonSourcePreviousWinRate),
      })
    );

    return {
      items: data,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 查询所有商机（用于下拉框等场景）
   */
  async findAllForSelection(
    query: {
      keyword?: string;
      customerId?: string;
      stage?: string;
      availableForSaleOrder?: boolean;
      currentSaleOrderId?: string;
    },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<OpportunityForSelection[]> {
    // RBAC：三路径 OR（自身 chargerId / customer.chargerId / customer.collaboratorIds 含我）；
    // keyword 也是 OR 形态，要用 AND 包起来防止互相吞掉。
    const where: Prisma.OpportunityWhereInput = { deletedAt: null };
    if (query.customerId) where.customerId = query.customerId;
    if (query.stage) where.opportunityStage = query.stage;

    const andClauses: Prisma.OpportunityWhereInput[] = [];
    if (chargerScope !== undefined && chargerScope !== null) {
      // 与 applyCustomerCollabViaCustomerScope 保持同语义（2026-06-04 加入公海可见 OR）：
      // keyword OR 与 RBAC OR 必须用 AND 包起来，无法直接复用 helper；但 OR 项必须与
      // helper 一致，否则下拉选商机看不到公海历史，与列表不一致。
      const scopeOr: Prisma.OpportunityWhereInput[] = [
        { chargerId: { in: chargerScope } },
        { customer: { chargerId: { in: chargerScope } } },
        { customer: { chargerId: null } },
      ];
      if (currentEmployeeId) {
        scopeOr.push({
          customer: { collaboratorIds: { array_contains: [currentEmployeeId] } },
        });
      }
      andClauses.push({ OR: scopeOr });
    }
    if (query.keyword) {
      andClauses.push({
        OR: [
          { opportunityName: { contains: query.keyword, mode: 'insensitive' as const } },
          { serialNumber: { contains: query.keyword, mode: 'insensitive' as const } },
        ],
      });
    }
    if (query.availableForSaleOrder) {
      andClauses.push(
        query.currentSaleOrderId
          ? {
              OR: [
                { saleOrders: { none: { deletedAt: null } } },
                { saleOrders: { some: { id: query.currentSaleOrderId, deletedAt: null } } },
              ],
            }
          : { saleOrders: { none: { deletedAt: null } } }
      );
    }
    if (andClauses.length > 0) where.AND = andClauses;

    const items = await this.prisma.opportunity.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        serialNumber: true,
        opportunityName: true,
        opportunityAmount: true,
        opportunityStage: true,
        customer: {
          select: { customerName: true },
        },
        products: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          select: { productName: true },
        },
      },
    });

    return items.map((item) => ({
      id: item.id,
      serialNumber: item.serialNumber,
      opportunityName: item.opportunityName,
      customerName: item.customer?.customerName,
      opportunityAmount: toDecimalNumber(item.opportunityAmount),
      opportunityStage: item.opportunityStage,
      productNames: item.products.map((p) => p.productName).filter(Boolean),
    }));
  }

  async findOne(
    id: string,
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<OpportunityResponseOutput> {
    const where: Prisma.OpportunityWhereInput = { id, deletedAt: null };
    applyCustomerCollabViaCustomerScope(where, chargerScope, currentEmployeeId);
    const opportunity = await this.prisma.opportunity.findFirst({
      where,
      include: {
        charger: { select: { id: true, name: true, avatar: true } },
        customer: {
          select: { id: true, customerName: true, shortName: true },
        },
        contact: {
          select: { id: true, contactName: true },
        },
        products: {
          where: { deletedAt: null },
          select: {
            id: true,
            productName: true,
            productNumber: true,
            productPrice: true,
            quantity: true,
            unitPrice: true,
            discount: true,
            subtotalAmount: true,
            remark: true,
          },
        },
      },
    });

    if (!opportunity) {
      throw new NotFoundException(`商机 ${id} 不存在`);
    }

    return serializeEntity<OpportunityResponseOutput>({
      ...opportunity,
      chargerName: opportunity.charger?.name ?? opportunity.chargerName,
      chargerAvatar: opportunity.charger?.avatar ?? null,
      expectedDealDate: toDateOnlyString(opportunity.expectedDealDate),
      realDealDate: toDateOnlyString(opportunity.realDealDate),
      lostDate: toDateOnlyString(opportunity.lostDate),
      opportunityAmount: toDecimalNumber(opportunity.opportunityAmount),
      winRate: toDecimalNumber(opportunity.winRate),
      wonSourcePreviousDealDate: toDateOnlyString(opportunity.wonSourcePreviousDealDate),
      wonSourcePreviousWinRate:
        opportunity.wonSourcePreviousWinRate == null
          ? null
          : toDecimalNumber(opportunity.wonSourcePreviousWinRate),
    });
  }

  async create(
    dto: CreateOpportunityDto,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<OpportunityResponseOutput> {
    await this.assertCustomerInScope(dto.customerId, chargerScope, currentEmployeeId);
    this.assertChargerInScope(dto.chargerId, chargerScope);
    if (dto.contactId) {
      await this.assertContactBelongsToCustomer(dto.contactId, dto.customerId);
    }

    const serialNumber = await this.serialNumberService.generate(SerialNumberType.OPPORTUNITY);

    const { products, ...opportunityFields } = dto;
    const productSnapshots = (products ?? []).map((product) =>
      this.buildOpportunityProductSnapshot(product)
    );
    const resolvedOpportunityAmount = this.resolveOpportunityAmount(
      opportunityFields.opportunityAmount,
      products
    );
    const resolvedOpportunityName = await resolveOpportunityName(
      this.prisma,
      opportunityFields.opportunityName,
      opportunityFields.customerId,
      resolvedOpportunityAmount
    );

    // 商机阶段=赢单 时若前端未传 realDealDate，自动填当前时间，确保赢单数据完整。
    const resolvedRealDealDate = this.resolveRealDealDate(
      opportunityFields.opportunityStage,
      opportunityFields.realDealDate,
      null
    );

    // 商机阶段=输单流失 时若前端未传 lostDate，自动填当前时间。
    // 同时若失单原因为空，throw BadRequest（Zod refine 已拦一道，这里是兜底）。
    this.assertLostReasonOnLost(opportunityFields.opportunityStage, opportunityFields.loseReason);
    this.assertLoseReasonDetailOnOther(
      opportunityFields.loseReason,
      opportunityFields.loseReasonDetail
    );
    // loseReason ≠ '其他' 时自动清空 detail，避免脏数据残留
    const resolvedLoseReasonDetail =
      opportunityFields.loseReason === '其他' ? opportunityFields.loseReasonDetail : null;
    const resolvedLostDate = this.resolveLostDate(
      opportunityFields.opportunityStage,
      opportunityFields.lostDate,
      null
    );

    const opportunityId = await this.prisma.$transaction(async (tx) => {
      // 新商机尚无 Opportunity/SaleOrder 行；仍先进入统一图并把 Customer 作为最后一类锁。
      // 锁后重验客户/联系人，禁止事务外 scope 快照被并发软删或改绑穿透。
      await lockOpportunityRelationshipGraph(tx, [], [opportunityFields.customerId]);
      await this.assertCustomerInScope(
        opportunityFields.customerId,
        chargerScope,
        currentEmployeeId,
        tx
      );
      if (opportunityFields.contactId) {
        await this.assertContactBelongsToCustomer(
          opportunityFields.contactId,
          opportunityFields.customerId,
          tx
        );
      }

      const opportunity = await tx.opportunity.create({
        data: {
          serialNumber,
          opportunityName: resolvedOpportunityName,
          customerId: opportunityFields.customerId,
          contactId: opportunityFields.contactId ?? undefined,
          opportunityStage: opportunityFields.opportunityStage ?? undefined,
          opportunityAmount:
            resolvedOpportunityAmount != null ? String(resolvedOpportunityAmount) : undefined,
          // P1-15: 切到赢单且 caller 未传 winRate 时自动置 100；已传则尊重 caller
          winRate:
            opportunityFields.winRate != null
              ? String(opportunityFields.winRate)
              : opportunityFields.opportunityStage === OPPORTUNITY_STAGE.WON
                ? '100'
                : undefined,
          expectedDealDate: opportunityFields.expectedDealDate
            ? new Date(opportunityFields.expectedDealDate)
            : undefined,
          realDealDate: resolvedRealDealDate ?? undefined,
          lostDate: resolvedLostDate ?? undefined,
          // 默认负责人 = 当前操作人，避免 NULL chargerId 被列表默认筛选过滤掉
          chargerId: opportunityFields.chargerId ?? currentUser.employeeId ?? currentUser.id,
          loseReason: opportunityFields.loseReason ?? undefined,
          loseReasonDetail: resolvedLoseReasonDetail ?? undefined,
          ...(opportunityFields.opportunityStage === OPPORTUNITY_STAGE.WON
            ? { wonSourceType: OPPORTUNITY_WON_SOURCE.MANUAL }
            : {}),
          remark: opportunityFields.remark ?? undefined,
          ...auditCreate(currentUser),
        },
      });

      // 创建产品明细行
      if (productSnapshots.length > 0) {
        const productAudit = auditCreate(currentUser);
        await tx.opportunityProduct.createMany({
          data: productSnapshots.map((product) => ({
            opportunityId: opportunity.id,
            ...product,
            ...productAudit,
          })),
        });
      }

      await ensureCustomDevelopmentProject(
        tx,
        {
          opportunityId: opportunity.id,
          customerId: opportunity.customerId,
          ownerId: opportunity.chargerId,
          productNames: products?.map((product) => product.productName) ?? [],
          opportunityStage: opportunity.opportunityStage,
        },
        PROJECT_STATUS.OPPORTUNITY,
        currentUser
      );

      // 商机、产品/项目与客户派生状态是一个业务写入，任一步失败都必须整体回滚。
      await this.customersService.refreshCustomerLifecycle(opportunity.customerId, currentUser, tx);
      return opportunity.id;
    });

    // 事务提交后再查询完整关联数据
    const response = await this.findOne(opportunityId);
    await this.changeLog?.logChange({
      module: 'opportunities',
      action: 'create',
      target: response.id,
      targetName: response.opportunityName,
      currentUser,
      after: response,
    });
    return response;
  }

  async update(
    id: string,
    dto: UpdateOpportunityDto,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<OpportunityResponseOutput> {
    const existing = await this.findOne(id, chargerScope, currentEmployeeId);

    const { version, products, ...fieldsDto } = dto;
    const requestedProductSnapshots =
      products === undefined
        ? undefined
        : products.map((product) => this.buildOpportunityProductSnapshot(product));
    const requestVersion = requirePositiveVersion(version, '更新商机');
    if (existing.version !== requestVersion) {
      throw new ConflictException(
        `数据已被其他用户修改，当前版本 ${existing.version}。请刷新后重试。`
      );
    }
    const finalCustomerId = fieldsDto.customerId ?? existing.customerId;
    const customerChanged =
      fieldsDto.customerId !== undefined && fieldsDto.customerId !== existing.customerId;
    if (customerChanged) {
      await this.assertCustomerInScope(finalCustomerId, chargerScope, currentEmployeeId);
    }
    this.assertChargerInScope(fieldsDto.chargerId, chargerScope);
    const finalContactId =
      fieldsDto.contactId !== undefined ? fieldsDto.contactId : existing.contactId;
    if (finalContactId) {
      await this.assertContactBelongsToCustomer(finalContactId, finalCustomerId);
    }

    // 策略 C：只要「最终 stage=输单流失 且 最终 loseReason 为空」就拦截，
    // 覆盖「stage 已是 LOST 但本次 dto 未传 stage 也未传 loseReason」的漏网场景。
    const finalStage =
      fieldsDto.opportunityStage !== undefined
        ? fieldsDto.opportunityStage
        : existing.opportunityStage;
    const finalLoseReason =
      fieldsDto.loseReason !== undefined ? fieldsDto.loseReason : existing.loseReason;
    const finalLoseReasonDetail =
      fieldsDto.loseReasonDetail !== undefined
        ? fieldsDto.loseReasonDetail
        : existing.loseReasonDetail;
    this.assertLostReasonOnLost(finalStage, finalLoseReason);
    this.assertLoseReasonDetailOnOther(finalLoseReason, finalLoseReasonDetail);

    const audit = auditUpdate(currentUser);
    const data: Prisma.OpportunityUpdateInput = {
      ...(audit.updaterEmployeeId
        ? { updater: { connect: { id: audit.updaterEmployeeId } } }
        : { updater: { disconnect: true } }),
      version: { increment: 1 },
    };

    // opportunityName 由后端无条件重新生成（前端表单只读），忽略 fieldsDto.opportunityName。
    if (fieldsDto.customerId !== undefined)
      data.customer = { connect: { id: fieldsDto.customerId } };
    if (fieldsDto.contactId !== undefined) {
      data.contact = fieldsDto.contactId
        ? { connect: { id: fieldsDto.contactId } }
        : { disconnect: true };
    }
    if (fieldsDto.opportunityStage !== undefined) {
      data.opportunityStage = fieldsDto.opportunityStage;
      // 显式选择 WON（即使原本已是 WON）代表人工再次确认；后续订单撤销不得回退。
      if (fieldsDto.opportunityStage === OPPORTUNITY_STAGE.WON) {
        data.wonSourceType = OPPORTUNITY_WON_SOURCE.MANUAL;
        data.wonSourceSaleOrderId = null;
        data.wonSourcePreviousStage = null;
        data.wonSourcePreviousDealDate = null;
        data.wonSourcePreviousWinRate = null;
      } else {
        // 人工离开 WON 时清空旧 provenance；若仍有有效订单，锁后门禁会拒绝本次写入。
        data.wonSourceType = null;
        data.wonSourceSaleOrderId = null;
        data.wonSourcePreviousStage = null;
        data.wonSourcePreviousDealDate = null;
        data.wonSourcePreviousWinRate = null;
      }
    }
    // 最终金额（用于回写 opportunityAmount + 生成 opportunityName 兜底标题）
    let finalAmount: number | string | null | undefined = existing.opportunityAmount;
    if (products !== undefined) {
      finalAmount = this.resolveOpportunityAmount(
        fieldsDto.opportunityAmount !== undefined
          ? fieldsDto.opportunityAmount
          : existing.opportunityAmount,
        products
      );
      data.opportunityAmount = finalAmount != null ? String(finalAmount) : null;
    } else if (fieldsDto.opportunityAmount !== undefined) {
      finalAmount = fieldsDto.opportunityAmount;
      data.opportunityAmount =
        fieldsDto.opportunityAmount != null ? String(fieldsDto.opportunityAmount) : null;
    }
    // referenceDate 传 existing.createdAt，保证编辑商机不会把标题里的日期推到"今天"
    data.opportunityName = await resolveOpportunityName(
      this.prisma,
      undefined,
      finalCustomerId,
      finalAmount,
      existing.createdAt
    );
    if (fieldsDto.winRate !== undefined) {
      data.winRate = fieldsDto.winRate != null ? String(fieldsDto.winRate) : null;
    } else if (
      fieldsDto.opportunityStage === OPPORTUNITY_STAGE.WON &&
      existing.opportunityStage !== OPPORTUNITY_STAGE.WON
    ) {
      // P1-15: 本次切到赢单且 caller 未传 winRate → 自动置 100
      data.winRate = '100';
    }
    if (fieldsDto.expectedDealDate !== undefined) {
      data.expectedDealDate = fieldsDto.expectedDealDate
        ? new Date(fieldsDto.expectedDealDate)
        : null;
    }
    if (fieldsDto.realDealDate !== undefined) {
      data.realDealDate = fieldsDto.realDealDate ? new Date(fieldsDto.realDealDate) : null;
    } else if (
      fieldsDto.opportunityStage !== undefined &&
      this.resolveRealDealDate(fieldsDto.opportunityStage, undefined, existing.realDealDate) !=
        null &&
      existing.realDealDate == null
    ) {
      // 阶段切到"赢单"且当前 realDealDate 为空时，前端未显式传值则自动填当前时间，
      // 保证赢单数据完整。前端若主动传 null 则尊重前端意图（走上面的分支）。
      data.realDealDate = new Date();
    }
    // 输单日期：参照 realDealDate 的对称逻辑——dto 显式传值优先，
    // 阶段切到 LOST 且原值为空时自动填当前时间；回改非 LOST 阶段时**保留**已填日期（策略：回改保留）。
    if (fieldsDto.lostDate !== undefined) {
      data.lostDate = fieldsDto.lostDate ? new Date(fieldsDto.lostDate) : null;
    } else if (
      fieldsDto.opportunityStage !== undefined &&
      this.resolveLostDate(fieldsDto.opportunityStage, undefined, existing.lostDate) != null &&
      existing.lostDate == null
    ) {
      data.lostDate = new Date();
    }
    if (fieldsDto.chargerId !== undefined) {
      data.charger = fieldsDto.chargerId
        ? { connect: { id: fieldsDto.chargerId } }
        : { disconnect: true };
    }
    if (fieldsDto.loseReason !== undefined) data.loseReason = fieldsDto.loseReason;
    // loseReasonDetail：dto 显式传值优先；否则若最终 loseReason ≠ '其他' 自动清空
    if (fieldsDto.loseReasonDetail !== undefined) {
      data.loseReasonDetail = finalLoseReason === '其他' ? fieldsDto.loseReasonDetail : null;
    } else if (fieldsDto.loseReason !== undefined && fieldsDto.loseReason !== '其他') {
      data.loseReasonDetail = null;
    }
    if (fieldsDto.remark !== undefined) data.remark = fieldsDto.remark;

    try {
      await this.prisma.$transaction(async (tx) => {
        // 每次阶段/归属写都与 SaleOrder 创建、改绑、审批共用完整关系图。advisory 后先锁
        // 订单及 child，再锁 Opportunity/Customer，随后只信任锁后实时态。
        await lockOpportunityRelationshipGraph(tx, [id], [existing.customerId, finalCustomerId]);

        const opportunityWhere: Prisma.OpportunityWhereInput = {
          id,
          version: requestVersion,
          deletedAt: null,
        };
        applyCustomerCollabViaCustomerScope(opportunityWhere, chargerScope, currentEmployeeId);
        const lockedOpportunity = await tx.opportunity.findFirst({
          where: opportunityWhere,
          select: {
            id: true,
            customerId: true,
            opportunityStage: true,
            realDealDate: true,
            winRate: true,
            wonSourceType: true,
            wonSourceSaleOrderId: true,
            wonSourcePreviousStage: true,
            wonSourcePreviousDealDate: true,
            wonSourcePreviousWinRate: true,
            version: true,
          },
        });
        if (!lockedOpportunity || lockedOpportunity.customerId !== existing.customerId) {
          throw new ConflictException('商机版本、归属、删除状态或访问范围已变化，请刷新后重试');
        }

        await this.assertCustomerInScope(finalCustomerId, chargerScope, currentEmployeeId, tx);
        if (finalContactId) {
          await this.assertContactBelongsToCustomer(finalContactId, finalCustomerId, tx);
        }
        if (fieldsDto.chargerId) {
          const charger = await tx.employee.findFirst({
            where: {
              id:
                chargerScope == null
                  ? fieldsDto.chargerId
                  : { equals: fieldsDto.chargerId, in: chargerScope },
              deletedAt: null,
            },
            select: { id: true },
          });
          if (!charger) {
            throw new ForbiddenException('最终负责人不存在、已删除或超出当前数据范围');
          }
        }

        const effectiveOrders = await tx.saleOrder.findMany({
          where: {
            opportunityId: id,
            deletedAt: null,
            OR: [{ flowStatus: 'approved' }, { flowStatus: null }],
          },
          select: { id: true },
          orderBy: { id: 'asc' },
        });
        if (
          effectiveOrders.length > 0 &&
          fieldsDto.opportunityStage !== undefined &&
          fieldsDto.opportunityStage !== OPPORTUNITY_STAGE.WON
        ) {
          throw new ConflictException('该商机存在有效合同订单，阶段必须保持「赢单」');
        }
        if (effectiveOrders.length > 0) {
          // 对历史不一致行做保守自愈：仅当当前并非 WON 且本次未人工指定阶段时，
          // 记录明确 sale_order provenance；人工/未知 WON 永不被改写成可回退来源。
          if (
            lockedOpportunity.opportunityStage !== OPPORTUNITY_STAGE.WON &&
            fieldsDto.opportunityStage === undefined
          ) {
            data.opportunityStage = OPPORTUNITY_STAGE.WON;
            data.winRate = '100';
            if (!lockedOpportunity.realDealDate) data.realDealDate = new Date();
            data.wonSourceType = OPPORTUNITY_WON_SOURCE.SALE_ORDER;
            data.wonSourceSaleOrderId = effectiveOrders[0]!.id;
            data.wonSourcePreviousStage = lockedOpportunity.opportunityStage;
            data.wonSourcePreviousDealDate = lockedOpportunity.realDealDate;
            data.wonSourcePreviousWinRate = lockedOpportunity.winRate;
          } else if (
            fieldsDto.opportunityStage === undefined &&
            lockedOpportunity.wonSourceType === OPPORTUNITY_WON_SOURCE.SALE_ORDER
          ) {
            // 普通编辑只校准明确订单派生 WON；人工与历史未知 WON 的赢单率保持用户事实。
            data.winRate = '100';
          }
        }
        if (customerChanged) {
          await assertOpportunityHasNoActiveSaleOrder(tx, id);
        }

        // 主行以固定 id + version + 未删除状态 CAS；成功返回值是本事务对应的新归属事实。
        const updated = await tx.opportunity.update({
          where: { id, version: requestVersion, deletedAt: null },
          data,
        });

        if (requestedProductSnapshots !== undefined) {
          await this.applyOpportunityProductSnapshotDiff(
            tx,
            id,
            requestedProductSnapshots,
            currentUser
          );
        }

        const finalProducts = products ?? existing.products ?? [];
        const hadCustomDevelopment = hasCustomDevelopmentProduct(
          (existing.products ?? []).map((product) => product.productName)
        );
        const hasCustomDevelopment = hasCustomDevelopmentProduct(
          finalProducts.map((product) => product.productName)
        );
        await ensureCustomDevelopmentProject(
          tx,
          {
            opportunityId: id,
            customerId: updated.customerId,
            ownerId: updated.chargerId,
            productNames: finalProducts.map((product) => product.productName),
            opportunityStage: updated.opportunityStage,
          },
          PROJECT_STATUS.OPPORTUNITY,
          currentUser,
          {
            // “不回填历史”：普通编辑既有定制商机不能补建项目；只有本次明确把产品
            // 从非定制改为定制时，才把它视作新进入项目生命周期。
            createIfMissing:
              products !== undefined && !hadCustomDevelopment && hasCustomDevelopment,
            reactivateLostProject:
              existing.opportunityStage === OPPORTUNITY_STAGE.LOST &&
              updated.opportunityStage !== OPPORTUNITY_STAGE.LOST,
          }
        );

        // CAS 把事务外旧快照与成功返回的新行绑定；迁移时仅据此回算旧、新客户。
        await this.customersService.refreshCustomerLifecycle(
          [existing.customerId, updated.customerId],
          currentUser,
          tx
        );
      });

      // 事务提交后再查询完整关联数据
      const response = await this.findOne(id, chargerScope, currentEmployeeId);
      await this.changeLog?.logChange({
        module: 'opportunities',
        action: 'update',
        target: id,
        targetName: response.opportunityName,
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

  async remove(
    id: string,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope: string[] | null | undefined,
    currentEmployeeId: string | null | undefined,
    requestVersion: number
  ): Promise<void> {
    const requiredVersion = requirePositiveVersion(requestVersion, '删除商机');
    const record = await this.findOne(id, chargerScope, currentEmployeeId);
    if (record.version !== requiredVersion) {
      throw new ConflictException(
        `数据已被其他用户修改，当前版本 ${record.version}。请刷新后重试。`
      );
    }

    try {
      const deleted = await this.prisma.$transaction(async (tx) => {
        // 软删无条件进入完整 SaleOrder 关系图；锁后复验自身 scope/version 与订单占用。
        await lockOpportunityRelationshipGraph(tx, [id], [record.customerId]);
        const opportunityWhere: Prisma.OpportunityWhereInput = {
          id,
          version: requiredVersion,
          deletedAt: null,
        };
        applyCustomerCollabViaCustomerScope(opportunityWhere, chargerScope, currentEmployeeId);
        const lockedOpportunity = await tx.opportunity.findFirst({
          where: opportunityWhere,
          select: { id: true, customerId: true },
        });
        if (!lockedOpportunity || lockedOpportunity.customerId !== record.customerId) {
          throw new ConflictException('商机版本、归属、删除状态或访问范围已变化，请刷新后重试');
        }
        await assertOpportunityHasNoActiveSaleOrder(tx, id);

        const deletedAt = new Date();
        const updated = await tx.opportunity.update({
          where: { id, version: requiredVersion, deletedAt: null },
          data: {
            deletedAt,
            version: { increment: 1 },
            ...auditUpdate(currentUser),
          },
        });
        await tx.opportunityProduct.updateMany({
          where: { opportunityId: id, deletedAt: null },
          data: {
            deletedAt,
            version: { increment: 1 },
            ...auditUpdate(currentUser),
          },
        });
        // 使用 CAS 成功返回行的归属，软删与客户生命周期回算同事务提交或回滚。
        await this.customersService.refreshCustomerLifecycle(updated.customerId, currentUser, tx);
        return updated;
      });

      await this.changeLog?.logChange({
        module: 'opportunities',
        action: 'delete',
        target: id,
        targetName: record.opportunityName,
        currentUser,
        before: record,
        after: deleted,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException(
          `数据已被其他用户修改，当前版本 ${record.version}。请刷新后重试。`
        );
      }
      throw error;
    }
  }

  /**
   * 商机阶段=赢单 时，realDealDate 必须有值。
   *
   * 优先级：dto 显式传值 > 已存在值 > 自动填当前时间（仅当 stage='赢单'）
   * 非赢单阶段不动 realDealDate（用 dto 值或保留原值，由调用侧处理）。
   *
   * 返回 Date | null | undefined：
   * - Date：要更新为这个值
   * - null：前端显式传 null 想清空
   * - undefined：保持原值不动
   */
  private resolveRealDealDate(
    stage: string | null | undefined,
    dtoValue: string | Date | null | undefined,
    existing: string | Date | null | undefined
  ): Date | null | undefined {
    // dto 显式传值（包括 null 清空）→ 尊重 dto
    if (dtoValue !== undefined) {
      return dtoValue ? new Date(dtoValue) : null;
    }
    // dto 没传，stage 切到赢单且原值为空 → 自动填
    if (stage === OPPORTUNITY_STAGE.WON && !existing) {
      return new Date();
    }
    // 其他情况保持不动
    return undefined;
  }

  private async assertCustomerInScope(
    customerId: string,
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null,
    prisma: PrismaService | Prisma.TransactionClient = this.prisma
  ): Promise<void> {
    const where: Prisma.CustomerWhereInput = { id: customerId, deletedAt: null };
    applyCustomerCollabSelfScope(where, chargerScope, currentEmployeeId);
    const customer = await prisma.customer.findFirst({ where, select: { id: true } });
    if (!customer) {
      throw new ForbiddenException('无权将商机写入该客户，或客户不存在');
    }
  }

  private assertChargerInScope(
    chargerId: string | null | undefined,
    chargerScope?: string[] | null
  ): void {
    if (!chargerId || chargerScope === undefined || chargerScope === null) return;
    if (!chargerScope.includes(chargerId)) {
      throw new ForbiddenException('无权把商机负责人指定到当前数据范围之外');
    }
  }

  private async assertContactBelongsToCustomer(
    contactId: string,
    customerId: string,
    prisma: PrismaService | Prisma.TransactionClient = this.prisma
  ): Promise<void> {
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, customerId, deletedAt: null },
      select: { id: true },
    });
    if (!contact) {
      throw new BadRequestException('联系人不存在、已删除，或不属于当前客户');
    }
  }

  /**
   * 商机阶段=输单流失 时，lostDate 必须有值（对称于 resolveRealDealDate）。
   *
   * 返回 Date | null | undefined：
   * - Date：要更新为这个值
   * - null：前端显式传 null 想清空
   * - undefined：保持原值不动
   */
  private resolveLostDate(
    stage: string | null | undefined,
    dtoValue: string | Date | null | undefined,
    existing: string | Date | null | undefined
  ): Date | null | undefined {
    if (dtoValue !== undefined) {
      return dtoValue ? new Date(dtoValue) : null;
    }
    if (stage === '输单流失' && !existing) {
      return new Date();
    }
    return undefined;
  }

  /**
   * 商机阶段=输单流失 时强制要求填写失单原因。
   * Zod refine 在 schema 层已拦一道，本方法是 service 层的权威兜底——
   * 覆盖「stage 已是 LOST 但本次 update 既未传 stage 也未传 loseReason」的漏网场景。
   */
  private assertLostReasonOnLost(
    stage: string | null | undefined,
    loseReason: string | null | undefined
  ): void {
    if (stage !== '输单流失') return;
    if (typeof loseReason === 'string' && loseReason.trim().length > 0) return;
    throw new BadRequestException('商机阶段为「输单流失」时必须填写失单原因');
  }

  /**
   * 失单原因选「其他」时必须填写自由备注（loseReasonDetail）。
   * 同 assertLostReasonOnLost 的模式：shared schema 不做联动校验（保留 ZodObject.shape），
   * 前端 refine + 后端 assert 两边兜底。
   */
  private assertLoseReasonDetailOnOther(
    loseReason: string | null | undefined,
    loseReasonDetail: string | null | undefined
  ): void {
    if (loseReason !== '其他') return;
    if (typeof loseReasonDetail === 'string' && loseReasonDetail.trim().length > 0) return;
    throw new BadRequestException('失单原因选择「其他」时必须填写备注说明');
  }

  private buildOpportunityProductSnapshot(product: {
    productName: string;
    productNumber?: string | null;
    productPrice?: number | string | null;
    quantity?: number | string | null;
    unitPrice?: number | string | null;
    discount?: number | string | null;
    remark?: string | null;
  }): OpportunityProductSnapshotWrite {
    return {
      productName: product.productName,
      productNumber: product.productNumber ?? null,
      productPrice: product.productPrice != null ? String(product.productPrice) : null,
      quantity: product.quantity != null ? String(product.quantity) : null,
      unitPrice: product.unitPrice != null ? String(product.unitPrice) : null,
      discount: product.discount != null ? String(product.discount) : null,
      subtotalAmount: this.computeProductSubtotal(product).toFixed(2),
      remark: product.remark ?? null,
    };
  }

  private async applyOpportunityProductSnapshotDiff(
    tx: Prisma.TransactionClient,
    opportunityId: string,
    requestedProducts: OpportunityProductSnapshotWrite[],
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<void> {
    const rows = await tx.opportunityProduct.findMany({
      where: { opportunityId, deletedAt: null },
      select: {
        id: true,
        version: true,
        productName: true,
        productNumber: true,
        productPrice: true,
        quantity: true,
        unitPrice: true,
        discount: true,
        subtotalAmount: true,
        remark: true,
      },
      orderBy: { id: 'asc' },
    });
    const existingProducts = Array.isArray(rows)
      ? (rows as ExistingOpportunityProductSnapshot[])
      : [];
    const { removed, created } = diffProductSnapshots(
      existingProducts,
      requestedProducts,
      (product) => this.opportunityProductFingerprint(product),
      (product) => this.opportunityProductFingerprint(product)
    );

    if (removed.length > 0) {
      const softDeleted = await tx.opportunityProduct.updateMany({
        where: {
          opportunityId,
          deletedAt: null,
          OR: removed.map((product) => ({ id: product.id, version: product.version })),
        },
        data: {
          deletedAt: new Date(),
          version: { increment: 1 },
          ...auditUpdate(currentUser),
        },
      });
      if (softDeleted.count !== removed.length) {
        throw new ConflictException('商机产品版本或删除状态已变化，请刷新后重试');
      }
    }

    if (created.length > 0) {
      const productAudit = auditCreate(currentUser);
      await tx.opportunityProduct.createMany({
        data: created.map((product) => ({
          opportunityId,
          ...product,
          ...productAudit,
        })),
      });
    }
  }

  private opportunityProductFingerprint(
    product:
      | Omit<ExistingOpportunityProductSnapshot, 'id' | 'version'>
      | OpportunityProductSnapshotWrite
  ): string {
    return JSON.stringify([
      product.productName,
      product.productNumber ?? null,
      decimalProductFingerprint(product.productPrice),
      decimalProductFingerprint(product.quantity),
      decimalProductFingerprint(product.unitPrice),
      decimalProductFingerprint(product.discount),
      decimalProductFingerprint(product.subtotalAmount),
      product.remark ?? null,
    ]);
  }

  /**
   * 服务端权威重算单行小计：quantity × unitPrice × (1 − discount/100)，保留 2 位。
   * 与前端 opportunity-fields.tsx / 金额铁律(Decimal 求和) 对齐；忽略客户端传入的 subtotalAmount。
   * quantity/unitPrice 在 shared schema 已 required+positive，这里再兜底一道：缺失即拒。
   */
  private computeProductSubtotal(product: {
    quantity?: number | string | null;
    unitPrice?: number | string | null;
    discount?: number | string | null;
    productName?: string;
  }): Prisma.Decimal {
    if (product.quantity == null || product.unitPrice == null) {
      throw new BadRequestException(`产品「${product.productName ?? ''}」必须填写数量和单价`);
    }
    const qty = new Prisma.Decimal(product.quantity);
    const price = new Prisma.Decimal(product.unitPrice);
    const discount = new Prisma.Decimal(product.discount ?? 0); // 百分比 0–100
    if (qty.lte(0) || price.lte(0)) {
      throw new BadRequestException(`产品「${product.productName ?? ''}」数量与单价必须大于 0`);
    }
    const factor = new Prisma.Decimal(1).minus(discount.div(100));
    // 2 位四舍五入，得到 Decimal（toDecimalPlaces 默认 ROUND_HALF_UP，与前端 Math.round 一致）
    return qty.mul(price).mul(factor).toDecimalPlaces(2);
  }

  private resolveOpportunityAmount(
    inputAmount: number | string | null | undefined,
    products?:
      | {
          quantity?: number | string | null;
          unitPrice?: number | string | null;
          discount?: number | string | null;
          productName?: string;
        }[]
      | null
  ): string | null | undefined {
    if (products && products.length > 0) {
      // 由重算后的行小计求和 —— 不再信任 inputAmount，也不信任客户端 subtotalAmount
      const total = products.reduce(
        (sum, product) => sum.plus(this.computeProductSubtotal(product)),
        new Prisma.Decimal(0)
      );
      return total.toFixed(2); // 字符串，直接进 Decimal 列
    }
    // 无产品行（理论上 create 必有 .min(1)，update 可能不带 products）→ 沿用 inputAmount
    return inputAmount != null ? String(inputAmount) : inputAmount;
  }

  private buildLegacyFilters(query: QueryOpportunityDto): Record<string, unknown> {
    return {
      customerId: query.customerId,
      opportunityStage: query.opportunityStage,
      chargerId: query.chargerId,
    };
  }
}

function requirePositiveVersion(version: unknown, operation: string): number {
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new BadRequestException(`${operation}必须携带有效的 version`);
  }
  return version;
}
