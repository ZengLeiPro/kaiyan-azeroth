import { EventEmitter } from 'node:events';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
  disconnect: vi.fn(),
  queryRaw: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('node:child_process', () => ({ spawn: dependencies.spawn }));
vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function MockPrismaClient() {
    return {
      $disconnect: dependencies.disconnect,
      $queryRaw: dependencies.queryRaw,
    };
  }),
}));

import {
  LEGACY_ADJUSTMENT_BROKEN_MIGRATION,
  probeLegacyAdjustmentMigration,
  runPrismaCommand,
  runProductionMigrations,
} from './migrate-handler';

function createPrismaProcess(
  code: number,
  stdout = '',
  stderr = ''
): EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
} {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  });
  queueMicrotask(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    child.emit('close', code);
  });
  return child;
}

beforeEach(() => {
  vi.clearAllMocks();
  dependencies.disconnect.mockResolvedValue(undefined);
});

describe('runPrismaCommand', () => {
  it('收集 stdout/stderr 并在进程成功时返回', async () => {
    dependencies.spawn.mockReturnValue(createPrismaProcess(0, 'done', 'warning'));
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(runPrismaCommand(['migrate', 'deploy'], { DATABASE_URL: 'db' })).resolves.toEqual({
      stdout: 'done',
      stderr: 'warning',
    });
    expect(dependencies.spawn).toHaveBeenCalledOnce();
    expect(stdout).toHaveBeenCalledWith('done');
    expect(stderr).toHaveBeenCalledWith('warning');
  });

  it('Prisma 进程退出失败时携带命令与 stderr 拒绝', async () => {
    dependencies.spawn.mockReturnValue(createPrismaProcess(1, '', 'migration failed'));
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(runPrismaCommand(['migrate', 'deploy'], { DATABASE_URL: 'db' })).rejects.toThrow(
      'Prisma command failed (1): migrate deploy\nmigration failed'
    );
  });

  it('Prisma 进程启动失败时透传 error', async () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    });
    dependencies.spawn.mockReturnValue(child);
    const promise = runPrismaCommand(['migrate', 'deploy'], { DATABASE_URL: 'db' });
    child.emit('error', new Error('spawn failed'));

    await expect(promise).rejects.toThrow('spawn failed');
  });
});

describe('probeLegacyAdjustmentMigration', () => {
  it('前置表或字段不完整时保持正常 deploy', async () => {
    dependencies.queryRaw.mockResolvedValueOnce([
      { saleOrders: null, prismaMigrations: null, paymentLegacyAdjustment: false },
    ]);

    await expect(probeLegacyAdjustmentMigration('postgresql://test')).resolves.toBe('deploy');
    expect(dependencies.disconnect).toHaveBeenCalledOnce();
  });

  it('迁移已有 finished_at 时保持正常 deploy', async () => {
    dependencies.queryRaw
      .mockResolvedValueOnce([
        {
          saleOrders: 'sale_orders',
          prismaMigrations: '_prisma_migrations',
          paymentLegacyAdjustment: true,
        },
      ])
      .mockResolvedValueOnce([{ finishedAt: new Date('2026-08-29T00:00:00Z') }]);

    await expect(probeLegacyAdjustmentMigration('postgresql://test')).resolves.toBe('deploy');
    expect(dependencies.disconnect).toHaveBeenCalledOnce();
  });

  it('未完成迁移也不按实例指纹 resolve，直接 deploy', async () => {
    dependencies.queryRaw
      .mockResolvedValueOnce([
        {
          saleOrders: 'sale_orders',
          prismaMigrations: '_prisma_migrations',
          paymentLegacyAdjustment: true,
        },
      ])
      .mockResolvedValueOnce([{ finishedAt: null }]);

    await expect(probeLegacyAdjustmentMigration('postgresql://test')).resolves.toBe('deploy');
    expect(dependencies.queryRaw).toHaveBeenCalledTimes(2);
    expect(dependencies.disconnect).toHaveBeenCalledOnce();
  });
});

describe('runProductionMigrations', () => {
  it('正常数据库直接执行 migrate deploy', async () => {
    const runner = vi.fn().mockResolvedValue({ stdout: 'ok', stderr: '' });

    await runProductionMigrations(runner, 'postgresql://test', async () => 'deploy');

    expect(runner).toHaveBeenCalledOnce();
    expect(runner).toHaveBeenCalledWith(
      ['migrate', 'deploy'],
      expect.objectContaining({ DATABASE_URL: 'postgresql://test' })
    );
  });

  it('恢复库仅在精确指纹探针确认后先 resolve 已知错误迁移', async () => {
    const runner = vi.fn().mockResolvedValue({ stdout: 'ok', stderr: '' });

    await runProductionMigrations(runner, 'postgresql://restore', async () => 'resolve-broken');

    expect(runner.mock.calls.map(([args]) => args)).toEqual([
      ['migrate', 'resolve', '--applied', LEGACY_ADJUSTMENT_BROKEN_MIGRATION],
      ['migrate', 'deploy'],
    ]);
  });

  it('缺少 DATABASE_URL 时不调用探针或迁移', async () => {
    const runner = vi.fn();
    const probe = vi.fn();

    await expect(runProductionMigrations(runner, '', probe)).rejects.toThrow('DATABASE_URL 未配置');
    expect(probe).not.toHaveBeenCalled();
    expect(runner).not.toHaveBeenCalled();
  });
});
