import type {
  TablePreferenceConfig,
  TablePreferenceResponse,
  UpsertTablePreferenceInput,
} from '@ky-azeroth/shared/schemas/table-preference';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { auditCreate, auditUpdate } from '../../common/utils/audit-helper';
import { fromJsonValue, toJsonValue } from '../../common/utils/json-type-helpers';

@Injectable()
export class TablePreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * @no-optimistic-lock: 全员配置由管理员手动操作，并发风险极低；
   * version 字段语义为"广播版本号"（客户端凭它判断是否需要强制覆盖本地），
   * 不用于服务端并发控制。upsert 时 version 由 service 自增。
   */
  async findByPageKey(pageKey: string): Promise<TablePreferenceResponse | null> {
    const record = await this.prisma.tablePreference.findFirst({
      where: { pageKey, deletedAt: null },
    });
    if (!record) return null;
    return this.toResponse(record);
  }

  async upsert(
    input: UpsertTablePreferenceInput,
    currentUser: { id: string; employeeId?: string | null }
  ): Promise<TablePreferenceResponse> {
    const { pageKey, config } = input;
    const existing = await this.prisma.tablePreference.findUnique({
      where: { pageKey },
      select: { id: true, deletedAt: true },
    });

    const configJson = toJsonValue<TablePreferenceConfig>(config) ?? Prisma.JsonNull;

    if (existing) {
      const updated = await this.prisma.tablePreference.update({
        where: { id: existing.id },
        data: {
          configJson,
          version: { increment: 1 },
          deletedAt: null,
          ...auditUpdate(currentUser),
        },
      });
      return this.toResponse(updated);
    }

    const created = await this.prisma.tablePreference.create({
      data: {
        pageKey,
        configJson,
        version: 1,
        ...auditCreate(currentUser),
      },
    });
    return this.toResponse(created);
  }

  private toResponse(record: {
    id: string;
    pageKey: string;
    configJson: Prisma.JsonValue;
    version: number;
    createdAt: Date;
    updatedAt: Date;
  }): TablePreferenceResponse {
    const config = fromJsonValue<TablePreferenceConfig>(record.configJson) ?? {};
    return {
      id: record.id,
      pageKey: record.pageKey,
      config,
      version: record.version,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
