import { z } from 'zod';

import { createPaginatedResponseSchema, paginationSchema } from './common';

// ============================================================
// 节假日设置（System / Holidays）
//
// 仅存「打破默认规则的日期」：
//   HOLIDAY = 法定节假日（默认工作日 → 改休）
//   WORKDAY = 调休补班（默认周末 → 改上班）
// 周末按 dayOfWeek 实时计算，不入库。
// ============================================================

export const HOLIDAY_TYPE = { HOLIDAY: 'HOLIDAY', WORKDAY: 'WORKDAY' } as const;
export const holidayTypeEnum = z.enum([HOLIDAY_TYPE.HOLIDAY, HOLIDAY_TYPE.WORKDAY]);
export type HolidayType = z.infer<typeof holidayTypeEnum>;

/**
 * 严格校验 YYYY-MM-DD 是否为真实日历日。
 *
 * `new Date('2026-02-29T00:00:00.000Z')` 会**静默回滚**成 2026-03-01；
 * `new Date('2026-04-31T...')` 会静默回滚成 2026-05-01。
 * 为防止这种静默错位，先 parse 后回读年/月/日做一致性校验。
 *
 * 同时导出供前端「复制上一年」时过滤 2/29 等非法日期使用。
 */
export function isValidIsoDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return false;
  // 用 UTC 避免本地时区把 2026-01-01 偏移到 2025-12-31
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

// ============================================================
// 查询单年节假日
// ============================================================
// 接入标准分页：与 CLI 自动发现 list 命令对齐（CLI 会发 page/pageSize）。
// 一年最多 ~50 条记录，单页（默认 pageSize=100）即可覆盖；page>1 时返回空 items。
export const queryHolidaySchema = paginationSchema.extend({
  year: z.coerce.number().int().min(2000).max(2100),
});

export type QueryHolidayInput = z.infer<typeof queryHolidaySchema>;

// ============================================================
// 单条节假日条目（用于「发布」时全量替换）
// ============================================================
export const holidayItemSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD')
    .refine(isValidIsoDate, { message: '不是真实存在的日历日（如 2/29 在非闰年、4/31、13 月等）' }),
  type: holidayTypeEnum,
  note: z
    .string()
    .max(100)
    .nullable()
    .optional()
    // 空串/纯空白统一归一为 null，避免无业务意义的 update 与版本号增长
    .transform((v) => {
      if (v === undefined || v === null) return null;
      const trimmed = v.trim();
      return trimmed.length === 0 ? null : trimmed;
    }),
});

export type HolidayItem = z.infer<typeof holidayItemSchema>;

// ============================================================
// 整年发布（前端把该年的全量「例外日期」一次提交，后端整年 diff）
// ============================================================
export const publishHolidaysSchema = z
  .object({
    year: z.number().int().min(2000).max(2100),
    items: z.array(holidayItemSchema),
    /**
     * 显式确认空发布——当 items=[] 但 DB 当前该年有 >= 5 条记录时，
     * 后端会拒绝；调用方需带 `confirmEmpty: true` 才能真正全清。
     * 防误操作清空全年节假日。
     */
    confirmEmpty: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    const seen = new Set<string>();
    data.items.forEach((item, idx) => {
      // 1. 跨年校验：date 的真实年份必须等于 body.year
      const itemYear = Number(item.date.slice(0, 4));
      if (itemYear !== data.year) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', idx, 'date'],
          message: `日期 ${item.date} 不在年份 ${data.year} 内（推断年份=${itemYear}）`,
        });
      }
      // 2. 同一天不能出现两次
      if (seen.has(item.date)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', idx, 'date'],
          message: `日期 ${item.date} 在提交中重复`,
        });
      }
      seen.add(item.date);
    });
  });

export type PublishHolidaysInput = z.infer<typeof publishHolidaysSchema>;

// ============================================================
// 节假日响应
// ============================================================
export const holidayResponseSchema = z.object({
  id: z.string().uuid(),
  date: z.string(), // ISO yyyy-mm-dd
  year: z.number(),
  type: holidayTypeEnum,
  note: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  version: z.number().optional(),
});

export type HolidayResponse = z.infer<typeof holidayResponseSchema>;

// ============================================================
// 整年节假日响应（用于 PUT /holidays/year/:year 的发布接口）
// ============================================================
export const holidayYearResponseSchema = z.object({
  year: z.number(),
  items: z.array(holidayResponseSchema),
});

export type HolidayYearResponse = z.infer<typeof holidayYearResponseSchema>;

// ============================================================
// 节假日列表分页响应（GET /holidays?year=xxx 现统一为标准分页结构）
// 整年作为单页返回，结构与 CLI 自动发现的 list 命令对齐
// ============================================================
export const holidayListResponseSchema = createPaginatedResponseSchema(holidayResponseSchema);

export type HolidayListResponse = z.infer<typeof holidayListResponseSchema>;

// ============================================================
// 工作日历查询（范围全量返回，不分页）
// ============================================================
const WORK_CALENDAR_MAX_RANGE_DAYS = 1830; // 5 年上限，防 Agent 误传极端范围

// @no-pagination: 工作日历是范围全量返回（≤5 年 ≈ 1830 条），不适合套分页结构
export const queryWorkCalendarSchema = z
  .object({
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD')
      .refine(isValidIsoDate, { message: 'startDate 不是真实存在的日历日' }),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD')
      .refine(isValidIsoDate, { message: 'endDate 不是真实存在的日历日' }),
  })
  .superRefine((data, ctx) => {
    // 用 UTC 0 点解析，避免本地时区偏移
    const start = new Date(`${data.startDate}T00:00:00.000Z`).getTime();
    const end = new Date(`${data.endDate}T00:00:00.000Z`).getTime();
    if (start > end) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: `endDate (${data.endDate}) 不能早于 startDate (${data.startDate})`,
      });
      return;
    }
    const days = Math.floor((end - start) / (24 * 60 * 60 * 1000)) + 1;
    if (days > WORK_CALENDAR_MAX_RANGE_DAYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: `查询跨度 ${days} 天超过上限 ${WORK_CALENDAR_MAX_RANGE_DAYS} 天（约 5 年），请缩小区间`,
      });
    }
  });

export type QueryWorkCalendarInput = z.infer<typeof queryWorkCalendarSchema>;

// ============================================================
// 工作日历响应
//   - workDates：HOLIDAY 排除、WORKDAY 包含、未命中按 Mon-Fri 包含
//   - restDates：与 workDates 互补的范围内日期
//   - overrides：范围内 holiday 表的所有命中记录（HOLIDAY + WORKDAY 两类）
// ============================================================
export const workCalendarResponseSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
  workDates: z.array(z.string()),
  restDates: z.array(z.string()),
  overrides: z.array(holidayResponseSchema),
});

export type WorkCalendarResponse = z.infer<typeof workCalendarResponseSchema>;
