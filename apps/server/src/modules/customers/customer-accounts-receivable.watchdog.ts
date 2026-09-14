import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

import { PrismaService } from '../../common/prisma/prisma.service';
import { toJsonValue } from '../../common/utils/json-type-helpers';

type CustomerAccountsReceivableMismatch = {
  customerId: string;
  cached: Prisma.Decimal | string | number | null;
  computed: Prisma.Decimal | string | number | null;
};

@Injectable()
export class CustomerAccountsReceivableWatchdog {
  private readonly logger = new Logger(CustomerAccountsReceivableWatchdog.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('20 3 * * *', { timeZone: 'Asia/Shanghai' })
  async handleDailyAudit(): Promise<void> {
    try {
      // @prisma-raw-sql: 跨 Customer/SaleOrder 聚合核对物化应收，Prisma 无法在一条查询中比较聚合值。
      const mismatches = await this.prisma.$queryRaw<CustomerAccountsReceivableMismatch[]>`
        SELECT
          c."id" AS "customerId",
          COALESCE(c."accountsReceivable", 0) AS "cached",
          COALESCE(SUM(so."totalUncollected") FILTER (WHERE so."deletedAt" IS NULL), 0) AS "computed"
        FROM "public"."customers" c
        LEFT JOIN "public"."sale_orders" so ON so."customerId" = c."id"
        WHERE c."deletedAt" IS NULL
        GROUP BY c."id", c."accountsReceivable"
        HAVING COALESCE(c."accountsReceivable", 0) <>
          COALESCE(SUM(so."totalUncollected") FILTER (WHERE so."deletedAt" IS NULL), 0)
        ORDER BY c."id"
      `;

      if (mismatches.length === 0) {
        this.logger.log('Customer.accountsReceivable 全表对账完成：无差异');
        return;
      }

      const samples = mismatches.slice(0, 50).map((row) => ({
        customerId: row.customerId,
        cached: new Decimal(row.cached ?? 0).toFixed(2),
        computed: new Decimal(row.computed ?? 0).toFixed(2),
        delta: new Decimal(row.computed ?? 0).sub(row.cached ?? 0).toFixed(2),
      }));
      this.logger.error(`Customer.accountsReceivable 对账发现 ${mismatches.length} 个客户失同步`);
      await this.prisma.operationLog.create({
        data: {
          module: 'finance',
          action: 'watchdog',
          target: 'customer-accounts-receivable-out-of-sync',
          details: toJsonValue({ outOfSyncCount: mismatches.length, samples }),
        },
      });
    } catch (error) {
      this.logger.error(
        `Customer.accountsReceivable 对账失败：${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
