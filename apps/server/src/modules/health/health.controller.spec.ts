import { ServiceUnavailableException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../common/prisma/prisma.service';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  afterEach(() => {
    delete process.env.RELEASE_SHA;
  });

  it('liveness 返回构建注入的 release SHA', () => {
    process.env.RELEASE_SHA = 'abc123';
    const controller = new HealthController({} as PrismaService);

    expect(controller.check()).toEqual(
      expect.objectContaining({ status: 'ok', releaseSha: 'abc123' })
    );
  });

  it('数据库可用且不存在未完成迁移时才 ready', async () => {
    process.env.RELEASE_SHA = 'abc123';
    const prisma = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ '?column?': 1 }])
        .mockResolvedValueOnce([{ count: 0n }]),
    };
    const controller = new HealthController(prisma as unknown as PrismaService);

    await expect(controller.ready()).resolves.toEqual(
      expect.objectContaining({ status: 'ready', releaseSha: 'abc123' })
    );
  });

  it('数据库异常或迁移未完成时返回 503', async () => {
    const prisma = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ '?column?': 1 }])
        .mockResolvedValueOnce([{ count: 1n }]),
    };
    const controller = new HealthController(prisma as unknown as PrismaService);

    await expect(controller.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
