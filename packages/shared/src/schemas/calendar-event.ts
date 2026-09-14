import { z } from 'zod';

import { withColumn } from './column-meta';
import { COL_DATETIME } from './column-widths';
import { paginationSchema } from './common';

/**
 * 日程事件查询 Schema（只读实体，无 create/update）
 */
export const queryCalendarEventSchema = paginationSchema.extend({
  keyword: z.string().max(100).optional(),
  creator: z.string().optional(),
});

export type QueryCalendarEventInput = z.infer<typeof queryCalendarEventSchema>;

/**
 * 日程事件响应 Schema
 *
 * 列 UI 元数据通过 `withColumn(...)` 附着。时间字段展示使用 locale string 格式，
 * 保留为 custom + 页面 overrides，以与原有展示保持一致。
 */
export const calendarEventResponseSchema = z.object({
  eventId: z.string(),
  title: withColumn(z.string().optional().nullable(), {
    label: '日程标题',
    type: 'custom', // 页面 overrides（加粗）
    required: true,
    order: 10,
  }),
  description: withColumn(z.string().optional().nullable(), {
    label: '描述',
    type: 'custom', // 页面 overrides（30 字截断 + muted）
    order: 70,
  }),
  startTime: withColumn(z.string().optional().nullable(), {
    label: '开始时间',
    width: COL_DATETIME,
    type: 'custom', // 页面 overrides（toLocaleString('zh-CN')）
    order: 20,
  }),
  endTime: withColumn(z.string().optional().nullable(), {
    label: '结束时间',
    width: COL_DATETIME,
    type: 'custom',
    order: 30,
  }),
  location: withColumn(z.string().optional().nullable(), {
    label: '地点',
    type: 'custom', // 页面 overrides（muted）
    order: 40,
  }),
  creator: withColumn(z.string().optional().nullable(), {
    label: '创建者',
    type: 'custom',
    order: 50,
  }),
  attendees: withColumn(z.array(z.string()).optional().nullable(), {
    label: '参与人',
    type: 'custom', // 页面 overrides（muted + join）
    order: 60,
  }),
  syncedAt: withColumn(z.string().optional().nullable(), {
    label: '同步时间',
    width: COL_DATETIME,
    type: 'custom', // 页面 overrides（toLocaleString）
    order: 80,
  }),
});

export type CalendarEventResponseOutput = z.infer<typeof calendarEventResponseSchema>;
