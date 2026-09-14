/**
 * azeroth departments —— 组织树/成员/管理员子命令组（追挂模式）
 *
 * 设计说明：
 *   - departments 的 list/get/create/update/delete 已由 entity 自动 CRUD 注册。
 *     本文件追挂 6 条非标 endpoint：
 *     - GET    /departments/tree                          组织树
 *     - GET    /departments/:id/children                  直接子部门
 *     - GET    /departments/:id/employees                 部门成员列表（分页）
 *     - PUT    /departments/:id/managers                  设置部门管理员（含 version 乐观锁）
 *     - POST   /departments/:id/employees                 添加员工到部门
 *     - DELETE /departments/:id/employees/:employeeId     从部门移除员工
 *   - GET /departments/all（前端 selection 下拉用，本次按 2026-06-13
 *     决策"先不做"，跳过——不挂 list-all extras）。
 *   - body 字段由 shared 的 setDepartmentManagersSchema / addEmployeeToDepartmentSchema
 *     双源同步校验；扁平 flag 组装后用 validateWithSchema 兜底，避免 dry-run
 *     与 server 校验语义漂移。
 */

import {
  addEmployeeToDepartmentSchema,
  type DepartmentResponseOutput,
  type IDepartmentResponse,
  type IDepartmentTreeNode,
  setDepartmentManagersSchema,
} from '@ky-azeroth/shared';
import { Command } from 'commander';

import { request } from '../client.js';
import {
  encodeUuidPathId,
  fatal,
  output,
  parsePositiveInt,
  printJson,
  validateWithSchema,
} from '../utils.js';

export function registerDepartmentsExtras(departmentsCmd: Command): void {
  const program = departmentsCmd.parent;
  const getFormat = (): string => (program?.opts()['format'] as string | undefined) ?? 'json';

  // ── tree ──────────────────────────────────────────────────────────
  departmentsCmd
    .command('tree')
    .description('查询完整组织树（GET /departments/tree）')
    .action(async () => {
      const result = await request<IDepartmentTreeNode[]>('GET', '/departments/tree');
      output(result, getFormat());
    });

  // ── children ──────────────────────────────────────────────────────
  departmentsCmd
    .command('children <id>')
    .description('查询某部门的直接子部门（GET /departments/:id/children）')
    .action(async (id: string) => {
      const result = await request<DepartmentResponseOutput[]>(
        'GET',
        `/departments/${encodeUuidPathId(id, 'id')}/children`
      );
      output(result, getFormat());
    });

  // ── list-employees ────────────────────────────────────────────────
  departmentsCmd
    .command('list-employees <id>')
    .description('查询某部门的成员列表（GET /departments/:id/employees，分页）')
    .option('--page <n>', '页码（默认 1）')
    .option('--page-size <n>', '每页条数（默认 10）')
    .action(async (id: string, opts: { page?: string; pageSize?: string }) => {
      const params: Record<string, unknown> = {};
      if (opts.page) params['page'] = parsePositiveInt(opts.page, '--page');
      if (opts.pageSize) params['pageSize'] = parsePositiveInt(opts.pageSize, '--page-size');
      const result = await request(
        'GET',
        `/departments/${encodeUuidPathId(id, 'id')}/employees`,
        undefined,
        params
      );
      output(result, getFormat());
    });

  // ── set-managers ──────────────────────────────────────────────────
  // 修改部门管理员（PUT），含 version 乐观锁。schema 字段：managerId + version。
  departmentsCmd
    .command('set-managers <id>')
    .description('设置/修改部门管理员（PUT /departments/:id/managers，含 version 乐观锁）')
    .option('--manager-id <employeeId>', '新管理员的 employeeId（必填，null 表示清空）')
    .option('--version <n>', '当前部门 version（必填，乐观锁，先 `get <id>` 读取）')
    .option('--dry-run', '只打印 PUT 请求体，不实际发起')
    .action(
      async (id: string, opts: { managerId?: string; version?: string; dryRun?: boolean }) => {
        if (opts.managerId === undefined) fatal('Missing --manager-id', '传 "null" 显式清空管理员');
        if (!opts.version) fatal('Missing --version', '乐观锁字段，先 `departments get <id>` 读取');
        const raw: Record<string, unknown> = {
          managerId: opts.managerId === 'null' ? null : opts.managerId,
          version: parsePositiveInt(opts.version, '--version'),
        };
        const body = validateWithSchema(setDepartmentManagersSchema, raw, 'set-managers body');
        const path = `/departments/${encodeUuidPathId(id, 'id')}/managers`;
        if (opts.dryRun) {
          printJson({ method: 'PUT', path, body });
          return;
        }
        const result = await request<IDepartmentResponse>(
          'PUT',
          path,
          body as Record<string, unknown>
        );
        output(result, getFormat());
      }
    );

  // ── add-employee ──────────────────────────────────────────────────
  // POST，body = { employeeId, isPrimary? }
  departmentsCmd
    .command('add-employee <id>')
    .description('添加员工到部门（POST /departments/:id/employees）')
    .option('--employee-id <id>', '员工 employeeId（必填）')
    .option('--is-primary', '设为该员工的主部门（可选）')
    .option('--dry-run', '只打印 POST 请求体，不实际发起')
    .action(
      async (id: string, opts: { employeeId?: string; isPrimary?: boolean; dryRun?: boolean }) => {
        if (!opts.employeeId) fatal('Missing --employee-id');
        const raw: Record<string, unknown> = { employeeId: opts.employeeId };
        if (opts.isPrimary) raw['isPrimary'] = true;
        const body = validateWithSchema(addEmployeeToDepartmentSchema, raw, 'add-employee body');
        const path = `/departments/${encodeUuidPathId(id, 'id')}/employees`;
        if (opts.dryRun) {
          printJson({ method: 'POST', path, body });
          return;
        }
        const result = await request<{ message: string }>(
          'POST',
          path,
          body as Record<string, unknown>
        );
        output(result, getFormat());
      }
    );

  // ── remove-employee ───────────────────────────────────────────────
  // DELETE /departments/:id/employees/:employeeId
  departmentsCmd
    .command('remove-employee <id> <employeeId>')
    .description('从部门移除员工（DELETE /departments/:id/employees/:employeeId）')
    .option('--dry-run', '只打印请求路径，不实际发起')
    .action(async (id: string, employeeId: string, opts: { dryRun?: boolean }) => {
      const path = `/departments/${encodeUuidPathId(id, 'id')}/employees/${encodeUuidPathId(employeeId, 'employeeId')}`;
      if (opts.dryRun) {
        printJson({ method: 'DELETE', path, body: {} });
        return;
      }
      const result = await request<{ message: string }>('DELETE', path);
      output(result, getFormat());
    });
}
