import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn() },
}));

import {
  buildSortingStorageKey,
  loadPersistedSorting,
  SORTING_STORAGE_VERSION,
  writePersistedSorting,
} from '../use-server-pagination';

describe('use-server-pagination sorting persistence helpers', () => {
  beforeEach(() => {
    window.history.pushState(null, '', '/customers');
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('buildSortingStorageKey 使用 pathname 和 storageId 隔离列表视图', () => {
    expect(buildSortingStorageKey()).toBe('server-pagination-sorting:/customers');
    expect(buildSortingStorageKey('mine')).toBe('server-pagination-sorting:/customers:mine');
  });

  it('write/load 往返合法排序配置', () => {
    writePersistedSorting(
      {
        v: SORTING_STORAGE_VERSION,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        appliedServerVersion: 2,
      },
      'mine'
    );

    expect(loadPersistedSorting('mine')).toEqual({
      v: SORTING_STORAGE_VERSION,
      sortBy: 'createdAt',
      sortOrder: 'desc',
      appliedServerVersion: 2,
    });
  });

  it('load 忽略版本不匹配、非法 JSON 和非法排序方向', () => {
    localStorage.setItem(buildSortingStorageKey('old'), JSON.stringify({ v: 0, sortBy: 'name' }));
    expect(loadPersistedSorting('old')).toBeNull();

    localStorage.setItem(buildSortingStorageKey('bad-json'), '{');
    expect(loadPersistedSorting('bad-json')).toBeNull();

    localStorage.setItem(
      buildSortingStorageKey('partial'),
      JSON.stringify({ v: SORTING_STORAGE_VERSION, sortBy: 123, sortOrder: 'sideways' })
    );
    expect(loadPersistedSorting('partial')).toEqual({
      v: SORTING_STORAGE_VERSION,
      sortBy: undefined,
      sortOrder: undefined,
      appliedServerVersion: 0,
    });
  });

  it('write 在 localStorage 异常时静默忽略，避免阻断页面', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    expect(() =>
      writePersistedSorting({ v: SORTING_STORAGE_VERSION, appliedServerVersion: 0 }, 'quota')
    ).not.toThrow();

    expect(spy).toHaveBeenCalled();
  });
});
