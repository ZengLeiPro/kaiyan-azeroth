/**
 * azeroth operation-logs —— 操作日志/登录日志子命令组（追挂模式）
 *
 * 设计说明：
 *   - 后端在一个 module 里挂了 2 个 controller：
 *     - OperationLogsController → GET /operation-logs
 *     - LoginLogsController     → GET /login-logs
 *   - 但 shared 把它们都归到 OperationLog/LoginLog 两个只读两件组（query +
 *     response）。CLI 的 entity discovery 默认会把 OperationLog 注册成
 *     `operation-logs list/get`，LoginLog 命名映射到 `login-logs list/get`
 *     —— 但 server 端 `:id` 路由根本不存在，造成 doctor 报告里的"幽灵 get"。
 *   - 修法：在 registry 的 SUPPORTED_OPERATIONS_OVERRIDES 把 OperationLog
 *     和 LoginLog 都收窄到 `['list']`，CLI 自动注册的 get 子命令就被屏蔽。
 *   - 本文件不暴露任何新写动作（日志是只读 append-only），仅追挂一个
 *     `login-logs` 子命令到 operation-logs 命令组下，作为查 login-logs 的
 *     桥接（避免新建一个独立的 login-logs CLI 实体——它和 OperationLog
 *     同模块、同权限、语义相近）。
 *
 * 权限矩阵：
 *   - server 改动后两个 endpoint 均挂 `system/operation_logs/view`（详见
 *     operation-logs.controller.ts 注释）。
 */

import type { LoginLogResponse } from '@ky-azeroth/shared';
import { Command } from 'commander';

import { request } from '../client.js';
import { encodeUuidPathId, fatal, output, parseIsoInstant, parsePositiveInt } from '../utils.js';

interface LoginLogListResponse {
  items: LoginLogResponse[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function registerOperationLogsExtras(operationLogsCmd: Command): void {
  const program = operationLogsCmd.parent;
  const getFormat = (): string => (program?.opts()['format'] as string | undefined) ?? 'json';

  // ── login-logs ────────────────────────────────────────────────────
  // 桥接 LoginLogsController（GET /login-logs），分页参数全转发。
  // 为什么挂在 operation-logs 而不是独立顶级命令：同模块同权限，UI 菜单也是
  // "操作日志/登录日志"二级；CLI 上保持 `operation-logs login-logs --page=1`
  // 的层次比 `login-logs list` 更易发现。
  operationLogsCmd
    .command('login-logs')
    .description('查询登录日志（GET /login-logs，权限 system/operation_logs/view）')
    .option('--page <n>', '页码')
    .option('--page-size <n>', '每页条数')
    .option('--employee-id <id>', '员工 ID 过滤')
    .option('--username <name>', '用户名过滤')
    .option('--start-time <iso>', '起始时间 YYYY-MM-DDTHH:mm:ssZ')
    .option('--end-time <iso>', '结束时间 YYYY-MM-DDTHH:mm:ssZ')
    .option('--success', '仅返回成功登录')
    .action(
      async (opts: {
        page?: string;
        pageSize?: string;
        employeeId?: string;
        username?: string;
        startTime?: string;
        endTime?: string;
        success?: boolean;
      }) => {
        const params: Record<string, unknown> = {};
        if (opts.page) params['page'] = parsePositiveInt(opts.page, '--page');
        if (opts.pageSize) params['pageSize'] = parsePositiveInt(opts.pageSize, '--page-size');
        if (opts.employeeId) {
          encodeUuidPathId(opts.employeeId, 'employeeId');
          params['employeeId'] = opts.employeeId;
        }
        if (opts.username) params['username'] = opts.username;
        const startTime = opts.startTime
          ? parseIsoInstant(opts.startTime, '--start-time')
          : undefined;
        const endTime = opts.endTime ? parseIsoInstant(opts.endTime, '--end-time') : undefined;
        if (startTime && endTime && startTime > endTime) {
          fatal('Invalid login-log time range', '--start-time must not be after --end-time');
        }
        if (startTime) params['startTime'] = startTime;
        if (endTime) params['endTime'] = endTime;
        if (opts.success !== undefined) params['success'] = opts.success;
        const result = await request<LoginLogListResponse>('GET', '/login-logs', undefined, params);
        output(result, getFormat());
      }
    );
}
