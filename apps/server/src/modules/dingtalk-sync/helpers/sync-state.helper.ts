import { PrismaClient } from '@prisma/client';

import { clampDays } from '../utils';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 增量同步状态读写 + 时间窗口算法
 *
 * 迁移自 apps/dingtalk-sync/src/sync/sync-engine.ts:31-109，逻辑不变。
 * 状态存于 sync_states 表（apps/server/prisma/schema.prisma:1639-1649），
 * server 端 PrismaClient 直接可操作。
 */

export type SyncResult = {
  entity: string;
  count: number;
};

/** 读取增量同步状态 */
export async function getSyncState(
  prisma: PrismaClient,
  source: string,
  entityName: string,
  stateKey: string = 'default'
): Promise<Record<string, unknown> | null> {
  const state = await prisma.syncState.findUnique({
    where: {
      source_entityName_stateKey: { source, entityName, stateKey },
    },
  });
  if (!state) return null;
  try {
    return JSON.parse(state.stateValue) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 更新增量同步状态 */
export async function setSyncState(
  prisma: PrismaClient,
  source: string,
  entityName: string,
  stateValue: Record<string, unknown>,
  stateKey: string = 'default'
): Promise<void> {
  await prisma.syncState.upsert({
    where: {
      source_entityName_stateKey: { source, entityName, stateKey },
    },
    create: {
      source,
      entityName,
      stateKey,
      stateValue: JSON.stringify(stateValue),
    },
    update: {
      stateValue: JSON.stringify(stateValue),
    },
  });
}

/**
 * 运行增量同步窗口
 * 根据上次同步结束时间计算本次同步的时间窗口
 */
export async function runIncrementalWindow(
  prisma: PrismaClient,
  entityName: string,
  lookbackDays: number,
  overlapHours: number,
  runner: (startMs: number, endMs: number) => Promise<void>
): Promise<void> {
  const state = await getSyncState(prisma, 'dingtalk', entityName);
  const nowMs = Date.now();

  const lbDays = clampDays(lookbackDays, 1, 730);
  const overlapMs = Math.max(0, overlapHours) * 3600 * 1000;

  const lastEndMs = Number(state?.last_end_ms ?? 0);
  const defaultStart = nowMs - lbDays * DAY_MS;
  const startMs =
    Number.isFinite(lastEndMs) && lastEndMs > 0
      ? Math.max(defaultStart, Math.min(nowMs, lastEndMs - overlapMs))
      : defaultStart;

  const endMs = nowMs;

  await runner(startMs, endMs);

  await setSyncState(prisma, 'dingtalk', entityName, {
    last_start_ms: startMs,
    last_end_ms: endMs,
    updated_at: nowMs,
  });
}
