import { BadRequestException, ConflictException, HttpException } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'zlib';

import { InternalController } from './internal.controller';

const TOKEN = 'test-internal-operation-token';
const CONFIRM = 'FINANCE_IMPORT_DINGTALK_PREPARED_COMMIT';

function encodedPayload(workbookId = 'workbook-1'): string {
  return gzipSync(
    Buffer.from(
      JSON.stringify({
        workbookId,
        years: [2026],
        rows: [],
        openingBalances: { '2026': 0 },
        reconciliation: {
          passed: true,
          balanceDiffCount: 0,
          pnlDiffCount: 0,
        },
      })
    )
  ).toString('base64');
}

describe('InternalController', () => {
  const config = {
    get: vi.fn((key: string) => (key === 'MIGRATION_TOKEN' ? TOKEN : undefined)),
  };
  const prisma = {
    internalOperationExecution: {
      create: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  const financeImportService = {
    commitPreparedDingtalkImport: vi.fn(),
  };
  let controller: InternalController;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.internalOperationExecution.create.mockResolvedValue({ id: 'execution-1' });
    prisma.internalOperationExecution.update.mockResolvedValue({});
    prisma.internalOperationExecution.updateMany.mockResolvedValue({ count: 0 });
    financeImportService.commitPreparedDingtalkImport.mockResolvedValue({
      batchId: 'batch-1',
      status: 'committed',
      successRows: 2,
    });
    controller = new InternalController(
      config as never,
      prisma as never,
      financeImportService as never
    );
  });

  it('常驻 internal HTTP 面只保留 prepared finance import', () => {
    const prototype = InternalController.prototype as unknown as Record<string, unknown>;
    const routes = Object.getOwnPropertyNames(prototype)
      .filter((name) => Reflect.hasMetadata(METHOD_METADATA, prototype[name] as object))
      .map((name) => Reflect.getMetadata(PATH_METADATA, prototype[name] as object));

    expect(routes).toEqual(['finance-import-dingtalk-prepared-commit']);
  });

  it('要求运维令牌、动作级确认和幂等键', async () => {
    await expect(
      controller.commitPreparedDingtalkImport(undefined, 'finance-import-1', {
        confirm: CONFIRM,
        payloadGzipBase64: encodedPayload(),
      })
    ).rejects.toBeInstanceOf(HttpException);

    await expect(
      controller.commitPreparedDingtalkImport(TOKEN, 'finance-import-1', {
        confirm: 'YES',
        payloadGzipBase64: encodedPayload(),
      })
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      controller.commitPreparedDingtalkImport(TOKEN, 'short', {
        confirm: CONFIRM,
        payloadGzipBase64: encodedPayload(),
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('首次执行先原子登记，成功后固化结果', async () => {
    const result = await controller.commitPreparedDingtalkImport(TOKEN, 'finance-import-100', {
      confirm: CONFIRM,
      payloadGzipBase64: encodedPayload(),
    });

    expect(result).toMatchObject({
      success: true,
      idempotencyKey: 'finance-import-100',
      replayed: false,
      result: { batchId: 'batch-1' },
    });
    expect(prisma.internalOperationExecution.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        operation: 'finance-import-dingtalk-prepared-commit',
        idempotencyKey: 'finance-import-100',
        status: 'running',
        requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      select: { id: true },
    });
    expect(prisma.internalOperationExecution.update).toHaveBeenCalledWith({
      where: { id: 'execution-1' },
      data: expect.objectContaining({
        status: 'succeeded',
        resultJson: expect.objectContaining({ batchId: 'batch-1' }),
      }),
    });
  });

  it('相同幂等键和 payload 直接返回已成功结果', async () => {
    prisma.internalOperationExecution.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '6.19.2',
      })
    );
    const payload = encodedPayload();
    const requestHash = await import('crypto').then(({ createHash }) =>
      createHash('sha256').update(Buffer.from(payload, 'base64')).digest('hex')
    );
    prisma.internalOperationExecution.findUniqueOrThrow.mockResolvedValue({
      id: 'execution-old',
      requestHash,
      status: 'succeeded',
      resultJson: { batchId: 'batch-old', status: 'committed' },
    });

    const result = await controller.commitPreparedDingtalkImport(TOKEN, 'finance-import-100', {
      confirm: CONFIRM,
      payloadGzipBase64: payload,
    });

    expect(result.replayed).toBe(true);
    expect(result.result).toMatchObject({ batchId: 'batch-old' });
    expect(financeImportService.commitPreparedDingtalkImport).not.toHaveBeenCalled();
  });

  it('同一幂等键不能换 payload，运行中任务也不能并发重放', async () => {
    prisma.internalOperationExecution.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '6.19.2',
      })
    );
    prisma.internalOperationExecution.findUniqueOrThrow.mockResolvedValue({
      id: 'execution-old',
      requestHash: 'different-hash',
      status: 'succeeded',
      resultJson: {},
    });
    await expect(
      controller.commitPreparedDingtalkImport(TOKEN, 'finance-import-100', {
        confirm: CONFIRM,
        payloadGzipBase64: encodedPayload(),
      })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('允许相同 payload 重领失败任务，但并发重领只成功一次', async () => {
    prisma.internalOperationExecution.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '6.19.2',
      })
    );
    const payload = encodedPayload();
    const requestHash = await import('crypto').then(({ createHash }) =>
      createHash('sha256').update(Buffer.from(payload, 'base64')).digest('hex')
    );
    prisma.internalOperationExecution.findUniqueOrThrow.mockResolvedValue({
      id: 'execution-failed',
      requestHash,
      status: 'failed',
      resultJson: null,
      updatedAt: new Date(),
    });
    prisma.internalOperationExecution.updateMany.mockResolvedValueOnce({ count: 1 });

    const result = await controller.commitPreparedDingtalkImport(TOKEN, 'finance-import-100', {
      confirm: CONFIRM,
      payloadGzipBase64: payload,
    });

    expect(result.replayed).toBe(false);
    expect(prisma.internalOperationExecution.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'execution-failed',
        requestHash,
      }),
      data: {
        status: 'running',
        errorMessage: null,
        finishedAt: null,
      },
    });
  });

  it('允许重领超过十五分钟仍为 running 的中断任务', async () => {
    prisma.internalOperationExecution.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '6.19.2',
      })
    );
    const payload = encodedPayload();
    const requestHash = await import('crypto').then(({ createHash }) =>
      createHash('sha256').update(Buffer.from(payload, 'base64')).digest('hex')
    );
    prisma.internalOperationExecution.findUniqueOrThrow.mockResolvedValue({
      id: 'execution-stale',
      requestHash,
      status: 'running',
      resultJson: null,
      updatedAt: new Date(Date.now() - 16 * 60 * 1000),
    });
    prisma.internalOperationExecution.updateMany.mockResolvedValueOnce({ count: 1 });

    const result = await controller.commitPreparedDingtalkImport(TOKEN, 'finance-import-100', {
      confirm: CONFIRM,
      payloadGzipBase64: payload,
    });

    expect(result.replayed).toBe(false);
  });

  it('业务失败写入失败状态，并隐藏内部堆栈', async () => {
    financeImportService.commitPreparedDingtalkImport.mockRejectedValue(
      new Error('database password should not leak')
    );

    await expect(
      controller.commitPreparedDingtalkImport(TOKEN, 'finance-import-100', {
        confirm: CONFIRM,
        payloadGzipBase64: encodedPayload(),
      })
    ).rejects.toMatchObject({
      status: 500,
      response: '内部财务导入失败',
    });
    expect(prisma.internalOperationExecution.update).toHaveBeenCalledWith({
      where: { id: 'execution-1' },
      data: expect.objectContaining({
        status: 'failed',
        errorMessage: 'database password should not leak',
      }),
    });
  });
});
