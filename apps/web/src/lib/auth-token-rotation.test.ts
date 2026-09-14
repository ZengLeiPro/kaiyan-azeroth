import { describe, expect, it, vi } from 'vitest';

import { serializeTokenRotation } from './auth-token-rotation';

describe('serializeTokenRotation', () => {
  it('所有 refresh/reauth 操作严格串行执行', async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const events: string[] = [];

    const first = serializeTokenRotation(async () => {
      events.push('first:start');
      await firstGate;
      events.push('first:end');
      return 'first';
    });
    const secondOperation = vi.fn(async () => {
      events.push('second:start');
      return 'second';
    });
    const second = serializeTokenRotation(secondOperation);

    await Promise.resolve();
    expect(secondOperation).not.toHaveBeenCalled();
    releaseFirst();

    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second']);
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('前一个轮换失败不会阻断后续轮换', async () => {
    const first = serializeTokenRotation(async () => {
      throw new Error('refresh failed');
    });
    const second = serializeTokenRotation(async () => 'reauth succeeded');

    await expect(first).rejects.toThrow('refresh failed');
    await expect(second).resolves.toBe('reauth succeeded');
  });

  it('通过 Web Locks 跨标签页互斥，并在取得锁后先同步持久化代际', async () => {
    const events: string[] = [];
    const request = vi.fn(
      async (_name: string, _options: LockOptions, callback: () => Promise<string>) => {
        events.push('lock');
        return callback();
      }
    );
    const originalLocks = navigator.locks;
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: { request },
    });

    try {
      await expect(
        serializeTokenRotation(
          async () => {
            events.push('operation');
            return 'done';
          },
          async () => {
            events.push('rehydrate');
          }
        )
      ).resolves.toBe('done');
      expect(request).toHaveBeenCalledWith(
        'ky-azeroth-auth-token-rotation',
        { mode: 'exclusive' },
        expect.any(Function)
      );
      expect(events).toEqual(['lock', 'rehydrate', 'operation']);
    } finally {
      Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: originalLocks,
      });
    }
  });
});
