import type {
  HolidayListResponse,
  HolidayResponse,
  HolidayYearResponse,
  PublishHolidaysInput,
  WorkCalendarResponse,
} from '@ky-azeroth/shared/schemas';
import { isValidIsoDate } from '@ky-azeroth/shared/schemas';
import { Injectable, UnprocessableEntityException } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import { auditCreate, auditUpdate } from '../../common/utils/audit-helper';
import { serializeEntity } from '../../common/utils/response-helpers';

type CurrentUser = { id: string; employeeId?: string | null };

/** 误操作清空全年的阈值：>= 该值时必须显式 confirmEmpty */
const EMPTY_PUBLISH_GUARD_THRESHOLD = 5;

/** 工作日历查询跨度上限（与 queryWorkCalendarSchema 保持一致，service 入口做双保险） */
const WORK_CALENDAR_MAX_RANGE_DAYS = 1830;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 节假日设置 service
 *
 * 数据模型：仅存「打破默认规则的日期」（HOLIDAY + WORKDAY）。
 * 周末按 dayOfWeek 实时计算，不入库。
 */
@Injectable()
export class HolidaysService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 查询指定年份的所有节假日记录（标准分页响应）。
   *
   * 与 CLI 自动发现 list 命令的响应契约对齐。一年最多 ~50 条记录，
   * 实际几乎永远单页返回；page>1 时显式返回空 items，避免误导调用方。
   */
  async findByYear(year: number, page = 1, pageSize = 100): Promise<HolidayListResponse> {
    const where = { year };
    const [total, rows] = await Promise.all([
      this.prisma.holiday.count({ where }),
      this.prisma.holiday.findMany({
        where,
        orderBy: { date: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items: rows.map((row) => this.toResponse(row)),
      total,
      page,
      pageSize,
      totalPages: total === 0 ? 1 : Math.ceil(total / pageSize),
    };
  }

  /**
   * 整年发布（事务内 diff + advisory lock 串行化同年并发）：
   *  - 当前有 + 提交里没有 → 删除
   *  - 当前没 + 提交里有   → 创建
   *  - 双方都有但 type/note 不同 → 更新
   *
   * 并发安全：用 PostgreSQL advisory lock 按 year 加锁，
   * 同一年的并发发布会自动串行，避免两个 admin 同时发布造成脏写。
   */
  async publishYear(
    pathYear: number,
    dto: PublishHolidaysInput,
    currentUser: CurrentUser
  ): Promise<HolidayYearResponse> {
    // 1. 校验 body.year 与 path year 一致
    if (dto.year !== pathYear) {
      throw new UnprocessableEntityException(
        `请求 body 的 year=${dto.year} 与路径 year=${pathYear} 不一致`
      );
    }

    // 2. zod 已校验：日期真实存在、items 内日期唯一、跨年。此处不再重复 normalize。
    return this.prisma.$transaction(async (tx) => {
      // 3. advisory lock：按 year 串行化。事务结束自动释放。
      //    用 pg_advisory_xact_lock(int) 单参数版本，传 year 作为锁 key。
      // @prisma-raw-sql-unsafe: pg_advisory_xact_lock 不支持参数化绑定且需要 int 字面量；
      //   pathYear 来自 zod 已校验的整型路径参数，无注入风险
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${pathYear})`);

      // 4. 取当前该年所有记录
      const current = await tx.holiday.findMany({ where: { year: pathYear } });

      // 4.5 空发布防护：当提交 items=[] 但当前 DB 已有 >= 阈值条记录时，
      //     必须显式 confirmEmpty 才能继续。防止误操作清空整年节假日。
      if (
        dto.items.length === 0 &&
        current.length >= EMPTY_PUBLISH_GUARD_THRESHOLD &&
        !dto.confirmEmpty
      ) {
        throw new UnprocessableEntityException(
          `${pathYear} 年当前有 ${current.length} 条节假日记录，` +
            `空发布会全部清空。如确需清空，请带 confirmEmpty: true 重试。`
        );
      }

      const currentMap = new Map(current.map((row) => [toIsoDate(row.date), row]));
      const incomingMap = new Map(dto.items.map((item) => [item.date, item]));

      // 5. 删除：当前有 + 提交里没有
      const toDelete = current.filter((row) => !incomingMap.has(toIsoDate(row.date)));
      if (toDelete.length > 0) {
        await tx.holiday.deleteMany({
          where: { id: { in: toDelete.map((row) => row.id) } },
        });
      }

      // 6. 创建 + 更新（按需）
      for (const item of dto.items) {
        const existing = currentMap.get(item.date);
        // note 已被 zod transform 归一为 string|null；DB 字段也为 string|null。
        const normalizedNote: string | null = item.note ?? null;
        if (!existing) {
          await tx.holiday.create({
            data: {
              date: parseIsoDate(item.date),
              year: pathYear,
              type: item.type,
              note: normalizedNote,
              ...auditCreate(currentUser),
            },
          });
        } else if (existing.type !== item.type || (existing.note ?? null) !== normalizedNote) {
          await tx.holiday.update({
            where: { id: existing.id },
            data: {
              type: item.type,
              note: normalizedNote,
              version: { increment: 1 },
              ...auditUpdate(currentUser),
            },
          });
        }
      }

      // 7. 重新读取并返回
      const refreshed = await tx.holiday.findMany({
        where: { year: pathYear },
        orderBy: { date: 'asc' },
      });
      return {
        year: pathYear,
        items: refreshed.map((row) => this.toResponse(row)),
      };
    });
  }

  // ------------------------------------------------------------
  // 供 work-days helper / 其它模块调用的工具方法（本期不接入，但先暴露）
  // ------------------------------------------------------------

  /**
   * 判断某一天（YYYY-MM-DD 字符串）是否为休息日。
   *
   * **签名刻意收成字符串**：避免任何 Date 时区歧义。
   * 调用方如果手上是 Date 对象，应该按其"本地年月日"含义先字符串化，
   * 然后调用本方法（不要传 Date —— `new Date(2026,0,4)` 在中国 UTC+8
   * 上是 2026-01-04 本地，但 toUTCString 是前一天 16:00，会偏移）。
   *
   *  - 命中 holiday 表且 type=HOLIDAY → true
   *  - 命中 holiday 表且 type=WORKDAY → false（调休补班）
   *  - 未命中 → 周末(周六/周日)=true，工作日=false
   */
  async isRestDay(isoDate: string): Promise<boolean> {
    if (!isValidIsoDate(isoDate)) {
      throw new Error(`isRestDay: 非法的 ISO 日期 "${isoDate}"`);
    }
    const dateOnly = parseIsoDate(isoDate);
    const row = await this.prisma.holiday.findUnique({ where: { date: dateOnly } });
    if (row) {
      return row.type === 'HOLIDAY';
    }
    // dateOnly 是 UTC 0 点，getUTCDay 即该 ISO 日期的"星期几"。
    const dow = dateOnly.getUTCDay();
    return dow === 0 || dow === 6;
  }

  /**
   * 返回 [startDate, endDate] 范围内的工作日列表（ISO YYYY-MM-DD 数组，按升序）。
   *
   * **service-to-service 内部接口**：只做基础合法性校验（ISO 格式 + start≤end），
   * **不做跨度上限校验**——calendar 公共 API 的 1830 天上限是为 AI Agent 误传设的，
   * 不应泄漏到 effort-stats 等内部统计模块。effort-stats 跨度由其自身 schema 决定。
   */
  async listWorkDates(startDate: string, endDate: string): Promise<string[]> {
    this.validateRangeBasic(startDate, endDate);
    const { workDates } = await this.iterateRangeWithOverrides(startDate, endDate, false);
    return workDates;
  }

  /**
   * 工作日历：返回范围内 workDates + restDates + overrides。
   *
   * - workDates：HOLIDAY 排、WORKDAY 补、未命中按 Mon-Fri 包含
   * - restDates：与 workDates 互补
   * - overrides：范围内 holiday 表所有命中记录（完整字段，含 id/year/note 等）
   *
   * 公共 API 入口：基础校验 + 跨度上限双保险（zod schema 同步限制）。
   */
  async getCalendar(startDate: string, endDate: string): Promise<WorkCalendarResponse> {
    this.validateRangeBasic(startDate, endDate);
    this.validateRangeWithinMax(startDate, endDate);
    const { workDates, restDates, overrideRows } = await this.iterateRangeWithOverrides(
      startDate,
      endDate,
      true
    );
    return {
      startDate,
      endDate,
      workDates,
      restDates,
      overrides: overrideRows.map((row) => this.toResponse(row)),
    };
  }

  // ------------------------------------------------------------
  // private
  // ------------------------------------------------------------

  /**
   * 基础校验：ISO 日期合法性 + start ≤ end。
   * **不校验跨度上限**——跨度上限是公共 API 边界的防误传策略，由 zod / `validateRangeWithinMax` 负责。
   */
  private validateRangeBasic(startDate: string, endDate: string): void {
    if (!isValidIsoDate(startDate)) {
      throw new UnprocessableEntityException(`startDate 非法 ISO 日期 "${startDate}"`);
    }
    if (!isValidIsoDate(endDate)) {
      throw new UnprocessableEntityException(`endDate 非法 ISO 日期 "${endDate}"`);
    }
    if (parseIsoDate(startDate).getTime() > parseIsoDate(endDate).getTime()) {
      throw new UnprocessableEntityException(
        `endDate (${endDate}) 不能早于 startDate (${startDate})`
      );
    }
  }

  /**
   * 跨度上限校验：与 queryWorkCalendarSchema 保持一致（service 入口双保险）。
   * 仅 calendar 公共 API 使用，内部 listWorkDates 不调用此方法。
   */
  private validateRangeWithinMax(startDate: string, endDate: string): void {
    const start = parseIsoDate(startDate).getTime();
    const end = parseIsoDate(endDate).getTime();
    const days = Math.floor((end - start) / ONE_DAY_MS) + 1;
    if (days > WORK_CALENDAR_MAX_RANGE_DAYS) {
      throw new UnprocessableEntityException(
        `查询跨度 ${days} 天超过上限 ${WORK_CALENDAR_MAX_RANGE_DAYS} 天（约 5 年），请缩小区间`
      );
    }
  }

  /**
   * 范围工作日核心遍历（被 listWorkDates / getCalendar 共用）：
   * 一次 findMany 取 override map（一年 ~50 条），按 UTC 0 点逐日对照。
   *
   * @param includeFullOverrideRows 是否返回完整 override 行（getCalendar 用），
   *                                false 时只用 select 取 date+type（节省传输）
   */
  private async iterateRangeWithOverrides(
    startDate: string,
    endDate: string,
    includeFullOverrideRows: boolean
  ): Promise<{
    workDates: string[];
    restDates: string[];
    overrideRows: Array<{
      id: string;
      date: Date;
      year: number;
      type: string;
      note: string | null;
      createdAt: Date;
      updatedAt: Date;
      version: number;
    }>;
  }> {
    const start = parseIsoDate(startDate);
    const end = parseIsoDate(endDate);

    const overrideRows = includeFullOverrideRows
      ? await this.prisma.holiday.findMany({
          where: { date: { gte: start, lte: end } },
          orderBy: { date: 'asc' },
        })
      : [];
    const overrideMap: Map<string, { type: string }> = includeFullOverrideRows
      ? new Map(overrideRows.map((row) => [toIsoDate(row.date), { type: row.type }]))
      : new Map(
          (
            await this.prisma.holiday.findMany({
              where: { date: { gte: start, lte: end } },
              select: { date: true, type: true },
            })
          ).map((row) => [toIsoDate(row.date), row])
        );

    const workDates: string[] = [];
    const restDates: string[] = [];
    for (let t = start.getTime(); t <= end.getTime(); t += ONE_DAY_MS) {
      const iso = new Date(t).toISOString().slice(0, 10);
      if (this.isWorkDayByOverrideMap(iso, overrideMap)) {
        workDates.push(iso);
      } else {
        restDates.push(iso);
      }
    }
    return { workDates, restDates, overrideRows };
  }

  /**
   * 给定 ISO 日期 + 预取的 override map，判断是否为工作日。
   *  - HOLIDAY 命中 → 否
   *  - WORKDAY 命中 → 是
   *  - 未命中 → Mon-Fri 是、Sat/Sun 否
   */
  private isWorkDayByOverrideMap(iso: string, overrideMap: Map<string, { type: string }>): boolean {
    const row = overrideMap.get(iso);
    if (row) {
      return row.type === 'WORKDAY';
    }
    const dow = new Date(`${iso}T00:00:00.000Z`).getUTCDay();
    return dow !== 0 && dow !== 6;
  }

  private toResponse(row: {
    id: string;
    date: Date;
    year: number;
    type: string;
    note: string | null;
    createdAt: Date;
    updatedAt: Date;
    version: number;
  }): HolidayResponse {
    return serializeEntity<HolidayResponse>({
      ...row,
      date: toIsoDate(row.date),
    });
  }
}

/**
 * 把 Prisma 返回的 DATE 字段（UTC 午夜）转为 'YYYY-MM-DD'。
 * Prisma 把 `@db.Date` 字段以 UTC 0 点的 Date 对象返回，因此用 toISOString() 取前 10 位即可。
 */
function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * 把 'YYYY-MM-DD' 字符串解析为 UTC 0 点的 Date，以匹配 Prisma @db.Date 的存储惯例。
 *
 * **严格模式**：parse 后回读字符串与入参对比，2026-02-29 / 2026-04-31 / 2026-13-01
 * 这类被 `new Date()` 静默回滚的非法日期会抛 UnprocessableEntityException。
 * 兜底防 zod 层被绕过（如内部调用未走 DTO）。
 */
function parseIsoDate(iso: string): Date {
  if (!isValidIsoDate(iso)) {
    throw new UnprocessableEntityException(`非法日期 ${iso}（非真实存在的日历日）`);
  }
  return new Date(`${iso}T00:00:00.000Z`);
}
