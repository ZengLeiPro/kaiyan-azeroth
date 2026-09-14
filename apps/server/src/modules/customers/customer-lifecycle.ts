import {
  APPROVAL_INSTANCE_STATUS,
  CONTACT_STATUS,
  DEAL_STATUS,
  KEEP_RECORD_SOURCE,
  KEEP_RECORD_TYPE_TO_CONTACT_STATUS,
  LEAD_PROGRESS_STATUS,
  OPPORTUNITY_STAGE,
} from '@ky-azeroth/shared/constants';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

type LifecycleActor = { id: string; employeeId?: string | null };

export interface RecomputeCustomerLifecycleOptions {
  /**
   * 联系状态/最近跟进始终重算；仅事实事件调用方需要同时同步 Leads 推进状态。
   */
  syncLeadProgress: boolean;
  actor?: LifecycleActor;
  /**
   * 仅供“已在同一事务内完成一次主写并递增 version”的复合操作使用。
   * 生命周期仍会自行取得客户行锁并以 expectedVersion 做 CAS，但不会再次递增 version。
   * 当前唯一调用方是 Customer restore，保证一次人工恢复最终严格 version + 1。
   */
  versioning?: { mode: 'preserve'; expectedVersion: number };
}

/**
 * 客户派生状态唯一生命周期原语。
 *
 * 调用方必须传入当前主写事务的 TransactionClient。本函数先按 customer id 排序锁行，
 * 再在同一事务快照内读取 version、全部既有派生字段及可信完成事实。只有派生值真实变化
 * 才以 id+version+deletedAt 做一次 CAS；默认整组派生字段只递增一次 version。
 * flowStatus 兼容口径：approved 与 legacy NULL 是事实；pending/rejected/withdrawn/draft 均不是。
 */
export async function recomputeCustomerLifecycle(
  tx: Prisma.TransactionClient,
  customerIds: string | readonly string[],
  options: RecomputeCustomerLifecycleOptions
): Promise<void> {
  const ids = [...new Set(typeof customerIds === 'string' ? [customerIds] : customerIds)].sort();
  if (ids.length === 0) return;
  if (options.versioning && ids.length !== 1) {
    throw new Error('preserve-version 生命周期模式只允许单客户复合操作');
  }

  // PostgreSQL Read Committed 下，等待中的事务拿到行锁后，其后每条查询会看到前一事务
  // 已提交的事实；排序锁多客户，避免客户迁移 A→B / B→A 时反向加锁造成死锁。
  for (const customerId of ids) {
    // @prisma-raw-sql: Prisma ORM 无法表达 SELECT ... FOR UPDATE；生命周期事实重算必须先锁定客户行以串行化并发写入。
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "public"."customers"
      WHERE "id" = ${customerId}
      FOR UPDATE
    `;
  }

  for (const customerId of ids) {
    await recomputeLockedCustomer(tx, customerId, options);
  }
}

async function recomputeLockedCustomer(
  tx: Prisma.TransactionClient,
  customerId: string,
  options: RecomputeCustomerLifecycleOptions
): Promise<void> {
  // 必须在 FOR UPDATE 之后读取；禁止复用锁前快照。
  const customer = await tx.customer.findFirst({
    where: { id: customerId, deletedAt: null },
    select: {
      id: true,
      version: true,
      contactStatus: true,
      dealStatus: true,
      lastKeepRecordTime: true,
      lastKeepRecordContent: true,
      leadStage: true,
      leadStageUpdatedAt: true,
      leadStageUpdatedById: true,
      leadStageQualifiedAt: true,
      leadStageQualifiedById: true,
      firstSqlAt: true,
      leadProgressStatus: true,
      leadProgressUpdatedAt: true,
      leadAppointmentAt: true,
      leadProgressReason: true,
      leadProgressUpdatedById: true,
      intentTemperature: true,
      intentReasons: true,
      nextFollowUpAt: true,
      intentUpdatedAt: true,
      intentUpdatedById: true,
      intentSourceKeepRecordId: true,
      updaterEmployeeId: true,
    },
  });
  if (!customer) return;

  if (
    options.versioning?.mode === 'preserve' &&
    customer.version !== options.versioning.expectedVersion
  ) {
    throw new ConflictException('客户已被其他用户修改，请刷新后重试');
  }

  // 2026-03-04 才为 Keep / Visit / Opportunity 引入 nullable flowStatus，且 migration
  // 没有 backfill：NULL 仅代表字段引入前或可信历史同步留下的既有完成事实。
  // 只兼容 approved/NULL，绝不能把 pending/rejected/withdrawn/draft 放宽成事实。
  const completedFlowStatusWhere = {
    OR: [{ flowStatus: APPROVAL_INSTANCE_STATUS.APPROVED }, { flowStatus: null }],
  } satisfies Prisma.KeepRecordWhereInput;

  // source=field_change 是系统审计留底，不是一次真实客户接触；source=NULL 是历史人工来源。
  const completedKeepWhere: Prisma.KeepRecordWhereInput = {
    customerId,
    deletedAt: null,
    AND: [
      completedFlowStatusWhere,
      { OR: [{ source: null }, { source: { not: KEEP_RECORD_SOURCE.FIELD_CHANGE } }] },
    ],
  };

  const [latestKeepRecord, latestVisitRecord, wonCount, latestKeep, latestIntentKeep] =
    await Promise.all([
      tx.keepRecord.findFirst({
        where: completedKeepWhere,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { keepRecordType: true, createdAt: true },
      }),
      tx.visitRecord.findFirst({
        where: {
          customerId,
          deletedAt: null,
          OR: completedFlowStatusWhere.OR,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { visitType: true, createdAt: true, signInTime: true },
      }),
      tx.opportunity.count({
        where: {
          customerId,
          deletedAt: null,
          opportunityStage: OPPORTUNITY_STAGE.WON,
          OR: completedFlowStatusWhere.OR,
        },
      }),
      tx.keepRecord.findFirst({
        where: {
          ...completedKeepWhere,
          keepRecordTime: { not: null },
        },
        orderBy: [{ keepRecordTime: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        select: { keepRecordTime: true, keepRecordContent: true },
      }),
      tx.keepRecord.findFirst({
        where: { ...completedKeepWhere, intentTemperature: { not: null } },
        orderBy: [{ keepRecordTime: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          intentTemperature: true,
          intentReasons: true,
          nextFollowUpAt: true,
          creatorEmployeeId: true,
          updaterEmployeeId: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

  const nextContactStatus = computeContactStatus(latestKeepRecord, latestVisitRecord);
  const nextDealStatus =
    wonCount > 1 ? DEAL_STATUS.MULTI_WON : wonCount === 1 ? DEAL_STATUS.WON : DEAL_STATUS.NOT_WON;
  const nextLastKeepRecordTime = latestKeep?.keepRecordTime ?? null;
  const nextLastKeepRecordContent = latestKeep?.keepRecordContent ?? null;
  const data: Prisma.CustomerUncheckedUpdateManyInput = {};
  let changed = false;

  if (customer.contactStatus !== nextContactStatus) {
    data.contactStatus = nextContactStatus;
    changed = true;
  }
  if (customer.dealStatus !== nextDealStatus) {
    data.dealStatus = nextDealStatus;
    changed = true;
  }
  if (!sameDate(customer.lastKeepRecordTime, nextLastKeepRecordTime)) {
    data.lastKeepRecordTime = nextLastKeepRecordTime;
    changed = true;
  }
  if (customer.lastKeepRecordContent !== nextLastKeepRecordContent) {
    data.lastKeepRecordContent = nextLastKeepRecordContent;
    changed = true;
  }

  const nextIntentTemperature = latestIntentKeep?.intentTemperature ?? 'UNJUDGED';
  const nextIntentReasons = latestIntentKeep?.intentReasons ?? null;
  const nextFollowUpAt = latestIntentKeep?.nextFollowUpAt ?? null;
  // 客户档案的“更新人/更新时间”是意向值的实际标注审计，不是业务跟进负责人或跟进发生时间。
  // 创建时 auditCreate 同时写 creator/updater；编辑时 auditUpdate 覆盖 updater，因此优先取 updater。
  const nextIntentUpdatedAt = latestIntentKeep?.updatedAt ?? latestIntentKeep?.createdAt ?? null;
  const nextIntentUpdatedById =
    latestIntentKeep?.updaterEmployeeId ?? latestIntentKeep?.creatorEmployeeId ?? null;
  const nextIntentSourceKeepRecordId = latestIntentKeep?.id ?? null;
  if (
    customer.intentTemperature !== nextIntentTemperature ||
    JSON.stringify(customer.intentReasons) !== JSON.stringify(nextIntentReasons) ||
    !sameDate(customer.nextFollowUpAt, nextFollowUpAt) ||
    !sameDate(customer.intentUpdatedAt, nextIntentUpdatedAt) ||
    customer.intentUpdatedById !== nextIntentUpdatedById ||
    customer.intentSourceKeepRecordId !== nextIntentSourceKeepRecordId
  ) {
    data.intentTemperature = nextIntentTemperature;
    data.intentReasons =
      nextIntentReasons === null ? Prisma.JsonNull : (nextIntentReasons as Prisma.InputJsonValue);
    data.nextFollowUpAt = nextFollowUpAt;
    data.intentUpdatedAt = nextIntentUpdatedAt;
    data.intentUpdatedById = nextIntentUpdatedById;
    data.intentSourceKeepRecordId = nextIntentSourceKeepRecordId;
    changed = true;
  }

  let stageChanged = false;
  let stageChangedAt: Date | undefined;
  let lifecycleEmployeeId: string | null = null;

  if (options.syncLeadProgress && (customer.leadStage || customer.leadProgressStatus)) {
    if (!options.actor) {
      throw new Error('同步 Leads 事实状态时必须提供 actor');
    }

    const [latestWon, latestOnlineDemo] = await Promise.all([
      tx.opportunity.findFirst({
        where: {
          customerId,
          deletedAt: null,
          opportunityStage: OPPORTUNITY_STAGE.WON,
          OR: completedFlowStatusWhere.OR,
        },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true },
      }),
      tx.keepRecord.findFirst({
        where: {
          ...completedKeepWhere,
          keepRecordType: 'online_demo',
        },
        orderBy: [{ keepRecordTime: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        select: { createdAt: true, keepRecordTime: true },
      }),
    ]);

    const nextLeadProgress = deriveLeadProgress({
      customer,
      latestWon,
      latestVisit: latestVisitRecord,
      latestOnlineDemo,
    });

    if (nextLeadProgress && nextLeadProgress !== customer.leadProgressStatus) {
      const now = new Date();
      // 只信任认证上下文显式给出的 Employee id；actor.id 可能是 User id，绝不能猜 FK。
      lifecycleEmployeeId = options.actor.employeeId ?? null;
      stageChanged = nextLeadProgress === LEAD_PROGRESS_STATUS.WON && customer.leadStage !== 'SQL';
      stageChangedAt = now;

      data.leadProgressStatus = nextLeadProgress;
      data.leadProgressUpdatedAt = now;
      data.leadProgressReason = null;
      data.leadProgressUpdatedById = lifecycleEmployeeId;
      changed = true;

      if (stageChanged) {
        data.leadStage = 'SQL';
        data.leadStageUpdatedAt = now;
        data.leadStageQualifiedAt = now;
        data.leadStageUpdatedById = lifecycleEmployeeId;
        data.leadStageQualifiedById = lifecycleEmployeeId;
        if (customer.firstSqlAt == null) data.firstSqlAt = now;
      }
    }
  }

  if (!changed) return;

  // updater 审计同样只使用显式 employeeId；缺失时安全写 NULL，不回退猜测 actor.id。
  if (options.actor) data.updaterEmployeeId = options.actor.employeeId ?? null;
  if (!options.versioning) data.version = { increment: 1 };

  const result = await tx.customer.updateMany({
    where: { id: customerId, version: customer.version, deletedAt: null },
    data,
  });
  if (result.count !== 1) {
    throw new ConflictException('客户已被其他用户修改，请刷新后重试');
  }

  // 与阶段变更同事务留底；该记录明确排除在接触事实之外，避免自我触发派生状态。
  if (stageChanged && stageChangedAt && lifecycleEmployeeId && options.actor) {
    await tx.keepRecord.create({
      data: {
        customerId,
        keepRecordType: 'other',
        keepRecordTime: stageChangedAt,
        keepRecordContent: `[系统] 线索阶段变更：${customer.leadStage ?? '无'} → SQL（业务事件自动流转）`,
        keepRecordStatus: '客户维护',
        chargerId: lifecycleEmployeeId,
        flowStatus: APPROVAL_INSTANCE_STATUS.APPROVED,
        source: KEEP_RECORD_SOURCE.FIELD_CHANGE,
        creatorEmployeeId: lifecycleEmployeeId,
        updaterEmployeeId: lifecycleEmployeeId,
      },
    });
  }
}

function sameDate(left: Date | null, right: Date | null): boolean {
  return left === right || left?.getTime() === right?.getTime();
}

function computeContactStatus(
  latestKeepRecord: { keepRecordType: string | null; createdAt: Date } | null,
  latestVisitRecord: { createdAt: Date } | null
): string {
  if (!latestKeepRecord && !latestVisitRecord) return CONTACT_STATUS.UNTOUCHED;

  if (
    latestVisitRecord &&
    (!latestKeepRecord || latestVisitRecord.createdAt > latestKeepRecord.createdAt)
  ) {
    return CONTACT_STATUS.VISITED;
  }

  if (latestKeepRecord?.keepRecordType) {
    const mapped = KEEP_RECORD_TYPE_TO_CONTACT_STATUS[latestKeepRecord.keepRecordType];
    if (mapped) return mapped;
  }
  return CONTACT_STATUS.UNTOUCHED;
}

function deriveLeadProgress(args: {
  customer: {
    leadProgressStatus: string | null;
    leadProgressUpdatedAt: Date | null;
    leadAppointmentAt: Date | null;
  };
  latestWon: { updatedAt: Date } | null;
  latestVisit: { createdAt: Date; signInTime: Date | null } | null;
  latestOnlineDemo: { createdAt: Date; keepRecordTime: Date | null } | null;
}): string | null {
  const { customer, latestWon, latestVisit, latestOnlineDemo } = args;
  const progressAt = customer.leadProgressUpdatedAt?.getTime() ?? 0;
  const wonAt = latestWon?.updatedAt.getTime() ?? 0;
  const visitAt = latestVisit
    ? Math.max(latestVisit.createdAt.getTime(), latestVisit.signInTime?.getTime() ?? 0)
    : 0;
  const onlineDemoAt = latestOnlineDemo
    ? Math.max(
        latestOnlineDemo.createdAt.getTime(),
        latestOnlineDemo.keepRecordTime?.getTime() ?? 0
      )
    : 0;
  const completedAt = Math.max(visitAt, onlineDemoAt);
  const hasCompletedFact = Boolean(latestVisit || latestOnlineDemo);

  if (
    latestWon &&
    (customer.leadProgressStatus === LEAD_PROGRESS_STATUS.WON || wonAt > progressAt)
  ) {
    return LEAD_PROGRESS_STATUS.WON;
  }
  if (customer.leadProgressStatus === LEAD_PROGRESS_STATUS.WON && !latestWon) {
    return hasCompletedFact
      ? LEAD_PROGRESS_STATUS.VISITED
      : customer.leadAppointmentAt
        ? LEAD_PROGRESS_STATUS.PENDING_VISIT
        : LEAD_PROGRESS_STATUS.ACTIVE;
  }
  if (
    hasCompletedFact &&
    (customer.leadProgressStatus === LEAD_PROGRESS_STATUS.VISITED ||
      completedAt > progressAt ||
      (customer.leadProgressStatus === LEAD_PROGRESS_STATUS.PENDING_VISIT &&
        (!customer.leadAppointmentAt || completedAt >= customer.leadAppointmentAt.getTime())))
  ) {
    return LEAD_PROGRESS_STATUS.VISITED;
  }
  if (customer.leadProgressStatus === LEAD_PROGRESS_STATUS.VISITED && !hasCompletedFact) {
    return customer.leadAppointmentAt
      ? LEAD_PROGRESS_STATUS.PENDING_VISIT
      : LEAD_PROGRESS_STATUS.ACTIVE;
  }
  return null;
}
