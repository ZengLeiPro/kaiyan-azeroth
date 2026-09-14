import {
  APPROVAL_EVENT_TYPE,
  APPROVAL_INSTANCE_STATUS,
  INVOICE_STATUS,
} from '@ky-azeroth/shared/constants';
import type { BatchApproveInput } from '@ky-azeroth/shared/schemas/approval';
import type {
  BatchRemoveInvoiceInput,
  BatchTransferInvoiceInput,
  BatchUpdateInvoiceInput,
  InvoiceResponseOutput,
} from '@ky-azeroth/shared/schemas/invoice';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { SerialNumberType } from '../../common/constants/serial-number.constants';
import { FilterApplierService } from '../../common/filter-scheme';
import type { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  applyCustomerCollabViaCustomerScope,
  applyCustomerCollabViaCustomerWriteScope,
} from '../../common/services/data-scope.service';
import { SerialNumberService } from '../../common/services/serial-number.service';
import { auditCreate, auditUpdate } from '../../common/utils/audit-helper';
import { toJsonValue } from '../../common/utils/json-type-helpers';
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
import { CrmChangeLogService } from '../operation-logs/crm-change-log.service';
import {
  assertInvoiceWithinOrderAmount,
  lockSaleOrderFinancialGraph,
  validateFinancialSaleOrderAfterLock,
} from '../sale-orders/financial-limits.helper';
import { recalcSaleOrderInvoicedSummary } from '../sale-orders/invoiced-summary.helper';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { QueryInvoiceDto } from './dto/query-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { INVOICE_FILTER_REGISTRY } from './invoices.filter-registry';
import { clearActivePaymentInvoiceReferences } from './payment-invoice-reference.helper';

/**
 * 发票列表允许的排序字段白名单。
 * 注：invoiceDate 暂无单列索引（payments/sale-orders 的 businessDate 有），
 * 表数据量大幅增长后需评估补索引。
 */
const INVOICE_SORT_WHITELIST: ReadonlySet<string> = new Set([
  'serialNumber',
  'invoiceAmount',
  'invoiceDate',
  'createdAt',
  'updatedAt',
]);

const INVOICE_INCLUDE = {
  customer: {
    select: {
      id: true,
      customerName: true,
      shortName: true,
      chargerName: true,
      charger: { select: { name: true } },
    },
  },
  saleOrder: {
    select: {
      id: true,
      serialNumber: true,
      orderTitle: true,
      chargerName: true,
      charger: { select: { name: true } },
    },
  },
} as const;

type InvoiceWithIncludes = Prisma.InvoiceGetPayload<{ include: typeof INVOICE_INCLUDE }>;

function serializeInvoice(item: InvoiceWithIncludes): InvoiceResponseOutput {
  const customerChargerName = item.customer.charger?.name ?? item.customer.chargerName ?? null;
  const saleOrderChargerName = item.saleOrder.charger?.name ?? item.saleOrder.chargerName ?? null;
  const { customer, saleOrder, ...rest } = item;

  return serializeEntity<InvoiceResponseOutput>({
    ...rest,
    chargerName: saleOrderChargerName ?? customerChargerName,
    customer: {
      id: customer.id,
      customerName: customer.customerName,
      shortName: customer.shortName,
    },
    saleOrder: {
      id: saleOrder.id,
      serialNumber: saleOrder.serialNumber,
      chargerName: saleOrderChargerName,
    },
    invoiceDate: toDateOnlyString(item.invoiceDate),
    invoiceAmount: toDecimalNumber(item.invoiceAmount),
  });
}

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly serialNumberService: SerialNumberService,
    private readonly approvalGuardService: ApprovalGuardService,
    private readonly approvalsService: ApprovalsService,
    private readonly businessApprovalService: BusinessApprovalService,
    private readonly filterApplier: FilterApplierService,
    private readonly changeLog?: CrmChangeLogService
  ) {}

  /**
   * 创建发票
   */
  async create(
    dto: CreateInvoiceDto,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<InvoiceResponseOutput> {
    if (!Number.isFinite(dto.invoiceAmount) || dto.invoiceAmount <= 0) {
      throw new BadRequestException('发票金额必须大于 0');
    }
    const resolvedCustomerId = await this.resolveSaleOrderCustomerId(
      dto.saleOrderId,
      dto.customerId,
      chargerScope,
      currentEmployeeId
    );
    const serialNumber = await this.serialNumberService.generate(SerialNumberType.INVOICE);
    const approvalRequired = await this.approvalGuardService.isRequired(
      APPROVAL_EVENT_TYPE.INVOICE_APPROVE
    );
    const flowStatus = approvalRequired ? 'pending' : 'approved';

    let approvalInstanceId: string | undefined;
    const invoice = await this.prisma.$transaction(async (tx) => {
      await lockSaleOrderFinancialGraph(tx, dto.saleOrderId);
      const lockedOrder = await validateFinancialSaleOrderAfterLock(tx, {
        saleOrderId: dto.saleOrderId,
        expectedCustomerId: dto.customerId ?? resolvedCustomerId,
        chargerScope,
        currentEmployeeId,
      });
      if (flowStatus === 'approved') {
        await assertInvoiceWithinOrderAmount(tx, {
          saleOrderId: dto.saleOrderId,
          invoiceAmount: dto.invoiceAmount,
          invoiceStatus: dto.invoiceStatus,
        });
      }

      const created = await tx.invoice.create({
        data: {
          serialNumber,
          flowStatus,
          saleOrderId: dto.saleOrderId,
          customerId: lockedOrder.customerId,
          subject: dto.subject?.trim() || '开票',
          invoiceAmount: String(dto.invoiceAmount),
          invoiceType: dto.invoiceType ?? undefined,
          invoiceDate: dto.invoiceDate ? new Date(dto.invoiceDate) : undefined,
          invoiceNumber: dto.invoiceNumber ?? undefined,
          title: dto.title ?? undefined,
          taxIdentifyNum: dto.taxIdentifyNum ?? undefined,
          invoiceStatus: dto.invoiceStatus ?? undefined,
          itemType: dto.itemType ?? undefined,
          bankName: dto.bankName ?? undefined,
          bankAccount: dto.bankAccount ?? undefined,
          registeredAddress: dto.registeredAddress ?? undefined,
          registeredPhone: dto.registeredPhone ?? undefined,
          remark: dto.remark ?? undefined,
          ...auditCreate(currentUser),
        },
        include: INVOICE_INCLUDE,
      });

      if (approvalRequired) {
        approvalInstanceId = await this.businessApprovalService.createApprovalForNewRecord(
          tx,
          APPROVAL_EVENT_TYPE.INVOICE_APPROVE,
          created,
          currentUser
        );
      }

      // 业务行 + 订单聚合重算必须同事务，避免发票已落库但 invoicedAmount 未刷新
      await recalcSaleOrderInvoicedSummary(tx, created.saleOrderId);
      return created;
    });

    if (approvalInstanceId) {
      this.approvalsService.notifyOnSubmit(approvalInstanceId).catch(() => {});
    }

    const response = serializeInvoice(invoice);

    await this.changeLog?.logChange({
      module: 'invoices',
      action: 'create',
      target: response.id,
      targetName: response.invoiceNumber ?? response.serialNumber,
      currentUser,
      after: response,
    });

    return response;
  }

  /**
   * 查询发票列表
   *
   * 注意：发票模型本身没有 chargerId，数据范围是通过 `customer.chargerId` 间接过滤。
   * 这里把 `chargerScope: null` 传给 applier 让它跳过默认 scope 注入，在 baseWhere
   * 里自己拼 `{ customer: { chargerId: { in: chargerScope } } }`。
   */
  async findAll(
    query: QueryInvoiceDto,
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null,
    rawQuery?: unknown
  ): Promise<PaginatedResponse<InvoiceResponseOutput>> {
    const { page = 1, pageSize = 20, sortBy, sortOrder } = query;
    const { skip } = calculatePagination(page, pageSize);

    // 发票无自身 chargerId，仅靠关联 customer 鉴权（负责人 或 协作人）。
    const baseWhere: Prisma.InvoiceWhereInput = { deletedAt: null };
    applyCustomerCollabViaCustomerScope(baseWhere, chargerScope, currentEmployeeId);

    const where = await this.filterApplier.buildWhere<Prisma.InvoiceWhereInput>({
      registry: INVOICE_FILTER_REGISTRY,
      rawQuery,
      legacyKeyword: query.keyword,
      legacyFilters: this.buildLegacyFilters(query),
      // 走 "applier 跳过 scope + service 手工拼" 模式
      chargerScope: null,
      baseWhere,
    });

    const orderBy = resolveOrderBy<Prisma.InvoiceOrderByWithRelationInput>(sortBy, sortOrder, {
      whitelist: INVOICE_SORT_WHITELIST,
      fallback: { createdAt: 'desc' },
    });

    const [total, items] = await Promise.all([
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.findMany({
        where,
        skip,
        take: pageSize,
        orderBy,
        include: INVOICE_INCLUDE,
      }),
    ]);

    return {
      items: items.map((item) => serializeInvoice(item)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 查询发票详情
   */
  async findOne(
    id: string,
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<InvoiceResponseOutput> {
    const where: Prisma.InvoiceWhereInput = { id, deletedAt: null };
    applyCustomerCollabViaCustomerScope(where, chargerScope, currentEmployeeId);

    const invoice = await this.prisma.invoice.findFirst({
      where,
      include: INVOICE_INCLUDE,
    });

    if (!invoice) {
      throw new NotFoundException(`发票 ${id} 不存在`);
    }

    return serializeInvoice(invoice);
  }

  /**
   * 更新发票
   */
  async update(
    id: string,
    dto: UpdateInvoiceDto,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<InvoiceResponseOutput> {
    const requestVersion = requireRequestVersion(dto.version, '更新发票');
    const existing = await this.findOne(id, chargerScope, currentEmployeeId);
    this.businessApprovalService.assertCanDirectEdit(existing.flowStatus, '开票记录', currentUser);
    const finalSaleOrderId = dto.saleOrderId ?? existing.saleOrderId;
    const finalInvoiceAmount =
      dto.invoiceAmount !== undefined ? dto.invoiceAmount : existing.invoiceAmount;
    if (!Number.isFinite(Number(finalInvoiceAmount)) || Number(finalInvoiceAmount) <= 0) {
      throw new BadRequestException('发票金额必须大于 0');
    }
    const finalInvoiceStatus =
      dto.invoiceStatus !== undefined ? dto.invoiceStatus : existing.invoiceStatus;
    const shouldTouchOrderCustomer = dto.saleOrderId !== undefined || dto.customerId !== undefined;
    const resolvedCustomerId = shouldTouchOrderCustomer
      ? await this.resolveSaleOrderCustomerId(
          finalSaleOrderId,
          dto.customerId,
          chargerScope,
          currentEmployeeId
        )
      : undefined;
    try {
      // update + 旧/新订单聚合重算同事务
      const invoice = await this.prisma.$transaction(async (tx) => {
        const pendingApproval = await this.businessApprovalService.lockPendingFormEdit(
          tx,
          APPROVAL_EVENT_TYPE.INVOICE_APPROVE,
          id,
          existing.flowStatus,
          currentUser
        );
        await lockSaleOrderFinancialGraph(tx, [existing.saleOrderId, finalSaleOrderId]);
        const targetWhere: Prisma.InvoiceWhereInput = {
          id,
          version: requestVersion,
          deletedAt: null,
        };
        applyCustomerCollabViaCustomerWriteScope(targetWhere, chargerScope, currentEmployeeId);
        const lockedInvoice = await tx.invoice.findFirst({
          where: targetWhere,
          select: {
            id: true,
            saleOrderId: true,
            customerId: true,
            flowStatus: true,
            sourcePaymentIds: true,
          },
        });
        if (
          !lockedInvoice ||
          lockedInvoice.saleOrderId !== existing.saleOrderId ||
          lockedInvoice.customerId !== existing.customerId ||
          lockedInvoice.flowStatus !== existing.flowStatus
        ) {
          throw new ConflictException('发票版本、关系、状态或访问范围已变化，请刷新后重试');
        }
        this.businessApprovalService.assertCanDirectEdit(
          lockedInvoice.flowStatus,
          '开票记录',
          currentUser
        );
        await validateFinancialSaleOrderAfterLock(tx, {
          saleOrderId: existing.saleOrderId,
          expectedCustomerId: existing.customerId,
          chargerScope,
          currentEmployeeId,
        });
        const finalOrder = await validateFinancialSaleOrderAfterLock(tx, {
          saleOrderId: finalSaleOrderId,
          expectedCustomerId: resolvedCustomerId ?? existing.customerId,
          chargerScope,
          currentEmployeeId,
        });
        if (resolvedCustomerId !== undefined && resolvedCustomerId !== finalOrder.customerId) {
          throw new ConflictException('订单客户关系已变化，请刷新后重试');
        }
        const invoiceRelationChanged = finalSaleOrderId !== lockedInvoice.saleOrderId;
        if (invoiceRelationChanged) {
          const sourcePaymentIds = Array.isArray(lockedInvoice.sourcePaymentIds)
            ? lockedInvoice.sourcePaymentIds.filter(
                (value): value is string => typeof value === 'string' && value.length > 0
              )
            : [];
          const reverseReferenceCount = await tx.payment.count({
            where: {
              deletedAt: null,
              OR: [{ invoicedByInvoiceId: id }, { relatedInvoiceId: id }],
            },
          });
          if (sourcePaymentIds.length > 0 || reverseReferenceCount > 0) {
            throw new ConflictException('已有合并开票或退款反向引用的发票不能改绑合同订单');
          }
        }
        if (existing.flowStatus === 'approved') {
          await assertInvoiceWithinOrderAmount(tx, {
            saleOrderId: finalSaleOrderId,
            invoiceAmount: finalInvoiceAmount,
            invoiceStatus: finalInvoiceStatus,
            excludeInvoiceId: id,
          });
        }

        const updated = await tx.invoice.update({
          where: { id, version: requestVersion },
          data: {
            ...(dto.saleOrderId !== undefined && { saleOrderId: dto.saleOrderId }),
            ...(resolvedCustomerId !== undefined && { customerId: resolvedCustomerId }),
            ...(dto.subject !== undefined && { subject: dto.subject }),
            ...(dto.invoiceAmount !== undefined && { invoiceAmount: String(dto.invoiceAmount) }),
            ...(dto.invoiceType !== undefined && { invoiceType: dto.invoiceType }),
            ...(dto.invoiceDate !== undefined && {
              invoiceDate: dto.invoiceDate ? new Date(dto.invoiceDate) : null,
            }),
            ...(dto.invoiceNumber !== undefined && { invoiceNumber: dto.invoiceNumber }),
            ...(dto.title !== undefined && { title: dto.title }),
            ...(dto.taxIdentifyNum !== undefined && { taxIdentifyNum: dto.taxIdentifyNum }),
            ...(dto.invoiceStatus !== undefined && { invoiceStatus: dto.invoiceStatus }),
            ...(dto.itemType !== undefined && { itemType: dto.itemType }),
            ...(dto.bankName !== undefined && { bankName: dto.bankName }),
            ...(dto.bankAccount !== undefined && { bankAccount: dto.bankAccount }),
            ...(dto.registeredAddress !== undefined && {
              registeredAddress: dto.registeredAddress,
            }),
            ...(dto.registeredPhone !== undefined && { registeredPhone: dto.registeredPhone }),
            ...(dto.remark !== undefined && { remark: dto.remark }),
            ...auditUpdate(currentUser),
            version: { increment: 1 },
          },
          include: INVOICE_INCLUDE,
        });

        await this.businessApprovalService.syncPendingFormEdit(
          tx,
          pendingApproval,
          APPROVAL_EVENT_TYPE.INVOICE_APPROVE,
          updated,
          currentUser
        );

        if (
          updated.invoiceStatus === INVOICE_STATUS.VOID ||
          updated.invoiceStatus === INVOICE_STATUS.RED_VOIDED
        ) {
          await clearActivePaymentInvoiceReferences(tx, updated.id, currentUser);
        }

        // 若 saleOrderId 改了，旧/新订单都要刷新；否则只刷新当前订单。
        const touchedSaleOrderIds = new Set<string>([updated.saleOrderId]);
        if (existing.saleOrderId && existing.saleOrderId !== updated.saleOrderId) {
          touchedSaleOrderIds.add(existing.saleOrderId);
        }
        for (const sid of touchedSaleOrderIds) {
          await recalcSaleOrderInvoicedSummary(tx, sid);
        }
        return updated;
      });

      const response = serializeInvoice(invoice);

      await this.changeLog?.logChange({
        module: 'invoices',
        action: 'update',
        target: id,
        targetName: response.invoiceNumber ?? response.serialNumber,
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
    dto: UpdateInvoiceDto,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ) {
    const requestVersion = requireRequestVersion(dto.version, '提交发票变更审批');
    const existing = await this.findOne(id, chargerScope, currentEmployeeId);
    if (existing.flowStatus === 'pending') {
      throw new BadRequestException('开票记录审批中，不允许发起变更，请先撤回审批');
    }
    if (existing.flowStatus !== 'approved') {
      throw new BadRequestException('只有已审批通过的开票记录需要发起变更审批');
    }
    if (requestVersion !== existing.version) {
      throw new ConflictException(
        `数据已被其他用户修改，当前版本 ${existing.version}。请刷新后重试。`
      );
    }

    const patch = stripUndefinedField(dto, ['version']);
    if (Object.keys(patch).length === 0) {
      throw new BadRequestException('没有可提交审批的变更内容');
    }
    const baseVersion = requireVersion(existing.version);

    return this.businessApprovalService.submitChangeApproval(
      {
        eventType: APPROVAL_EVENT_TYPE.INVOICE_CHANGE,
        targetType: APPROVAL_CHANGE_TARGET_TYPE.INVOICE,
        targetId: id,
        targetCode: existing.serialNumber,
        title: `开票变更｜${existing.invoiceNumber ?? existing.serialNumber}`,
        baseVersion,
        patch,
        beforeSnapshot: existing as unknown as Record<string, unknown>,
        afterSnapshot: { ...(existing as unknown as Record<string, unknown>), ...patch },
      },
      currentUser
    );
  }

  /**
   * 红字冲销发票（全额冲红）
   *
   * 约束：
   * - 原票 invoiceStatus 必须是 NORMAL（已开正常票）
   * - 原票 flowStatus 必须是 approved（草稿/驳回不允许冲红）
   * - 软删 / 已作废 / 已冲红 → 直接拒绝
   *
   * 效果：原票 invoiceStatus 置 'RED_VOIDED'，version 递增，remark 追加冲红原因；
   *      触发 recalcSaleOrderInvoicedSummary 后，订单净开票额自动下调，
   *      orderInvoiceStatus 从「已开完」退回「部分开票」/「未开票」。
   *
   * 部分冲红场景 = 全冲 + 重开（业务侧自行操作）。
   */
  async voidRed(
    id: string,
    version: number,
    reason: string,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<InvoiceResponseOutput> {
    requireRequestVersion(version, '冲红发票');
    const existing = await this.findOne(id, chargerScope, currentEmployeeId);

    if (existing.invoiceStatus !== INVOICE_STATUS.NORMAL) {
      throw new BadRequestException(
        `仅 NORMAL 状态的发票允许冲红，当前 ${existing.invoiceStatus ?? 'null'}`
      );
    }
    if (existing.flowStatus !== 'approved') {
      throw new BadRequestException(
        `仅 approved 审批通过的发票允许冲红，当前 ${existing.flowStatus ?? 'null'}`
      );
    }
    if (!reason || !reason.trim()) {
      throw new BadRequestException('冲红原因不能为空');
    }

    const stampedRemark = `[冲红 ${new Date().toISOString().slice(0, 10)}] ${reason.trim()}${
      existing.remark ? `\n--- 原备注 ---\n${existing.remark}` : ''
    }`;

    try {
      // 冲红 + 订单净开票重算必须在同一事务，否则可能出现「票已冲红但订单 invoicedAmount 未更新」
      // 的半提交状态（CAS 重算失败时 invoice 已落库无法回滚）。
      const invoice = await this.prisma.$transaction(async (tx) => {
        await lockSaleOrderFinancialGraph(tx, existing.saleOrderId);
        const targetWhere: Prisma.InvoiceWhereInput = {
          id,
          version,
          deletedAt: null,
        };
        applyCustomerCollabViaCustomerWriteScope(targetWhere, chargerScope, currentEmployeeId);
        const lockedInvoice = await tx.invoice.findFirst({
          where: targetWhere,
          select: {
            id: true,
            saleOrderId: true,
            customerId: true,
            flowStatus: true,
            invoiceStatus: true,
          },
        });
        if (
          !lockedInvoice ||
          lockedInvoice.saleOrderId !== existing.saleOrderId ||
          lockedInvoice.customerId !== existing.customerId ||
          lockedInvoice.flowStatus !== 'approved' ||
          lockedInvoice.invoiceStatus !== INVOICE_STATUS.NORMAL
        ) {
          throw new ConflictException('发票版本、关系、审批或票面状态已变化，请刷新后重试');
        }
        await validateFinancialSaleOrderAfterLock(tx, {
          saleOrderId: lockedInvoice.saleOrderId,
          expectedCustomerId: lockedInvoice.customerId,
          chargerScope,
          currentEmployeeId,
        });
        const updated = await tx.invoice.update({
          where: { id, version },
          data: {
            invoiceStatus: INVOICE_STATUS.RED_VOIDED,
            remark: stampedRemark,
            version: { increment: 1 },
            ...auditUpdate(currentUser),
          },
        });
        await clearActivePaymentInvoiceReferences(tx, id, currentUser);
        await recalcSaleOrderInvoicedSummary(tx, updated.saleOrderId);
        return updated;
      });

      const response = serializeEntity<InvoiceResponseOutput>({
        ...invoice,
        invoiceAmount: toDecimalNumber(invoice.invoiceAmount),
        invoiceDate: toDateOnlyString(invoice.invoiceDate),
      });

      await this.changeLog?.logChange({
        module: 'invoices',
        action: 'red-void',
        target: id,
        targetName: response.invoiceNumber ?? response.serialNumber,
        currentUser,
        before: existing,
        after: response,
      });

      return response;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException(
          `发票已被其他用户修改，当前版本 ${existing.version}。请刷新后重试。`
        );
      }
      throw error;
    }
  }

  /**
   * 删除发票（软删除，带乐观锁）
   */
  async remove(
    id: string,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope: string[] | null | undefined,
    currentEmployeeId: string | null | undefined,
    requestVersion: number
  ): Promise<void> {
    requireRequestVersion(requestVersion, '删除发票');
    const existing = await this.findOne(id, chargerScope, currentEmployeeId);
    this.businessApprovalService.assertCanDelete(existing.flowStatus, '开票记录');

    try {
      const deleted = await this.prisma.$transaction(async (tx) => {
        await lockSaleOrderFinancialGraph(tx, existing.saleOrderId);
        const targetWhere: Prisma.InvoiceWhereInput = {
          id,
          version: requestVersion,
          deletedAt: null,
        };
        applyCustomerCollabViaCustomerWriteScope(targetWhere, chargerScope, currentEmployeeId);
        const lockedInvoice = await tx.invoice.findFirst({
          where: targetWhere,
          select: {
            id: true,
            saleOrderId: true,
            customerId: true,
            flowStatus: true,
            sourcePaymentIds: true,
          },
        });
        if (
          !lockedInvoice ||
          lockedInvoice.saleOrderId !== existing.saleOrderId ||
          lockedInvoice.customerId !== existing.customerId ||
          lockedInvoice.flowStatus !== existing.flowStatus
        ) {
          throw new ConflictException('发票版本、关系、状态或访问范围已变化，请刷新后重试');
        }
        this.businessApprovalService.assertCanDelete(lockedInvoice.flowStatus, '开票记录');
        await validateFinancialSaleOrderAfterLock(tx, {
          saleOrderId: lockedInvoice.saleOrderId,
          expectedCustomerId: lockedInvoice.customerId,
          chargerScope,
          currentEmployeeId,
        });
        const row = await tx.invoice.update({
          where: { id, version: requestVersion },
          data: {
            deletedAt: new Date(),
            version: { increment: 1 },
            ...auditUpdate(currentUser),
          },
        });
        await clearActivePaymentInvoiceReferences(tx, id, currentUser);
        if (existing.saleOrderId) {
          await recalcSaleOrderInvoicedSummary(tx, existing.saleOrderId);
        }
        return row;
      });

      await this.changeLog?.logChange({
        module: 'invoices',
        action: 'delete',
        target: id,
        targetName: existing.invoiceNumber ?? existing.serialNumber,
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

  private buildLegacyFilters(query: QueryInvoiceDto): Record<string, unknown> {
    return {
      invoiceStatus: query.invoiceStatus,
      customerId: query.customerId,
      saleOrderId: query.saleOrderId,
    };
  }

  private async resolveSaleOrderCustomerId(
    saleOrderId: string,
    inputCustomerId?: string | null,
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<string> {
    const where: Prisma.SaleOrderWhereInput = { id: saleOrderId, deletedAt: null };
    applyCustomerCollabViaCustomerWriteScope(where, chargerScope, currentEmployeeId);
    const saleOrder = await this.prisma.saleOrder.findFirst({
      where,
      select: { customerId: true },
    });

    if (!saleOrder) {
      throw new ForbiddenException('无权在该销售订单下登记开票，或订单不存在');
    }

    if (inputCustomerId && inputCustomerId !== saleOrder.customerId) {
      throw new BadRequestException('开票客户必须与关联合同订单客户一致');
    }

    return saleOrder.customerId;
  }

  // ========== 合并开票（v1，由 PaymentsService.mergeInvoice 调用） ==========

  /**
   * 在外部事务里创建一张「合并开票」发票，回写 sourcePaymentIds，并触发与单条新建发票
   * 完全一致的审批流（INVOICE_APPROVE）+ 订单已开票金额聚合重算。
   *
   * 与 create 的核心差异：
   * - 接收外部 tx 而不是自己开事务（保证 mergeInvoice 的"建发票+回写 payment.invoicedByInvoiceId"原子）
   * - sourcePaymentIds 必填（用于审计反查）
   * - chargerId 由调用方传入（通常等于订单负责人）
   * - 审批 approvalInstanceId 通过返回值上抛，调用方在事务外触发 notify
   */
  async createForMerge(
    tx: Prisma.TransactionClient,
    args: {
      saleOrderId: string;
      customerId: string;
      invoiceAmount: number;
      sourcePaymentIds: string[];
      invoiceFields: {
        subject?: string | null;
        invoiceType: string;
        invoiceDate: string;
        invoiceNumber?: string | null;
        title?: string | null;
        taxIdentifyNum?: string | null;
        invoiceStatus?: string | null;
        itemType?: string | null;
        bankName?: string | null;
        bankAccount?: string | null;
        registeredAddress?: string | null;
        registeredPhone?: string | null;
        remark?: string | null;
      };
      currentUser: { id: string; employeeId?: string | null };
      chargerId?: string | null;
    }
  ): Promise<{ invoice: InvoiceResponseOutput; approvalInstanceId?: string }> {
    if (!Number.isFinite(args.invoiceAmount) || args.invoiceAmount <= 0) {
      throw new BadRequestException('合并开票金额必须是有限正数');
    }
    const serialNumber = await this.serialNumberService.generate(SerialNumberType.INVOICE);
    const approvalRequired = await this.approvalGuardService.isRequired(
      APPROVAL_EVENT_TYPE.INVOICE_APPROVE
    );
    const flowStatus = approvalRequired ? 'pending' : 'approved';

    // 与 create 同位置做金额上限校验；approvalRequired 时由审批通过路径再校验一次。
    if (flowStatus === 'approved') {
      // caller（PaymentsService.mergeInvoice）已持有完整 SaleOrder 图锁并完成实时关系复验。
      await assertInvoiceWithinOrderAmount(tx, {
        saleOrderId: args.saleOrderId,
        invoiceAmount: args.invoiceAmount,
        invoiceStatus: args.invoiceFields.invoiceStatus,
      });
    }

    const fields = args.invoiceFields;
    const created = await tx.invoice.create({
      data: {
        serialNumber,
        flowStatus,
        saleOrderId: args.saleOrderId,
        customerId: args.customerId,
        subject: fields.subject?.trim() || '开票',
        invoiceAmount: String(args.invoiceAmount),
        invoiceType: fields.invoiceType,
        invoiceDate: new Date(fields.invoiceDate),
        invoiceNumber: fields.invoiceNumber ?? undefined,
        title: fields.title ?? undefined,
        taxIdentifyNum: fields.taxIdentifyNum ?? undefined,
        invoiceStatus: fields.invoiceStatus ?? undefined,
        itemType: fields.itemType ?? undefined,
        bankName: fields.bankName ?? undefined,
        bankAccount: fields.bankAccount ?? undefined,
        registeredAddress: fields.registeredAddress ?? undefined,
        registeredPhone: fields.registeredPhone ?? undefined,
        remark: fields.remark ?? undefined,
        chargerId: args.chargerId ?? undefined,
        sourcePaymentIds: toJsonValue(args.sourcePaymentIds),
        ...auditCreate(args.currentUser),
      },
      include: INVOICE_INCLUDE,
    });

    let approvalInstanceId: string | undefined;
    if (approvalRequired) {
      approvalInstanceId = await this.businessApprovalService.createApprovalForNewRecord(
        tx,
        APPROVAL_EVENT_TYPE.INVOICE_APPROVE,
        created,
        args.currentUser
      );
    }

    // approved 状态直发时立即重算订单已开票聚合；pending 状态等审批通过路径里调
    if (flowStatus === 'approved') {
      await recalcSaleOrderInvoicedSummary(tx, created.saleOrderId);
    }

    return { invoice: serializeInvoice(created), approvalInstanceId };
  }

  // ========== 批量操作 ==========

  /** 私有：用 chargerScope 过滤 ids，返回作用域内可见的发票子集 + 越权 ids。 */
  private async filterByInvoiceAccessScope(
    ids: string[],
    chargerScope: string[] | null | undefined,
    currentEmployeeId: string | null | undefined,
    select: Prisma.InvoiceSelect
  ): Promise<{ accessible: Array<Record<string, unknown>>; skipped: string[] }> {
    const where: Prisma.InvoiceWhereInput = {
      id: { in: ids },
      deletedAt: null,
    };
    applyCustomerCollabViaCustomerScope(where, chargerScope, currentEmployeeId);
    const accessible = await this.prisma.invoice.findMany({ where, select });
    const accessibleIds = new Set(accessible.map((row: { id: string }) => row.id));
    const skipped = ids.filter((id) => !accessibleIds.has(id));
    return { accessible, skipped };
  }

  private buildInvoiceBatchCasWhere(
    rows: Array<{ id: string; flowStatus: string | null }>,
    versions: Record<string, number>,
    chargerScope: string[] | null | undefined,
    currentEmployeeId: string | null | undefined
  ): Prisma.InvoiceWhereInput {
    const where: Prisma.InvoiceWhereInput = {
      deletedAt: null,
      AND: [
        {
          OR: rows.map((row) => ({
            id: row.id,
            version: versions[row.id],
            flowStatus: row.flowStatus,
          })),
        },
      ],
    };
    applyCustomerCollabViaCustomerScope(where, chargerScope, currentEmployeeId);
    return where;
  }

  private async validateLockedInvoiceBatchOrders(
    tx: Prisma.TransactionClient,
    rows: Array<{
      id: string;
      saleOrderId: string;
      customerId: string;
      flowStatus: string | null;
    }>,
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null,
    allowPending = false
  ): Promise<void> {
    for (const row of [...rows].sort((left, right) => left.id.localeCompare(right.id))) {
      if (
        row.flowStatus === APPROVAL_INSTANCE_STATUS.APPROVED ||
        (!allowPending && row.flowStatus === APPROVAL_INSTANCE_STATUS.PENDING)
      ) {
        throw new ConflictException('批量发票包含审批中或已审批记录，请刷新后重试');
      }
      await validateFinancialSaleOrderAfterLock(tx, {
        saleOrderId: row.saleOrderId,
        expectedCustomerId: row.customerId,
        chargerScope,
        currentEmployeeId,
      });
    }
  }

  private assertInvoiceBatchCasCount(actual: number, expected: number): void {
    if (actual !== expected) {
      throw new ConflictException('批量发票已被其他用户或审批流程修改，请刷新后重试');
    }
  }

  private async loadInvoiceLogRows(ids: string[]) {
    if (ids.length === 0) return [];
    return this.prisma.invoice.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        serialNumber: true,
        invoiceNumber: true,
        invoiceType: true,
        invoiceDate: true,
        itemType: true,
        remark: true,
        chargerId: true,
        chargerName: true,
        flowStatus: true,
        status: true,
      },
    });
  }

  async batchTransfer(
    dto: BatchTransferInvoiceInput,
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

    const { accessible, skipped } = await this.filterByInvoiceAccessScope(
      ids,
      chargerScope,
      currentEmployeeId,
      {
        id: true,
        saleOrderId: true,
        customerId: true,
        flowStatus: true,
      }
    );
    if (accessible.length === 0) {
      return { success: 0, skipped };
    }

    const accessibleRows = accessible as Array<{
      id: string;
      saleOrderId: string;
      customerId: string;
      flowStatus: string | null;
    }>;
    const targetRows = accessibleRows.filter(
      (row) =>
        row.flowStatus !== APPROVAL_INSTANCE_STATUS.PENDING &&
        row.flowStatus !== APPROVAL_INSTANCE_STATUS.APPROVED
    );
    skipped.push(
      ...accessibleRows
        .filter((row) => row.flowStatus === 'pending' || row.flowStatus === 'approved')
        .map((row) => row.id)
    );
    if (targetRows.length === 0) return { success: 0, skipped };
    const targetIds = targetRows.map((row) => row.id);
    const beforeRows = await this.loadInvoiceLogRows(targetIds);

    await this.prisma.$transaction(async (tx) => {
      await lockSaleOrderFinancialGraph(
        tx,
        targetRows.map((row) => row.saleOrderId)
      );
      const lockedRows = await tx.invoice.findMany({
        where: this.buildInvoiceBatchCasWhere(targetRows, versions, null, null),
        select: { id: true, saleOrderId: true, customerId: true, flowStatus: true },
      });
      this.assertInvoiceBatchCasCount(lockedRows.length, targetRows.length);
      await this.validateLockedInvoiceBatchOrders(tx, lockedRows, null, null);
      const result = await tx.invoice.updateMany({
        where: this.buildInvoiceBatchCasWhere(targetRows, versions, null, null),
        data: {
          chargerId,
          chargerName: null,
          ...auditUpdate(currentUser),
          version: { increment: 1 },
        },
      });
      this.assertInvoiceBatchCasCount(result.count, targetRows.length);
    });

    const afterRows = await this.loadInvoiceLogRows(targetIds);
    await this.writeBatchChangeLogs('batch-transfer', currentUser, beforeRows, afterRows);

    return { success: targetRows.length, skipped };
  }

  async batchUpdate(
    dto: BatchUpdateInvoiceInput,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<{ success: number; skipped: string[] }> {
    const { ids, versions, patch } = dto;

    const data: Prisma.InvoiceUpdateManyMutationInput = {};
    if (patch.invoiceType !== undefined) data.invoiceType = patch.invoiceType;
    if (patch.invoiceDate !== undefined)
      data.invoiceDate = patch.invoiceDate ? new Date(patch.invoiceDate) : null;
    if (patch.itemType !== undefined) data.itemType = patch.itemType;
    if (patch.remark !== undefined) data.remark = patch.remark;
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('至少需要修改一个字段');
    }

    const { accessible, skipped } = await this.filterByInvoiceAccessScope(
      ids,
      chargerScope,
      currentEmployeeId,
      { id: true, saleOrderId: true, customerId: true, flowStatus: true }
    );
    if (accessible.length === 0) {
      return { success: 0, skipped };
    }

    const accessibleRows = accessible as Array<{
      id: string;
      saleOrderId: string;
      customerId: string;
      flowStatus: string | null;
    }>;
    const editableRows = accessibleRows.filter(
      (row) => row.flowStatus !== APPROVAL_INSTANCE_STATUS.APPROVED
    );
    const lockedIds = accessibleRows
      .filter((row) => row.flowStatus === APPROVAL_INSTANCE_STATUS.APPROVED)
      .map((row) => row.id);
    skipped.push(...lockedIds);
    if (editableRows.length === 0) {
      return { success: 0, skipped };
    }

    const editableIds = editableRows.map((row) => row.id);
    const beforeRows = await this.loadInvoiceLogRows(editableIds);
    await this.prisma.$transaction(async (tx) => {
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
            APPROVAL_EVENT_TYPE.INVOICE_APPROVE,
            row.id,
            row.flowStatus,
            currentUser
          )
        );
      }
      await lockSaleOrderFinancialGraph(
        tx,
        editableRows.map((row) => row.saleOrderId)
      );
      const lockedRows = await tx.invoice.findMany({
        where: this.buildInvoiceBatchCasWhere(
          editableRows,
          versions,
          chargerScope,
          currentEmployeeId
        ),
        select: { id: true, saleOrderId: true, customerId: true, flowStatus: true },
      });
      this.assertInvoiceBatchCasCount(lockedRows.length, editableRows.length);
      await this.validateLockedInvoiceBatchOrders(
        tx,
        lockedRows,
        chargerScope,
        currentEmployeeId,
        true
      );
      const result = await tx.invoice.updateMany({
        where: this.buildInvoiceBatchCasWhere(
          editableRows,
          versions,
          chargerScope,
          currentEmployeeId
        ),
        data: {
          ...data,
          ...auditUpdate(currentUser),
          version: { increment: 1 },
        },
      });
      this.assertInvoiceBatchCasCount(result.count, editableRows.length);
      if (pendingApprovalLocks.size > 0) {
        const updatedPendingRows = await tx.invoice.findMany({
          where: { id: { in: [...pendingApprovalLocks.keys()] }, deletedAt: null },
          select: {
            id: true,
            version: true,
            serialNumber: true,
            title: true,
            invoiceAmount: true,
            customer: { select: { id: true, customerName: true, shortName: true } },
            saleOrder: { select: { id: true, serialNumber: true } },
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
            APPROVAL_EVENT_TYPE.INVOICE_APPROVE,
            record,
            currentUser
          );
        }
      }
    });

    const afterRows = await this.loadInvoiceLogRows(editableIds);
    await this.writeBatchChangeLogs('batch-update', currentUser, beforeRows, afterRows);

    return { success: editableRows.length, skipped };
  }

  async batchApprove(
    dto: BatchApproveInput,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<{ success: number; skipped: Array<{ id: string; reason: string }> }> {
    const allowedEventTypes = new Set<string>([
      APPROVAL_EVENT_TYPE.INVOICE_APPROVE,
      APPROVAL_EVENT_TYPE.INVOICE_CHANGE,
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
          skipped.push({ id: instanceId, reason: '非发票审批，已跳过' });
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
   * 批量软删发票。
   * 同事务内清理 payment.invoicedByInvoiceId（避免脏状态：发票已删但回款仍标记已合并）。
   */
  async batchRemove(
    dto: BatchRemoveInvoiceInput,
    currentUser: { id: string; employeeId?: string | null },
    chargerScope?: string[] | null,
    currentEmployeeId?: string | null
  ): Promise<{ success: number; skipped: string[] }> {
    const { ids, versions } = dto;
    const { accessible, skipped } = await this.filterByInvoiceAccessScope(
      ids,
      chargerScope,
      currentEmployeeId,
      { id: true, saleOrderId: true, customerId: true, flowStatus: true }
    );
    if (accessible.length === 0) {
      return { success: 0, skipped };
    }

    const accessibleRows = accessible as Array<{
      id: string;
      saleOrderId: string;
      customerId: string;
      flowStatus: string | null;
    }>;
    const deletableRows = accessibleRows.filter(
      (row) => row.flowStatus !== 'pending' && row.flowStatus !== 'approved'
    );
    const lockedIds = accessibleRows
      .filter((row) => row.flowStatus === 'pending' || row.flowStatus === 'approved')
      .map((row) => row.id);
    skipped.push(...lockedIds);
    if (deletableRows.length === 0) {
      return { success: 0, skipped };
    }

    const deletableIds = deletableRows.map((row) => row.id);
    const beforeRows = await this.loadInvoiceLogRows(deletableIds);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await lockSaleOrderFinancialGraph(
        tx,
        deletableRows.map((row) => row.saleOrderId)
      );
      const lockedRows = await tx.invoice.findMany({
        where: this.buildInvoiceBatchCasWhere(
          deletableRows,
          versions,
          chargerScope,
          currentEmployeeId
        ),
        select: { id: true, saleOrderId: true, customerId: true, flowStatus: true },
      });
      this.assertInvoiceBatchCasCount(lockedRows.length, deletableRows.length);
      await this.validateLockedInvoiceBatchOrders(tx, lockedRows, chargerScope, currentEmployeeId);
      // 必须先通过发票 CAS guard；冲突时不得触碰 payment 反向引用或订单聚合。
      const result = await tx.invoice.updateMany({
        where: this.buildInvoiceBatchCasWhere(
          deletableRows,
          versions,
          chargerScope,
          currentEmployeeId
        ),
        data: {
          deletedAt: now,
          ...auditUpdate(currentUser),
          version: { increment: 1 },
        },
      });
      this.assertInvoiceBatchCasCount(result.count, deletableRows.length);

      await clearActivePaymentInvoiceReferences(tx, deletableIds, currentUser);
      // 订单已开票金额聚合重算（每个不同 saleOrder 各算一次）
      const orderIds = Array.from(new Set(deletableRows.map((row) => row.saleOrderId)));
      for (const oid of orderIds) {
        await recalcSaleOrderInvoicedSummary(tx, oid);
      }
    });

    const afterRows = await this.loadInvoiceLogRows(deletableIds);
    await this.writeBatchChangeLogs('batch-delete', currentUser, beforeRows, afterRows);

    return { success: deletableRows.length, skipped };
  }

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
        module: 'invoices',
        action,
        target: id,
        targetName: (before.invoiceNumber as string | null) ?? (before.serialNumber as string),
        currentUser,
        before,
        after,
      });
    }
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

function requireRequestVersion(version: unknown, operation: string): number {
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new BadRequestException(`${operation}必须携带有效的 version`);
  }
  return version;
}

function requireVersion(version: number | undefined): number {
  if (version === undefined) {
    throw new BadRequestException('单据缺少版本号，无法发起变更审批');
  }
  return version;
}
