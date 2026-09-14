/**
 * azeroth approvals —— 审批处理与查询子命令组。
 *
 * 审批提交必须走各业务实体的 submit-approval / change-request 薄入口，
 * 由服务端在业务数据范围校验与 CAS 成功后创建内部审批实例。本命令组不得提供
 * 可手填 eventType / formId 的通用 submit，以免绕过业务不变量。
 */

import * as allShared from '@ky-azeroth/shared';
import { Command, Option } from 'commander';

import { request } from '../client.js';
import { encodeUuidPathId, fatal, output, parsePositiveInt } from '../utils.js';

// shared 包没声明 "type": "module"，tsx 跑 dev 模式下 ESM/CJS interop 会把
// named exports 包到 default 里。registry.ts 用同样的 (default ?? raw) 模式
// 来读 MODULES，这里复用此约定。
const sharedExports = (allShared as Record<string, unknown>)['default'] ?? allShared;
const APPROVAL_EVENT_TYPE = (sharedExports as { APPROVAL_EVENT_TYPE: Record<string, string> })
  .APPROVAL_EVENT_TYPE;

const EVENT_TYPES = Object.values(APPROVAL_EVENT_TYPE);
const ACTIONS = ['approve', 'reject'] as const;

type ApprovalAction = (typeof ACTIONS)[number];

const intArg = (v: string): number => parsePositiveInt(v, 'pagination option');
const csvArg = (v: string): string[] =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** 校验 eventType 落在 shared 注册表内（与服务端 Zod enum 同源） */
function ensureEventType(value: string): void {
  if (!EVENT_TYPES.includes(value)) {
    fatal(`Invalid --event-type "${value}"`, `Allowed: ${EVENT_TYPES.join(' | ')}`);
  }
}

function ensureAction(value: string): asserts value is ApprovalAction {
  if (!ACTIONS.includes(value as ApprovalAction)) {
    fatal(`Invalid action "${value}"`, `Allowed: ${ACTIONS.join(' | ')}`);
  }
}

export function registerApprovalsCommands(program: Command): void {
  const root = program.command('approvals').description('审批处理与查询（业务提交请走实体命令）');

  // ── approve ─────────────────────────────────────────────────────────
  root
    .command('approve <instanceId>')
    .description('审批通过/驳回当前节点')
    .option('--reject', '驳回（默认是通过）')
    .option('--comment <text>', '审批意见')
    .action(async (instanceId: string, opts: { reject?: boolean; comment?: string }) => {
      const action: ApprovalAction = opts.reject ? 'reject' : 'approve';
      ensureAction(action);
      const format = program.opts()['format'] as string;
      const result = await request(
        'POST',
        `/approvals/${encodeUuidPathId(instanceId, 'instanceId')}/approve`,
        {
          action,
          ...(opts.comment ? { comment: opts.comment } : {}),
        }
      );
      output(result, format);
    });

  // ── withdraw ────────────────────────────────────────────────────────
  root
    .command('withdraw <instanceId>')
    .description('撤回审批（仅发起人，且未结束时可撤）')
    .option('--comment <text>', '撤回理由')
    .action(async (instanceId: string, opts: { comment?: string }) => {
      const format = program.opts()['format'] as string;
      const result = await request(
        'POST',
        `/approvals/${encodeUuidPathId(instanceId, 'instanceId')}/withdraw`,
        opts.comment ? { comment: opts.comment } : {}
      );
      output(result, format);
    });

  // ── admin-approve ───────────────────────────────────────────────────
  root
    .command('admin-approve <instanceId>')
    .description('管理员强制审批（ADMIN 角色）')
    .option('--reject', '驳回（默认是通过）')
    .option('--comment <text>', '审批意见')
    .action(async (instanceId: string, opts: { reject?: boolean; comment?: string }) => {
      const action: ApprovalAction = opts.reject ? 'reject' : 'approve';
      const format = program.opts()['format'] as string;
      const result = await request(
        'POST',
        `/approvals/${encodeUuidPathId(instanceId, 'instanceId')}/admin-approve`,
        {
          action,
          ...(opts.comment ? { comment: opts.comment } : {}),
        }
      );
      output(result, format);
    });

  // ── pending ─────────────────────────────────────────────────────────
  // 通用列表选项构造器：所有 GET 列表共享同一组分页/筛选 flag
  type ListOpts = {
    page?: number;
    pageSize?: number;
    eventType?: string[];
    status?: string;
    keyword?: string;
    startDate?: string;
    endDate?: string;
    quiet?: boolean;
  };

  const buildListParams = (opts: ListOpts): Record<string, unknown> => {
    const validateDate = (value: string, label: string): string => {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(`${value}T00:00:00Z`))
      ) {
        fatal(`Invalid ${label} "${value}"`, 'Expected a real YYYY-MM-DD calendar date');
      }
      return value;
    };
    if (opts.startDate && opts.endDate && opts.startDate > opts.endDate) {
      fatal('Invalid approval date range', '--start-date must not be after --end-date');
    }
    const params: Record<string, unknown> = {};
    if (opts.page !== undefined) params['page'] = opts.page;
    if (opts.pageSize !== undefined) params['pageSize'] = opts.pageSize;
    if (opts.eventType && opts.eventType.length > 0) {
      for (const t of opts.eventType) ensureEventType(t);
      params['eventType'] = opts.eventType;
    }
    if (opts.status) params['status'] = opts.status;
    if (opts.keyword) params['keyword'] = opts.keyword;
    if (opts.startDate) params['startDate'] = validateDate(opts.startDate, '--start-date');
    if (opts.endDate) params['endDate'] = validateDate(opts.endDate, '--end-date');
    return params;
  };

  const attachListOptions = (cmd: Command): Command =>
    cmd
      .option('--page <n>', '页码', intArg, 1)
      .option('--page-size <n>', '每页大小', intArg, 100)
      .option(
        '--event-type <types>',
        `事件类型（逗号分隔；可选: ${EVENT_TYPES.join('|')}）`,
        csvArg
      )
      .addOption(
        new Option('--status <status>', '状态').choices([
          'pending',
          'approved',
          'rejected',
          'withdrawn',
        ])
      )
      .option('--keyword <text>', '关键词')
      .option('--start-date <date>', '起始日期 YYYY-MM-DD')
      .option('--end-date <date>', '结束日期 YYYY-MM-DD')
      .option('-q, --quiet', '仅输出 ID');

  attachListOptions(root.command('pending').description('待我审批列表')).action(
    async (opts: ListOpts) => {
      const format = program.opts()['format'] as string;
      const result = await request<{
        items: Array<Record<string, unknown>>;
        total: number;
      }>('GET', '/approvals/pending', undefined, buildListParams(opts));
      if (opts.quiet) output(result.items, format, { quiet: true });
      else output(result, format);
    }
  );

  attachListOptions(root.command('completed').description('我已审批列表')).action(
    async (opts: ListOpts) => {
      const format = program.opts()['format'] as string;
      const result = await request<{
        items: Array<Record<string, unknown>>;
        total: number;
      }>('GET', '/approvals/completed', undefined, buildListParams(opts));
      if (opts.quiet) output(result.items, format, { quiet: true });
      else output(result, format);
    }
  );

  attachListOptions(root.command('initiated').description('我发起的审批列表')).action(
    async (opts: ListOpts) => {
      const format = program.opts()['format'] as string;
      const result = await request<{
        items: Array<Record<string, unknown>>;
        total: number;
      }>('GET', '/approvals/initiated', undefined, buildListParams(opts));
      if (opts.quiet) output(result.items, format, { quiet: true });
      else output(result, format);
    }
  );

  attachListOptions(root.command('copy-to').description('抄送给我的列表')).action(
    async (opts: ListOpts) => {
      const format = program.opts()['format'] as string;
      const result = await request<{
        items: Array<Record<string, unknown>>;
        total: number;
      }>('GET', '/approvals/copy-to', undefined, buildListParams(opts));
      if (opts.quiet) output(result.items, format, { quiet: true });
      else output(result, format);
    }
  );

  attachListOptions(root.command('all').description('全部审批列表（仅 ADMIN）')).action(
    async (opts: ListOpts) => {
      const format = program.opts()['format'] as string;
      const result = await request<{
        items: Array<Record<string, unknown>>;
        total: number;
      }>('GET', '/approvals/all', undefined, buildListParams(opts));
      if (opts.quiet) output(result.items, format, { quiet: true });
      else output(result, format);
    }
  );

  // ── pending-count ───────────────────────────────────────────────────
  root
    .command('pending-count')
    .description('待我审批数量')
    .action(async () => {
      const format = program.opts()['format'] as string;
      const result = await request('GET', '/approvals/pending/count');
      output(result, format);
    });

  // ── form ────────────────────────────────────────────────────────────
  root
    .command('form <eventType> <formId>')
    .description('按业务单查审批实例（eventType + formId）')
    .action(async (eventType: string, formId: string) => {
      ensureEventType(eventType);
      const format = program.opts()['format'] as string;
      const result = await request(
        'GET',
        `/approvals/form/${encodeURIComponent(eventType)}/${encodeUuidPathId(formId, 'formId')}`
      );
      output(result, format);
    });

  // ── get ─────────────────────────────────────────────────────────────
  root
    .command('get <instanceId>')
    .description('获取审批实例详情（含 tasks/records）')
    .action(async (instanceId: string) => {
      const format = program.opts()['format'] as string;
      const result = await request(
        'GET',
        `/approvals/${encodeUuidPathId(instanceId, 'instanceId')}`
      );
      output(result, format);
    });

  // ── get-change-request ──────────────────────────────────────────────
  // 业务单变更审批走 :id/change-request thin wrapper（sale-orders/payments/
  // invoices/visit-records 4 个 controller，由 crud.ts 通用注册的 change-request
  // 子命令承接提交动作），server 把变更前/变更后字段都存到 ApprovalChangeRequest
  // 表。本命令读该详情（包含 before/after diff），用于审批人对比变更内容。
  root
    .command('get-change-request <id>')
    .description('查询变更申请详情（GET /approvals/change-requests/:id，含 before/after diff）')
    .action(async (id: string) => {
      const format = program.opts()['format'] as string;
      const result = await request(
        'GET',
        `/approvals/change-requests/${encodeUuidPathId(id, 'id')}`
      );
      output(result, format);
    });
}
