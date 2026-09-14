/**
 * 验证 useManualFilter 的关键行为，特别关注 v1.2 新增的 schemeVersion reset 能力：
 * - 不传 schemeVersion 时完全向后兼容
 * - initialFilters 引用变化但 schemeVersion 不变 → 不 reset，用户正在输入的值保留
 * - schemeVersion 变化 → reset 到新的 initialFilters
 * - 第 3 参数可以是 ZodTypeAny（老用法）或 number（新用法），互斥
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { useManualFilter } from '../use-manual-filter';

describe('useManualFilter', () => {
  it('不传 schemeVersion 时完全向后兼容：reset/search/setFilter 均正常', () => {
    const { result } = renderHook(() => useManualFilter({ keyword: '', status: [] as string[] }));
    expect(result.current.tempFilters).toEqual({ keyword: '', status: [] });
    expect(result.current.activeFilters).toEqual({ keyword: '', status: [] });

    act(() => result.current.setFilter('keyword', 'foo'));
    expect(result.current.tempFilters.keyword).toBe('foo');
    expect(result.current.activeFilters.keyword).toBe('');

    act(() => result.current.search());
    expect(result.current.activeFilters.keyword).toBe('foo');
  });

  it('引用变化但 schemeVersion 保持 1 时不 reset（用户正在输入的值保留）', () => {
    const initial1 = { keyword: '', status: [] as string[] };
    const { result, rerender } = renderHook(
      ({ init, ver }: { init: typeof initial1; ver: number }) =>
        useManualFilter(init, undefined, ver),
      { initialProps: { init: initial1, ver: 1 } }
    );

    act(() => result.current.setFilter('keyword', 'editing'));
    expect(result.current.tempFilters.keyword).toBe('editing');

    // 模拟 useFilterScheme 的 initialFilters 引用换了新的（内容相同）
    rerender({ init: { keyword: '', status: [] }, ver: 1 });
    expect(result.current.tempFilters.keyword).toBe('editing');
  });

  it('schemeVersion 变化时 reset 到新的 initialFilters', () => {
    const initial1 = { keyword: '', status: [] as string[] };
    const initial2 = { keyword: '', status: [] as string[], chargerId: '' };
    const { result, rerender } = renderHook(
      ({ init, ver }: { init: Record<string, string | string[]>; ver: number }) =>
        useManualFilter(init, undefined, ver),
      { initialProps: { init: initial1, ver: 1 } }
    );

    act(() => result.current.setFilter('keyword', 'editing'));
    expect(result.current.tempFilters.keyword).toBe('editing');

    // admin 改配置导致 scheme version 递增
    rerender({ init: initial2, ver: 2 });
    expect(result.current.tempFilters).toEqual(initial2);
    expect(result.current.activeFilters).toEqual(initial2);
  });

  it('第 3 参数是 ZodTypeAny 时按 zod schema 工作，不会误入 version 分支', () => {
    const initial = { keyword: '' };
    // 传一个真实 Zod schema（不会被当 number），行为等同无 version
    const schema = z.object({ keyword: z.string().optional() });
    const { result, rerender } = renderHook(
      ({ init }: { init: typeof initial }) => useManualFilter(init, undefined, schema),
      { initialProps: { init: initial } }
    );

    act(() => result.current.setFilter('keyword', 'hello'));
    rerender({ init: { keyword: '' } });
    // 引用变化不触发 reset（因为第 3 参数是 schema 不是 version）
    expect(result.current.tempFilters.keyword).toBe('hello');
  });

  it('首次挂载时 prevVersion 已初始化为当前 version，不会在首次渲染误触发 reset', () => {
    const initialState = { keyword: '' };
    const { result } = renderHook(() => useManualFilter(initialState, undefined, 7));
    act(() => result.current.setFilter('keyword', 'after-mount'));
    expect(result.current.tempFilters.keyword).toBe('after-mount');
  });

  it('apiParams 正确处理 flat bracket-style key 的 string 与 string[]', () => {
    const initialState = {
      keyword: '',
      'filters[customerLevel][]': [] as string[],
      'filters[createdAt][from]': '',
    };
    const { result } = renderHook(() => useManualFilter(initialState));

    act(() => result.current.setFilter('keyword', 'kw'));
    act(() => result.current.setFilter('filters[customerLevel][]', ['A', 'B']));
    act(() => result.current.setFilter('filters[createdAt][from]', '2026-01-01'));
    act(() => result.current.search());

    expect(result.current.apiParams).toEqual({
      keyword: 'kw',
      'filters[customerLevel][]': ['A', 'B'],
      'filters[createdAt][from]': '2026-01-01',
    });
  });

  it('支持批量、立即应用、方案替换与重置', () => {
    const initial = { keyword: '', status: [] as string[], ownerId: '' };
    const { result } = renderHook(() => useManualFilter(initial));

    act(() => result.current.setFilters({ keyword: 'draft', status: ['OPEN'] }));
    expect(result.current.tempFilters).toMatchObject({ keyword: 'draft', status: ['OPEN'] });
    expect(result.current.activeFilters).toEqual(initial);

    act(() => result.current.applyFilters({ ownerId: 'owner-1' }));
    expect(result.current.tempFilters.ownerId).toBe('owner-1');
    expect(result.current.activeFilters.ownerId).toBe('owner-1');

    act(() => result.current.replaceFilters({ keyword: 'preset', ownerId: undefined }));
    expect(result.current.tempFilters).toEqual({ keyword: 'preset', status: [], ownerId: '' });
    expect(result.current.activeFilters).toEqual({ keyword: 'preset', status: [], ownerId: '' });
    expect(result.current.hasActiveFilters).toBe(true);

    act(() => result.current.reset());
    expect(result.current.tempFilters).toEqual(initial);
    expect(result.current.activeFilters).toEqual(initial);
    expect(result.current.hasActiveFilters).toBe(false);
  });
});
