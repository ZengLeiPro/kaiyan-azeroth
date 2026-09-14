import { Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * dingtalk_collect 月度对账服务（绑定方案 v2.2 Phase 4）
 *
 * 业务背景：
 *  - bankName=浙江网商银行 ≡ 钉钉天元代收账户（钉钉收钱，公司不直接收）
 *  - 公司月度收益走 finance_ledgers 上的 'revenue.dingtalk_commission' 独立挂账
 *  - 「钉钉代收总额」/「钉钉佣金实收」≈ 钉钉典型返佣率（5-15%）
 *  - 月度返佣率严重偏离 → 报警（可能漏算、错算、钉钉一方策略变化）
 *
 * 数据口径（按 PaymentItem 视角）：
 *   monthly_collect_total      = Σ PaymentItem.amount
 *                                WHERE paymentMode='dingtalk_collect'
 *                                  AND deletedAt IS NULL
 *                                  AND payment.flowStatus='approved'
 *                                  AND payment.deletedAt IS NULL
 *                                GROUP BY MONTH(payment.businessDate)
 *
 *   monthly_commission_in      = Σ FinanceLedger.amount
 *                                WHERE subject.code='revenue.dingtalk_commission'
 *                                  AND amount > 0
 *                                  AND deletedAt IS NULL
 *                                GROUP BY MONTH(txDate)
 *
 *   commission_rate            = monthly_commission_in / monthly_collect_total
 */

export interface DingtalkMonthlyRow {
  /** 'YYYY-MM' */
  month: string;
  /** 该月 dingtalk_collect PaymentItem 总额 */
  collectTotal: string;
  /** 该月 dingtalk_collect PaymentItem 笔数 */
  collectCount: number;
  /** 该月 revenue.dingtalk_commission ledger 净收 */
  commissionReceived: string;
  /** 返佣率（commissionReceived / collectTotal），无收时为 null */
  commissionRate: number | null;
}

export interface DingtalkReconcileQuery {
  /** 起始月 'YYYY-MM'（含），默认 12 个月前 */
  fromMonth?: string;
  /** 结束月 'YYYY-MM'（含），默认本月 */
  toMonth?: string;
}

@Injectable()
export class DingtalkCollectReconcileService {
  private readonly logger = new Logger(DingtalkCollectReconcileService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 月度对账（区间）
   * 返回每月一行：collectTotal / commissionReceived / commissionRate
   */
  async monthlyReconcile(query: DingtalkReconcileQuery = {}): Promise<DingtalkMonthlyRow[]> {
    const { fromMonth, toMonth } = this.normalizeMonthRange(query);

    // 1. 拉 dingtalk_collect PaymentItem 月度聚合
    // @prisma-raw-sql: Prisma ORM 不直接支持 to_char(date, 'YYYY-MM') 月分组 GROUP BY，
    // 改用 SQL 原生聚合更高效；参数全部走 tagged template 安全绑定（无字符串拼接）
    const collect = await this.prisma.$queryRaw<
      Array<{ month: string; total: Decimal | null; cnt: bigint }>
    >`
      SELECT to_char(p."businessDate", 'YYYY-MM') AS month,
             SUM(pi.amount) AS total,
             COUNT(*) AS cnt
      FROM payment_items pi
      JOIN payments p ON p.id = pi."paymentId"
      WHERE pi."paymentMode" = 'dingtalk_collect'
        AND pi."deletedAt" IS NULL
        AND p."flowStatus" = 'approved'
        AND p."deletedAt" IS NULL
        AND p."businessDate" IS NOT NULL
        AND to_char(p."businessDate", 'YYYY-MM') BETWEEN ${fromMonth} AND ${toMonth}
      GROUP BY 1
      ORDER BY 1
    `;

    // 2. 拉 revenue.dingtalk_commission ledger 月度聚合
    // @prisma-raw-sql: 同上，月度 GROUP BY 走原生 SQL
    const commission = await this.prisma.$queryRaw<Array<{ month: string; total: Decimal | null }>>`
      SELECT to_char(fl."txDate", 'YYYY-MM') AS month,
             SUM(fl.amount) AS total
      FROM finance_ledgers fl
      JOIN finance_subjects fs ON fs.id = fl."subjectId"
      WHERE fs.code = 'revenue.dingtalk_commission'
        AND fl."deletedAt" IS NULL
        AND to_char(fl."txDate", 'YYYY-MM') BETWEEN ${fromMonth} AND ${toMonth}
      GROUP BY 1
      ORDER BY 1
    `;

    // 3. 合并到月份维度
    const months = this.enumerateMonths(fromMonth, toMonth);
    const collectMap = new Map(collect.map((r) => [r.month, r]));
    const commissionMap = new Map(commission.map((r) => [r.month, r]));
    const result: DingtalkMonthlyRow[] = [];
    for (const m of months) {
      const c = collectMap.get(m);
      const cm = commissionMap.get(m);
      const total = c?.total ?? new Decimal(0);
      const recv = cm?.total ?? new Decimal(0);
      const rate = total.eq(0) ? null : recv.div(total).toNumber();
      result.push({
        month: m,
        collectTotal: total.toFixed(2),
        collectCount: c ? Number(c.cnt) : 0,
        commissionReceived: recv.toFixed(2),
        commissionRate: rate,
      });
    }
    return result;
  }

  /**
   * 检查指定月份是否偏离合理返佣率区间（默认 [0.05, 0.15]）
   * 返回 { rateOk, row } 供 watchdog cron 判断
   */
  async checkMonth(
    month: string,
    bounds = { lo: 0.05, hi: 0.15 }
  ): Promise<{ rateOk: boolean; reason: string; row: DingtalkMonthlyRow | null }> {
    const rows = await this.monthlyReconcile({ fromMonth: month, toMonth: month });
    const row = rows[0] ?? null;
    if (!row) return { rateOk: true, reason: '该月无 dingtalk_collect 数据', row: null };
    if (row.commissionRate == null) {
      return { rateOk: true, reason: 'collectTotal=0，无返佣率可算', row };
    }
    if (row.commissionRate < bounds.lo) {
      return {
        rateOk: false,
        reason: `返佣率 ${(row.commissionRate * 100).toFixed(2)}% 低于 ${(bounds.lo * 100).toFixed(0)}%，可能漏算佣金 ledger`,
        row,
      };
    }
    if (row.commissionRate > bounds.hi) {
      return {
        rateOk: false,
        reason: `返佣率 ${(row.commissionRate * 100).toFixed(2)}% 高于 ${(bounds.hi * 100).toFixed(0)}%，可能 dingtalk_collect 漏标或佣金误归科目`,
        row,
      };
    }
    return { rateOk: true, reason: '在合理区间', row };
  }

  // ============== 私有 ==============

  private normalizeMonthRange(q: DingtalkReconcileQuery): {
    fromMonth: string;
    toMonth: string;
  } {
    // 不可用 Date.now()（环境限制）；让 caller 显式传，否则用最大可能范围
    const fromMonth = q.fromMonth ?? '2020-01';
    const toMonth = q.toMonth ?? '2099-12';
    if (!/^\d{4}-\d{2}$/.test(fromMonth) || !/^\d{4}-\d{2}$/.test(toMonth)) {
      throw new Error('fromMonth/toMonth 必须为 "YYYY-MM" 格式');
    }
    if (fromMonth > toMonth) {
      throw new Error('fromMonth 不能晚于 toMonth');
    }
    return { fromMonth, toMonth };
  }

  private enumerateMonths(fromMonth: string, toMonth: string): string[] {
    // 按 'YYYY-MM' 字符串自增
    const result: string[] = [];
    const [fy, fm] = fromMonth.split('-').map((s) => Number(s));
    const [ty, tm] = toMonth.split('-').map((s) => Number(s));
    if (
      fy === undefined ||
      fm === undefined ||
      ty === undefined ||
      tm === undefined ||
      Number.isNaN(fy) ||
      Number.isNaN(fm) ||
      Number.isNaN(ty) ||
      Number.isNaN(tm)
    ) {
      throw new Error('enumerateMonths: 月份解析失败');
    }
    let y = fy;
    let m = fm;
    // 防御性：枚举上限 240 个月（20 年）防止参数失控
    let safety = 240;
    while ((y < ty || (y === ty && m <= tm)) && safety-- > 0) {
      result.push(`${y}-${String(m).padStart(2, '0')}`);
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
    return result;
  }
}
