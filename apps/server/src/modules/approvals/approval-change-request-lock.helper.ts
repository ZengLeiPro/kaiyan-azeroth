import type { Prisma } from '@prisma/client';

/**
 * 串行化同一业务目标的人工写入与变更审批提单。
 *
 * 所有会抬升 target.version 的人工写路径，以及 ApprovalChangeRequest 创建路径，
 * 必须在同一事务内先获取这把锁，再检查 pending 申请并执行 CAS。
 */
export async function lockApprovalChangeRequestTarget(
  tx: Prisma.TransactionClient,
  targetType: string,
  targetId: string
): Promise<void> {
  const lockKey = `approval_change_request:${targetType}:${targetId}`;
  // @prisma-raw-sql: PostgreSQL 事务级 advisory lock 用于按业务目标串行化写入与变更审批创建。
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
}
