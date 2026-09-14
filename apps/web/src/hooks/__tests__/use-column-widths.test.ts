/**
 * 验证 useColumnWidths 的关键行为：
 * - 初始化读取 localStorage（带版本校验）
 * - onResize 触发 clamp（min/max）
 * - userModified 延迟写入
 * - onResetAll 清除覆盖
 * - 自定义事件 'kya:column-widths:reset' 重置
 * - STORAGE_VERSION 不匹配时丢弃旧数据
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  COLUMN_WIDTHS_RESET_EVENT,
  type ColumnWidthSpec,
  dispatchColumnWidthsReset,
  useColumnWidths,
} from '../use-column-widths';

const specs: ColumnWidthSpec[] = [
  { key: 'a', defaultWidth: 100, minWidth: 60, maxWidth: 500 },
  { key: 'b', defaultWidth: 200 },
];

const STORAGE_KEY = 'column-widths:/';

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  // 强制 pathname 为 '/'，因为 jsdom 默认 about:blank 时 pathname 可能不同
  Object.defineProperty(window, 'location', {
    value: { pathname: '/' },
    writable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useColumnWidths', () => {
  it('无 localStorage 时 widths 为空', () => {
    const { result } = renderHook(() => useColumnWidths(specs));
    expect(result.current.widths).toEqual({});
    expect(result.current.getWidth('a')).toBe(100);
    expect(result.current.getWidth('b')).toBe(200);
  });

  it('初始化时读取 localStorage（版本匹配）', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, widths: { a: 250 } }));
    const { result } = renderHook(() => useColumnWidths(specs));
    expect(result.current.widths).toEqual({ a: 250 });
    expect(result.current.getWidth('a')).toBe(250);
  });

  it('STORAGE_VERSION 不匹配时丢弃旧数据', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 0, widths: { a: 250 } }));
    const { result } = renderHook(() => useColumnWidths(specs));
    expect(result.current.widths).toEqual({});
  });

  it('onResize 触发 clamp（min）', () => {
    const { result } = renderHook(() => useColumnWidths(specs));
    act(() => result.current.onResize('a', 30));
    expect(result.current.widths.a).toBe(60);
  });

  it('onResize 触发 clamp（max）', () => {
    const { result } = renderHook(() => useColumnWidths(specs));
    act(() => result.current.onResize('a', 9999));
    expect(result.current.widths.a).toBe(500);
  });

  it('防抖写入 localStorage（300ms 内只写一次）', () => {
    const { result } = renderHook(() => useColumnWidths(specs));
    act(() => {
      result.current.onResize('a', 120);
      result.current.onResize('a', 140);
      result.current.onResize('a', 160);
    });
    // 未到时间，localStorage 还没写
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    act(() => vi.advanceTimersByTime(300));
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    expect(persisted.widths.a).toBe(160);
    expect(persisted.v).toBe(2);
    expect(persisted.appliedServerVersion).toBe(0);
  });

  it('首次渲染不触发 localStorage 写入（userModified=false）', () => {
    renderHook(() => useColumnWidths(specs));
    act(() => vi.advanceTimersByTime(1000));
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('onResetAll 清空 widths', () => {
    const { result } = renderHook(() => useColumnWidths(specs));
    act(() => result.current.onResize('a', 250));
    expect(result.current.widths).toEqual({ a: 250 });
    act(() => result.current.onResetAll());
    expect(result.current.widths).toEqual({});
    expect(result.current.getWidth('a')).toBe(100); // 回落默认
  });

  it('onResetColumn 只清单列', () => {
    const { result } = renderHook(() => useColumnWidths(specs));
    act(() => {
      result.current.onResize('a', 250);
      result.current.onResize('b', 300);
    });
    act(() => result.current.onResetColumn('a'));
    expect(result.current.widths).toEqual({ b: 300 });
  });

  it('全局事件 COLUMN_WIDTHS_RESET_EVENT 触发重置', () => {
    const { result } = renderHook(() => useColumnWidths(specs));
    act(() => result.current.onResize('a', 250));
    expect(result.current.widths).toEqual({ a: 250 });
    act(() => {
      window.dispatchEvent(new CustomEvent(COLUMN_WIDTHS_RESET_EVENT));
    });
    expect(result.current.widths).toEqual({});
  });

  it('dispatchColumnWidthsReset 同时清 localStorage 和触发事件', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, widths: { a: 999 } }));
    const { result } = renderHook(() => useColumnWidths(specs));
    // 注意：hook 初始化时已经读入 { a: 999 }；dispatchColumnWidthsReset 会触发 reset
    act(() => dispatchColumnWidthsReset());
    expect(result.current.widths).toEqual({});
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('【回归】reset 后 300ms 防抖周期内 localStorage 保持 removed，不会被写回 {v:1,widths:{}}', () => {
    const { result } = renderHook(() => useColumnWidths(specs));
    // 先模拟用户拖拽过，再触发 reset
    act(() => result.current.onResize('a', 250));
    act(() => vi.advanceTimersByTime(300));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').widths).toEqual({ a: 250 });
    act(() => dispatchColumnWidthsReset());
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    // 关键断言：推进 500ms 让防抖/effect 有充分时间写回，但因为 suppressPersistRef=true，
    // localStorage 必须保持 null（不能被覆盖为 {v:1,widths:{}}）
    act(() => vi.advanceTimersByTime(500));
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('【回归】修改后卸载应持久化最新列宽，不是初始值', () => {
    // 预置历史值
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, widths: { a: 100 } }));
    const { result, unmount } = renderHook(() => useColumnWidths(specs));
    // 用户拖拽，但未到 300ms 就卸载
    act(() => result.current.onResize('a', 333));
    act(() => vi.advanceTimersByTime(50));
    // localStorage 此时还是旧值（防抖未触发）
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').widths.a).toBe(100);
    // 卸载时应该 flush 最新值（333），而不是初始渲染捕获的 {a:100}
    unmount();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').widths.a).toBe(333);
  });

  it('【回归】storageId 隔离：同 pathname 不同 storageId 不共享 localStorage', () => {
    const KEY_A = 'column-widths:/:tabA';
    const KEY_B = 'column-widths:/:tabB';
    const { result: rA } = renderHook(() => useColumnWidths(specs, { storageId: 'tabA' }));
    const { result: rB } = renderHook(() => useColumnWidths(specs, { storageId: 'tabB' }));
    act(() => rA.current.onResize('a', 250));
    act(() => rB.current.onResize('a', 180));
    act(() => vi.advanceTimersByTime(300));
    expect(JSON.parse(localStorage.getItem(KEY_A) ?? '{}').widths.a).toBe(250);
    expect(JSON.parse(localStorage.getItem(KEY_B) ?? '{}').widths.a).toBe(180);
    expect(rA.current.widths.a).toBe(250);
    expect(rB.current.widths.a).toBe(180);
  });

  it('【回归】dispatchColumnWidthsReset(storageId) 只影响匹配的 hook', () => {
    const { result: rA } = renderHook(() => useColumnWidths(specs, { storageId: 'tabA' }));
    const { result: rB } = renderHook(() => useColumnWidths(specs, { storageId: 'tabB' }));
    act(() => rA.current.onResize('a', 250));
    act(() => rB.current.onResize('a', 180));
    act(() => vi.advanceTimersByTime(300));
    act(() => dispatchColumnWidthsReset('tabA'));
    expect(rA.current.widths).toEqual({});
    expect(rB.current.widths).toEqual({ a: 180 });
    expect(localStorage.getItem('column-widths:/:tabA')).toBeNull();
    expect(localStorage.getItem('column-widths:/:tabB')).not.toBeNull();
  });

  it('localStorage 损坏时降级为空', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    const { result } = renderHook(() => useColumnWidths(specs));
    expect(result.current.widths).toEqual({});
  });

  it('【二轮回归】reset 后第一次 resize 必须被持久化到 localStorage', () => {
    const { result } = renderHook(() => useColumnWidths(specs));
    // 预先有一次用户拖拽
    act(() => result.current.onResize('a', 200));
    act(() => vi.advanceTimersByTime(300));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}').widths).toEqual({ a: 200 });
    // reset
    act(() => dispatchColumnWidthsReset());
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    act(() => vi.advanceTimersByTime(500));
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    // 关键断言：reset 后再 resize，必须正常进入防抖写入，不被 suppress 吞掉
    act(() => result.current.onResize('a', 250));
    act(() => vi.advanceTimersByTime(300));
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    expect(persisted.widths.a).toBe(250);
  });

  it('【二轮回归】onResetAll 后第一次 resize 必须被持久化', () => {
    const { result } = renderHook(() => useColumnWidths(specs));
    act(() => result.current.onResize('a', 200));
    act(() => vi.advanceTimersByTime(300));
    act(() => result.current.onResetAll());
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    act(() => result.current.onResize('a', 280));
    act(() => vi.advanceTimersByTime(300));
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    expect(persisted.widths.a).toBe(280);
  });

  it('【二轮回归】storageId 运行时切换后，应读取新 key 的持久化值而非保留旧 state', () => {
    const KEY_A = 'column-widths:/:tabA';
    const KEY_B = 'column-widths:/:tabB';
    // 两个 tab 各有历史列宽
    localStorage.setItem(KEY_A, JSON.stringify({ v: 1, widths: { a: 300 } }));
    localStorage.setItem(KEY_B, JSON.stringify({ v: 1, widths: { a: 180 } }));
    const { result, rerender } = renderHook(
      ({ storageId }) => useColumnWidths(specs, { storageId }),
      { initialProps: { storageId: 'tabA' } }
    );
    expect(result.current.widths).toEqual({ a: 300 });
    // 切到 tabB：state 应重新加载为 tabB 的历史值（{a:180}）
    rerender({ storageId: 'tabB' });
    expect(result.current.widths).toEqual({ a: 180 });
    // 切回 tabA
    rerender({ storageId: 'tabA' });
    expect(result.current.widths).toEqual({ a: 300 });
  });

  it('【四轮回归】onResize + 同批次 unmount：最新值必须持久化到 localStorage', () => {
    // 场景：用户刚拖动列宽、还没等到 React 的 ref-sync effect 跑，
    // 组件立刻因路由切换/弹窗关闭被卸载；cleanup 读的是 latestWidthsRef。
    // 如果 onResize 不同步更新 ref，cleanup 会把旧值或空值写回，最新改动丢失。
    const { result, unmount } = renderHook(() => useColumnWidths(specs));
    act(() => {
      result.current.onResize('a', 333);
      unmount();
    });
    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    expect(persisted.widths?.a).toBe(333);
  });

  it('【三轮回归】storageId 切换时，旧 key 的未防抖落盘改动必须 flush 保留', () => {
    const KEY_A = 'column-widths:/:tabA';
    const { result, rerender } = renderHook(
      ({ storageId }) => useColumnWidths(specs, { storageId }),
      { initialProps: { storageId: 'tabA' } }
    );
    // 用户在 tabA 拖列宽，但 300ms 防抖未到就切 tab
    act(() => result.current.onResize('a', 420));
    act(() => vi.advanceTimersByTime(50));
    expect(localStorage.getItem(KEY_A)).toBeNull();
    // 切到 tabB
    rerender({ storageId: 'tabB' });
    // 关键断言：切换时旧 tab 的 420 必须 flush 到 KEY_A
    const persistedA = JSON.parse(localStorage.getItem(KEY_A) ?? '{}');
    expect(persistedA.widths.a).toBe(420);
    // 切回 tabA 仍能读到 420
    rerender({ storageId: 'tabA' });
    expect(result.current.widths).toEqual({ a: 420 });
  });
});
