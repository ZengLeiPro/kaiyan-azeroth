/**
 * azeroth holidays calendar / publish —— 节假日子命令组（追挂模式）
 *
 * 设计说明：
 *   - holidays 的 list 由 entity 自动发现注册（CRUD 模板）。
 *   - 屏蔽自动注册的 get/create/update/delete：后端 holidays.controller
 *     仅有 GET / / GET /calendar / PUT /year/:year 三条路由，标准 CRUD 缺
 *     `:id`/POST/DELETE。通过 EntityConfig.supportedOperations=['list']
 *     在 crud.ts 注册前做白名单 gating。
 *   - calendar：`GET /holidays/calendar?startDate&endDate`，返回
 *     `{startDate, endDate, workDates, restDates, overrides}`。
 *   - publish：`PUT /holidays/year/:year`，body 走 publishHolidaysSchema
 *     （items 数组 + 可选 confirmEmpty）；items 由 --json 传入。
 */

import {
  type HolidayYearResponse,
  publishHolidaysSchema,
  type WorkCalendarResponse,
} from '@ky-azeroth/shared';
import { Command } from 'commander';

import { request } from '../client.js';
import {
  fatal,
  output,
  parseStrictInt,
  printJson,
  readJsonInput,
  validateWithSchema,
} from '../utils.js';

interface CalendarOpts {
  startDate?: string;
  endDate?: string;
}

/** 基础 ISO 日期格式校验（service/zod 会再做日历有效性校验，这里只做形态校验提早 fail-fast） */
function ensureIsoDate(label: string, value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fatal(`Invalid --${label} "${value}"`, 'Expected ISO YYYY-MM-DD');
  }
}

/**
 * 在已由自动发现注册的 holidaysCmd 上追挂 `calendar` 子命令。
 * 注意：不替换/不重建 holidaysCmd，与自动发现的 list/get 共存。
 */
export function registerHolidaysExtras(holidaysCmd: Command): void {
  const program = holidaysCmd.parent;
  holidaysCmd
    .command('calendar')
    .description('查询工作日历（范围内 workDates + restDates + overrides）')
    // 使用 .option()（而非 .requiredOption()）以便缺参时走 fatal() 的 JSON 结构化错误，
    // 对 AI Agent 调用方更友好——commander 默认的 requiredOption 失败是纯文本到 stderr。
    .option('--start-date <iso>', '起始日期 YYYY-MM-DD（必填）')
    .option('--end-date <iso>', '结束日期 YYYY-MM-DD（必填）')
    .action(async (opts: CalendarOpts) => {
      if (!opts.startDate) {
        fatal('Missing --start-date', 'Expected YYYY-MM-DD');
      }
      if (!opts.endDate) {
        fatal('Missing --end-date', 'Expected YYYY-MM-DD');
      }
      ensureIsoDate('start-date', opts.startDate);
      ensureIsoDate('end-date', opts.endDate);

      const format = (program?.opts()['format'] as string | undefined) ?? 'json';
      const result = await request<WorkCalendarResponse>('GET', '/holidays/calendar', undefined, {
        startDate: opts.startDate,
        endDate: opts.endDate,
      });

      if (format === 'table') {
        // table 模式：把 overrides 平铺成行展示（含日期 + 类型 + 备注）；
        // 顶层 workDates/restDates 数量级可达 1830，table 不适合，附在概要里。
        const summary = [
          {
            startDate: result.startDate,
            endDate: result.endDate,
            workDays: result.workDates.length,
            restDays: result.restDates.length,
            overrideCount: result.overrides.length,
          },
        ];
        output(summary, format);
        if (result.overrides.length > 0) {
          output(result.overrides, format, {
            columns: ['date', 'type', 'note'],
          });
        }
      } else {
        output(result, format);
      }
    });

  // ── work-dates ──────────────────────────────────────────────────────
  // GET /holidays/work-dates：和 calendar 同模型但仅返回 workDates（工作日数组），
  // 用于工时报表/effort-records 的"按工作日计算饱和度"。权限挂在 effort_records.view
  // 而非 holidays——2026-06-13 audit 报告里的设计意图。
  holidaysCmd
    .command('work-dates')
    .description('查询范围内工作日数组（GET /holidays/work-dates，权限挂在 effort_records.view）')
    .option('--start-date <iso>', '起始日期 YYYY-MM-DD（必填）')
    .option('--end-date <iso>', '结束日期 YYYY-MM-DD（必填）')
    .action(async (opts: CalendarOpts) => {
      if (!opts.startDate) fatal('Missing --start-date', 'Expected YYYY-MM-DD');
      if (!opts.endDate) fatal('Missing --end-date', 'Expected YYYY-MM-DD');
      ensureIsoDate('start-date', opts.startDate);
      ensureIsoDate('end-date', opts.endDate);

      const format = (program?.opts()['format'] as string | undefined) ?? 'json';
      const result = await request<WorkCalendarResponse>('GET', '/holidays/work-dates', undefined, {
        startDate: opts.startDate,
        endDate: opts.endDate,
      });
      output(result, format);
    });

  // ── publish ─────────────────────────────────────────────────────────
  // 整年发布（PUT /holidays/year/:year）。body 仅 items + confirmEmpty
  // 两个字段：items 由 --json 传入（多条数组，字段数大），year 走 path。
  // 后端 service 对 items 做整年 diff（新增/更新/删除）并按真实变更增量
  // 触发版本号，前端"复制上一年再编辑"是主要使用场景。
  holidaysCmd
    .command('publish <year>')
    .description('整年发布节假日（PUT /holidays/year/:year）')
    .option('--json <path>', 'items 数组 JSON 文件路径（或 "-" 表示从 stdin 读）')
    .option(
      '--confirm-empty',
      '允许 items=[] 全清整年（防误清空保护：当 DB 该年 ≥ 5 条且 items 为空时必须显式带）'
    )
    .option('--dry-run', '只打印 PUT 请求体，不实际发起')
    .action(
      async (
        yearStr: string,
        opts: { json?: string; confirmEmpty?: boolean; dryRun?: boolean }
      ) => {
        const yearNum = parseStrictInt(yearStr, '<year>');
        if (yearNum < 2000 || yearNum > 2100) {
          fatal(`Invalid <year> "${yearStr}"`, 'Expected integer in 2000-2100');
        }
        if (!opts.json) {
          fatal(
            'Missing --json',
            'Pass a JSON file path containing the items array (or "-" for stdin)'
          );
        }
        // 读 items 数组（顶层是 array）+ 组装完整 body 后整体用 publishHolidaysSchema 校验。
        // schema 内含跨年校验 + 重复日期 superRefine，CLI dry-run 必须与服务端语义一致。
        const itemsRaw = readJsonInput(opts.json, '--json');
        if (!Array.isArray(itemsRaw)) {
          fatal('--json must contain a JSON array of holiday items');
        }
        const rawBody: Record<string, unknown> = {
          year: yearNum,
          items: itemsRaw,
        };
        if (opts.confirmEmpty) rawBody['confirmEmpty'] = true;

        const body = validateWithSchema(publishHolidaysSchema, rawBody, 'publish holidays body');

        const path = `/holidays/year/${yearNum}`;
        if (opts.dryRun) {
          printJson({ method: 'PUT', path, body });
          return;
        }

        const format = (program?.opts()['format'] as string | undefined) ?? 'json';
        const result = await request<HolidayYearResponse>('PUT', path, body);
        output(result, format);
      }
    );
}
