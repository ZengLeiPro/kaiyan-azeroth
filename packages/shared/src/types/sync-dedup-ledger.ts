/**
 * 夜间同步幂等台账（销售数据闭环系统）类型契约
 *
 * 对应 Prisma model SyncDedupLedger（apps/server/prisma/schema.prisma）。
 * 纯机器台账：防夜间 cron 重试重复写 KeepRecord。前端/CLI 不暴露增删改，仅供 cron 内部与排查使用。
 */
export interface ISyncDedupLedger {
  id: string;
  runId: string;
  sourceEmployeeId: string;
  sourceType: string;
  sourceMessageId: string | null;
  /** sha1(customerId|chargerEmployeeId|factDate|normalize(factCoreText)) */
  dedupKey: string;
  /** seen / written / skipped */
  status: string;
  firstSeenAt?: string;
  lastSeenAt?: string;
  // 审计（机器表）
  createdAt?: string;
  createdBy?: string | null;
  updatedAt?: string;
  updatedBy?: string | null;
  deletedAt?: string | null;
  version?: number;
}
