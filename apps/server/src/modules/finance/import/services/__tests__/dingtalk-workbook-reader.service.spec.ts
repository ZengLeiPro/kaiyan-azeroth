// eslint-disable-next-line no-restricted-imports -- 测试需要 mock spawn，生产调用仍在 service 内封装
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DingtalkWorkbookReaderService } from '../dingtalk-workbook-reader.service';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

type MockChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

function makeRows(count: number): string[][] {
  return Array.from({ length: count }, (_, i) => [`row-${i + 1}`]);
}

function makeChildProcess(params: { stdout?: string; stderr?: string; code: number }): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();

  setImmediate(() => {
    if (params.stdout) child.stdout.emit('data', Buffer.from(params.stdout));
    if (params.stderr) child.stderr.emit('data', Buffer.from(params.stderr));
    child.emit('close', params.code);
  });

  return child;
}

describe('DingtalkWorkbookReaderService', () => {
  const spawnMock = vi.mocked(spawn);
  const originalRetryDelay = process.env.DWS_RANGE_RETRY_DELAY_MS;

  beforeEach(() => {
    spawnMock.mockReset();
    process.env.DWS_RANGE_RETRY_DELAY_MS = '0';
  });

  afterEach(() => {
    process.env.DWS_RANGE_RETRY_DELAY_MS = originalRetryDelay;
    vi.restoreAllMocks();
  });

  it('readRange 遇到钉钉 HSF 超时会重试', async () => {
    spawnMock
      .mockReturnValueOnce(
        makeChildProcess({
          code: 1,
          stderr: JSON.stringify({
            error: {
              message: 'HSFTimeOutException-HSF-0002',
            },
          }),
        }) as unknown as ReturnType<typeof spawn>
      )
      .mockReturnValueOnce(
        makeChildProcess({
          code: 0,
          stdout: JSON.stringify({ success: true, displayValues: [['A', 'B']] }),
        }) as unknown as ReturnType<typeof spawn>
      );

    const service = new DingtalkWorkbookReaderService();

    await expect(service.readRange('workbook-1', 'sheet-1', 'A1:E25')).resolves.toEqual([
      ['A', 'B'],
    ]);
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it('readRangeBatched 默认按 25 行切分', async () => {
    const service = new DingtalkWorkbookReaderService();
    const readSpy = vi.spyOn(service, 'readRange').mockResolvedValue(makeRows(25));

    const rows = await service.readRangeBatched('workbook-1', 'sheet-1', 'A:E', 50);

    expect(rows).toHaveLength(50);
    expect(readSpy).toHaveBeenNthCalledWith(1, 'workbook-1', 'sheet-1', 'A1:E25');
    expect(readSpy).toHaveBeenNthCalledWith(2, 'workbook-1', 'sheet-1', 'A26:E50');
  });
});
