import type { Prisma, PrismaClient } from '@prisma/client';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

/**
 * 把任意时刻转换为「北京时间（UTC+8）」下的 YYYY-MM-DD。
 *
 * 用 UTC 偏移而非 `toLocaleString('zh-CN')`，避免服务器系统时区配置漂移；
 * 同样不用 `toISOString().slice(0,10)` 直接出 UTC 日期——那样北京时间凌晨 0-8 点
 * 会比真实日期少一天。
 */
function toBeijingDateString(reference: Date | string | null | undefined): string {
  const d = reference ? new Date(reference) : new Date();
  if (Number.isNaN(d.getTime())) {
    return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
  return new Date(d.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * orderTitle 为空时按 `客户名 - YYYY-MM-DD - ¥金额` 兜底生成。
 *
 * 单一事实来源：sale-orders.service.ts 的 create/update 与 backfill 脚本均调用此函数，
 * 避免兜底规则在多处漂移。
 *
 * 规则：
 * - inputTitle 非空（trim 后）→ 直接返回 trim 后的值
 * - 否则查 customer.customerName；取不到则用 customerId 前 8 位兜底
 * - 日期段使用北京时间（UTC+8）的 YYYY-MM-DD；referenceDate 不传则用「现在」，
 *   update/backfill 等场景应传 createdAt，避免每次编辑都把标题里的日期推到"今天"
 * - 金额为空时填「待定」
 * - 最终结果 slice 到 200（与 schema.prisma 上 VarChar(200) 对齐）
 */
export async function resolveOrderTitle(
  prisma: PrismaLike,
  inputTitle: string | null | undefined,
  customerId: string,
  amount: number | string | null | undefined,
  referenceDate?: Date | string | null
): Promise<string> {
  const trimmed = typeof inputTitle === 'string' ? inputTitle.trim() : '';
  if (trimmed) return trimmed;

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { customerName: true },
  });
  const customerName = customer?.customerName?.trim() || customerId.slice(0, 8);

  const dateText = toBeijingDateString(referenceDate);

  const amountText = amount != null && amount !== '' ? `¥${Number(amount).toFixed(2)}` : '待定';

  const generated = `${customerName} - ${dateText} - ${amountText}`;
  return generated.slice(0, 200);
}
