import {
  APPROVAL_EVENT_TYPE,
  APPROVAL_INSTANCE_STATUS,
  ORDER_STATUS,
  PROJECT_STATUS,
} from '@ky-azeroth/shared/constants';
import type { BatchApproveInput } from '@ky-azeroth/shared/schemas/approval';
import type {
  BatchTransferSaleOrderInput,
  BatchUpdateSaleOrderInput,
  SaleOrderResponseOutput,
} from '@ky-azeroth/shared/schemas/sale-order';
import {
  SALE_ORDER_VOID_PROJECT_ACTION,
  saleOrderDateOnlySchema,
  type SaleOrderVoidPreviewOutput,
  type SaleOrderVoidRequestInput,
} from '@ky-azeroth/shared/schemas/sale-order';
import type { SaleOrderForSelection } from '@ky-azeroth/shared/types/sale-order';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
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
import { APPROVAL_CHANGE_TARGET_TYPE } from '../approvals/approval-change-requests.service';
import { ApprovalGuardService } from '../approvals/approval-guard.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { BusinessApprovalService } from '../approvals/business-approval.service';
import { recomputeCustomerAccountsReceivable } from '../customers/customer-accounts-receivable.helper';
import { CrmChangeLogService } from '../operation-logs/crm-change-log.service';
import {
  advanceCustomDevelopmentProjectFromSaleOrder,
  assertSaleOrderProjectRelationUnchanged,
} from '../projects/project-lifecycle.helper';
import { CreateSaleOrderDto } from './dto/create-sale-order.dto';
import { QuerySaleOrderDto } from './dto/query-sale-order.dto';
import { UpdateSaleOrderDto } from './dto/update-sale-order.dto';
import { assertBadDebtAmountWithinOutstanding } from './financial-limits.helper';
import { recalcSaleOrderInvoicedSummary } from './invoiced-summary.helper';
import { resolveOrderTitle } from './order-title.helper';
import { recalcSaleOrderPaymentSummary } from './payment-summary.helper';
import { decimalProductFingerprint, diffProductSnapshots } from './product-snapshot-diff.helper';
import {
  isEffectiveSaleOrderFlowStatus,
  reconcileSaleOrderActivationLifecycle,
} from './sale-order-activation-lifecycle.helper';
import { lockSaleOrderGraph } from './sale-order-lock-protocol.helper';
import {
  assertOpportunityHasNoActiveSaleOrder,
  lockSaleOrderRelationshipsBeforeCustomerTouch,
} from './sale-order-opportunity-link.helper';
import { buildSaleOrderVoidPlan } from './sale-order-void-plan.helper';
import { SALE_ORDER_FILTER_REGISTRY } from './sale-orders.filter-registry';

/**
 * 销售订单列表允许的排序字段白名单。
 * 业务日期 / 回款日期 / 合同周期起止 + 金额族字段 + 创建/更新时间。
 * 注：findAllForSelection（下拉选择器）固定 createdAt desc，不消费前端 sortBy。
 */
const SALE_ORDER_APPROVAL_EVENT_TYPES = [
  APPROVAL_EVENT_TYPE.SALE_ORDER_ACTIVATE,
  APPROVAL_EVENT_TYPE.SALE_ORDER_CHANGE,
  APPROVAL_EVENT_TYPE.SALE_ORDER_VOID,
] as const;
const ACTIVE_APPROVAL_INSTANCE_STATUSES = [APPROVAL_INSTANCE_STATUS.PENDING] as const;

const SALE_ORDER_SORT_WHITELIST: ReadonlySet<string> = new Set([
  'orderTitle',
  'orderAmount',
  'otherFee',
  'badDebtAmount',
  'businessDate',
  'paymentDate',
  'lastPaymentDate',
  'orderBeginDate',
  'orderEndDate',
  'createdAt',
  'updatedAt',
  // 金额族字段（均为 SaleOrder 表直存列）：产品 / 应收 / 已收 / 已退 / 坏账 / 未收 / 已开票
  'productAmount',
  'totalReceivables',
  'totalReceived',
  'totalRefunded',
  'totalUncollected',
  'invoicedAmount',
]);

interface OrderProductSnapshotWrite {
  productName: string;
  productNumber: string | null;
  productPrice: string | null;
  quantity: string | null;
  unitPrice: string | null;
  contractUnitPrice: string | null;
  discount: string;
  subtotalAmount: string;
  remark: string | null;
}

interface ExistingOrderProductSnapshot {
  id: string;
  version: number;
  productName: string;
  productNumber: string | null;
  productPrice: unknown;
  quantity: unknown;
  unitPrice: unknown;
  contractUnitPrice: unknown;
  discount: unknown;
  subtotalAmount: unknown;
  remark: string | null;
}

@Injectable()
export class SaleOrdersService {
  private readonly logger = new Logger(SaleOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly serialNumberService: SerialNumberService,
    private readonly approvalGuardService: ApprovalGuardService,
    private readonly approvalsService: ApprovalsService,
    private readonly businessApprovalService: BusinessApprovalService,
    private readonly filterApplier: FilterApplierService,
    private readonly changeLog?: CrmChangeLogService
  ) {}

  async findAll(
    query: QuerySaleOrderDto,
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null,
    rawQuery?: unknown
  ): Promise<PaginatedResponse<SaleOrderResponseOutput>> {
    const { page = 1, pageSize = 10, sortBy, sortOrder } = query;
    const { skip, take } = calculatePagination(page, pageSize);

    // RBAC：三路径 OR（自身 chargerId / customer.chargerId / customer.collaboratorIds 含我）。
    // chargerScope 传 null 让 applier 不再注入 isScopeField AND，避免覆盖 OR；
    // 配套地，filter-registry 的 chargerId 字段已去掉 isScopeField 标记。
    const baseWhere: Prisma.SaleOrderWhereInput = { deletedAt: null };
    applyCustomerCollabViaCustomerScope(baseWhere, chargerScope, currentEmployeeId);

    const where = await this.filterApplier.buildWhere<Prisma.SaleOrderWhereInput>({
      registry: SALE_ORDER_FILTER_REGISTRY,
      rawQuery,
      legacyKeyword: query.keyword,
      legacyFilters: this.buildLegacyFilters(query),
      chargerScope: null,
      baseWhere,
    });

    const orderBy = resolveOrderBy<Prisma.SaleOrderOrderByWithRelationInput>(sortBy, sortOrder, {
      whitelist: SALE_ORDER_SORT_WHITELIST,
      fallback: { createdAt: 'desc' },
    });

    const [items, total] = await Promise.all([
      this.prisma.saleOrder.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          charger: { select: { id: true, name: true } },
          customer: {
            select: { id: true, customerName: true, shortName: true },
          },
          opportunity: {
            select: { id: true, opportunityName: true, serialNumber: true },
          },
        },
      }),
      this.prisma.saleOrder.count({ where }),
    ]);

    const data = items.map((item) =>
      serializeEntity<SaleOrderResponseOutput>({
        ...item,
        chargerName: item.charger?.name ?? item.chargerName,
        businessDate: toDateOnlyString(item.businessDate),
        paymentDate: toDateOnlyString(item.paymentDate),
        lastPaymentDate: toDateOnlyString(item.lastPaymentDate),
        orderBeginDate: toDateOnlyString(item.orderBeginDate),
        orderEndDate: toDateOnlyString(item.orderEndDate),
        orderAmount: toDecimalNumber(item.orderAmount),
        otherFee: toDecimalNumber(item.otherFee),
        badDebtAmount: toDecimalNumber(item.badDebtAmount) ?? 0,
        productAmount: toDecimalNumber(item.productAmount),
        totalReceivables: toDecimalNumber(item.totalReceivables),
        totalReceived: toDecimalNumber(item.totalReceived),
        totalUncollected: toDecimalNumber(item.totalUncollected),
        invoicedAmount: toDecimalNumber(item.invoicedAmount) ?? 0,
        orderInvoiceStatus: item.orderInvoiceStatus,
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
   * 查询所有合同订单（用于下拉框等场景）
   */
  async findAllForSelection(
    query: {
      keyword?: string;
      customerId?: string;
      opportunityId?: string;
      status?: string;
    },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<SaleOrderForSelection[]> {
    // RBAC：三路径 OR（与 findAll 保持一致）。注意 keyword 也是 OR 形态——
    // 把两组 OR 用 AND 包起来，避免它们互相吞掉。
    const where: Prisma.SaleOrderWhereInput = { deletedAt: null, legacyAdjustment: false };
    if (query.status) where.status = query.status;
    if (query.customerId) where.customerId = query.customerId;
    if (query.opportunityId) where.opportunityId = query.opportunityId;

    const andClauses: Prisma.SaleOrderWhereInput[] = [];
    if (chargerScope !== undefined && chargerScope !== null) {
      // 与 applyCustomerCollabViaCustomerScope 保持同语义（2026-06-04 加入公海可见 OR）：
      // 这里因 keyword OR 与 RBAC OR 必须用 AND 包起来才不互相吞掉，无法直接复用 helper。
      // 但 OR 项必须与 helper 一致，否则下拉选订单看不到公海历史，与列表不一致。
      const scopeOr: Prisma.SaleOrderWhereInput[] = [
        { chargerId: { in: chargerScope } },
        { customer: { chargerId: { in: chargerScope } } },
        { customer: { chargerId: null } },
      ];
      if (currentEmployeeId) {
        scopeOr.push({
          customer: {
            collaboratorIds: { array_contains: [currentEmployeeId] },
          },
        });
      }
      andClauses.push({ OR: scopeOr });
    }
    if (query.keyword) {
      andClauses.push({
        OR: [
          {
            orderTitle: {
              contains: query.keyword,
              mode: 'insensitive' as const,
            },
          },
          {
            serialNumber: {
              contains: query.keyword,
              mode: 'insensitive' as const,
            },
          },
        ],
      });
    }
    if (andClauses.length > 0) where.AND = andClauses;

    const orders = await this.prisma.saleOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        serialNumber: true,
        orderTitle: true,
        customerId: true,
        opportunityId: true,
        chargerId: true,
        orderAmount: true,
        totalReceived: true,
        totalUncollected: true,
        orderStatus: true,
        invoicedAmount: true,
        legacyAdjustment: true,
        customer: {
          select: { customerName: true },
        },
      },
    });

    return orders.map((o) => ({
      id: o.id,
      serialNumber: o.serialNumber,
      orderName: o.orderTitle ?? o.serialNumber,
      customerId: o.customerId,
      customerName: o.customer?.customerName,
      opportunityId: o.opportunityId,
      chargerId: o.chargerId,
      orderAmount: toDecimalNumber(o.orderAmount),
      totalReceived: toDecimalNumber(o.totalReceived),
      totalUncollected: toDecimalNumber(o.totalUncollected),
      orderStatus: o.orderStatus,
      invoicedAmount: toDecimalNumber(o.invoicedAmount),
      legacyAdjustment: o.legacyAdjustment,
    }));
  }

  async findOne(
    id: string,
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<SaleOrderResponseOutput> {
    const where: Prisma.SaleOrderWhereInput = { id, deletedAt: null };
    applyCustomerCollabViaCustomerScope(where, chargerScope, currentEmployeeId);
    const saleOrder = await this.prisma.saleOrder.findFirst({
      where,
      include: {
        charger: { select: { id: true, name: true } },
        customer: {
          select: { id: true, customerName: true, shortName: true },
        },
        opportunity: {
          select: { id: true, opportunityName: true, serialNumber: true },
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
            contractUnitPrice: true,
            discount: true,
            subtotalAmount: true,
            remark: true,
          },
        },
      },
    });

    if (!saleOrder) {
      throw new NotFoundException(`销售订单 ${id} 不存在`);
    }

    return serializeEntity<SaleOrderResponseOutput>({
      ...saleOrder,
      chargerName: saleOrder.charger?.name ?? saleOrder.chargerName,
      businessDate: toDateOnlyString(saleOrder.businessDate),
      paymentDate: toDateOnlyString(saleOrder.paymentDate),
      lastPaymentDate: toDateOnlyString(saleOrder.lastPaymentDate),
      orderBeginDate: toDateOnlyString(saleOrder.orderBeginDate),
      orderEndDate: toDateOnlyString(saleOrder.orderEndDate),
      orderAmount: toDecimalNumber(saleOrder.orderAmount),
      otherFee: toDecimalNumber(saleOrder.otherFee),
      badDebtAmount: toDecimalNumber(saleOrder.badDebtAmount) ?? 0,
      productAmount: toDecimalNumber(saleOrder.productAmount),
      totalReceivables: toDecimalNumber(saleOrder.totalReceivables),
      totalReceived: toDecimalNumber(saleOrder.totalReceived),
      totalUncollected: toDecimalNumber(saleOrder.totalUncollected),
      invoicedAmount: toDecimalNumber(saleOrder.invoicedAmount) ?? 0,
      orderInvoiceStatus: saleOrder.orderInvoiceStatus,
    });
  }

  async create(
    dto: CreateSaleOrderDto,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<SaleOrderResponseOutput> {
    await this.assertCustomerInScope(dto.customerId, chargerScope, currentEmployeeId);
    this.assertChargerInScope(dto.chargerId, chargerScope);

    const serialNumber = await this.serialNumberService.generate(SerialNumberType.SALE_ORDER);
    const approvalRequired = await this.approvalGuardService.isRequired(
      APPROVAL_EVENT_TYPE.SALE_ORDER_ACTIVATE
    );
    const flowStatus = approvalRequired ? 'pending' : 'approved';

    const { products, ...orderFields } = dto;
    this.assertProductsValid(products);
    const productSnapshots = products.map((product) => this.buildOrderProductSnapshot(product));
    if (orderFields.opportunityId) {
      // 保留事务外快速失败仅用于 UX；事务内取得共用锁后必须再次按实时 scope 复查。
      await this.assertOpportunityBelongsToCustomer(
        orderFields.opportunityId,
        orderFields.customerId,
        this.prisma,
        chargerScope,
        currentEmployeeId
      );
    }

    const resolvedOrderTitle = await resolveOrderTitle(
      this.prisma,
      orderFields.orderTitle,
      orderFields.customerId,
      orderFields.orderAmount
    );
    const orderAmount = dto.orderAmount != null ? String(dto.orderAmount) : undefined;
    const otherFee = dto.otherFee != null ? String(dto.otherFee) : undefined;
    const badDebtAmount = dto.badDebtAmount != null ? String(dto.badDebtAmount) : '0.00';
    const productAmount = this.sumProductAmount(products).toFixed(2);
    const totalReceivables = this.sumProductSubtotal(products).toFixed(2);
    const initialTotalReceived = '0.00';
    assertBadDebtAmountWithinOutstanding({
      badDebtAmount,
      receivablesBase: totalReceivables,
    });
    const initialTotalUncollected = new Prisma.Decimal(totalReceivables)
      .minus(badDebtAmount)
      .toFixed(2);
    const businessDate =
      orderFields.businessDate === undefined
        ? undefined
        : toSaleOrderDateOnly(orderFields.businessDate, '业务日期');
    const paymentDate =
      orderFields.paymentDate == null
        ? undefined
        : toSaleOrderDateOnly(orderFields.paymentDate, '付款日期');
    const orderBeginDate =
      orderFields.orderBeginDate === undefined
        ? undefined
        : toSaleOrderDateOnly(orderFields.orderBeginDate, '合同开始日期');
    const orderEndDate =
      orderFields.orderEndDate == null
        ? undefined
        : toSaleOrderDateOnly(orderFields.orderEndDate, '合同结束日期');
    assertSaleOrderDateRange(orderFields.orderBeginDate, orderFields.orderEndDate);

    let approvalInstanceId: string | undefined;
    const { id: saleOrderId } = await this.prisma.$transaction(async (tx) => {
      // 新订单尚无可锁 SaleOrder 行：先取关系 advisory，再真实锁 Opportunity/Customer。
      // 锁后重新验证 scope/软删/归属，事务外检查仅作快速失败提示。
      await lockSaleOrderGraph(tx, {
        relationshipOpportunityIds: [orderFields.opportunityId],
        customerIds: [orderFields.customerId],
      });
      await this.assertCustomerInScope(orderFields.customerId, chargerScope, currentEmployeeId, tx);
      await this.assertChargerReference(
        tx,
        orderFields.chargerId ?? currentUser.employeeId ?? null,
        chargerScope
      );
      if (orderFields.opportunityId) {
        await this.assertOpportunityBelongsToCustomer(
          orderFields.opportunityId,
          orderFields.customerId,
          tx,
          chargerScope,
          currentEmployeeId
        );
        await assertOpportunityHasNoActiveSaleOrder(tx, orderFields.opportunityId);
      }

      const created = await tx.saleOrder.create({
        data: {
          serialNumber,
          flowStatus,
          orderTitle: resolvedOrderTitle,
          customerId: orderFields.customerId,
          opportunityId: orderFields.opportunityId ?? undefined,
          orderAmount,
          otherFee,
          badDebtAmount,
          productAmount,
          totalReceivables,
          totalReceived: initialTotalReceived,
          totalUncollected: initialTotalUncollected,
          businessDate,
          paymentDate,
          orderBeginDate,
          orderEndDate,
          // 缺省时仅接受真实 employeeId，绝不把认证主体 user.id 猜成 Employee FK。
          chargerId: orderFields.chargerId ?? currentUser.employeeId ?? undefined,
          remark: orderFields.remark ?? undefined,
          // orderStatus 由 payment-summary.helper 派生（5 态），新订单尚无回款 → NOT_RECEIVED
          // 前端 / 外部 API 一律禁止显式传入 orderStatus（已从 createSaleOrderSchema 移除）
          orderStatus: ORDER_STATUS.NOT_RECEIVED,
          ...auditCreate(currentUser),
        },
      });

      // 创建产品明细行（沿用 opportunities.service 同款模式）
      if (productSnapshots.length > 0) {
        const productAudit = auditCreate(currentUser);
        await tx.orderProduct.createMany({
          data: productSnapshots.map((product) => ({
            saleOrderId: created.id,
            ...product,
            ...productAudit,
          })),
        });
      }

      if (!approvalRequired) {
        await advanceCustomDevelopmentProjectFromSaleOrder(
          tx,
          created.id,
          PROJECT_STATUS.CONTRACT,
          currentUser,
          { createIfMissing: true }
        );
        await reconcileSaleOrderActivationLifecycle(
          tx,
          {
            opportunityIds: [created.opportunityId],
            customerIds: [created.customerId],
          },
          currentUser
        );
      } else {
        // 自审批可能在 createApprovalForNewRecord 内直接把订单推进到 approved；
        // 终态回写路径会负责项目、商机与客户生命周期，调用方不得再用 stale created 重复推进。
        approvalInstanceId = await this.businessApprovalService.createApprovalForNewRecord(
          tx,
          APPROVAL_EVENT_TYPE.SALE_ORDER_ACTIVATE,
          created,
          currentUser
        );
      }

      await recomputeCustomerAccountsReceivable(tx, created.customerId);

      return {
        id: created.id,
        opportunityId: created.opportunityId,
        customerId: created.customerId,
      };
    });

    if (approvalInstanceId) {
      this.approvalsService.notifyOnSubmit(approvalInstanceId).catch(() => {});
    }

    // 事务提交后再查询完整关联数据（含 products）
    const response = await this.findOne(saleOrderId);
    await this.changeLog
      ?.logChange({
        module: 'sale-orders',
        action: 'create',
        target: response.id,
        targetName: response.orderTitle ?? response.serialNumber,
        currentUser,
        after: response,
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `合同订单 ${response.id} 创建日志写入失败: ${error instanceof Error ? error.message : String(error)}`
        );
      });
    return response;
  }

  async update(
    id: string,
    dto: UpdateSaleOrderDto,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<SaleOrderResponseOutput> {
    const existing = await this.findOne(id, chargerScope, currentEmployeeId);
    this.businessApprovalService.assertCanDirectEdit(existing.flowStatus, '合同订单', currentUser);

    const { version: requestVersion, products, ...fieldsDto } = dto;
    if (!Number.isInteger(requestVersion) || requestVersion < 1) {
      throw new BadRequestException('更新合同订单必须携带有效的 version');
    }
    if (products !== undefined) {
      this.assertProductsValid(products);
    } else if ((existing.products?.length ?? 0) === 0) {
      throw new BadRequestException('合同订单至少需要一项产品明细');
    }
    const requestedProductSnapshots =
      products === undefined
        ? undefined
        : products.map((product) => this.buildOrderProductSnapshot(product));
    const finalCustomerId = fieldsDto.customerId ?? existing.customerId;
    if (fieldsDto.customerId !== undefined && fieldsDto.customerId !== existing.customerId) {
      await this.assertCustomerCanChange(id);
      await this.assertCustomerInScope(fieldsDto.customerId, chargerScope, currentEmployeeId);
    }
    this.assertChargerInScope(fieldsDto.chargerId, chargerScope);
    const finalOpportunityId =
      fieldsDto.opportunityId !== undefined ? fieldsDto.opportunityId : existing.opportunityId;
    if (finalOpportunityId) {
      // 保留锁前 UX 校验；关系事实实际变化时会在事务内持锁重查。
      await this.assertOpportunityBelongsToCustomer(
        finalOpportunityId,
        finalCustomerId,
        this.prisma,
        chargerScope,
        currentEmployeeId
      );
    }
    const opportunityRelationshipChanged =
      finalCustomerId !== existing.customerId || finalOpportunityId !== existing.opportunityId;
    // 与 charger/customer 等 relation 字段共存时，audit 必须走 relation 写法（updater.connect），
    // 避免 SaleOrderUpdateInput（Checked）与 UncheckedUpdateInput 分支被混用导致 Prisma 报 500。
    const audit = auditUpdate(currentUser);
    const data: Prisma.SaleOrderUpdateInput = {
      ...(audit.updaterEmployeeId
        ? { updater: { connect: { id: audit.updaterEmployeeId } } }
        : { updater: { disconnect: true } }),
      version: { increment: 1 },
    };

    // orderTitle 由后端无条件重新生成（前端表单只读），忽略 fieldsDto.orderTitle。
    if (fieldsDto.customerId !== undefined)
      data.customer = { connect: { id: fieldsDto.customerId } };
    if (fieldsDto.opportunityId !== undefined) {
      data.opportunity = fieldsDto.opportunityId
        ? { connect: { id: fieldsDto.opportunityId } }
        : { disconnect: true };
    }
    if (fieldsDto.orderAmount !== undefined) {
      data.orderAmount = fieldsDto.orderAmount != null ? String(fieldsDto.orderAmount) : null;
    }
    if (fieldsDto.otherFee !== undefined) {
      data.otherFee = fieldsDto.otherFee != null ? String(fieldsDto.otherFee) : null;
    }
    if (fieldsDto.badDebtAmount !== undefined) {
      data.badDebtAmount = String(fieldsDto.badDebtAmount);
    }
    if (fieldsDto.businessDate !== undefined) {
      data.businessDate = toSaleOrderDateOnly(fieldsDto.businessDate, '业务日期');
    }
    if (fieldsDto.paymentDate !== undefined) {
      data.paymentDate =
        fieldsDto.paymentDate === null
          ? null
          : toSaleOrderDateOnly(fieldsDto.paymentDate, '付款日期');
    }
    if (fieldsDto.orderBeginDate !== undefined) {
      data.orderBeginDate = toSaleOrderDateOnly(fieldsDto.orderBeginDate, '合同开始日期');
    }
    if (fieldsDto.orderEndDate !== undefined) {
      data.orderEndDate =
        fieldsDto.orderEndDate === null
          ? null
          : toSaleOrderDateOnly(fieldsDto.orderEndDate, '合同结束日期');
    }
    if (fieldsDto.orderBeginDate !== undefined || fieldsDto.orderEndDate !== undefined) {
      assertSaleOrderDateRange(
        fieldsDto.orderBeginDate !== undefined ? fieldsDto.orderBeginDate : existing.orderBeginDate,
        fieldsDto.orderEndDate !== undefined ? fieldsDto.orderEndDate : existing.orderEndDate
      );
    }
    if (fieldsDto.chargerId !== undefined) {
      data.charger = fieldsDto.chargerId
        ? { connect: { id: fieldsDto.chargerId } }
        : { disconnect: true };
    }
    if (fieldsDto.remark !== undefined) data.remark = fieldsDto.remark;
    // orderStatus 已从 createSaleOrderSchema 移除，update 路径也不再透传——
    // 5 态状态由 recalcSaleOrderPaymentSummary 在 Payment 变动 / 审批通过 / 撤回时派生。
    // 即使老客户端仍在 payload 里塞 orderStatus，UpdateSaleOrderDto 已不存在此字段，
    // nestjs-zod 会按 schema 静默剥离，不会出现"用户改了订单状态"事件。

    // 基于最终 customerId + orderAmount 重新生成 orderTitle；
    // referenceDate 传 existing.createdAt，保证编辑订单不会把标题里的日期推到"今天"。
    const finalOrderAmount =
      fieldsDto.orderAmount !== undefined ? fieldsDto.orderAmount : existing.orderAmount;
    data.orderTitle = await resolveOrderTitle(
      this.prisma,
      undefined,
      finalCustomerId,
      finalOrderAmount,
      existing.createdAt
    );
    if (products !== undefined) {
      const productAmount = this.sumProductAmount(products);
      const totalReceivables = this.sumProductSubtotal(products);
      const totalReceived = new Prisma.Decimal(existing.totalReceived ?? 0);
      data.productAmount = productAmount.toFixed(2);
      data.totalReceivables = totalReceivables.toFixed(2);
      data.totalUncollected = Prisma.Decimal.max(
        totalReceivables.minus(totalReceived),
        new Prisma.Decimal(0)
      ).toFixed(2);
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        const pendingApproval = await this.businessApprovalService.lockPendingFormEdit(
          tx,
          APPROVAL_EVENT_TYPE.SALE_ORDER_ACTIVATE,
          id,
          existing.flowStatus,
          currentUser
        );
        await lockSaleOrderRelationshipsBeforeCustomerTouch(
          tx,
          [
            {
              saleOrderId: id,
              opportunityId: existing.opportunityId,
              customerId: existing.customerId,
            },
          ],
          {
            opportunityIds: [finalOpportunityId],
            customerIds: [finalCustomerId],
          }
        );

        const lockedOrderWhere: Prisma.SaleOrderWhereInput = {
          id,
          version: requestVersion,
          deletedAt: null,
        };
        applyCustomerCollabViaCustomerScope(lockedOrderWhere, chargerScope, currentEmployeeId);
        const lockedOrder = await tx.saleOrder.findFirst({
          where: lockedOrderWhere,
          select: {
            id: true,
            customerId: true,
            opportunityId: true,
            flowStatus: true,
            version: true,
          },
        });
        if (
          !lockedOrder ||
          lockedOrder.customerId !== existing.customerId ||
          lockedOrder.opportunityId !== existing.opportunityId
        ) {
          throw new ConflictException('合同订单版本、关系、删除状态或访问范围已变化，请刷新后重试');
        }
        this.businessApprovalService.assertCanDirectEdit(
          lockedOrder.flowStatus,
          '合同订单',
          currentUser
        );
        await this.assertSaleOrderChangeReferences(
          tx,
          {
            saleOrderId: id,
            existingCustomerId: lockedOrder.customerId,
            existingOpportunityId: lockedOrder.opportunityId,
            customerId: finalCustomerId,
            chargerId: fieldsDto.chargerId ?? existing.chargerId,
            opportunityId: finalOpportunityId,
          },
          chargerScope ?? null,
          currentEmployeeId ?? null
        );
        const saleOrder = await tx.saleOrder.update({
          where: { id, version: requestVersion },
          data,
        });

        if (requestedProductSnapshots !== undefined) {
          await this.applyOrderProductSnapshotDiff(tx, id, requestedProductSnapshots, currentUser);
        }

        if (
          opportunityRelationshipChanged &&
          (isEffectiveSaleOrderFlowStatus(existing.flowStatus) ||
            isEffectiveSaleOrderFlowStatus(saleOrder.flowStatus))
        ) {
          await reconcileSaleOrderActivationLifecycle(
            tx,
            {
              opportunityIds: [existing.opportunityId, saleOrder.opportunityId],
              customerIds: [existing.customerId, saleOrder.customerId],
              retractedOpportunityIds: isEffectiveSaleOrderFlowStatus(existing.flowStatus)
                ? [existing.opportunityId]
                : [],
            },
            currentUser
          );
        }

        if (fieldsDto.orderAmount !== undefined) {
          // orderAmount 只影响「合同金额/开票上限」口径；应收由产品明细小计汇总维护。
          await recalcSaleOrderInvoicedSummary(tx, id);
        }
        if (products !== undefined || fieldsDto.badDebtAmount !== undefined) {
          // 产品明细或坏账变更会影响 totalUncollected，需让订单和客户 AR 基于新应收重算。
          await recalcSaleOrderPaymentSummary(tx, id);
        } else {
          await recomputeCustomerAccountsReceivable(tx, saleOrder.customerId);
        }
        if (existing.customerId !== saleOrder.customerId) {
          await recomputeCustomerAccountsReceivable(tx, existing.customerId);
        }

        if (pendingApproval) {
          // 产品、开票与回款汇总会在本事务继续通过 CAS 递增订单版本。
          // 必须以全部派生更新后的最终版本同步审批实例，否则下一次审批校验会永久命中旧快照。
          const finalOrder = await tx.saleOrder.findFirst({
            where: { id, deletedAt: null },
            select: { version: true },
          });
          if (!finalOrder) {
            throw new ConflictException('合同订单在审批表单更新后不存在，请刷新后重试');
          }
          await this.businessApprovalService.syncPendingFormEdit(
            tx,
            pendingApproval,
            APPROVAL_EVENT_TYPE.SALE_ORDER_ACTIVATE,
            { ...saleOrder, version: finalOrder.version },
            currentUser
          );
        }

        return saleOrder;
      });

      // 事务提交后再查询完整关联数据（含 products）
      const response = await this.findOne(id, chargerScope, currentEmployeeId);
      await this.changeLog
        ?.logChange({
          module: 'sale-orders',
          action: 'update',
          target: id,
          targetName: response.orderTitle ?? response.serialNumber,
          currentUser,
          before: existing,
          after: response,
        })
        .catch((error: unknown) => {
          this.logger.warn(
            `合同订单 ${id} 更新日志写入失败: ${error instanceof Error ? error.message : String(error)}`
          );
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
    dto: UpdateSaleOrderDto,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ) {
    const existing = await this.findOne(id, chargerScope, currentEmployeeId);
    if (existing.flowStatus === 'pending') {
      throw new BadRequestException('合同订单审批中，不允许发起变更，请先撤回审批');
    }
    if (existing.flowStatus !== 'approved') {
      throw new BadRequestException('只有已审批通过的合同订单需要发起变更审批');
    }
    if (dto.version !== existing.version) {
      throw new ConflictException(
        `数据已被其他用户修改，当前版本 ${existing.version}。请刷新后重试。`
      );
    }

    const finalCustomerId = dto.customerId ?? existing.customerId;
    const finalChargerId = dto.chargerId ?? existing.chargerId;
    const finalOpportunityId =
      dto.opportunityId !== undefined ? dto.opportunityId : existing.opportunityId;
    const submitterScope = chargerScope === undefined ? [] : chargerScope;
    const submitterEmployeeId = currentUser.employeeId ?? currentEmployeeId ?? null;

    const patch = stripUndefinedField(dto, ['version']);
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('没有可提交审批的变更内容');
    }
    if (dto.orderBeginDate !== undefined || dto.orderEndDate !== undefined) {
      const finalOrderBeginDate =
        dto.orderBeginDate !== undefined ? dto.orderBeginDate : existing.orderBeginDate;
      if (!finalOrderBeginDate) {
        throw new BadRequestException('合同开始日期必须是有效的 YYYY-MM-DD 日历日期');
      }
      assertSaleOrderDateRange(
        finalOrderBeginDate,
        dto.orderEndDate !== undefined ? dto.orderEndDate : existing.orderEndDate
      );
    }
    const baseVersion = requireVersion(existing.version);

    return this.businessApprovalService.submitChangeApproval(
      {
        eventType: APPROVAL_EVENT_TYPE.SALE_ORDER_CHANGE,
        targetType: APPROVAL_CHANGE_TARGET_TYPE.SALE_ORDER,
        targetId: id,
        targetCode: existing.serialNumber,
        title: `合同订单变更｜${existing.orderTitle ?? existing.serialNumber}`,
        baseVersion,
        patch,
        beforeSnapshot: existing as unknown as Record<string, unknown>,
        afterSnapshot: {
          ...(existing as unknown as Record<string, unknown>),
          ...patch,
        },
        validateInTransaction: async (tx) => {
          await this.assertSaleOrderChangeReferences(
            tx,
            {
              saleOrderId: id,
              existingCustomerId: existing.customerId,
              existingOpportunityId: existing.opportunityId,
              customerId: finalCustomerId,
              chargerId: finalChargerId,
              opportunityId: finalOpportunityId,
            },
            submitterScope,
            submitterEmployeeId
          );
        },
      },
      currentUser
    );
  }

  async getVoidPreview(
    id: string,
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<SaleOrderVoidPreviewOutput> {
    const existing = await this.findOne(id, chargerScope, currentEmployeeId);
    if (existing.flowStatus !== 'approved') {
      throw new BadRequestException('只有已审批通过的合同订单可以预检纠错作废');
    }
    const plan = await buildSaleOrderVoidPlan(this.prisma, id);
    return plan.preview;
  }

  async submitVoidRequest(
    id: string,
    dto: SaleOrderVoidRequestInput,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ) {
    const existing = await this.findOne(id, chargerScope, currentEmployeeId);
    if (existing.flowStatus === 'pending') {
      throw new BadRequestException('合同订单审批中，不能申请作废，请先撤回审批');
    }
    if (existing.flowStatus !== 'approved') {
      throw new BadRequestException('只有已审批通过的合同订单需要申请作废');
    }
    if (dto.version !== existing.version) {
      throw new ConflictException(
        `数据已被其他用户修改，当前版本 ${existing.version}。请刷新后重试。`
      );
    }

    const plan = await buildSaleOrderVoidPlan(this.prisma, id);
    if (plan.preview.blockers.length > 0) {
      throw new BadRequestException(plan.preview.blockers.join('；'));
    }
    if (
      plan.preview.requiresProjectAction &&
      dto.projectAction !== SALE_ORDER_VOID_PROJECT_ACTION.ROLLBACK_TO_OPPORTUNITY
    ) {
      throw new BadRequestException('请确认将关联项目回退到商机阶段');
    }
    if (!plan.preview.requiresProjectAction && dto.projectAction) {
      throw new BadRequestException('当前订单没有可自动回退的关联项目，请刷新预检结果');
    }

    const reason = dto.reason.trim();
    return this.businessApprovalService.submitChangeApproval(
      {
        eventType: APPROVAL_EVENT_TYPE.SALE_ORDER_VOID,
        targetType: APPROVAL_CHANGE_TARGET_TYPE.SALE_ORDER,
        targetId: id,
        targetCode: existing.serialNumber,
        title: `合同订单纠错作废｜${existing.orderTitle ?? existing.serialNumber}`,
        baseVersion: existing.version,
        patch: {
          __operation: 'void_bundle',
          __reason: reason,
          dependencySnapshot: plan.snapshot,
          projectAction: dto.projectAction ?? null,
        },
        beforeSnapshot: existing as unknown as Record<string, unknown>,
        afterSnapshot: {
          ...(existing as unknown as Record<string, unknown>),
          voidReason: reason,
          deletedAt: '审批通过后原子纠错作废',
          voidDependencies: {
            payments: plan.preview.payments,
            invoices: plan.preview.invoices,
            project: plan.preview.project,
          },
        },
      },
      currentUser
    );
  }

  async remove(
    id: string,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null,
    requestVersion?: number
  ): Promise<void> {
    if (
      typeof requestVersion !== 'number' ||
      !Number.isInteger(requestVersion) ||
      requestVersion < 1
    ) {
      throw new BadRequestException('删除合同订单必须携带有效的 version');
    }
    const existing = await this.findOne(id, chargerScope, currentEmployeeId);
    this.businessApprovalService.assertCanDelete(existing.flowStatus, '合同订单');

    const activeApproval = await this.prisma.approvalInstance.findFirst({
      where: {
        eventType: { in: [...SALE_ORDER_APPROVAL_EVENT_TYPES] },
        formId: id,
        status: { in: [...ACTIVE_APPROVAL_INSTANCE_STATUSES] },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (activeApproval) {
      throw new BadRequestException('合同订单存在审批中记录，请先撤回审批后再删除');
    }

    let deleted: unknown;
    try {
      deleted = await this.prisma.$transaction(async (tx) => {
        await lockSaleOrderRelationshipsBeforeCustomerTouch(tx, [
          {
            saleOrderId: id,
            opportunityId: existing.opportunityId,
            customerId: existing.customerId,
          },
        ]);
        const lockedOrderWhere: Prisma.SaleOrderWhereInput = {
          id,
          version: requestVersion,
          deletedAt: null,
        };
        applyCustomerCollabViaCustomerScope(lockedOrderWhere, chargerScope, currentEmployeeId);
        const lockedOrder = await tx.saleOrder.findFirst({
          where: lockedOrderWhere,
          select: {
            version: true,
            customerId: true,
            opportunityId: true,
            flowStatus: true,
          },
        });
        if (
          !lockedOrder ||
          lockedOrder.customerId !== existing.customerId ||
          lockedOrder.opportunityId !== existing.opportunityId
        ) {
          throw new ConflictException('合同订单版本、关系、删除状态或访问范围已变化，请刷新后重试');
        }
        this.businessApprovalService.assertCanDelete(lockedOrder.flowStatus, '合同订单');

        const [
          paymentCount,
          invoiceCount,
          projectCount,
          secondaryProjectCount,
          ledgerCount,
          pendingApprovalCount,
        ] = await Promise.all([
          tx.payment.count({ where: { saleOrderId: id, deletedAt: null } }),
          tx.invoice.count({ where: { saleOrderId: id, deletedAt: null } }),
          tx.project.count({ where: { saleOrderId: id, deletedAt: null } }),
          tx.projectSaleOrder.count({ where: { saleOrderId: id } }),
          tx.financeLedger.count({ where: { saleOrderId: id, deletedAt: null } }),
          tx.approvalInstance.count({
            where: {
              eventType: { in: [...SALE_ORDER_APPROVAL_EVENT_TYPES] },
              formId: id,
              status: { in: [...ACTIVE_APPROVAL_INSTANCE_STATUSES] },
              deletedAt: null,
            },
          }),
        ]);
        if (
          paymentCount > 0 ||
          invoiceCount > 0 ||
          projectCount > 0 ||
          secondaryProjectCount > 0 ||
          ledgerCount > 0 ||
          pendingApprovalCount > 0
        ) {
          throw new BadRequestException(
            `合同订单仍有关联记录（回款/退款 ${paymentCount}、发票 ${invoiceCount}、项目 ${projectCount + secondaryProjectCount}、财务流水 ${ledgerCount}、审批 ${pendingApprovalCount}），不能直接删除`
          );
        }

        await advanceCustomDevelopmentProjectFromSaleOrder(
          tx,
          id,
          PROJECT_STATUS.OPPORTUNITY,
          currentUser,
          { createIfMissing: false }
        );

        const updated = await tx.saleOrder.update({
          where: { id, version: requestVersion },
          data: {
            deletedAt: new Date(),
            version: { increment: 1 },
            ...auditUpdate(currentUser),
          },
        });
        await tx.orderProduct.updateMany({
          where: { saleOrderId: id, deletedAt: null },
          data: {
            deletedAt: new Date(),
            version: { increment: 1 },
            ...auditUpdate(currentUser),
          },
        });

        if (isEffectiveSaleOrderFlowStatus(lockedOrder.flowStatus)) {
          await reconcileSaleOrderActivationLifecycle(
            tx,
            {
              opportunityIds: [lockedOrder.opportunityId],
              customerIds: [lockedOrder.customerId],
              retractedOpportunityIds: [lockedOrder.opportunityId],
            },
            currentUser
          );
        }
        await recomputeCustomerAccountsReceivable(tx, lockedOrder.customerId);
        return updated;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException(
          `数据已被其他用户修改，当前版本 ${existing.version}。请刷新后重试。`
        );
      }
      throw error;
    }

    await this.changeLog
      ?.logChange({
        module: 'sale-orders',
        action: 'delete',
        target: id,
        targetName: existing.orderTitle ?? existing.serialNumber,
        currentUser,
        before: existing,
        after: deleted,
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `合同订单 ${id} 删除日志写入失败: ${error instanceof Error ? error.message : String(error)}`
        );
      });
  }

  private buildLegacyFilters(query: QuerySaleOrderDto): Record<string, unknown> {
    return {
      customerId: query.customerId,
      orderStatus: query.orderStatus,
      chargerId: query.chargerId,
    };
  }

  private async assertOpportunityBelongsToCustomer(
    opportunityId: string,
    customerId: string,
    prisma: PrismaService | Prisma.TransactionClient = this.prisma,
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<void> {
    const where: Prisma.OpportunityWhereInput = {
      id: opportunityId,
      deletedAt: null,
    };
    applyCustomerCollabViaCustomerScope(where, chargerScope, currentEmployeeId);
    const opportunity = await prisma.opportunity.findFirst({
      where,
      select: { customerId: true },
    });

    if (!opportunity) {
      throw new BadRequestException(
        `商机 ${opportunityId} 不存在、已删除或超出当前可见范围，不能关联订单`
      );
    }

    if (opportunity.customerId !== customerId) {
      throw new BadRequestException('合同订单客户必须与关联商机客户一致');
    }
  }

  private async assertCustomerInScope(
    customerId: string,
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null,
    prisma: PrismaService | Prisma.TransactionClient = this.prisma
  ): Promise<void> {
    const where: Prisma.CustomerWhereInput = {
      id: customerId,
      deletedAt: null,
    };
    applyCustomerCollabSelfScope(where, chargerScope, currentEmployeeId);
    const customer = await prisma.customer.findFirst({
      where,
      select: { id: true },
    });
    if (!customer) {
      throw new ForbiddenException('无权将合同订单写入该客户，或客户不存在');
    }
  }

  private assertChargerInScope(
    chargerId: string | null | undefined,
    chargerScope?: string[] | null
  ): void {
    if (!chargerId || chargerScope === undefined || chargerScope === null) return;
    if (!chargerScope.includes(chargerId)) {
      throw new ForbiddenException('无权把合同订单负责人指定到当前数据范围之外');
    }
  }

  private async assertChargerReference(
    tx: Prisma.TransactionClient,
    chargerId: string | null | undefined,
    chargerScope?: string[] | null
  ): Promise<void> {
    if (!chargerId) throw new BadRequestException('合同订单最终负责人不能为空');
    const charger = await tx.employee.findFirst({
      where: {
        id: chargerScope == null ? chargerId : { equals: chargerId, in: chargerScope },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!charger) {
      throw new ForbiddenException('最终负责人不存在、已删除或超出当前数据范围');
    }
  }

  private async assertSaleOrderChangeReferences(
    prisma: Prisma.TransactionClient,
    refs: {
      saleOrderId: string;
      existingCustomerId: string;
      existingOpportunityId: string | null | undefined;
      customerId: string;
      chargerId: string | null | undefined;
      opportunityId: string | null | undefined;
    },
    chargerScope: string[] | null,
    currentEmployeeId: string | null
  ): Promise<void> {
    const opportunityRelationshipChanged =
      refs.customerId !== refs.existingCustomerId ||
      refs.opportunityId !== refs.existingOpportunityId;
    const customerWhere: Prisma.CustomerWhereInput = {
      id: refs.customerId,
      deletedAt: null,
    };
    applyCustomerCollabSelfScope(customerWhere, chargerScope, currentEmployeeId);
    const customer = await prisma.customer.findFirst({
      where: customerWhere,
      select: { id: true },
    });
    if (!customer) {
      throw new ForbiddenException('最终客户不存在、已删除或超出当前可写数据范围');
    }

    // 兼容历史 chargerId=NULL：普通字段治理不得因既有空负责人被永久锁死；
    // 新建仍由 create schema/assertChargerReference 强制负责人，显式传负责人时实时复验。
    if (refs.chargerId) {
      const charger = await prisma.employee.findFirst({
        where: {
          id: chargerScope === null ? refs.chargerId : { equals: refs.chargerId, in: chargerScope },
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!charger) {
        throw new ForbiddenException('最终负责人不存在、已删除或超出当前数据范围');
      }
    }

    // 调用方必须已通过 lockSaleOrderRelationshipsBeforeCustomerTouch 持有新旧关系图锁。
    if (refs.opportunityId) {
      const opportunityWhere: Prisma.OpportunityWhereInput = {
        id: refs.opportunityId,
        customerId: refs.customerId,
        deletedAt: null,
      };
      applyCustomerCollabViaCustomerScope(opportunityWhere, chargerScope, currentEmployeeId);
      const opportunity = await prisma.opportunity.findFirst({
        where: opportunityWhere,
        select: { id: true },
      });
      if (!opportunity) {
        throw new ForbiddenException(
          '最终商机不存在、已删除、超出当前可见范围，或与最终客户不一致'
        );
      }
      if (opportunityRelationshipChanged) {
        await assertOpportunityHasNoActiveSaleOrder(prisma, refs.opportunityId, refs.saleOrderId);
      }
    }

    if (refs.customerId !== refs.existingCustomerId) {
      await this.assertCustomerCanChange(refs.saleOrderId, prisma);
    }
    if (opportunityRelationshipChanged) {
      await assertSaleOrderProjectRelationUnchanged(
        prisma,
        refs.saleOrderId,
        refs.customerId,
        refs.opportunityId ?? null
      );
    }
  }

  private async assertCustomerCanChange(
    saleOrderId: string,
    prisma: PrismaService | Prisma.TransactionClient = this.prisma
  ): Promise<void> {
    const [paymentCount, invoiceCount] = await Promise.all([
      prisma.payment.count({ where: { saleOrderId, deletedAt: null } }),
      prisma.invoice.count({ where: { saleOrderId, deletedAt: null } }),
    ]);

    if (paymentCount > 0 || invoiceCount > 0) {
      throw new BadRequestException('合同订单已有回款或开票记录，不能修改客户');
    }
  }

  private buildOrderProductSnapshot(product: {
    productName: string;
    productNumber?: string | null;
    productPrice?: number | string | null;
    quantity?: number | string | null;
    unitPrice?: number | string | null;
    contractUnitPrice?: number | string | null;
    remark?: string | null;
  }): OrderProductSnapshotWrite {
    const pricing = this.computeProductPricing(product);
    return {
      productName: product.productName,
      productNumber: product.productNumber ?? null,
      productPrice: product.productPrice != null ? String(product.productPrice) : null,
      quantity: product.quantity != null ? String(product.quantity) : null,
      unitPrice: product.unitPrice != null ? String(product.unitPrice) : null,
      contractUnitPrice:
        product.contractUnitPrice != null ? String(product.contractUnitPrice) : null,
      discount: pricing.discount.toFixed(2),
      subtotalAmount: pricing.subtotalAmount.toFixed(2),
      remark: product.remark ?? null,
    };
  }

  private async applyOrderProductSnapshotDiff(
    tx: Prisma.TransactionClient,
    saleOrderId: string,
    requestedProducts: OrderProductSnapshotWrite[],
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<void> {
    const rows = await tx.orderProduct.findMany({
      where: { saleOrderId, deletedAt: null },
      select: {
        id: true,
        version: true,
        productName: true,
        productNumber: true,
        productPrice: true,
        quantity: true,
        unitPrice: true,
        contractUnitPrice: true,
        discount: true,
        subtotalAmount: true,
        remark: true,
      },
      orderBy: { id: 'asc' },
    });
    const existingProducts = Array.isArray(rows) ? (rows as ExistingOrderProductSnapshot[]) : [];
    const { removed, created } = diffProductSnapshots(
      existingProducts,
      requestedProducts,
      (product) => this.orderProductFingerprint(product),
      (product) => this.orderProductFingerprint(product)
    );

    if (removed.length > 0) {
      const removedIds = removed.map((product) => product.id);
      const referencedProductCount = await tx.paymentItem.count({
        where: {
          saleOrderProductId: { in: removedIds },
          deletedAt: null,
        },
      });
      if (referencedProductCount > 0) {
        throw new ConflictException(
          `本次变更会替换的订单产品已有 ${referencedProductCount} 条 PaymentItem 引用，请保留原产品行`
        );
      }

      const softDeleted = await tx.orderProduct.updateMany({
        where: {
          saleOrderId,
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
        throw new ConflictException('订单产品版本或删除状态已变化，请刷新后重试');
      }
    }

    if (created.length > 0) {
      const productAudit = auditCreate(currentUser);
      await tx.orderProduct.createMany({
        data: created.map((product) => ({
          saleOrderId,
          ...product,
          ...productAudit,
        })),
      });
    }
  }

  private orderProductFingerprint(
    product: Omit<ExistingOrderProductSnapshot, 'id' | 'version'> | OrderProductSnapshotWrite
  ): string {
    return JSON.stringify([
      product.productName,
      product.productNumber ?? null,
      decimalProductFingerprint(product.productPrice),
      decimalProductFingerprint(product.quantity),
      decimalProductFingerprint(product.unitPrice),
      decimalProductFingerprint(product.contractUnitPrice),
      decimalProductFingerprint(product.discount),
      decimalProductFingerprint(product.subtotalAmount),
      product.remark ?? null,
    ]);
  }

  /**
   * 订单明细合同单价是最终成交单价；折扣由产品单价与合同单价反推。
   * 忽略客户端传入的 discount/subtotalAmount，避免缓存前端或手工 payload 写错金额。
   */
  private computeProductPricing(product: {
    quantity?: number | string | null;
    unitPrice?: number | string | null;
    contractUnitPrice?: number | string | null;
    productName?: string;
  }): {
    discount: Prisma.Decimal;
    productAmount: Prisma.Decimal;
    subtotalAmount: Prisma.Decimal;
  } {
    if (
      product.quantity == null ||
      product.unitPrice == null ||
      product.contractUnitPrice == null
    ) {
      throw new BadRequestException(
        `产品「${product.productName ?? ''}」必须填写数量、产品单价和合同单价`
      );
    }
    const qty = new Prisma.Decimal(product.quantity);
    const unitPrice = new Prisma.Decimal(product.unitPrice);
    const contractUnitPrice = new Prisma.Decimal(product.contractUnitPrice);
    if (qty.lte(0) || unitPrice.lte(0) || contractUnitPrice.lte(0)) {
      throw new BadRequestException(
        `产品「${product.productName ?? ''}」数量、产品单价和合同单价必须大于 0`
      );
    }
    const discount = new Prisma.Decimal(1)
      .minus(contractUnitPrice.div(unitPrice))
      .mul(100)
      .toDecimalPlaces(2);
    if (discount.lt(-999.99) || discount.gt(100)) {
      throw new BadRequestException(
        `产品「${product.productName ?? ''}」折扣超出范围，请核对产品单价和合同单价`
      );
    }
    return {
      discount,
      productAmount: qty.mul(unitPrice).toDecimalPlaces(2),
      subtotalAmount: qty.mul(contractUnitPrice).toDecimalPlaces(2),
    };
  }

  private sumProductAmount(
    products: {
      quantity?: number | string | null;
      unitPrice?: number | string | null;
      contractUnitPrice?: number | string | null;
      productName?: string;
    }[]
  ): Prisma.Decimal {
    return products.reduce(
      (sum, product) => sum.plus(this.computeProductPricing(product).productAmount),
      new Prisma.Decimal(0)
    );
  }

  private sumProductSubtotal(
    products: {
      quantity?: number | string | null;
      unitPrice?: number | string | null;
      contractUnitPrice?: number | string | null;
      productName?: string;
    }[]
  ): Prisma.Decimal {
    return products.reduce(
      (sum, product) => sum.plus(this.computeProductPricing(product).subtotalAmount),
      new Prisma.Decimal(0)
    );
  }

  private assertProductsValid(
    products: Array<{
      productName: string;
      quantity: number | string;
      unitPrice: number | string;
      contractUnitPrice: number | string;
    }>
  ): void {
    if (products.length === 0) {
      throw new BadRequestException('合同订单至少需要一项产品明细');
    }

    for (const product of products) {
      if (!product.productName.trim()) {
        throw new BadRequestException('产品名称不能为空');
      }
      const quantity = Number(product.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new BadRequestException('产品数量必须大于0');
      }
      const unitPrice = Number(product.unitPrice);
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        throw new BadRequestException('产品单价必须大于0');
      }
      const contractUnitPrice = Number(product.contractUnitPrice);
      if (!Number.isFinite(contractUnitPrice) || contractUnitPrice <= 0) {
        throw new BadRequestException('合同单价必须大于0');
      }
    }
  }

  // ========== 批量操作 ==========

  /**
   * 批量操作通用：用 chargerScope 过滤 ids，返回作用域内可见的订单子集 + 越权 ids。
   * chargerScope=null 表示该菜单 viewScope=ALL，跳过过滤。
   */
  private async filterBySaleOrderAccessScope(
    ids: string[],
    chargerScope: string[] | null | undefined,
    currentEmployeeId: string | null | undefined,
    select: Prisma.SaleOrderSelect
  ): Promise<{
    accessible: Array<Record<string, unknown>>;
    skipped: string[];
  }> {
    const where: Prisma.SaleOrderWhereInput = {
      id: { in: ids },
      deletedAt: null,
    };
    applyCustomerCollabViaCustomerScope(where, chargerScope, currentEmployeeId);
    const accessible = await this.prisma.saleOrder.findMany({ where, select });
    const accessibleIds = new Set(accessible.map((row: { id: string }) => row.id));
    const skipped = ids.filter((id) => !accessibleIds.has(id));
    return { accessible, skipped };
  }

  private buildSaleOrderBatchCasWhere(
    rows: Array<{ id: string }>,
    versions: Record<string, number>,
    chargerScope: string[] | null | undefined,
    currentEmployeeId: string | null | undefined,
    excludeApproved: boolean
  ): Prisma.SaleOrderWhereInput {
    const andClauses: Prisma.SaleOrderWhereInput[] = [
      {
        OR: rows.map((row) => ({ id: row.id, version: versions[row.id] })),
      },
    ];
    if (excludeApproved) {
      andClauses.push({
        // `flowStatus` 可空；显式把 null 纳入“非 approved”，避免 SQL 三值逻辑漏掉历史记录。
        OR: [{ flowStatus: null }, { flowStatus: { not: APPROVAL_INSTANCE_STATUS.APPROVED } }],
      });
    }

    const where: Prisma.SaleOrderWhereInput = {
      deletedAt: null,
      // CAS OR 必须嵌在 AND 内；范围 helper 会写顶层 OR，不能覆盖逐行 id+version。
      AND: andClauses,
    };
    applyCustomerCollabViaCustomerScope(where, chargerScope, currentEmployeeId);
    return where;
  }

  /**
   * 统一图锁之后重读批量目标的实时版本、归属和审批状态。
   * 最终 updateMany 仍复用同一 CAS where；本快照只用于锁后业务校验，禁止回退到锁前 rows。
   */
  private async loadLockedSaleOrderBatchRows(
    tx: Prisma.TransactionClient,
    rows: Array<{ id: string }>,
    versions: Record<string, number>,
    chargerScope: string[] | null | undefined,
    currentEmployeeId: string | null | undefined,
    excludeApproved: boolean,
    action: string
  ): Promise<
    Array<{
      id: string;
      version: number;
      customerId: string;
      opportunityId: string | null;
      chargerId: string | null;
      flowStatus: string | null;
      serialNumber: string;
      orderTitle: string | null;
      orderBeginDate: Date | null;
      orderEndDate: Date | null;
      paymentDate: Date | null;
      businessDate: Date | null;
      remark: string | null;
      chargerName: string | null;
      status: string;
    }>
  > {
    const lockedRows = await tx.saleOrder.findMany({
      where: this.buildSaleOrderBatchCasWhere(
        rows,
        versions,
        chargerScope,
        currentEmployeeId,
        excludeApproved
      ),
      select: {
        id: true,
        version: true,
        serialNumber: true,
        orderTitle: true,
        customerId: true,
        opportunityId: true,
        chargerId: true,
        chargerName: true,
        flowStatus: true,
        status: true,
        orderBeginDate: true,
        orderEndDate: true,
        paymentDate: true,
        businessDate: true,
        remark: true,
      },
      orderBy: { id: 'asc' },
    });
    this.assertSaleOrderBatchCasCount(lockedRows.length, rows.length, action);
    return lockedRows;
  }

  private assertSaleOrderBatchCandidateVersions(
    rows: Array<{ id: string; version: number }>,
    versions: Record<string, number>,
    action: string
  ): void {
    if (rows.some((row) => row.version !== versions[row.id])) {
      throw new ConflictException(`批量${action}冲突：订单版本已变化，请刷新后重试`);
    }
  }

  private assertSaleOrderBatchCasCount(actual: number, expected: number, action: string): void {
    if (actual !== expected) {
      throw new ConflictException(
        `批量${action}冲突：订单版本、删除状态、审批状态或访问范围已变化，请刷新后重试`
      );
    }
  }

  /** 拍快照用于审计 diff。字段集合 = 批量编辑白名单 + chargerId/chargerName + 关键标识。 */
  private async loadSaleOrderLogRows(ids: string[]) {
    if (ids.length === 0) return [];
    return this.prisma.saleOrder.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        serialNumber: true,
        orderTitle: true,
        orderBeginDate: true,
        orderEndDate: true,
        paymentDate: true,
        businessDate: true,
        remark: true,
        chargerId: true,
        chargerName: true,
        flowStatus: true,
        status: true,
      },
    });
  }

  /**
   * 批量更换订单负责人。chargerScope=null 表示该菜单 viewScope=ALL。
   * chargerName 置 null，由读取时通过 charger 关联动态拼接。
   */
  async batchTransfer(
    dto: BatchTransferSaleOrderInput,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope: string[] | null,
    currentEmployeeId: string | null
  ): Promise<{ success: number; skipped: string[] }> {
    const { ids, versions, chargerId } = dto;

    const newCharger = await this.prisma.employee.findUnique({
      where: { id: chargerId },
      select: { id: true },
    });
    if (!newCharger) {
      throw new NotFoundException(`员工 ${chargerId} 不存在`);
    }

    const { accessible, skipped } = await this.filterBySaleOrderAccessScope(
      ids,
      chargerScope,
      currentEmployeeId,
      {
        id: true,
        version: true,
        flowStatus: true,
      }
    );
    if (accessible.length === 0) {
      return { success: 0, skipped };
    }

    const accessibleRows = accessible as Array<{
      id: string;
      version: number;
      flowStatus: string | null;
    }>;
    const targetRows = accessibleRows.filter(
      (row) => row.flowStatus !== APPROVAL_INSTANCE_STATUS.PENDING
    );
    skipped.push(
      ...accessibleRows
        .filter((row) => row.flowStatus === APPROVAL_INSTANCE_STATUS.PENDING)
        .map((row) => row.id)
    );
    if (targetRows.length === 0) return { success: 0, skipped };
    this.assertSaleOrderBatchCandidateVersions(targetRows, versions, '转交');
    const targetIds = targetRows.map((row) => row.id);

    const result = await this.prisma.$transaction(async (tx) => {
      await lockSaleOrderGraph(tx, {
        financialSaleOrderIds: targetIds,
        saleOrderIds: targetIds,
      });
      const beforeRows = await this.loadLockedSaleOrderBatchRows(
        tx,
        targetRows,
        versions,
        null,
        null,
        false,
        '转交'
      );
      const updateResult = await tx.saleOrder.updateMany({
        where: this.buildSaleOrderBatchCasWhere(targetRows, versions, null, null, false),
        data: {
          chargerId,
          chargerName: null,
          ...auditUpdate(currentUser),
          version: { increment: 1 },
        },
      });
      this.assertSaleOrderBatchCasCount(updateResult.count, targetRows.length, '转交');
      return { updateResult, beforeRows };
    });

    const afterRows = await this.loadSaleOrderLogRows(targetIds);
    await this.writeBatchChangeLogs('batch-transfer', currentUser, result.beforeRows, afterRows);

    return { success: result.updateResult.count, skipped };
  }

  /**
   * 批量编辑订单（白名单字段）：updateMany，事务原子。
   */
  async batchUpdate(
    dto: BatchUpdateSaleOrderInput,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<{ success: number; skipped: string[] }> {
    const { ids, versions, patch } = dto;

    const data: Prisma.SaleOrderUpdateManyMutationInput = {};
    if (patch.orderTitle !== undefined) data.orderTitle = patch.orderTitle;
    if (patch.orderBeginDate !== undefined) {
      data.orderBeginDate = toSaleOrderDateOnly(patch.orderBeginDate, '合同开始日期');
    }
    if (patch.orderEndDate !== undefined) {
      data.orderEndDate = toSaleOrderDateOnly(patch.orderEndDate, '合同结束日期');
    }
    if (patch.paymentDate !== undefined) {
      data.paymentDate = toSaleOrderDateOnly(patch.paymentDate, '付款日期');
    }
    if (patch.businessDate !== undefined) {
      data.businessDate = toSaleOrderDateOnly(patch.businessDate, '业务日期');
    }
    assertSaleOrderDateRange(patch.orderBeginDate, patch.orderEndDate);
    if (patch.remark !== undefined) data.remark = patch.remark;
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('至少需要修改一个字段');
    }

    const { accessible, skipped } = await this.filterBySaleOrderAccessScope(
      ids,
      chargerScope,
      currentEmployeeId,
      {
        id: true,
        version: true,
        flowStatus: true,
        orderBeginDate: true,
        orderEndDate: true,
      }
    );
    if (accessible.length === 0) {
      return { success: 0, skipped };
    }

    const accessibleRows = accessible as Array<{
      id: string;
      version: number;
      flowStatus: string | null;
      orderBeginDate?: Date | null;
      orderEndDate?: Date | null;
    }>;
    const editableRows = accessibleRows.filter(
      (row) => row.flowStatus !== APPROVAL_INSTANCE_STATUS.APPROVED
    );
    const approvedIds = accessibleRows
      .filter((row) => row.flowStatus === APPROVAL_INSTANCE_STATUS.APPROVED)
      .map((row) => row.id);
    skipped.push(...approvedIds);
    if (editableRows.length === 0) {
      return { success: 0, skipped };
    }
    this.assertSaleOrderBatchCandidateVersions(editableRows, versions, '编辑');

    if (patch.orderBeginDate !== undefined || patch.orderEndDate !== undefined) {
      for (const row of editableRows) {
        assertSaleOrderDateRange(
          patch.orderBeginDate ?? toDateOnlyString(row.orderBeginDate),
          patch.orderEndDate ?? toDateOnlyString(row.orderEndDate)
        );
      }
    }

    const editableIds = editableRows.map((row) => row.id);
    const result = await this.prisma.$transaction(async (tx) => {
      const pendingApprovalLocks = new Map<
        string,
        Awaited<ReturnType<typeof this.businessApprovalService.lockPendingFormEdit>>
      >();
      for (const row of editableRows
        .filter((item) => item.flowStatus === APPROVAL_INSTANCE_STATUS.PENDING)
        .sort((left, right) => left.id.localeCompare(right.id))) {
        pendingApprovalLocks.set(
          row.id,
          await this.businessApprovalService.lockPendingFormEdit(
            tx,
            APPROVAL_EVENT_TYPE.SALE_ORDER_ACTIVATE,
            row.id,
            row.flowStatus,
            currentUser
          )
        );
      }
      await lockSaleOrderGraph(tx, {
        financialSaleOrderIds: editableIds,
        saleOrderIds: editableIds,
      });
      const lockedRows = await this.loadLockedSaleOrderBatchRows(
        tx,
        editableRows,
        versions,
        chargerScope,
        currentEmployeeId,
        true,
        '编辑'
      );
      if (patch.orderBeginDate !== undefined || patch.orderEndDate !== undefined) {
        for (const row of lockedRows) {
          assertSaleOrderDateRange(
            patch.orderBeginDate ?? toDateOnlyString(row.orderBeginDate),
            patch.orderEndDate ?? toDateOnlyString(row.orderEndDate)
          );
        }
      }
      const updateResult = await tx.saleOrder.updateMany({
        where: this.buildSaleOrderBatchCasWhere(
          editableRows,
          versions,
          chargerScope,
          currentEmployeeId,
          true
        ),
        data: {
          ...data,
          ...auditUpdate(currentUser),
          version: { increment: 1 },
        },
      });
      this.assertSaleOrderBatchCasCount(updateResult.count, editableRows.length, '编辑');
      if (pendingApprovalLocks.size > 0) {
        const updatedPendingRows = await tx.saleOrder.findMany({
          where: { id: { in: [...pendingApprovalLocks.keys()] }, deletedAt: null },
          select: {
            id: true,
            version: true,
            serialNumber: true,
            orderTitle: true,
            orderAmount: true,
            customer: { select: { id: true, customerName: true, shortName: true } },
          },
        });
        if (updatedPendingRows.length !== pendingApprovalLocks.size) {
          throw new ConflictException('审批目标已变化，请刷新后重试');
        }
        for (const record of updatedPendingRows.sort((left, right) =>
          left.id.localeCompare(right.id)
        )) {
          await this.businessApprovalService.syncPendingFormEdit(
            tx,
            pendingApprovalLocks.get(record.id)!,
            APPROVAL_EVENT_TYPE.SALE_ORDER_ACTIVATE,
            record,
            currentUser
          );
        }
      }
      return { updateResult, beforeRows: lockedRows };
    });

    const afterRows = await this.loadSaleOrderLogRows(editableIds);
    await this.writeBatchChangeLogs('batch-update', currentUser, result.beforeRows, afterRows);

    return { success: result.updateResult.count, skipped };
  }

  /**
   * 批量审批人决策：循环调 ApprovalsService.doApproval，每条独立事务。
   * 失败原因聚合到 skipped，不抛错——某条因 CAS 抢先/财务校验失败被跳过时其他正常处理。
   * 仅接受 sale_order_activate / sale_order_change / sale_order_void，其他归入 skipped。
   */
  async batchApprove(
    dto: BatchApproveInput,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<{
    success: number;
    skipped: Array<{ id: string; reason: string }>;
  }> {
    const allowedEventTypes = new Set<string>([
      APPROVAL_EVENT_TYPE.SALE_ORDER_ACTIVATE,
      APPROVAL_EVENT_TYPE.SALE_ORDER_CHANGE,
      APPROVAL_EVENT_TYPE.SALE_ORDER_VOID,
    ]);

    const skipped: Array<{ id: string; reason: string }> = [];
    let success = 0;

    for (const instanceId of dto.instanceIds) {
      try {
        const instance = await this.prisma.approvalInstance.findUnique({
          where: { id: instanceId },
          select: { eventType: true },
        });
        if (!instance) {
          skipped.push({ id: instanceId, reason: '审批实例不存在' });
          continue;
        }
        if (!allowedEventTypes.has(instance.eventType)) {
          skipped.push({ id: instanceId, reason: '非订单审批，已跳过' });
          continue;
        }
        await this.approvalsService.doApproval(
          instanceId,
          { action: dto.action, comment: dto.comment },
          currentUser
        );
        success += 1;
      } catch (error) {
        const reason =
          error instanceof HttpException
            ? error.message
            : error instanceof Error
              ? error.message
              : '未知错误';
        skipped.push({ id: instanceId, reason });
      }
    }

    return { success, skipped };
  }

  /**
   * 批量删除逐条复用单条删除原语，确保每条订单的项目回退、商机阶段、客户状态、
   * 客户应收与产品明细都在各自事务内保持一致；单条失败不影响其他订单。
   */
  async batchRemove(
    ids: string[],
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<{
    success: number;
    skipped: string[];
    errors: Array<{ id: string; error: string }>;
  }> {
    const { accessible, skipped } = await this.filterBySaleOrderAccessScope(
      ids,
      chargerScope,
      currentEmployeeId,
      { id: true, flowStatus: true, version: true }
    );
    const errors = skipped.map((id) => ({
      id,
      error: '记录不存在、已删除或无权访问',
    }));
    let success = 0;

    for (const row of accessible as Array<{
      id: string;
      flowStatus: string | null;
      version: number;
    }>) {
      try {
        await this.remove(row.id, currentUser, chargerScope, currentEmployeeId, row.version);
        success += 1;
      } catch (error) {
        skipped.push(row.id);
        errors.push({
          id: row.id,
          error:
            error instanceof HttpException
              ? error.message
              : error instanceof Error
                ? error.message
                : '未知错误',
        });
      }
    }

    return { success, skipped, errors };
  }

  /** 按 id 配对 before/after 行，逐条调 changeLog.logChange。审计失败仅 log，不阻断。 */
  private async writeBatchChangeLogs(
    action: 'batch-transfer' | 'batch-update' | 'batch-delete',
    currentUser: { id: string; employeeId?: string | null },
    beforeRows: Array<Record<string, unknown>>,
    afterRows: Array<Record<string, unknown>>
  ): Promise<void> {
    if (!this.changeLog) return;
    const afterById = new Map(afterRows.map((row) => [String(row.id), row]));
    for (const before of beforeRows) {
      const id = String(before.id);
      const after = afterById.get(id);
      if (!after) continue;
      await this.changeLog.logChange({
        module: 'sale-orders',
        action,
        target: id,
        targetName: (before.orderTitle as string | null) ?? (before.serialNumber as string),
        currentUser,
        before,
        after,
      });
    }
  }
}

function toSaleOrderDateOnly(value: string, fieldLabel: string): Date {
  const parsed = saleOrderDateOnlySchema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException(`${fieldLabel}必须是有效的 YYYY-MM-DD 日历日期`);
  }

  const date = new Date(`${parsed.data}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    // 双保险：即使运行时日期解析行为异常，也绝不把 Invalid Date 交给 Prisma。
    throw new BadRequestException(`${fieldLabel}必须是有效的 YYYY-MM-DD 日历日期`);
  }
  return date;
}

function assertSaleOrderDateRange(
  orderBeginDate: string | null | undefined,
  orderEndDate: string | null | undefined
): void {
  const parsedBegin = parseOptionalSaleOrderDateOnly(orderBeginDate, '合同开始日期');
  const parsedEnd = parseOptionalSaleOrderDateOnly(orderEndDate, '合同结束日期');
  if (parsedBegin && parsedEnd && parsedEnd < parsedBegin) {
    throw new BadRequestException('合同结束日期不能早于合同开始日期');
  }
}

function parseOptionalSaleOrderDateOnly(
  value: string | null | undefined,
  fieldLabel: string
): string | null {
  if (value == null || value === '') return null;
  const parsed = saleOrderDateOnlySchema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException(`${fieldLabel}必须是有效的 YYYY-MM-DD 日历日期`);
  }
  return parsed.data;
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
