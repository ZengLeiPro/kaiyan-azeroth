import { Prisma } from '@prisma/client';

export type PayrollPeriodKeyInput = string | { year: number; month: number };

/**
 * 将薪资期间统一为 YYYY-MM。手工 API 由 shared schema 拒绝非规范输入；
 * 导入链路可传解析出的 year/month 或兼容一位月份的 periodKey。
 */
export function normalizePayrollPeriodKey(input: PayrollPeriodKeyInput): string {
  let year: number;
  let month: number;

  if (typeof input === 'string') {
    const match = input.trim().match(/^(\d{4})-(\d{1,2})$/);
    if (!match) {
      throw new RangeError('薪资期间格式应为 YYYY-MM');
    }
    year = Number(match[1]);
    month = Number(match[2]);
  } else {
    year = input.year;
    month = input.month;
  }

  if (!Number.isInteger(year) || year < 0 || year > 9999) {
    throw new RangeError('薪资期间年份必须是四位整数');
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError('薪资期间月份必须介于 01 和 12 之间');
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/**
 * 同一期间的所有 PayrollRecord 写入共用 PostgreSQL 事务级 advisory lock。
 * 锁只在事务提交或回滚时释放；调用方处理多期间时必须先规范化、去重并排序。
 */
export async function lockPayrollPeriod(
  tx: Prisma.TransactionClient,
  periodKey: PayrollPeriodKeyInput
): Promise<void> {
  const normalizedPeriodKey = normalizePayrollPeriodKey(periodKey);
  // @prisma-raw-sql: PostgreSQL transaction advisory lock 串行化同一薪资期间的全部写入口。
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`payroll_period:${normalizedPeriodKey}`}, 0))`
  );
}
