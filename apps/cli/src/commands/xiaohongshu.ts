import type { IXiaohongshuDatasetCatalogResponse } from '@ky-azeroth/shared';
import {
  xiaohongshuDailyReportQuerySchema,
  xiaohongshuDatasetCatalogQuerySchema,
  xiaohongshuDatasetIdSchema,
  xiaohongshuDatasetQuerySchema,
  xiaohongshuManualSyncBodySchema,
  xiaohongshuRankingQuerySchema,
  xiaohongshuSummaryQuerySchema,
  xiaohongshuSyncRunQuerySchema,
  xiaohongshuTrendQuerySchema,
} from '@ky-azeroth/shared';
import { Command } from 'commander';
import type { z } from 'zod';

import { request } from '../client.js';
import {
  encodeUuidPathId,
  fatal,
  output,
  parseJsonWithSchema,
  parsePositiveInt,
  printJson,
  validateWithSchema,
} from '../utils.js';
import { runXiaohongshuDatasetAllPages } from './xiaohongshu-dataset-pages.js';

interface JsonQueryOptions {
  json: string;
}

interface DatasetCatalogOptions {
  advertiserId?: string;
}

interface DatasetQueryOptions extends JsonQueryOptions {
  all?: boolean;
  output?: string;
  metadataOutput?: string;
  resumeFromPage?: number;
  pageSize?: number;
}

function readQuery<T extends z.ZodTypeAny>(schema: T, source: string): z.infer<T> {
  return parseJsonWithSchema(schema, source, '--json');
}

function encodeDatasetId(value: string): string {
  const parsed = xiaohongshuDatasetIdSchema.safeParse(value);
  if (!parsed.success) {
    fatal(`Invalid dataset id "${value}"`, {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }
  return encodeURIComponent(parsed.data);
}

/** Agent-facing 小红书聚光完整数据命令；OAuth 浏览器跳转端点不在此注册。 */
export function registerXiaohongshuCommands(program: Command): void {
  const command = program
    .command('xiaohongshu')
    .description('小红书聚光连接、完整数据查询与同步任务');
  const getFormat = (): string => (program.opts()['format'] as string | undefined) ?? 'json';

  command
    .command('connection')
    .description('查询聚光连接状态')
    .action(async () => {
      output(await request('GET', '/xiaohongshu/connection'), getFormat());
    });

  command
    .command('advertisers')
    .description('查询已授权广告主')
    .action(async () => {
      output(await request('GET', '/xiaohongshu/advertisers'), getFormat());
    });

  command
    .command('datasets')
    .description('列出全部聚光只读数据集、授权状态与查询契约')
    .option('--advertiser-id <id>', '按指定广告主所属连接解析真实授权范围')
    .action(async (opts: DatasetCatalogOptions) => {
      const query = validateWithSchema(
        xiaohongshuDatasetCatalogQuerySchema,
        { advertiserId: opts.advertiserId },
        'xiaohongshu datasets query'
      );
      const result = await request<IXiaohongshuDatasetCatalogResponse>(
        'GET',
        '/xiaohongshu/datasets',
        undefined,
        query
      );
      output(getFormat() === 'table' ? result.datasets : result, getFormat());
    });

  command
    .command('describe-dataset <dataset>')
    .description('查询一个聚光数据集的完整参数、分页、字段与可用性契约')
    .option('--advertiser-id <id>', '按指定广告主所属连接解析真实授权范围')
    .action(async (dataset: string, opts: DatasetCatalogOptions) => {
      const query = validateWithSchema(
        xiaohongshuDatasetCatalogQuerySchema,
        { advertiserId: opts.advertiserId },
        'xiaohongshu describe-dataset query'
      );
      const path = `/xiaohongshu/datasets/${encodeDatasetId(dataset)}`;
      output(await request('GET', path, undefined, query), getFormat());
    });

  command
    .command('query-dataset <dataset>')
    .description('查询任意可用聚光数据集；--all 串行导出完整 NDJSON 与元数据 sidecar')
    .requiredOption('--json <path>', '查询 JSON 文件或 "-"（广告主、日期、口径与 params）')
    .option('--page-size <n>', '覆盖 JSON 中的每页数量（1—100）', (value) =>
      parsePositiveInt(value, 'page-size')
    )
    .option('--all', '串行拉取全部页面并输出 NDJSON')
    .option('--output <file>', '全量模式必填：NDJSON 输出文件；失败保留半成品')
    .option(
      '--metadata-output <file>',
      '（配合 --all）元数据 sidecar 路径；默认 <output>.metadata.json'
    )
    .option('--resume-from-page <n>', '（配合 --all）从失败页继续并追加输出', (value) =>
      parsePositiveInt(value, 'resume-from-page')
    )
    .action(async (dataset: string, opts: DatasetQueryOptions) => {
      const parsed = readQuery(xiaohongshuDatasetQuerySchema, opts.json);
      const input = validateWithSchema(
        xiaohongshuDatasetQuerySchema,
        { ...parsed, ...(opts.pageSize ? { pageSize: opts.pageSize } : {}) },
        'xiaohongshu query-dataset request'
      );
      const path = `/xiaohongshu/datasets/${encodeDatasetId(dataset)}/query`;

      if (opts.all) {
        if (opts.json === '-') {
          fatal('--all requires --json <file>', 'stdin cannot be reopened by a resume command');
        }
        if (!opts.output) {
          fatal('--all requires --output <ndjson>', 'A durable file is required for safe resume');
        }
        if (input.page !== 1) {
          fatal('--all requires page=1 in --json (use --resume-from-page to continue)');
        }
        if (getFormat() === 'table') fatal('--all is incompatible with --format table');
        await runXiaohongshuDatasetAllPages({
          datasetId: dataset,
          input,
          jsonSource: opts.json,
          pageSize: input.pageSize,
          output: opts.output,
          metadataOutput: opts.metadataOutput,
          resumeFromPage: opts.resumeFromPage,
        });
        return;
      }

      if (opts.output) fatal('--output requires --all');
      if (opts.metadataOutput) fatal('--metadata-output requires --all');
      if (opts.resumeFromPage) fatal('--resume-from-page requires --all');
      output(await request('POST', path, input), getFormat());
    });

  command
    .command('reports')
    .description('查询聚光日报明细')
    .requiredOption('--json <path>', '查询 JSON 文件或 "-"（日期、广告主、层级、分页）')
    .action(async (opts: JsonQueryOptions) => {
      const query = readQuery(xiaohongshuDailyReportQuerySchema, opts.json);
      output(await request('GET', '/xiaohongshu/reports', undefined, query), getFormat());
    });

  command
    .command('summary')
    .description('查询指定日期范围汇总')
    .requiredOption('--json <path>', '查询 JSON 文件或 "-"（startDate/endDate 必填）')
    .action(async (opts: JsonQueryOptions) => {
      const query = readQuery(xiaohongshuSummaryQuerySchema, opts.json);
      output(await request('GET', '/xiaohongshu/summary', undefined, query), getFormat());
    });

  command
    .command('trend')
    .description('查询指定日期范围按日趋势')
    .requiredOption('--json <path>', '查询 JSON 文件或 "-"（startDate/endDate 必填）')
    .action(async (opts: JsonQueryOptions) => {
      const query = readQuery(xiaohongshuTrendQuerySchema, opts.json);
      output(await request('GET', '/xiaohongshu/trend', undefined, query), getFormat());
    });

  command
    .command('ranking')
    .description('查询指定日期范围 Top N 排行')
    .requiredOption('--json <path>', '查询 JSON 文件或 "-"（日期、层级、指标、limit）')
    .action(async (opts: JsonQueryOptions) => {
      const query = readQuery(xiaohongshuRankingQuerySchema, opts.json);
      output(await request('GET', '/xiaohongshu/ranking', undefined, query), getFormat());
    });

  command
    .command('sync-runs')
    .description('查询同步任务列表')
    .requiredOption('--json <path>', '查询 JSON 文件或 "-"（状态、广告主、分页）')
    .action(async (opts: JsonQueryOptions) => {
      const query = readQuery(xiaohongshuSyncRunQuerySchema, opts.json);
      output(await request('GET', '/xiaohongshu/sync-runs', undefined, query), getFormat());
    });

  command
    .command('latest-sync-run')
    .description('查询最新同步任务')
    .action(async () => {
      output(await request('GET', '/xiaohongshu/sync-runs/latest'), getFormat());
    });

  command
    .command('get-sync-run <id>')
    .description('查询单个同步任务详情')
    .action(async (id: string) => {
      const path = `/xiaohongshu/sync-runs/${encodeUuidPathId(id, 'sync run id')}`;
      output(await request('GET', path), getFormat());
    });

  command
    .command('trigger-sync')
    .description('手动触发小红书聚光日报同步（非 dry-run 强制 --yes）')
    .requiredOption('--json <path>', '请求 JSON 文件或 "-"（日期、层级、广告主）')
    .option('--dry-run', '仅校验并打印请求，不发起外部同步')
    .option('--yes', '确认触发外部同步（非 dry-run 必填）')
    .action(async (opts: JsonQueryOptions & { dryRun?: boolean; yes?: boolean }) => {
      const body = parseJsonWithSchema(xiaohongshuManualSyncBodySchema, opts.json, '--json');
      const path = '/xiaohongshu/sync-runs/trigger';
      if (opts.dryRun) {
        printJson({ method: 'POST', path, body });
        return;
      }
      if (!opts.yes) {
        fatal('Missing --yes', {
          operation: 'xiaohongshu.trigger-sync',
          hint: 'Use --dry-run first, then repeat with --yes',
        });
      }
      output(await request('POST', '/xiaohongshu/sync-runs/trigger', body), getFormat());
    });
}
