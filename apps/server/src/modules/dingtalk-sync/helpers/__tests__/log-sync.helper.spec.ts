import { afterEach, describe, expect, it, vi } from 'vitest';

import { normalizeCreatorId, resolveCreatorIdMap } from '../log-sync.helper';

describe('resolveCreatorIdMap (SYS-CREATOR fix)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('全部已是 UUID：不查 DB，返回空 Map', async () => {
    const findMany = vi.fn();
    const prisma = { employee: { findMany } } as never;

    const map = await resolveCreatorIdMap(prisma, [
      '11111111-2222-3333-4444-555555555555',
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    ]);

    expect(map.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('数字 ID 命中 employee.dingtalkUserId：返回映射', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 'emp-uuid-1', dingtalkUserId: '12345' },
      { id: 'emp-uuid-2', dingtalkUserId: '67890' },
    ]);
    const prisma = { employee: { findMany } } as never;

    const map = await resolveCreatorIdMap(prisma, ['12345', '67890', '12345']);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      where: { dingtalkUserId: { in: expect.arrayContaining(['12345', '67890']) } },
      select: { id: true, dingtalkUserId: true },
    });
    expect(map.get('12345')).toBe('emp-uuid-1');
    expect(map.get('67890')).toBe('emp-uuid-2');
  });

  it('数字 ID 未命中：Map 不含该 raw（调用方保留原值）', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { employee: { findMany } } as never;

    const map = await resolveCreatorIdMap(prisma, ['999']);

    expect(map.has('999')).toBe(false);
  });

  it('混合 UUID + 数字 ID：仅数字 ID 查 DB', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'emp-uuid-1', dingtalkUserId: '12345' }]);
    const prisma = { employee: { findMany } } as never;

    const map = await resolveCreatorIdMap(prisma, [
      '11111111-2222-3333-4444-555555555555',
      '12345',
    ]);

    expect(findMany).toHaveBeenCalledWith({
      where: { dingtalkUserId: { in: ['12345'] } },
      select: { id: true, dingtalkUserId: true },
    });
    expect(map.get('12345')).toBe('emp-uuid-1');
    expect(map.has('11111111-2222-3333-4444-555555555555')).toBe(false);
  });
});

describe('normalizeCreatorId (SYS-CREATOR fix)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('UUID 短路保留', () => {
    const map = new Map<string, string>();
    expect(normalizeCreatorId('11111111-2222-3333-4444-555555555555', map)).toBe(
      '11111111-2222-3333-4444-555555555555'
    );
  });

  it('数字 ID 命中映射：返回 employee.id', () => {
    const map = new Map<string, string>([['12345', 'emp-uuid-1']]);
    expect(normalizeCreatorId('12345', map)).toBe('emp-uuid-1');
  });

  it('数字 ID 未命中：保留原值并 console.warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const map = new Map<string, string>();

    expect(normalizeCreatorId('999', map)).toBe('999');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('999');
  });

  it('null/空串：返回 null（避免空字符串入库）', () => {
    const map = new Map<string, string>();
    expect(normalizeCreatorId(null, map)).toBeNull();
    expect(normalizeCreatorId(undefined, map)).toBeNull();
    expect(normalizeCreatorId('', map)).toBeNull();
  });
});
