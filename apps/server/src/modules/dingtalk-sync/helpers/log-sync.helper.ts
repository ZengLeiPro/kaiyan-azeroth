import { PrismaClient } from '@prisma/client';

import { DingtalkLogRaw, LogsApi } from '../dingtalk/logs';
import { runIncrementalWindow, type SyncResult } from './sync-state.helper';

export type LogsSyncOptions = {
  /** 时间窗口回溯天数（默认 30） */
  lookbackDays: number;
  /** 增量重叠小时数（默认 6） */
  overlapHours: number;
};

/** UUID v4-ish 形如 8-4-4-4-12 hex，宽松匹配（不校验 version 位） */
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type EmployeeLite = Pick<{ id: string; dingtalkUserId: string | null }, 'id' | 'dingtalkUserId'>;

type PrismaLike = {
  employee: {
    findMany: (args: {
      where: { dingtalkUserId: { in: string[] } };
      select: { id: true; dingtalkUserId: true };
    }) => Promise<EmployeeLite[]>;
  };
};

/**
 * 把钉钉日志原始 creator_id（数字钉钉 userId 或已映射 UUID）
 * 归一为 Employee.id（UUID）的映射表。
 *
 * SYS-CREATOR fix：dingtalk-sync 历史只写数字 ID，下游 JOIN 报表
 * 无法关联员工。新流程在批处理前一次性查 employee.dingtalkUserId in
 * (本批所有 raw creatorId)，得到 raw -> employeeId Map。已是 UUID 的 raw
 * 不查（短路保留），未命中映射的 raw 也保留并由调用方 warn。
 */
export async function resolveCreatorIdMap(
  prisma: PrismaLike,
  rawCreatorIds: Iterable<string | null | undefined>
): Promise<Map<string, string>> {
  const nonUuidNumericIds = new Set<string>();
  for (const raw of rawCreatorIds) {
    if (!raw) continue;
    if (UUID_LIKE.test(raw)) continue;
    nonUuidNumericIds.add(raw);
  }
  if (nonUuidNumericIds.size === 0) return new Map();

  const employees = await prisma.employee.findMany({
    where: { dingtalkUserId: { in: Array.from(nonUuidNumericIds) } },
    select: { id: true, dingtalkUserId: true },
  });

  const map = new Map<string, string>();
  for (const emp of employees) {
    if (emp.dingtalkUserId) {
      map.set(emp.dingtalkUserId, emp.id);
    }
  }
  return map;
}

/**
 * 将 raw creatorId 归一为 employee.id（UUID）。
 * - 已是 UUID：原样返回（短路）
 * - 数字 ID 命中映射：返回 employee.id
 * - 数字 ID 未命中：保留原值，console.warn 提示
 */
export function normalizeCreatorId(
  raw: string | null | undefined,
  uuidMap: Map<string, string>
): string | null {
  if (!raw) return null;
  if (UUID_LIKE.test(raw)) return raw;
  const mapped = uuidMap.get(raw);
  if (mapped) return mapped;
  console.warn(
    `[syncLogs] dingtalk creatorId=${raw} 未在 employee.dingtalkUserId 中命中，保留原值`
  );
  return raw;
}

/**
 * 同步钉钉工作日志
 *
 * 与 apps/dingtalk-sync/src/sync/log-sync.ts 的主要差异：
 * - 不再调用钉钉 /department/listsub 拉部门，直接读 server 端 department 表
 *   （字段 dingtalkDeptId，参见 apps/server/prisma/schema.prisma:436-455）
 * - 省一次 OAPI 全量部门递归调用
 *
 * 策略：增量时间窗口，遍历所有部门，按 reportId upsert。
 */
export async function syncLogs(
  prisma: PrismaClient,
  logsApi: LogsApi,
  options: LogsSyncOptions
): Promise<SyncResult> {
  let totalCount = 0;

  // 从本地 department 表取部门 ID 列表
  const departments = await prisma.department.findMany({
    where: {
      dingtalkDeptId: { not: null },
      deletedAt: null,
    },
    select: { dingtalkDeptId: true },
  });

  const deptIds = departments
    .map((d) => d.dingtalkDeptId)
    .filter((v): v is number => Number.isFinite(v));

  console.log(`准备遍历 ${deptIds.length} 个部门获取工作日志（来自本地 department 表）`);

  await runIncrementalWindow(
    prisma,
    'logs',
    options.lookbackDays,
    options.overlapHours,
    async (startMs, endMs) => {
      console.log(
        `日志同步时间窗口: ${new Date(startMs).toISOString()} ~ ${new Date(endMs).toISOString()}`
      );

      const allLogs: DingtalkLogRaw[] = [];
      const seen = new Set<string>();

      for (let i = 0; i < deptIds.length; i++) {
        const deptId = deptIds[i];
        if (deptId === undefined) continue;
        try {
          const logs = await logsApi.getDepartmentLogs(deptId, startMs, endMs);
          for (const log of logs) {
            if (!log.reportId || seen.has(log.reportId)) continue;
            seen.add(log.reportId);
            allLogs.push(log);
          }
        } catch (err) {
          const msg = (err as { message?: string })?.message ?? String(err);
          console.warn(`获取部门(${deptId})日志失败，跳过: ${msg}`);
        }
      }

      console.log(`共获取到 ${allLogs.length} 条去重后的日志`);

      // SYS-CREATOR fix：批处理前一次性构建 dingtalkUserId -> employee.id 映射
      const uuidMap = await resolveCreatorIdMap(
        prisma,
        allLogs.map((l) => l.creatorId)
      );

      for (const log of allLogs) {
        try {
          const existing = await prisma.dingtalkLog.findUnique({
            where: { reportId: log.reportId },
            select: { source: true, isLocallyEdited: true },
          });

          const normalizedCreatorId = normalizeCreatorId(log.creatorId, uuidMap);

          // 同步保护：本地新增记录不应该撞 reportId，仍然跳过保险；
          // 同步过来后被本地编辑过的记录（isLocallyEdited=true）不再覆盖。
          if (existing) {
            if (existing.source === 'local' || existing.isLocallyEdited) {
              continue;
            }
            await prisma.dingtalkLog.update({
              where: { reportId: log.reportId },
              data: {
                templateName: log.templateName || null,
                creatorId: normalizedCreatorId,
                creatorName: log.creatorName || null,
                deptName: log.deptName || null,
                contents: log.contents || null,
                createTime: log.createTime,
                syncedAt: new Date(),
              },
            });
          } else {
            await prisma.dingtalkLog.create({
              data: {
                reportId: log.reportId,
                templateName: log.templateName || null,
                creatorId: normalizedCreatorId,
                creatorName: log.creatorName || null,
                deptName: log.deptName || null,
                contents: log.contents || null,
                createTime: log.createTime,
                syncedAt: new Date(),
                source: 'dingtalk',
                isLocallyEdited: false,
              },
            });
          }
          totalCount++;
        } catch (err: unknown) {
          const msg = (err as { message?: string })?.message ?? String(err);
          console.error(`upsert 日志(${log.reportId})失败: ${msg}`);
        }
      }
    }
  );

  return { entity: 'dingtalk_logs', count: totalCount };
}
