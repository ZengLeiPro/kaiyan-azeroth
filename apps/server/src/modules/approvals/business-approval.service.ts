import {
  APPROVAL_ACTION,
  APPROVAL_INSTANCE_STATUS,
  APPROVAL_RESULT,
  APPROVAL_TASK_STATUS,
  type ApprovalEventTypeValue,
} from '@ky-azeroth/shared/constants';
import type { ApprovalInstanceResponseOutput } from '@ky-azeroth/shared/schemas/approval';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import {
  applyCustomerCollabViaCustomerScope,
  applyCustomerOwnedScope,
} from '../../common/services/data-scope.service';
import { auditCreate, auditUpdate } from '../../common/utils/audit-helper';
import { toJsonValue } from '../../common/utils/json-type-helpers';
import { serializeEntity } from '../../common/utils/response-helpers';
import { recomputeCustomerLifecycle } from '../customers/customer-lifecycle';
import { reconcileSaleOrderActivationLifecycle } from '../sale-orders/sale-order-activation-lifecycle.helper';
import {
  type ApprovalBusinessModelName,
  getApprovalBusinessConfig,
} from './approval-business-registry';
import { lockApprovalChangeRequestTarget } from './approval-change-request-lock.helper';
import type { ApprovalChangeTargetType } from './approval-change-requests.service';
import {
  lockAndValidateApprovalChangeTargetForApproval,
  lockAndValidateApprovalSubmissionTarget,
  lockAndValidatePendingApprovalTarget,
} from './approval-target-validator.helper';
import { ApprovalsService } from './approvals.service';

interface CurrentUser {
  id: string;
  employeeId?: string | null;
  roles?: string[];
}

interface BusinessRecord {
  id: string;
  version: number;
  flowStatus?: string | null;
  deletedAt?: Date | string | null;
  [key: string]: unknown;
}

interface PendingApprovalFormEditLock {
  id: string;
  initiatorId: string;
  version: number;
}

export interface SubmitChangeApprovalInput {
  eventType: string;
  targetType: ApprovalChangeTargetType;
  targetId: string;
  targetCode?: string | null;
  title: string;
  baseVersion: number;
  patch: Record<string, unknown>;
  beforeSnapshot: Record<string, unknown>;
  afterSnapshot: Record<string, unknown>;
  /** 目标模块在同一事务内执行最终引用、范围与软删除校验；失败则不得创建申请。 */
  validateInTransaction?: (tx: Prisma.TransactionClient) => Promise<void>;
}

interface BusinessDelegate {
  findFirst: (args: unknown) => Promise<BusinessRecord | null>;
  updateMany: (args: unknown) => Promise<{ count: number }>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

@Injectable()
export class BusinessApprovalService {
  private readonly logger = new Logger(BusinessApprovalService.name);

  constructor(
    private prisma: PrismaService,
    private approvalsService: ApprovalsService
  ) {}

  private async canLockAnyPendingForm(currentUser: CurrentUser): Promise<boolean> {
    const employeeId = currentUser.employeeId ?? currentUser.id;
    if (!employeeId) return false;
    const permission = await this.prisma.rolePermission.findFirst({
      where: {
        module: 'approval',
        menu: 'approval_list',
        approve: true,
        role: {
          deletedAt: null,
          status: 'active',
          users: { some: { employeeId } },
        },
      },
      select: { id: true },
    });
    return permission !== null;
  }

  async submitBusinessApproval(
    eventType: string,
    formId: string,
    currentUser: CurrentUser,
    chargerScope?: string[] | null
  ) {
    const config = getApprovalBusinessConfig(eventType);
    if (!config) {
      throw new BadRequestException(`不支持 ${eventType} 类型的业务审批`);
    }

    const { instance } = await this.prisma.$transaction(async (tx) => {
      const delegate = tx[config.modelName] as BusinessDelegate;
      const scopeWhere = this.buildBusinessScopeWhere(
        config.modelName,
        formId,
        chargerScope,
        // user.id 是认证主体 id，不得猜成 Employee FK；协作人范围只接受真实 employeeId。
        currentUser.employeeId
      );
      const record = await delegate.findFirst(
        this.buildBusinessFindFirstArgs(config.modelName, scopeWhere)
      );

      if (!record) {
        throw new NotFoundException(config.notFoundMessage);
      }

      this.assertCanSubmit(record.flowStatus);

      // 财务/SaleOrder 必须先锁完整图，随后才允许目标行 CAS；禁止先更新 child 再补订单锁。
      await lockAndValidateApprovalSubmissionTarget(tx, {
        eventType,
        formId,
        targetVersion: record.version,
        expectedFlowStatus: record.flowStatus ?? null,
        initiatorEmployeeId: currentUser.employeeId,
      });

      // 先把事务内快照按 id+version+flowStatus+deletedAt+scope 原子抢占为 pending。
      // 若删除/编辑/另一提交在读后抢先提交，PostgreSQL 会在行锁等待后重判条件并返回 0。
      const claimed = await delegate.updateMany({
        where: {
          ...scopeWhere,
          id: record.id,
          version: record.version,
          flowStatus: record.flowStatus ?? null,
        },
        data: {
          flowStatus: APPROVAL_INSTANCE_STATUS.PENDING,
          version: { increment: 1 },
          updaterEmployeeId: currentUser.employeeId ?? null,
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException('单据状态、版本、删除状态或访问范围已变化，请刷新后重试');
      }

      const targetVersion = record.version + 1;
      await lockAndValidatePendingApprovalTarget(tx, {
        eventType,
        formId,
        targetVersion,
        initiatorEmployeeId: currentUser.employeeId,
      });

      // CAS 成功后才创建实例；自审批可能在本调用内直接回写 approved 终态。
      const created = await this.approvalsService.createApprovalInstance(
        tx,
        {
          eventType: eventType as ApprovalEventTypeValue,
          formId,
          formCode: config.buildFormCode(record),
          title: config.buildTitle(record),
          targetVersion,
        },
        currentUser
      );

      const finalRecord = await delegate.findFirst(
        this.buildBusinessFindFirstArgs(config.modelName, scopeWhere)
      );
      if (!finalRecord) {
        throw new ConflictException('单据在审批提交事务内发生并发漂移，请刷新后重试');
      }

      // legacy NULL 在客户生命周期中代表迁移前已完成事实。首次纳入审批并落到 pending 时，
      // 必须在同一事务撤销 SaleOrder / Visit 已贡献的派生事实；若自审批已直接 approved，
      // fresh-read 会阻止这里重复撤销刚刚生效的事实。
      if (
        record.flowStatus === null &&
        finalRecord.flowStatus === APPROVAL_INSTANCE_STATUS.PENDING
      ) {
        await this.retractLegacyBusinessFacts(tx, config.modelName, record, currentUser);
      }

      // 审批实例、业务 pending CAS 与操作日志必须原子提交；日志失败时整笔回滚，
      // 禁止事务提交后再 best-effort 补写而留下无审计的业务状态。
      await this.writeSubmitChangeLog(
        tx,
        config.modelName,
        eventType,
        formId,
        currentUser,
        record,
        finalRecord
      );

      return { instance: created, before: record, after: finalRecord };
    });

    // 事务外触发通知（失败不影响主流程）
    const instanceId = (instance as { id?: string })?.id;
    if (instanceId) {
      this.approvalsService.notifyOnSubmit(instanceId).catch((err) => {
        this.logger.error(
          `业务审批提交通知发送失败 instanceId=${instanceId}: ${err instanceof Error ? err.message : String(err)}`
        );
      });
    }

    return serializeEntity<ApprovalInstanceResponseOutput>(
      instance as unknown as Record<string, unknown>
    );
  }

  /** 已通过单据必须走变更审批；审批中的单据在事务内另行校验是否为发起人。 */
  assertCanDirectEdit(
    flowStatus: string | null | undefined,
    label = '单据',
    _currentUser?: CurrentUser
  ): void {
    if (flowStatus === APPROVAL_INSTANCE_STATUS.APPROVED) {
      throw new BadRequestException(`${label}已审批通过，不允许直接修改，请发起变更审批`);
    }
  }

  /**
   * 发起人或 ADMIN 编辑审批中表单时，先锁审批实例以保持与审批操作一致的锁顺序。
   * 返回锁快照供业务表更新后同步 targetVersion、标题和表单编号。
   */
  async lockPendingFormEdit(
    tx: Prisma.TransactionClient,
    eventType: string,
    formId: string,
    flowStatus: string | null | undefined,
    currentUser: CurrentUser
  ): Promise<PendingApprovalFormEditLock | null> {
    const canLockAny = await this.canLockAnyPendingForm(currentUser);
    // @prisma-raw-sql: Prisma ORM 无法表达按发起人筛选的审批实例行锁，必须与审批操作串行。
    const locks = canLockAny
      ? // @prisma-raw-sql: 有代审权限时锁定任意待审实例，避免与审批操作并发修改。
        await tx.$queryRaw<PendingApprovalFormEditLock[]>`
          SELECT "id", "initiatorId", "version"
          FROM "public"."approval_instances"
          WHERE "eventType" = ${eventType}
            AND "formId" = ${formId}
            AND "status" = ${APPROVAL_INSTANCE_STATUS.PENDING}
            AND "deletedAt" IS NULL
          FOR UPDATE
        `
      : // @prisma-raw-sql: 发起人需锁定本人待审实例，避免与审批操作并发修改。
        await tx.$queryRaw<PendingApprovalFormEditLock[]>`
          SELECT "id", "initiatorId", "version"
          FROM "public"."approval_instances"
          WHERE "eventType" = ${eventType}
            AND "formId" = ${formId}
            AND "initiatorId" = ${currentUser.id}
            AND "status" = ${APPROVAL_INSTANCE_STATUS.PENDING}
            AND "deletedAt" IS NULL
          FOR UPDATE
        `;
    if (locks.length > 0) return locks[0]!;

    const pending = await tx.approvalInstance.findFirst({
      where: {
        eventType,
        formId,
        status: APPROVAL_INSTANCE_STATUS.PENDING,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (pending) {
      throw new ForbiddenException('只有审批发起人或管理员可在审核通过前修改表单');
    }
    if (flowStatus === APPROVAL_INSTANCE_STATUS.PENDING) {
      throw new ConflictException('审批状态已变更，请刷新后重试');
    }
    return null;
  }

  async syncPendingFormEdit(
    tx: Prisma.TransactionClient,
    lock: PendingApprovalFormEditLock | null,
    eventType: string,
    record: BusinessRecord,
    currentUser: CurrentUser
  ): Promise<void> {
    if (!lock) return;

    const config = getApprovalBusinessConfig(eventType);
    if (!config) {
      throw new BadRequestException(`不支持 ${eventType} 类型的业务审批`);
    }
    const serialized = record as Record<string, unknown>;
    const updated = await tx.approvalInstance.updateMany({
      where: {
        id: lock.id,
        eventType,
        formId: record.id,
        initiatorId: lock.initiatorId,
        status: APPROVAL_INSTANCE_STATUS.PENDING,
        deletedAt: null,
        version: lock.version,
      },
      data: {
        targetVersion: record.version,
        formCode: config.buildFormCode(serialized),
        title: config.buildTitle(serialized),
        version: { increment: 1 },
        ...auditUpdate(currentUser),
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException('审批状态已变更，请刷新后重试');
    }
  }

  /** 审批中或已通过的业务单据不能直接删除，避免留下悬空审批或绕过作废流程。 */
  assertCanDelete(flowStatus: string | null | undefined, label = '单据'): void {
    if (flowStatus === APPROVAL_INSTANCE_STATUS.PENDING) {
      throw new BadRequestException(`${label}审批中，不能删除，请先撤回审批`);
    }
    if (flowStatus === APPROVAL_INSTANCE_STATUS.APPROVED) {
      throw new BadRequestException(`${label}已审批通过，不能直接删除`);
    }
  }

  /**
   * 统一变更审批入口：与角色无关，含 ADMIN 在内的所有人都通过此方法发起变更审批。
   * 2026-06 改造前 ADMIN 调用会被直接拒绝（引导走 PUT 直改），现已统一规则——
   * 若发起人即首节点（或某节点）审批人，由 approvals.service 内
   * autoPassSelfTasksAndAdvance 自动通过并链式推进。
   */
  async submitChangeApproval(
    input: SubmitChangeApprovalInput,
    currentUser: CurrentUser
  ): Promise<ApprovalInstanceResponseOutput> {
    const instance = await this.prisma.$transaction(async (tx) => {
      // 必须是事务中的第一项数据库操作：同一 target 的提单先串行，再读取 pending。
      // contract partial UNIQUE 是跨版本/绕过应用锁写入的最终兜底。
      await lockApprovalChangeRequestTarget(tx, input.targetType, input.targetId);

      const existing = await tx.approvalChangeRequest.findFirst({
        where: {
          targetType: input.targetType,
          targetId: input.targetId,
          status: APPROVAL_INSTANCE_STATUS.PENDING,
          deletedAt: null,
        },
        select: { id: true, approvalInstanceId: true, patch: true },
      });
      let supersededChange: {
        id: string;
        approvalInstanceId: string | null;
        patch: unknown;
      } | null = null;
      if (existing) {
        if (input.eventType !== 'sale_order_change') {
          throw new ConflictException('该单据已有进行中的变更审批');
        }
        supersededChange = existing;
        await this.supersedeSaleOrderChangeApproval(tx, existing, currentUser);
      }

      await lockAndValidateApprovalChangeTargetForApproval(tx, {
        targetType: input.targetType,
        targetId: input.targetId,
        targetVersion: input.baseVersion,
        patch: input.patch,
        initiatorEmployeeId: currentUser.employeeId,
        eventType: input.eventType,
      });
      // 模块可追加比统一六类 validator 更窄的业务断言，但不能替代或绕过上面的强制校验。
      await input.validateInTransaction?.(tx);

      let change;
      try {
        change = await tx.approvalChangeRequest.create({
          data: {
            eventType: input.eventType,
            targetType: input.targetType,
            targetId: input.targetId,
            targetCode: input.targetCode ?? null,
            title: input.title,
            baseVersion: input.baseVersion,
            patch: toJsonValue(stripUndefined(input.patch)) ?? Prisma.JsonNull,
            beforeSnapshot: toJsonValue(input.beforeSnapshot) ?? Prisma.JsonNull,
            afterSnapshot: toJsonValue(input.afterSnapshot) ?? Prisma.JsonNull,
            status: APPROVAL_INSTANCE_STATUS.PENDING,
            ...auditCreate(currentUser),
          },
        });
      } catch (error) {
        if (hasPrismaErrorCode(error, 'P2002')) {
          throw new ConflictException('该单据已有进行中的变更审批，请刷新后重试');
        }
        throw error;
      }

      const created = await this.approvalsService.createApprovalInstance(
        tx,
        {
          eventType: input.eventType as ApprovalEventTypeValue,
          formId: change.id,
          formCode: input.targetCode || change.id,
          title: input.title,
          targetVersion: input.baseVersion,
        },
        currentUser
      );

      await tx.approvalChangeRequest.update({
        where: { id: change.id },
        data: { approvalInstanceId: created.id },
      });

      if (supersededChange) {
        await tx.approvalChangeRequest.update({
          where: { id: supersededChange.id },
          data: {
            patch:
              toJsonValue({
                ...asRecord(supersededChange.patch),
                __latestApprovalInstanceId: created.id,
              }) ?? Prisma.JsonNull,
            ...auditUpdate(currentUser),
          },
        });
      }

      return { created, supersededInstanceId: supersededChange?.approvalInstanceId ?? null };
    });

    if (instance.supersededInstanceId) {
      this.approvalsService.completeInstanceTodos(instance.supersededInstanceId);
    }
    this.approvalsService.notifyOnSubmit(instance.created.id).catch((err) => {
      this.logger.error(
        `变更审批提交通知发送失败 instanceId=${instance.created.id}: ${err instanceof Error ? err.message : String(err)}`
      );
    });

    return serializeEntity<ApprovalInstanceResponseOutput>({ ...instance.created });
  }

  private async supersedeSaleOrderChangeApproval(
    tx: Prisma.TransactionClient,
    change: { id: string; approvalInstanceId: string | null },
    currentUser: CurrentUser
  ): Promise<void> {
    const now = new Date();
    const withdrawn = await tx.approvalChangeRequest.updateMany({
      where: { id: change.id, status: APPROVAL_INSTANCE_STATUS.PENDING, deletedAt: null },
      data: {
        status: APPROVAL_INSTANCE_STATUS.WITHDRAWN,
        completedAt: now,
        version: { increment: 1 },
        ...auditUpdate(currentUser),
      },
    });
    if (withdrawn.count !== 1) {
      throw new ConflictException('原变更审批状态已变化，请刷新后重试');
    }
    if (!change.approvalInstanceId) return;

    const closed = await tx.approvalInstance.updateMany({
      where: {
        id: change.approvalInstanceId,
        status: APPROVAL_INSTANCE_STATUS.PENDING,
        deletedAt: null,
      },
      data: {
        status: APPROVAL_INSTANCE_STATUS.WITHDRAWN,
        completedAt: now,
        version: { increment: 1 },
        ...auditUpdate(currentUser),
      },
    });
    if (closed.count !== 1) {
      throw new ConflictException('原审批实例状态已变化，请刷新后重试');
    }

    await tx.approvalTask.updateMany({
      where: {
        instanceId: change.approvalInstanceId,
        status: APPROVAL_TASK_STATUS.PENDING,
        deletedAt: null,
      },
      data: {
        status: APPROVAL_TASK_STATUS.SKIPPED,
        actionTime: now,
        version: { increment: 1 },
        ...auditUpdate(currentUser),
      },
    });
    await tx.approvalRecord.create({
      data: {
        instanceId: change.approvalInstanceId,
        nodeOrder: 0,
        nodeName: null,
        operatorId: currentUser.id,
        operatorName: currentUser.employeeId ?? currentUser.id,
        action: APPROVAL_ACTION.WITHDRAW,
        result: APPROVAL_RESULT.WITHDRAWN,
        comment: '销售重新提交订单变更，原审批自动失效',
      },
    });
  }

  private async retractLegacyBusinessFacts(
    tx: Prisma.TransactionClient,
    modelName: ApprovalBusinessModelName,
    record: BusinessRecord,
    currentUser: CurrentUser
  ): Promise<void> {
    if (modelName === 'saleOrder') {
      const customerId = getStringField(record, 'customerId');
      if (!customerId) {
        throw new ConflictException('合同订单客户关系已损坏，无法安全提交审批');
      }
      const opportunityId = getStringField(record, 'opportunityId');
      await reconcileSaleOrderActivationLifecycle(
        tx,
        {
          opportunityIds: [opportunityId],
          customerIds: [customerId],
          retractedOpportunityIds: [opportunityId],
        },
        currentUser
      );
      return;
    }

    if (modelName === 'visitRecord') {
      const customerId = getStringField(record, 'customerId');
      if (!customerId) {
        throw new ConflictException('拜访记录客户关系已损坏，无法安全提交审批');
      }
      await recomputeCustomerLifecycle(tx, customerId, {
        syncLeadProgress: true,
        actor: currentUser,
      });
    }
  }

  private async writeSubmitChangeLog(
    tx: Prisma.TransactionClient,
    modelName: ApprovalBusinessModelName,
    eventType: string,
    formId: string,
    currentUser: CurrentUser,
    before: BusinessRecord,
    after: BusinessRecord
  ): Promise<void> {
    const meta = getCrmApprovalLogMeta(modelName, eventType);
    const targetName = meta.getTargetName(after) ?? meta.getTargetName(before);
    const targetCustomerId =
      getStringField(after, 'customerId') ?? getStringField(before, 'customerId');

    await tx.operationLog.create({
      data: {
        // user.id 是认证主体，不保证是 Employee FK；缺 employeeId 时显式记匿名审计主体。
        employeeId: currentUser.employeeId ?? null,
        module: meta.module,
        action: meta.action,
        target: formId,
        targetCustomerId,
        details: toJsonValue({
          kind: 'change',
          targetName,
          before: serializeEntity<Record<string, unknown>>(before),
          after: serializeEntity<Record<string, unknown>>(after),
        }),
      },
    });
  }

  /**
   * 创建即提交场景：业务 Service 在 create 事务内调用。
   * - 调用前业务记录必须已 create 完成（含 serialNumber 等字段）
   * - 业务表 flowStatus 由调用方在 create 时直接写 'pending'，本方法不再 update
   * - 返回 instanceId 供调用方在事务外触发通知
   */
  async createApprovalForNewRecord(
    tx: Prisma.TransactionClient,
    eventType: string,
    record: BusinessRecord,
    currentUser: CurrentUser
  ): Promise<string> {
    const config = getApprovalBusinessConfig(eventType);
    if (!config) {
      throw new BadRequestException(`不支持 ${eventType} 类型的业务审批`);
    }

    await lockAndValidatePendingApprovalTarget(tx, {
      eventType,
      formId: record.id,
      targetVersion: record.version,
      initiatorEmployeeId: currentUser.employeeId,
    });

    const instance = await this.approvalsService.createApprovalInstance(
      tx,
      {
        eventType: eventType as ApprovalEventTypeValue,
        formId: record.id,
        formCode: config.buildFormCode(record as unknown as Record<string, unknown>),
        title: config.buildTitle(record as unknown as Record<string, unknown>),
        targetVersion: record.version,
      },
      currentUser
    );
    return instance.id;
  }

  private assertCanSubmit(flowStatus?: string | null) {
    if (!flowStatus || flowStatus === 'draft' || flowStatus === 'rejected') {
      return;
    }

    if (flowStatus === 'pending') {
      throw new BadRequestException('该单据已有审批中');
    }

    if (flowStatus === 'approved') {
      throw new BadRequestException('该单据已通过审批，无需重复提交');
    }

    throw new BadRequestException(`当前审批状态 ${flowStatus} 不允许提交`);
  }

  private buildBusinessScopeWhere(
    modelName: ApprovalBusinessModelName,
    formId: string,
    chargerScope: string[] | null | undefined,
    currentEmployeeId: string | null | undefined
  ): Record<string, unknown> {
    const where: Record<string, unknown> = { id: formId, deletedAt: null };

    // 注入数据范围:与各 service findOne 一致(scope==null 即管理员,helper 直返不加过滤)
    switch (modelName) {
      case 'saleOrder':
      case 'payment':
      case 'visitRecord':
        applyCustomerCollabViaCustomerScope(where, chargerScope, currentEmployeeId);
        break;
      case 'invoice':
        // invoice 无自身 chargerId,仅靠 customer 关联鉴权
        applyCustomerOwnedScope(where, chargerScope, currentEmployeeId);
        break;
    }
    return where;
  }

  private buildBusinessFindFirstArgs(
    modelName: ApprovalBusinessModelName,
    where: Record<string, unknown>
  ): unknown {
    switch (modelName) {
      case 'invoice':
        return {
          where,
          include: {
            customer: { select: { id: true, customerName: true, shortName: true } },
            saleOrder: { select: { id: true, serialNumber: true } },
          },
        };
      case 'payment':
        return {
          where,
          include: {
            customer: { select: { id: true, customerName: true, shortName: true } },
            saleOrder: { select: { id: true, orderTitle: true, serialNumber: true } },
          },
        };
      case 'visitRecord':
        return {
          where,
          include: {
            customer: { select: { id: true, customerName: true, shortName: true } },
            contact: { select: { id: true, contactName: true } },
          },
        };
      case 'saleOrder':
        return {
          where,
          include: {
            customer: { select: { id: true, customerName: true, shortName: true } },
          },
        };
      default:
        return { where };
    }
  }
}

function stripUndefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function hasPrismaErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

function getCrmApprovalLogMeta(
  modelName: ApprovalBusinessModelName,
  eventType: string
): {
  module: string;
  action: string;
  getTargetName: (record: BusinessRecord) => string | null;
} {
  switch (modelName) {
    case 'invoice':
      return {
        module: 'invoices',
        action: 'submit-approval',
        getTargetName: (record) => getStringField(record, 'invoiceNumber', 'serialNumber'),
      };
    case 'payment':
      return {
        module: 'payments',
        action: eventType === 'payment_refund_approve' ? 'submit-refund' : 'submit-approval',
        getTargetName: (record) => getStringField(record, 'serialNumber'),
      };
    case 'visitRecord':
      return {
        module: 'visit-records',
        action: 'submit-approval',
        getTargetName: (record) => getStringField(record, 'signAddress') ?? getCustomerName(record),
      };
    case 'saleOrder':
      return {
        module: 'sale-orders',
        action: 'submit-approval',
        getTargetName: (record) => getStringField(record, 'orderTitle', 'serialNumber'),
      };
  }
}

function getStringField(record: BusinessRecord, ...fields: string[]): string | null {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function getCustomerName(record: BusinessRecord): string | null {
  const customer = record.customer;
  if (!customer || typeof customer !== 'object') return null;
  return getStringField(customer as BusinessRecord, 'customerName', 'shortName');
}
