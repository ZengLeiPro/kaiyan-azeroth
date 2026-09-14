import type { WebEventResponseOutput } from '@ky-azeroth/shared/schemas';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import { calculatePagination } from '../../common/utils/response-helpers';
import type { ArchiveWebEventsDto, QueryWebEventDto } from './dto';

/**
 * 官网埋点事件只读服务 + admin 归档。
 *
 * 数据由独立 collector（独立 analytics collector）直连 PG 写入；
 * 本 service 仅做查询 + 维护归档（取代了原 wa_reader/wa_admin PG 角色直连）。
 *
 * 设计要点：
 * - 时区：dateFrom/dateTo 接受 ISO 字符串或 yyyy-MM-dd（按北京时间解析）。
 * - BigInt id：Prisma 返回 BigInt 类型，service 层手动转 string 后再返回，
 *   避免 JSON.stringify 抛 `Do not know how to serialize a BigInt`。
 * - 复合主键 (id, receivedAt)：getEvent(id) 用 findFirst（id 是 BIGINT IDENTITY
 *   全局唯一，单 id 即可唯一定位），不能直接 findUnique。
 * - bot 默认过滤：query.isBot 未显式传时默认 false（看 bot 流量必须显式传 true）。
 * - archive 走双闸门：dryRun=false + yes=true 才真删，否则只返影响行数。
 */
@Injectable()
export class WebEventsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- list (分页) ----------

  async findEvents(query: QueryWebEventDto): Promise<PaginatedResponse<WebEventResponseOutput>> {
    const { page = 1, pageSize = 100 } = query;
    const { skip, take } = calculatePagination(page, pageSize);
    const where = this.buildWhere(query);

    const [total, rows] = await Promise.all([
      this.prisma.webEvent.count({ where }),
      this.prisma.webEvent.findMany({
        where,
        skip,
        take,
        orderBy: { receivedAt: query.sortOrder ?? 'desc' },
      }),
    ]);

    return {
      items: rows.map((row) => this.toResponse(row)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  // ---------- get by id ----------

  async getEvent(id: string): Promise<WebEventResponseOutput> {
    const idBig = this.parseId(id);
    // 复合主键 (id, receivedAt)，但 id 是 BIGINT IDENTITY 全局唯一，findFirst 即可
    const row = await this.prisma.webEvent.findFirst({ where: { id: idBig } });
    if (!row) {
      throw new NotFoundException(`web event ${id} not found`);
    }
    return this.toResponse(row);
  }

  // ---------- archive (admin) ----------

  async archiveEvents(input: ArchiveWebEventsDto): Promise<{
    matched: number;
    deleted: number;
    dryRun: boolean;
  }> {
    const before = this.parseBeijing(input.before);
    if (!before) {
      throw new Error('archive.before 无法解析为合法日期');
    }

    const where: Prisma.WebEventWhereInput = { receivedAt: { lt: before } };
    if (input.path) where.path = input.path;

    const matched = await this.prisma.webEvent.count({ where });

    // 双闸门：dryRun=false + yes=true 才真删（schema 层已 refine，service 这里再防御性兜底）
    if (input.dryRun || !input.yes) {
      return { matched, deleted: 0, dryRun: true };
    }

    const { count } = await this.prisma.webEvent.deleteMany({ where });
    return { matched, deleted: count, dryRun: false };
  }

  // ---------- helpers ----------

  private buildWhere(query: QueryWebEventDto): Prisma.WebEventWhereInput {
    const where: Prisma.WebEventWhereInput = {};

    // bot 默认 false；显式传则按传的
    where.isBot = query.isBot ?? false;

    if (query.site) where.site = query.site;

    // event：单值 or 多值
    if (query.event?.length === 1) {
      where.event = query.event[0]!;
    } else if (query.event?.length) {
      where.event = { in: query.event };
    }

    // path：精确 / 前缀
    if (query.path) where.path = query.path;
    if (query.pathPrefix) where.path = { startsWith: query.pathPrefix };

    if (query.vid) where.vid = query.vid;
    if (query.sid) where.sid = query.sid;

    if (query.utmSource?.length) where.utmSource = { in: query.utmSource };
    if (query.utmMedium?.length) where.utmMedium = { in: query.utmMedium };
    if (query.utmCampaign?.length) where.utmCampaign = { in: query.utmCampaign };
    if (query.refHost?.length) where.refHost = { in: query.refHost };
    if (query.placement?.length) where.placement = { in: query.placement };
    if (query.channel?.length) where.channel = { in: query.channel };

    // 时间范围（按北京时间解析）
    const from = this.parseBeijing(query.dateFrom);
    const to = this.parseBeijing(query.dateTo);
    if (from || to) {
      where.receivedAt = {};
      if (from) where.receivedAt.gte = from;
      if (to) where.receivedAt.lt = to;
    }

    // keyword：跨 title/path 模糊搜
    if (query.keyword) {
      where.OR = [{ title: { contains: query.keyword } }, { path: { contains: query.keyword } }];
    }

    return where;
  }

  /** yyyy-MM-dd → +08:00 0:00；ISO 字符串原样 new Date() */
  private parseBeijing(s?: string): Date | undefined {
    if (!s) return undefined;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return new Date(`${s}T00:00:00+08:00`);
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? undefined : d;
  }

  private parseId(id: string): bigint {
    if (!/^\d+$/.test(id)) {
      throw new NotFoundException(`web event id ${id} is not numeric`);
    }
    return BigInt(id);
  }

  /** Prisma row → API response：BigInt id 转 string，Date 转 ISO string，raw 透传 */
  private toResponse(row: {
    id: bigint;
    receivedAt: Date;
    clientTs: Date | null;
    site: string;
    event: string;
    vid: string | null;
    sid: string | null;
    path: string | null;
    pageType: string | null;
    title: string | null;
    referrer: string | null;
    refHost: string | null;
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    utmTerm: string | null;
    utmContent: string | null;
    placement: string | null;
    channel: string | null;
    label: string | null;
    ua: string | null;
    isBot: boolean;
    ipHash: string | null;
    country: string | null;
    region: string | null;
    city: string | null;
    isp: string | null;
    screen: string | null;
    lang: string | null;
    raw: Prisma.JsonValue | null;
  }): WebEventResponseOutput {
    return {
      id: row.id.toString(),
      receivedAt: row.receivedAt.toISOString(),
      clientTs: row.clientTs?.toISOString() ?? null,
      site: row.site,
      event: row.event,
      vid: row.vid,
      sid: row.sid,
      path: row.path,
      pageType: row.pageType,
      title: row.title,
      referrer: row.referrer,
      refHost: row.refHost,
      utmSource: row.utmSource,
      utmMedium: row.utmMedium,
      utmCampaign: row.utmCampaign,
      utmTerm: row.utmTerm,
      utmContent: row.utmContent,
      placement: row.placement,
      channel: row.channel,
      label: row.label,
      ua: row.ua,
      isBot: row.isBot,
      ipHash: row.ipHash,
      country: row.country,
      region: row.region,
      city: row.city,
      isp: row.isp,
      screen: row.screen,
      lang: row.lang,
      raw: (row.raw as Record<string, unknown> | null) ?? null,
    };
  }
}
