/**
 * azeroth sales-action-items —— 销售数据待办业务动作子命令（追挂模式）
 *
 * 设计说明：
 *   - 标准 list/get/create/update/delete 由自动发现 CRUD 模板注册。
 *   - 本文件只追挂后端 SalesActionItemsController 的非标业务路由：
 *     - GET  /sales-action-items/my
 *     - GET  /sales-action-items/my/count
 *     - POST /sales-action-items/:id/adopt
 *     - POST /sales-action-items/:id/ignore
 *     - POST /sales-action-items/:id/done
 *     - POST /sales-action-items/:id/transfer
 *     - POST /sales-action-items/:id/reopen
 *     - POST /sales-action-items/:id/undo
 *   - 处置动作只调用专用路由，尤其 adopt 必须由后端复用 KeepRecordsService 写跟进记录，
 *     不能用 update status 替代。
 */

import {
  type DoneSalesActionItemInput,
  doneSalesActionItemSchema,
  type IgnoreSalesActionItemInput,
  ignoreSalesActionItemSchema,
  type QuerySalesActionItemInput,
  querySalesActionItemSchema,
  type SalesActionItemResponseOutput,
  type TransferSalesActionItemInput,
  transferSalesActionItemSchema,
} from '@ky-azeroth/shared';
import { Command } from 'commander';

import { request } from '../client.js';
import {
  encodeUuidPathId,
  fatal,
  output,
  parseJsonWithSchema,
  parseStrictInt,
  printJson,
  validateWithSchema,
} from '../utils.js';

interface SalesActionItemsListResponse {
  items: SalesActionItemResponseOutput[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface SalesActionItemsQueryOpts {
  page?: number;
  pageSize?: number;
  keyword?: string;
  customerId?: string[];
  category?: string[];
  status?: string[];
  doneType?: string[];
  confidence?: string[];
  sourceRunId?: string;
}

interface IgnoreOpts {
  resolveNote?: string;
  note?: string;
  json?: string;
  dryRun?: boolean;
}

interface DoneOpts {
  doneType?: string;
  resolveNote?: string;
  note?: string;
  json?: string;
  dryRun?: boolean;
}

interface TransferOpts {
  employeeId?: string;
  targetEmployeeId?: string;
  reason?: string;
  json?: string;
  dryRun?: boolean;
}

const collect = (val: string, prev: string[]): string[] => [...prev, val];
const intOpt =
  (label: string) =>
  (value: string): number =>
    parseStrictInt(value, label);

export function registerSalesActionItemsExtras(salesActionItemsCmd: Command): void {
  const program = salesActionItemsCmd.parent;
  const getFormat = (): string => (program?.opts()['format'] as string | undefined) ?? 'json';

  // ── my ───────────────────────────────────────────────────────────────
  // GET /sales-action-items/my：服务端强制 employeeId = 当前登录员工。
  salesActionItemsCmd
    .command('my')
    .description('查询我的销售待办（GET /sales-action-items/my，后端强制当前员工）')
    .option('--page <n>', '页码', intOpt('--page'), 1)
    .option('--page-size <n>', '每页条数', intOpt('--page-size'), 100)
    .option('--keyword <kw>', '关键词搜索（标题 / 原因）')
    .option('--customer-id <uuid>', '客户 UUID，可重复', collect, [] as string[])
    .option('--category <value>', '类型，可重复', collect, [] as string[])
    .option('--status <value>', '状态，可重复', collect, [] as string[])
    .option('--done-type <value>', '办结类型，可重复', collect, [] as string[])
    .option('--confidence <value>', '置信度，可重复', collect, [] as string[])
    .option('--source-run-id <id>', '夜间批次 ID')
    .action(async (opts: SalesActionItemsQueryOpts) => {
      const query = validateWithSchema(
        querySalesActionItemSchema,
        compactQuery(opts),
        'sales-action-items my query'
      ) as QuerySalesActionItemInput;
      const result = await request<SalesActionItemsListResponse>(
        'GET',
        '/sales-action-items/my',
        undefined,
        query as unknown as Record<string, unknown>
      );
      output(result, getFormat());
    });

  // ── my-count ────────────────────────────────────────────────────────
  // GET /sales-action-items/my/count：服务端只使用 category 过滤。
  salesActionItemsCmd
    .command('my-count')
    .description('查询我的未处理待办数量（GET /sales-action-items/my/count）')
    .option('--category <value>', '类型，可重复', collect, [] as string[])
    .action(async (opts: Pick<SalesActionItemsQueryOpts, 'category'>) => {
      const query = validateWithSchema(
        querySalesActionItemSchema.pick({ category: true }),
        compactQuery(opts),
        'sales-action-items my-count query'
      );
      const result = await request<{ count: number }>(
        'GET',
        '/sales-action-items/my/count',
        undefined,
        query as unknown as Record<string, unknown>
      );
      output(result, getFormat());
    });

  // ── adopt ───────────────────────────────────────────────────────────
  salesActionItemsCmd
    .command('adopt <id>')
    .description('采纳待办草稿并写跟进记录（POST /sales-action-items/:id/adopt）')
    .option('--dry-run', '只打印请求路径，不实际发起')
    .action(async (id: string, opts: { dryRun?: boolean }) => {
      await postAction(id, 'adopt', opts.dryRun, getFormat());
    });

  // ── ignore ──────────────────────────────────────────────────────────
  salesActionItemsCmd
    .command('ignore <id>')
    .description('忽略待办（POST /sales-action-items/:id/ignore，resolveNote 必填）')
    .option('--resolve-note <text>', '忽略理由（必填）')
    .option('--note <text>', '忽略理由别名；建议使用 --resolve-note')
    .option('--json <path>', '或用 JSON 文件传入 body { resolveNote }')
    .option('--dry-run', '只打印请求体，不实际发起')
    .action(async (id: string, opts: IgnoreOpts) => {
      const body = buildIgnoreBody(opts);
      const path = `/sales-action-items/${encodeUuidPathId(id, 'id')}/ignore`;
      if (opts.dryRun) {
        printJson({ method: 'POST', path, body });
        return;
      }
      const result = await request<SalesActionItemResponseOutput>(
        'POST',
        path,
        body as unknown as Record<string, unknown>
      );
      output(result, getFormat());
    });

  // ── done ────────────────────────────────────────────────────────────
  salesActionItemsCmd
    .command('done <id>')
    .description('标记已办（POST /sales-action-items/:id/done，doneType + resolveNote 必填）')
    .option(
      '--done-type <value>',
      '办结类型：follow_recorded | progressed | shelved | false_alarm | other'
    )
    .option('--resolve-note <text>', '处置结果（必填）')
    .option('--note <text>', '处置结果别名；建议使用 --resolve-note')
    .option('--json <path>', '或用 JSON 文件传入 body { doneType, resolveNote, keepRecord? }')
    .option('--dry-run', '只打印请求体，不实际发起')
    .action(async (id: string, opts: DoneOpts) => {
      const body = buildDoneBody(opts);
      const path = `/sales-action-items/${encodeUuidPathId(id, 'id')}/done`;
      if (opts.dryRun) {
        printJson({ method: 'POST', path, body });
        return;
      }
      const result = await request<SalesActionItemResponseOutput>(
        'POST',
        path,
        body as unknown as Record<string, unknown>
      );
      output(result, getFormat());
    });

  // ── transfer ────────────────────────────────────────────────────────
  salesActionItemsCmd
    .command('transfer <id>')
    .description(
      '转交待办（POST /sales-action-items/:id/transfer，targetEmployeeId + reason 必填）'
    )
    .option('--employee-id <uuid>', '目标员工 UUID（--target-employee-id 的短别名）')
    .option('--target-employee-id <uuid>', '目标员工 UUID')
    .option('--reason <text>', '转交原因（必填）')
    .option('--json <path>', '或用 JSON 文件传入 body { targetEmployeeId, reason }')
    .option('--dry-run', '只打印请求体，不实际发起')
    .action(async (id: string, opts: TransferOpts) => {
      const body = buildTransferBody(opts);
      const path = `/sales-action-items/${encodeUuidPathId(id, 'id')}/transfer`;
      if (opts.dryRun) {
        printJson({ method: 'POST', path, body });
        return;
      }
      const result = await request<SalesActionItemResponseOutput>(
        'POST',
        path,
        body as unknown as Record<string, unknown>
      );
      output(result, getFormat());
    });

  // ── reopen ──────────────────────────────────────────────────────────
  salesActionItemsCmd
    .command('reopen <id>')
    .description('已办结改回待办（POST /sales-action-items/:id/reopen）')
    .option('--dry-run', '只打印请求路径，不实际发起')
    .action(async (id: string, opts: { dryRun?: boolean }) => {
      await postAction(id, 'reopen', opts.dryRun, getFormat());
    });

  // ── undo ────────────────────────────────────────────────────────────
  salesActionItemsCmd
    .command('undo <id>')
    .description('撤销已采纳并软删生成的跟进记录（POST /sales-action-items/:id/undo）')
    .option('--dry-run', '只打印请求路径，不实际发起')
    .action(async (id: string, opts: { dryRun?: boolean }) => {
      await postAction(id, 'undo', opts.dryRun, getFormat());
    });
}

function compactQuery(opts: SalesActionItemsQueryOpts): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(opts)) {
    if (value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    query[key] = value;
  }
  return query;
}

function buildIgnoreBody(opts: IgnoreOpts): IgnoreSalesActionItemInput {
  if (opts.json) return parseJsonWithSchema(ignoreSalesActionItemSchema, opts.json, '--json');
  const resolveNote = opts.resolveNote ?? opts.note;
  if (!resolveNote) fatal('Missing --resolve-note (or --json)');
  return validateWithSchema(
    ignoreSalesActionItemSchema,
    { resolveNote },
    'sales-action-items ignore body'
  );
}

function buildDoneBody(opts: DoneOpts): DoneSalesActionItemInput {
  if (opts.json) return parseJsonWithSchema(doneSalesActionItemSchema, opts.json, '--json');
  const resolveNote = opts.resolveNote ?? opts.note;
  if (!opts.doneType || !resolveNote) {
    fatal('Missing --done-type / --resolve-note (or --json)');
  }
  return validateWithSchema(
    doneSalesActionItemSchema,
    { doneType: opts.doneType, resolveNote },
    'sales-action-items done body'
  );
}

function buildTransferBody(opts: TransferOpts): TransferSalesActionItemInput {
  if (opts.json) return parseJsonWithSchema(transferSalesActionItemSchema, opts.json, '--json');
  const targetEmployeeId = opts.targetEmployeeId ?? opts.employeeId;
  if (!targetEmployeeId || !opts.reason) {
    fatal('Missing --employee-id / --reason (or --json)');
  }
  return validateWithSchema(
    transferSalesActionItemSchema,
    { targetEmployeeId, reason: opts.reason },
    'sales-action-items transfer body'
  );
}

async function postAction(
  id: string,
  action: 'adopt' | 'reopen' | 'undo',
  dryRun: boolean | undefined,
  format: string
): Promise<void> {
  const path = `/sales-action-items/${encodeUuidPathId(id, 'id')}/${action}`;
  if (dryRun) {
    printJson({ method: 'POST', path, body: {} });
    return;
  }
  const result = await request<SalesActionItemResponseOutput>('POST', path);
  output(result, format);
}
