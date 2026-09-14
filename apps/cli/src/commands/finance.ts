/**
 * azeroth finance —— 财务模块
 *
 * 所有命令通过 PAT 调用 server，server 端走 finance.* 权限矩阵。
 * 高风险写操作另要求最近认证 JWT，PAT 会被拒绝。CLI 本身不做权限预检。
 *
 * 实体已在 registry.ts 的 EXCLUDED_ENTITIES 中排除自动 CRUD 派生，
 * 所有命令在此手写注册（不依赖 schema 三件套自动派生）。
 *
 * 钉钉迁移典型流程：
 *   1. `azeroth finance import-dingtalk-preview --workbook-id <id> --years 2025,2026`
 *      → 看 reconciliation.passed；若 false 看 balanceDiffs / pnlDiffs 调整钉钉源数据
 *   2. `azeroth finance import-dingtalk-commit --batch-id <id> --strategy replace_year`
 */

import { Command, Option } from 'commander';

import { request } from '../client.js';
import { encodeUuidPathId, fatal, output, parseStrictInt, printJson } from '../utils.js';

function intInRange(value: string, label: string, min: number, max: number): number {
  const parsed = parseStrictInt(value, label);
  if (parsed < min || parsed > max) fatal(`Invalid ${label}`, `Expected ${min}..${max}`);
  return parsed;
}
const positiveInt = (value: string): number =>
  intInRange(value, 'integer', 1, Number.MAX_SAFE_INTEGER);
const yearArg = (value: string): number => intInRange(value, 'year', 2000, 2100);
const monthArg = (value: string): number => intInRange(value, 'month', 1, 12);
const levelArg = (value: string): number => intInRange(value, 'level', 1, 2);
function uuidCsv(value: string, label: string): string[] {
  return value.split(',').map((item) => {
    const trimmed = item.trim();
    encodeUuidPathId(trimmed, label);
    return trimmed;
  });
}

export function registerFinanceCommands(program: Command): void {
  const finance = program.command('finance').description('财务总账（仅 admin 用户可用）');

  const getFormat = (): string => (program.opts()['format'] as string | undefined) ?? 'json';

  // ============== 账户字典 ==============
  finance
    .command('list-accounts')
    .description('列出账户字典')
    .option('--keyword <q>', '关键词搜索')
    .option('--kind <k>', '账户类型：virtual/bank/alipay/wechat/cash')
    .action(async (opts: { keyword?: string; kind?: string }) => {
      const params = new URLSearchParams();
      if (opts.keyword) params.set('keyword', opts.keyword);
      if (opts.kind) params.set('kind', opts.kind);
      const result = await request('GET', `/finance-accounts?${params.toString()}`);
      output(result, getFormat());
    });

  finance
    .command('get-account <id>')
    .description('查看单个账户')
    .action(async (id: string) => {
      const result = await request('GET', `/finance-accounts/${encodeUuidPathId(id, 'id')}`);
      output(result, getFormat());
    });

  // ============== 科目字典 ==============
  finance
    .command('list-subjects')
    .description('列出科目字典')
    .option('--keyword <q>', '关键词搜索')
    .option('--category <c>', '大类：revenue/cogs/opex/tax/other_income/non_pl')
    .option('--level <l>', '层级：1 分组 / 2 叶子', levelArg)
    .option('--page-size <n>', '每页', positiveInt, 200)
    .action(
      async (opts: { keyword?: string; category?: string; level?: number; pageSize?: number }) => {
        const params = new URLSearchParams();
        if (opts.keyword) params.set('keyword', opts.keyword);
        if (opts.category) params.set('category', opts.category);
        if (opts.level) params.set('level', String(opts.level));
        if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
        const result = await request('GET', `/finance-subjects?${params.toString()}`);
        output(result, getFormat());
      }
    );

  finance
    .command('get-subject <id>')
    .description('查看单个科目')
    .action(async (id: string) => {
      const result = await request('GET', `/finance-subjects/${encodeUuidPathId(id, 'id')}`);
      output(result, getFormat());
    });

  // ============== 公司流水 ==============
  finance
    .command('list-ledger')
    .description('列出公司流水（含 runningBalance）')
    .option('--year <y>', '年份', yearArg)
    .option('--month <m>', '月份 1-12', monthArg)
    .option('--account-id <id>', '账户 ID（可逗号分隔多个）')
    .option('--subject-id <id>', '科目 ID（可逗号分隔多个）')
    .option('--category <c>', '大类（可逗号分隔多个）')
    .option('--direction <d>', '方向：in/out')
    .option('--keyword <q>', '关键词（搜备注/科目名）')
    .option('--page <n>', '页码', positiveInt, 1)
    .option('--page-size <n>', '每页', positiveInt, 100)
    .action(async (opts: Record<string, string | number | undefined>) => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(opts)) {
        if (v === undefined) continue;
        if (k === 'accountId' || k === 'subjectId') {
          for (const part of uuidCsv(String(v), k)) params.append(k, part);
        } else if (k === 'category') {
          for (const part of String(v).split(',')) params.append(k, part);
        } else {
          params.set(k, String(v));
        }
      }
      const result = await request('GET', `/finance-ledger?${params.toString()}`);
      output(result, getFormat());
    });

  finance
    .command('get-ledger <id>')
    .description('查看单条流水')
    .action(async (id: string) => {
      const result = await request('GET', `/finance-ledger/${encodeUuidPathId(id, 'id')}`);
      output(result, getFormat());
    });

  // ============== 私账流水 ==============
  finance
    .command('list-personal-ledger')
    .description('列出私账流水（仅 admin 用户可见）')
    .option('--year <y>', '年份', yearArg)
    .option('--month <m>', '月份 1-12', monthArg)
    .option('--keyword <q>', '关键词')
    .option('--page <n>', '页码', positiveInt, 1)
    .option('--page-size <n>', '每页', positiveInt, 100)
    .action(async (opts: Record<string, string | number | undefined>) => {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(opts)) {
        if (v !== undefined) params.set(k, String(v));
      }
      const result = await request('GET', `/finance-personal-ledger?${params.toString()}`);
      output(result, getFormat());
    });

  // ============== 损益表 ==============
  finance
    .command('pnl')
    .description('损益表（科目×月份 矩阵）')
    .requiredOption('--year <y>', '年份', yearArg)
    .action(async (opts: { year: number }) => {
      const result = await request('GET', `/finance-pnl?year=${opts.year}`);
      output(result, getFormat());
    });

  finance
    .command('pnl-drilldown')
    .description('PnL 下钻：查某月某科目命中的明细')
    .requiredOption('--year <y>', '年份', yearArg)
    .requiredOption('--month <m>', '月份 1-12', monthArg)
    .requiredOption('--subject <code>', '科目 code（如 opex.ga_salary）')
    .action(async (opts: { year: number; month: number; subject: string }) => {
      const params = new URLSearchParams({
        year: String(opts.year),
        month: String(opts.month),
        subjectCode: opts.subject,
      });
      const result = await request('GET', `/finance-pnl/drilldown?${params.toString()}`);
      output(result, getFormat());
    });

  // ============== 钉钉迁移 ==============
  finance
    .command('import-dingtalk-preview')
    .description('预览钉钉迁移（不入库，含双对账）')
    .requiredOption('--workbook-id <id>', '钉钉表 workbookId')
    .requiredOption('--years <years>', '年份逗号分隔，如 2025,2026')
    .option('--dry-run', '只打印请求体，不实际发起')
    .action(async (opts: { workbookId: string; years: string; dryRun?: boolean }) => {
      const body = {
        workbookId: opts.workbookId,
        years: opts.years.split(',').map(yearArg),
      };
      if (opts.dryRun) {
        printJson({ method: 'POST', url: '/finance-import/dingtalk/preview', body });
        return;
      }
      const result = await request('POST', '/finance-import/dingtalk/preview', body);
      output(result, getFormat());
    });

  finance
    .command('import-dingtalk-commit')
    .description('提交钉钉迁移（需 batch.status=preview）')
    .requiredOption('--batch-id <id>', '从 preview 返回的 batchId')
    .addOption(
      new Option('--strategy <s>', '策略（必须显式选择，不提供覆盖型默认值）')
        .choices(['replace_year', 'append_only'])
        .makeOptionMandatory()
    )
    .option('--yes', '确认执行导入提交（非 dry-run 必填）')
    .option('--dry-run', '只打印请求体，不实际发起')
    .action(
      async (opts: { batchId: string; strategy: string; yes?: boolean; dryRun?: boolean }) => {
        encodeUuidPathId(opts.batchId, 'batchId');
        const body = { batchId: opts.batchId, strategy: opts.strategy };
        if (opts.dryRun) {
          printJson({ method: 'POST', path: '/finance-import/dingtalk/commit', body });
          return;
        }
        if (!opts.yes) fatal('Finance import commit requires --yes');
        const result = await request('POST', '/finance-import/dingtalk/commit', body);
        output(result, getFormat());
      }
    );

  finance
    .command('list-import-batches')
    .description('列出导入批次历史')
    .option('--page <n>', '页码', positiveInt, 1)
    .option('--page-size <n>', '每页', positiveInt, 20)
    .action(async (opts: { page?: number; pageSize?: number }) => {
      const params = new URLSearchParams();
      if (opts.page) params.set('page', String(opts.page));
      if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
      const result = await request('GET', `/finance-import/batches?${params.toString()}`);
      output(result, getFormat());
    });

  finance
    .command('get-import-batch <id>')
    .description('查看单个批次详情（含 reconciliation）')
    .action(async (id: string) => {
      const result = await request('GET', `/finance-import/batches/${encodeUuidPathId(id, 'id')}`);
      output(result, getFormat());
    });
}
