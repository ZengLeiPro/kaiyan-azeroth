/**
 * 期间预设 → 实际 (startDate, endDate) 解析
 *
 * 解析规则（基准时间：服务端 NOW()，业务时区按 Asia/Shanghai 处理）：
 * - mtd     : 本月 1 号 ~ 今天（含）
 * - last30d : 今天往前 30 天 ~ 今天（含 30 个完整日）
 * - qtd     : 本季首月 1 号 ~ 今天（含）
 * - ytd     : 本年 1 月 1 号 ~ 今天（含）
 * - custom  : 透传调用方传入的 startDate / endDate
 *
 * 返回 ISO 字符串便于结构化记录到响应 range meta。
 */

import type { AnalyticsRangeInput } from '@ky-azeroth/shared/schemas';
import type { IAnalyticsRangeMeta } from '@ky-azeroth/shared/types';
import { BadRequestException } from '@nestjs/common';

export interface ResolvedAnalyticsRange {
  /** start of day（>=） */
  startDate: Date;
  /** end of day（<，即下一天的 0 点） */
  endDate: Date;
  /** 元信息（YYYY-MM-DD） */
  meta: IAnalyticsRangeMeta;
}

const fmt = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const nextDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);

/**
 * 解析期间预设为 (start, end) 闭开区间。
 *
 * @param input { preset, startDate?, endDate? }
 * @param now   注入便于测试，默认 new Date()
 */
export function resolveAnalyticsRange(
  input: AnalyticsRangeInput,
  now: Date = new Date()
): ResolvedAnalyticsRange {
  const today = startOfDay(now);
  let start: Date;
  let end: Date = nextDay(today); // end-exclusive：包含今天

  switch (input.preset) {
    case 'mtd':
      start = new Date(today.getFullYear(), today.getMonth(), 1);
      break;
    case 'last30d':
      start = new Date(today);
      start.setDate(start.getDate() - 29); // 含今天共 30 天
      break;
    case 'qtd': {
      const q = Math.floor(today.getMonth() / 3); // 0-3
      start = new Date(today.getFullYear(), q * 3, 1);
      break;
    }
    case 'ytd':
      start = new Date(today.getFullYear(), 0, 1);
      break;
    case 'custom': {
      if (!input.startDate || !input.endDate) {
        throw new BadRequestException('preset=custom 时必须提供 startDate 与 endDate');
      }
      // YYYY-MM-DD → 本地 0 点
      start = new Date(`${input.startDate}T00:00:00`);
      end = new Date(`${input.endDate}T00:00:00`);
      end.setDate(end.getDate() + 1); // 包含 endDate 当天
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        throw new BadRequestException('startDate 或 endDate 解析失败');
      }
      if (start >= end) {
        throw new BadRequestException('startDate 必须 ≤ endDate');
      }
      break;
    }
    default:
      throw new BadRequestException(`不支持的 preset：${String(input.preset)}`);
  }

  // 用于 meta 显示的 endDate 文本（含当日）= 实际 end - 1 天
  const metaEnd = new Date(end);
  metaEnd.setDate(metaEnd.getDate() - 1);

  return {
    startDate: start,
    endDate: end,
    meta: {
      preset: input.preset,
      startDate: fmt(start),
      endDate: fmt(metaEnd),
    },
  };
}
