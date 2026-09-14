/**
 * azeroth projects —— 项目订单挂接 / 成员管理子命令组（追挂模式）
 *
 * 设计说明：
 *   - projects 的 list/get/create/update/delete 由 entity 自动发现注册
 *     （CRUD 模板），本文件只追挂"非标准 CRUD"的成员/订单挂接动作。
 *   - 命名加 `-sale-order` / `-member` 后缀避免与 crud.ts 自动注册的
 *     `get <id>` / `delete <id>` / `update <id>` 冲突（commander 在子命令
 *     重名时会用后注册者覆盖，丢自动 CRUD 行为）。
 *   - 后端路由（projects.controller.ts:87-131）：
 *     - POST   /projects/:id/sale-orders            body = { saleOrderId, version }
 *     - DELETE /projects/:id/sale-orders/:saleOrderId?version=...
 *     - POST   /projects/:id/members                body = { employeeId, userName?, role? }
 *     - DELETE /projects/:id/members/:memberId?version=...
 *     - GET    /projects/:id/members
 *   - body 校验来源：shared 的 linkSaleOrderSchema / addProjectMemberSchema
 *     已抽取；CLI 这一侧只做 fail-fast 形态校验，server 端 zod 兜底。
 *   - 写入命令统一支持 --dry-run，与 crud.ts 行为一致（打印 method/path/body）。
 */

import {
  addProjectMemberSchema,
  linkSaleOrderSchema,
  type ProjectMemberOutput,
} from '@ky-azeroth/shared';
import { Command } from 'commander';

import { request } from '../client.js';
import {
  encodeUuidPathId,
  fatal,
  output,
  parseStrictInt,
  printJson,
  validateWithSchema,
} from '../utils.js';

interface LinkOpts {
  saleOrderId?: string;
  version?: string;
  dryRun?: boolean;
}
interface AddMemberOpts {
  employeeId?: string;
  userName?: string;
  role?: string;
  dryRun?: boolean;
}

interface VersionedDeleteOpts {
  version: string;
  dryRun?: boolean;
}

function parseVersion(value: string): number {
  const version = parseStrictInt(value, '--version');
  if (version < 1) fatal('Invalid --version', 'Expected a positive integer (>= 1)');
  return version;
}

/** projects.controller.linkSaleOrder 的响应（serializeEntity 出来的不规则 snapshot） */
interface LinkSaleOrderResult {
  id: string;
  saleOrderId: string;
  orderTitle: string | null;
  orderAmount: number | null;
}

export function registerProjectsExtras(projectsCmd: Command): void {
  const program = projectsCmd.parent;

  // ── link-sale-order ────────────────────────────────────────────────
  projectsCmd
    .command('link-sale-order <projectId>')
    .description('挂接销售订单到项目（POST /projects/:id/sale-orders）')
    .option('--sale-order-id <uuid>', '销售订单 ID（必填）')
    .requiredOption('--version <n>', '当前项目 version（必填，先 projects get <id> 读取）')
    .option('--dry-run', '只打印 POST 请求体，不实际发起')
    .action(async (projectId: string, opts: LinkOpts) => {
      if (!opts.saleOrderId) fatal('Missing --sale-order-id');
      // 用 shared schema 校验 UUID，避免维护手写正则二源
      const body = validateWithSchema(
        linkSaleOrderSchema,
        { saleOrderId: opts.saleOrderId, version: parseVersion(opts.version!) },
        'link-sale-order body'
      );
      const path = `/projects/${encodeUuidPathId(projectId, 'projectId')}/sale-orders`;
      if (opts.dryRun) {
        printJson({ method: 'POST', path, body });
        return;
      }
      const format = (program?.opts()['format'] as string | undefined) ?? 'json';
      const result = await request<LinkSaleOrderResult>(
        'POST',
        path,
        body as Record<string, unknown>
      );
      output(result, format);
    });

  // ── unlink-sale-order ──────────────────────────────────────────────
  projectsCmd
    .command('unlink-sale-order <projectId> <saleOrderId>')
    .description('解除项目与销售订单的关联（DELETE /projects/:id/sale-orders/:saleOrderId）')
    .requiredOption('--version <n>', '当前项目 version（必填，先 projects get <id> 读取）')
    .option('--dry-run', '只打印请求路径，不实际发起')
    .action(async (projectId: string, saleOrderId: string, opts: VersionedDeleteOpts) => {
      const path = `/projects/${encodeUuidPathId(projectId, 'projectId')}/sale-orders/${encodeUuidPathId(saleOrderId, 'saleOrderId')}`;
      const query = { version: parseVersion(opts.version) };
      if (opts.dryRun) {
        printJson({ method: 'DELETE', path, query });
        return;
      }
      const format = (program?.opts()['format'] as string | undefined) ?? 'json';
      const result = await request<{ success: boolean }>('DELETE', path, undefined, query);
      output(result, format);
    });

  // ── add-member ─────────────────────────────────────────────────────
  projectsCmd
    .command('add-member <projectId>')
    .description('添加项目成员（POST /projects/:id/members）')
    .option('--employee-id <id>', '员工 ID（必填）')
    .option('--user-name <name>', '展示用名（可选；不传则后端按 employeeId 反查）')
    .option('--role <role>', '成员角色（可选自由文本）')
    .option('--dry-run', '只打印 POST 请求体，不实际发起')
    .action(async (projectId: string, opts: AddMemberOpts) => {
      if (!opts.employeeId) fatal('Missing --employee-id');
      const rawBody: Record<string, unknown> = { employeeId: opts.employeeId };
      if (opts.userName !== undefined) rawBody['userName'] = opts.userName;
      if (opts.role !== undefined) rawBody['role'] = opts.role;
      // shared schema 兜底（含 employeeId 格式 + 可选字段长度等约束）
      const body = validateWithSchema(addProjectMemberSchema, rawBody, 'add-member body');
      const path = `/projects/${encodeUuidPathId(projectId, 'projectId')}/members`;
      if (opts.dryRun) {
        printJson({ method: 'POST', path, body });
        return;
      }
      const format = (program?.opts()['format'] as string | undefined) ?? 'json';
      const result = await request<ProjectMemberOutput>(
        'POST',
        path,
        body as Record<string, unknown>
      );
      output(result, format);
    });

  // ── remove-member ──────────────────────────────────────────────────
  projectsCmd
    .command('remove-member <projectId> <memberId>')
    .description('移除项目成员（DELETE /projects/:id/members/:memberId）')
    .requiredOption('--version <n>', '当前项目成员 version（必填，先 list-members 读取）')
    .option('--dry-run', '只打印请求路径，不实际发起')
    .action(async (projectId: string, memberId: string, opts: VersionedDeleteOpts) => {
      const path = `/projects/${encodeUuidPathId(projectId, 'projectId')}/members/${encodeUuidPathId(memberId, 'memberId')}`;
      const query = { version: parseVersion(opts.version) };
      if (opts.dryRun) {
        printJson({ method: 'DELETE', path, query });
        return;
      }
      const format = (program?.opts()['format'] as string | undefined) ?? 'json';
      const result = await request<{ success: boolean }>('DELETE', path, undefined, query);
      output(result, format);
    });

  // ── list-members ───────────────────────────────────────────────────
  // 只读列表，无 dry-run（不会产生副作用）。
  projectsCmd
    .command('list-members <projectId>')
    .description('查询项目成员列表（GET /projects/:id/members）')
    .action(async (projectId: string) => {
      const format = (program?.opts()['format'] as string | undefined) ?? 'json';
      const path = `/projects/${encodeUuidPathId(projectId, 'projectId')}/members`;
      const result = await request<ProjectMemberOutput[]>('GET', path);
      output(result, format);
    });
}
