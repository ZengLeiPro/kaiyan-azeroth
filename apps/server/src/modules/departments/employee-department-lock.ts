import type { Prisma } from '@prisma/client';

const EMPLOYEE_DEPARTMENT_LOCK_PREFIX = 'employee_primary_department:';

/**
 * 串行化同一员工的全部 employee_departments 读改写。
 *
 * 必须在事务内、且在任何 employeeDepartment 关系读写之前调用；事务提交或回滚时 PostgreSQL
 * 自动释放锁。保留既有 key 前缀，使所有新旧写入口竞争同一把锁。
 */
export async function lockEmployeeDepartmentWrites(
  tx: Prisma.TransactionClient,
  employeeId: string
): Promise<void> {
  const lockKey = EMPLOYEE_DEPARTMENT_LOCK_PREFIX + employeeId;
  // @prisma-raw-sql: Prisma 不提供 transaction advisory lock；用于串行化同一员工的部门关系写入。
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
}
