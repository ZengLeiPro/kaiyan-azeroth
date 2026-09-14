import { act, render, renderHook, waitFor } from '@testing-library/react';
import { createElement, startTransition, Suspense, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { GeolocationPosition } from '@/hooks/use-geolocation';
import { reverseGeocode } from '@/lib/geocoding';

import type { VisitRecordFormData } from './types';
import { useVisitRecordGeocoding } from './use-visit-record-geocoding';

vi.mock('@/lib/geocoding', () => ({
  reverseGeocode: vi.fn(),
  wgs84ToGcj02: vi.fn((longitude: number, latitude: number) => [longitude, latitude]),
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn() },
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createFormData(overrides: Partial<VisitRecordFormData> = {}): VisitRecordFormData {
  return {
    customerId: '',
    contactId: null,
    visitType: null,
    content: null,
    signInTime: null,
    signOutTime: null,
    signAddress: null,
    signLocation: null,
    duration: null,
    visitStatus: null,
    attachments: null,
    chargerId: null,
    ...overrides,
  };
}

const firstPosition: GeolocationPosition = {
  latitude: 24.87391,
  longitude: 118.67587,
  accuracy: 20,
};

const secondPosition: GeolocationPosition = {
  latitude: 24.9,
  longitude: 118.7,
  accuracy: 10,
};

function useHarness({ dialogOpen, entityId }: { dialogOpen: boolean; entityId: string | null }) {
  const [formData, setFormData] = useState(() => createFormData());
  const geocoding = useVisitRecordGeocoding({ dialogOpen, entityId, setFormData });
  return { ...geocoding, formData, setFormData };
}

describe('useVisitRecordGeocoding', () => {
  beforeEach(() => {
    vi.mocked(reverseGeocode).mockReset();
  });

  it('延迟响应不会覆盖定位后用户手改的地址', async () => {
    const request = deferred<{ address: string | null; location: string }>();
    vi.mocked(reverseGeocode).mockReturnValueOnce(request.promise);
    const { result } = renderHook(() => useHarness({ dialogOpen: true, entityId: 'A' }));

    act(() => result.current.handleLocationDetected(firstPosition));
    expect(result.current.isResolvingAddress).toBe(true);

    act(() => {
      result.current.setFormData((previous) => ({
        ...previous,
        signAddress: '用户手工修改地址',
      }));
    });

    await act(async () => {
      request.resolve({ address: '延迟返回的地址', location: '118.675870,24.873910' });
      await request.promise;
    });

    expect(result.current.formData.signAddress).toBe('用户手工修改地址');
    expect(result.current.isResolvingAddress).toBe(false);
  });

  it('关闭后重开表单时旧会话响应绝不写入新表单', async () => {
    const request = deferred<{ address: string | null; location: string }>();
    vi.mocked(reverseGeocode).mockReturnValueOnce(request.promise);
    const { result, rerender } = renderHook(useHarness, {
      initialProps: {
        dialogOpen: true,
        entityId: 'A',
      } as { dialogOpen: boolean; entityId: string | null },
    });

    act(() => result.current.handleLocationDetected(firstPosition));
    const signal = vi.mocked(reverseGeocode).mock.calls[0]?.[0].signal;

    rerender({ dialogOpen: false, entityId: 'A' });
    expect(result.current.isResolvingAddress).toBe(false);
    expect(signal?.aborted).toBe(true);

    act(() => result.current.setFormData(createFormData({ signAddress: '重开后的表单地址' })));
    rerender({ dialogOpen: true, entityId: 'A' });

    await act(async () => {
      request.resolve({ address: 'A 的旧会话地址', location: '118.675870,24.873910' });
      await request.promise;
    });

    expect(result.current.formData.signAddress).toBe('重开后的表单地址');
    expect(result.current.isResolvingAddress).toBe(false);
  });

  it('从编辑切到新建时旧实体请求失效并清除解析状态', async () => {
    const request = deferred<{ address: string | null; location: string }>();
    vi.mocked(reverseGeocode).mockReturnValueOnce(request.promise);
    const { result, rerender } = renderHook(useHarness, {
      initialProps: {
        dialogOpen: true,
        entityId: 'A',
      } as { dialogOpen: boolean; entityId: string | null },
    });

    act(() => result.current.handleLocationDetected(firstPosition));
    const signal = vi.mocked(reverseGeocode).mock.calls[0]?.[0].signal;
    act(() => result.current.setFormData(createFormData({ signAddress: '新建表单地址' })));
    rerender({ dialogOpen: true, entityId: null });

    expect(signal?.aborted).toBe(true);
    expect(result.current.isResolvingAddress).toBe(false);

    await act(async () => {
      request.resolve({ address: 'A 的延迟地址', location: '118.675870,24.873910' });
      await request.promise;
    });

    expect(result.current.formData.signAddress).toBe('新建表单地址');
  });

  it('切换 editingEntity 时旧实体响应绝不串写新实体', async () => {
    const request = deferred<{ address: string | null; location: string }>();
    vi.mocked(reverseGeocode).mockReturnValueOnce(request.promise);
    const { result, rerender } = renderHook(useHarness, {
      initialProps: { dialogOpen: true, entityId: 'A' },
    });

    act(() => result.current.handleLocationDetected(firstPosition));
    const signal = vi.mocked(reverseGeocode).mock.calls[0]?.[0].signal;
    act(() => result.current.setFormData(createFormData({ signAddress: 'B 原地址' })));
    rerender({ dialogOpen: true, entityId: 'B' });

    expect(signal?.aborted).toBe(true);
    expect(result.current.isResolvingAddress).toBe(false);

    await act(async () => {
      request.resolve({ address: 'A 的延迟地址', location: '118.675870,24.873910' });
      await request.promise;
    });

    expect(result.current.formData.signAddress).toBe('B 原地址');
    expect(result.current.isResolvingAddress).toBe(false);
  });

  it('组件卸载后不会消费延迟响应', async () => {
    const request = deferred<{ address: string | null; location: string }>();
    vi.mocked(reverseGeocode).mockReturnValueOnce(request.promise);
    const setFormData = vi.fn();
    const { result, unmount } = renderHook(() =>
      useVisitRecordGeocoding({ dialogOpen: true, entityId: 'A', setFormData })
    );

    act(() => result.current.handleLocationDetected(firstPosition));
    const signal = vi.mocked(reverseGeocode).mock.calls[0]?.[0].signal;
    expect(setFormData).toHaveBeenCalledTimes(1);

    unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      request.resolve({ address: '卸载后的地址', location: '118.675870,24.873910' });
      await request.promise;
    });

    expect(setFormData).toHaveBeenCalledTimes(1);
  });

  it('同一会话内新定位中止旧定位且新响应胜出', async () => {
    const firstRequest = deferred<{ address: string | null; location: string }>();
    const secondRequest = deferred<{ address: string | null; location: string }>();
    vi.mocked(reverseGeocode)
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise);
    const { result } = renderHook(() => useHarness({ dialogOpen: true, entityId: 'A' }));

    act(() => result.current.handleLocationDetected(firstPosition));
    const firstSignal = vi.mocked(reverseGeocode).mock.calls[0]?.[0].signal;
    act(() => result.current.handleLocationDetected(secondPosition));

    expect(firstSignal?.aborted).toBe(true);

    await act(async () => {
      secondRequest.resolve({ address: '第二次定位地址', location: '118.700000,24.900000' });
      await secondRequest.promise;
    });
    expect(result.current.formData.signAddress).toBe('第二次定位地址');
    expect(result.current.isResolvingAddress).toBe(false);

    await act(async () => {
      firstRequest.resolve({ address: '第一次定位旧地址', location: '118.675870,24.873910' });
      await firstRequest.promise;
    });
    expect(result.current.formData.signAddress).toBe('第二次定位地址');
  });

  it('切换实体的 Suspense render 被中止时不污染已提交会话', async () => {
    const request = deferred<{ address: string | null; location: string }>();
    vi.mocked(reverseGeocode).mockReturnValueOnce(request.promise);
    const never = new Promise<never>(() => undefined);
    let updateConfig!: (config: { entityId: string; suspend: boolean }) => void;
    let committedHandle!: (coords: GeolocationPosition) => void;
    let suspendedRenderCount = 0;

    function Harness() {
      const [config, setConfig] = useState({ entityId: 'A', suspend: false });
      const [, setFormData] = useState(() => createFormData());
      const geocoding = useVisitRecordGeocoding({
        dialogOpen: true,
        entityId: config.entityId,
        setFormData,
      });
      updateConfig = setConfig;
      if (config.suspend) {
        suspendedRenderCount += 1;
        throw never;
      }
      committedHandle = geocoding.handleLocationDetected;
      return null;
    }

    const view = render(createElement(Suspense, { fallback: null }, createElement(Harness)));
    const handleFromCommittedA = committedHandle;

    act(() => {
      startTransition(() => updateConfig({ entityId: 'B', suspend: true }));
    });
    await waitFor(() => expect(suspendedRenderCount).toBeGreaterThan(0));

    act(() => handleFromCommittedA(firstPosition));
    expect(reverseGeocode).toHaveBeenCalledTimes(1);

    view.unmount();
    await act(async () => {
      request.resolve({ address: 'A 地址', location: '118.675870,24.873910' });
      await request.promise;
    });
  });
});
