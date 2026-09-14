import { Injectable, Logger } from '@nestjs/common';

import { SERIAL_NUMBER_CONFIG, SerialNumberType } from '../constants/serial-number.constants';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 业务编号生成服务
 *
 * 使用 serial_number_counters 表原子递增生成唯一编号。
 * 档案类型支持冲突检测和自动修复。
 */
@Injectable()
export class SerialNumberService {
  private readonly logger = new Logger(SerialNumberService.name);

  // 档案类型 → Prisma 表名映射（用于冲突检测）
  private readonly tableMapping: Record<string, string> = {
    EMPLOYEE: 'employees',
    CUSTOMER: 'customers',
    OPPORTUNITY: 'opportunities',
    SALE_ORDER: 'sale_orders',
    PAYMENT: 'payments',
    // 退款编号 REF- 与回款编号 PAY- 都落在 payments 表，但前缀不同所以不会冲突
    PAYMENT_REFUND: 'payments',
    INVOICE: 'invoices',
  };

  constructor(private prisma: PrismaService) {}

  /**
   * 生成业务编号（支持自动修复）
   * @param type 编号类型
   * @param maxRetries 最大重试次数（默认3次）
   * @returns 生成的编号字符串
   */
  async generate(type: SerialNumberType, maxRetries = 3): Promise<string> {
    const config = SERIAL_NUMBER_CONFIG[type];
    if (!config) {
      throw new Error(`Unknown serial number type: ${type}`);
    }

    const { prefix, hasDate, seqLength } = config;
    const dateKey = hasDate ? this.formatDate(new Date()) : '';

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // @prisma-raw-sql: 使用 ON CONFLICT 原子操作确保并发环境下序列号递增的线程安全性
        const result = await this.prisma.$queryRaw<[{ counter: number }]>`
          INSERT INTO serial_number_counters (id, type, "dateKey", counter, "createdAt", "updatedAt")
          VALUES (gen_random_uuid()::text, ${type}, ${dateKey}, 1, NOW(), NOW())
          ON CONFLICT (type, "dateKey")
          DO UPDATE SET counter = serial_number_counters.counter + 1, "updatedAt" = NOW()
          RETURNING counter
        `;

        const seq = result[0].counter;
        const seqStr = seq.toString().padStart(seqLength, '0');
        const serialNumber = hasDate ? `${prefix}${dateKey}${seqStr}` : `${prefix}${seqStr}`;

        // 档案类检查冲突
        if (!hasDate && this.tableMapping[type]) {
          const exists = await this.checkSerialNumberExists(type, serialNumber);

          if (exists) {
            this.logger.warn(
              `[自愈机制] 检测到编号冲突: ${serialNumber} (counter=${seq})，尝试修复计数器...`
            );

            const fixed = await this.autoFixCounter(type, prefix);
            if (fixed) {
              this.logger.log(
                `[自愈机制] 计数器已修复，重试生成编号 (尝试 ${attempt}/${maxRetries})`
              );
              continue;
            } else {
              throw new Error(`计数器修复失败，无法生成编号 ${type}`);
            }
          }
        }

        if (attempt > 1) {
          this.logger.log(`[自愈机制] 编号生成成功: ${serialNumber} (经过 ${attempt} 次尝试)`);
        }

        return serialNumber;
      } catch (error) {
        if (attempt === maxRetries) {
          this.logger.error(`[自愈机制] 编号生成失败，已达到最大重试次数 ${maxRetries}`, error);
          throw error;
        }

        this.logger.warn(`[自愈机制] 第 ${attempt} 次尝试失败，准备重试...`);
        await this.sleep(100 * attempt);
      }
    }

    throw new Error(`编号生成失败: ${type}`);
  }

  /**
   * 检查编号是否已存在
   */
  private async checkSerialNumberExists(
    type: SerialNumberType,
    serialNumber: string
  ): Promise<boolean> {
    const tableName = this.tableMapping[type];
    if (!tableName) {
      return false;
    }

    try {
      // @prisma-raw-sql-unsafe: 使用动态表名查询编号是否存在，Prisma Client 不支持动态表名
      const result = await this.prisma.$queryRawUnsafe<[{ count: bigint }]>(
        `SELECT COUNT(*) as count FROM "${tableName}"
         WHERE "serialNumber" = $1 AND "deletedAt" IS NULL`,
        serialNumber
      );

      return Number(result[0].count) > 0;
    } catch (error) {
      this.logger.error(`检查编号是否存在时出错: ${serialNumber}`, error);
      return false;
    }
  }

  /**
   * 自动修复计数器
   */
  private async autoFixCounter(type: SerialNumberType, prefix: string): Promise<boolean> {
    const tableName = this.tableMapping[type];
    if (!tableName) {
      return false;
    }

    try {
      const prefixLength = prefix.length;
      // @prisma-raw-sql-unsafe: 使用动态表名和 SUBSTRING/CAST 进行数值排序查找最大序列号，Prisma Client 不支持动态表名
      const result = await this.prisma.$queryRawUnsafe<Array<{ serialNumber: string }>>(
        `SELECT "serialNumber"
         FROM "${tableName}"
         WHERE "serialNumber" LIKE $1
           AND "deletedAt" IS NULL
         ORDER BY CAST(SUBSTRING("serialNumber" FROM ${prefixLength + 1}) AS INTEGER) DESC
         LIMIT 1`,
        `${prefix}%`
      );

      if (!result || result.length === 0) {
        await this.resetCounter(type, 0);
        return true;
      }

      const firstResult = result[0];
      if (!firstResult) {
        await this.resetCounter(type, 0);
        return true;
      }

      const maxSerialNumber = firstResult.serialNumber;
      const sequenceStr = maxSerialNumber.replace(prefix, '');
      const maxSequence = parseInt(sequenceStr, 10);

      if (isNaN(maxSequence)) {
        this.logger.error(`无法解析编号: ${maxSerialNumber}`);
        return false;
      }

      this.logger.log(
        `[自愈机制] 修复计数器: ${type} → ${maxSequence} (最大编号: ${maxSerialNumber})`
      );

      // @prisma-raw-sql-unsafe: 使用 ON CONFLICT 原子操作强制更新计数器，需动态表参数化
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO serial_number_counters (id, type, "dateKey", counter, "createdAt", "updatedAt")
         VALUES (gen_random_uuid()::text, $1, '', $2, NOW(), NOW())
         ON CONFLICT (type, "dateKey")
         DO UPDATE SET counter = EXCLUDED.counter, "updatedAt" = NOW()`,
        type,
        maxSequence
      );

      return true;
    } catch (error) {
      this.logger.error(`自动修复计数器失败: ${type}`, error);
      return false;
    }
  }

  /**
   * 重置计数器
   */
  private async resetCounter(type: SerialNumberType, value: number): Promise<void> {
    // @prisma-raw-sql-unsafe: 使用 ON CONFLICT 原子操作重置计数器，需动态参数化
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO serial_number_counters (id, type, "dateKey", counter, "createdAt", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, '', $2, NOW(), NOW())
       ON CONFLICT (type, "dateKey")
       DO UPDATE SET counter = EXCLUDED.counter, "updatedAt" = NOW()`,
      type,
      value
    );
  }

  /**
   * 批量生成业务编号
   */
  async generateBatch(type: SerialNumberType, count: number): Promise<string[]> {
    if (count <= 0) {
      return [];
    }

    const config = SERIAL_NUMBER_CONFIG[type];
    if (!config) {
      throw new Error(`Unknown serial number type: ${type}`);
    }

    const { prefix, hasDate, seqLength } = config;
    const dateKey = hasDate ? this.formatDate(new Date()) : '';

    // @prisma-raw-sql: 使用 ON CONFLICT 原子操作批量递增计数器，确保并发安全
    const result = await this.prisma.$queryRaw<[{ counter: number }]>`
      INSERT INTO serial_number_counters (id, type, "dateKey", counter, "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, ${type}, ${dateKey}, ${count}, NOW(), NOW())
      ON CONFLICT (type, "dateKey")
      DO UPDATE SET counter = serial_number_counters.counter + ${count}, "updatedAt" = NOW()
      RETURNING counter
    `;

    const endSeq = result[0].counter;
    const startSeq = endSeq - count + 1;

    const results: string[] = [];
    for (let i = 0; i < count; i++) {
      const seqStr = (startSeq + i).toString().padStart(seqLength, '0');
      if (hasDate) {
        results.push(`${prefix}${dateKey}${seqStr}`);
      } else {
        results.push(`${prefix}${seqStr}`);
      }
    }
    return results;
  }

  /**
   * 格式化日期为 YYMMDD
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}${month}${day}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
