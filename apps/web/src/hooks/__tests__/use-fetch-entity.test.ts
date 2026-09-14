import { act, render, renderHook, waitFor } from '@testing-library/react';
import {
  createElement,
  type PropsWithChildren,
  startTransition,
  StrictMode,
  Suspense,
  useLayoutEffect,
  useState,
} from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';

import { useFetchEntity } from '../use-fetch-entity';

interface Entity {
  id: string;
  name: string;
  version: number;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

interface PendingGet {
  url: string;
  deferred: Deferred<{ data: Entity }>;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const pendingGets: PendingGet[] = [];

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: {
      get: vi.fn(),
    },
  };
});

function strictWrapper({ children }: PropsWithChildren) {
  return createElement(StrictMode, null, children);
}

function requestsFor(url: string) {
  return pendingGets.filter((request) => request.url === url);
}

async function resolveRequests(requests: PendingGet[], entity: Entity) {
  await act(async () => {
    for (const request of requests) request.deferred.resolve({ data: entity });
    await Promise.resolve();
  });
}

describe('useFetchEntity identity/generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pendingGets.length = 0;
    vi.mocked(api.get).mockImplementation((url) => {
      const request: PendingGet = {
        url: String(url),
        deferred: createDeferred<{ data: Entity }>(),
      };
      pendingGets.push(request);
      return request.deferred.promise as never;
    });
  });

  it('StrictMode 下 A→B 同步隐藏 A，且 A 的旧 refetch 不递增请求也不发 GET', async () => {
    const entityA: Entity = { id: 'A', name: '实体 A', version: 1 };
    const entityB: Entity = { id: 'B', name: '实体 B', version: 1 };
    const { result, rerender } = renderHook(
      ({ endpoint, id }: { endpoint: string; id: string }) => useFetchEntity<Entity>(endpoint, id),
      {
        initialProps: { endpoint: '/entities', id: 'A' },
        wrapper: strictWrapper,
      }
    );

    await waitFor(() => expect(requestsFor('/entities/A').length).toBeGreaterThan(0));
    const staleARefetch = result.current.refetch;
    const aRequestCount = requestsFor('/entities/A').length;

    rerender({ endpoint: '/entities', id: 'B' });

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(requestsFor('/entities/B').length).toBeGreaterThan(0));

    await act(async () => staleARefetch());
    expect(requestsFor('/entities/A')).toHaveLength(aRequestCount);

    await resolveRequests(requestsFor('/entities/B'), entityB);
    await waitFor(() => expect(result.current.data).toEqual(entityB));

    // A 的响应和 finally 在 B 已完成后抵达，也不得清空 B 或改写 loading/error。
    await resolveRequests(requestsFor('/entities/A'), entityA);
    expect(result.current.data).toEqual(entityB);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('同 identity 多次 refetch 乱序返回时只接受最高 sequence', async () => {
    const initial: Entity = { id: 'A', name: '初始', version: 1 };
    const older: Entity = { id: 'A', name: '较旧请求', version: 2 };
    const latest: Entity = { id: 'A', name: '最新请求', version: 3 };
    const { result } = renderHook(() => useFetchEntity<Entity>('/entities', 'A'), {
      wrapper: strictWrapper,
    });

    await waitFor(() => expect(requestsFor('/entities/A').length).toBeGreaterThan(0));
    await resolveRequests(requestsFor('/entities/A'), initial);
    await waitFor(() => expect(result.current.data).toEqual(initial));

    const baseline = requestsFor('/entities/A').length;
    let olderPromise!: Promise<void>;
    let latestPromise!: Promise<void>;
    act(() => {
      olderPromise = result.current.refetch();
      latestPromise = result.current.refetch();
    });
    await waitFor(() => expect(requestsFor('/entities/A')).toHaveLength(baseline + 2));

    const [olderRequest, latestRequest] = requestsFor('/entities/A').slice(baseline);
    await act(async () => {
      latestRequest!.deferred.resolve({ data: latest });
      await latestPromise;
    });
    expect(result.current.data).toEqual(latest);
    expect(result.current.loading).toBe(false);

    await act(async () => {
      olderRequest!.deferred.resolve({ data: older });
      await olderPromise;
    });
    expect(result.current.data).toEqual(latest);
    expect(result.current.loading).toBe(false);
  });

  it('B 的 Suspense render 被中止时 A 闭包仍有效，B 真正 commit 后 A 才失效', async () => {
    interface HarnessConfig {
      id: string;
      suspend: boolean;
    }

    const blocker = new Promise<void>(() => undefined);
    let setConfig!: (config: HarnessConfig) => void;
    let committedRefetch!: () => Promise<void>;
    let suspendedRenderCount = 0;

    function Harness() {
      const [config, updateConfig] = useState<HarnessConfig>({ id: 'A', suspend: false });
      const detail = useFetchEntity<Entity>('/entities', config.id);

      useLayoutEffect(() => {
        setConfig = updateConfig;
        committedRefetch = detail.refetch;
      }, [detail.refetch, updateConfig]);

      if (config.suspend) {
        suspendedRenderCount += 1;
        throw blocker;
      }
      return null;
    }

    render(
      createElement(
        StrictMode,
        null,
        createElement(
          Suspense,
          { fallback: createElement('span', null, 'loading') },
          createElement(Harness)
        )
      )
    );

    await waitFor(() => expect(requestsFor('/entities/A').length).toBeGreaterThan(0));
    const staleARefetch = committedRefetch;
    const aCountBeforeSuspense = requestsFor('/entities/A').length;

    await act(async () => {
      startTransition(() => setConfig({ id: 'B', suspend: true }));
      await Promise.resolve();
    });
    await waitFor(() => expect(suspendedRenderCount).toBeGreaterThan(0));

    let aRequestDuringSuspense!: Promise<void>;
    act(() => {
      aRequestDuringSuspense = staleARefetch();
    });
    await waitFor(() => expect(requestsFor('/entities/A')).toHaveLength(aCountBeforeSuspense + 1));

    act(() => setConfig({ id: 'B', suspend: false }));
    await waitFor(() => expect(requestsFor('/entities/B').length).toBeGreaterThan(0));

    const aCountAfterBCommit = requestsFor('/entities/A').length;
    await act(async () => staleARefetch());
    expect(requestsFor('/entities/A')).toHaveLength(aCountAfterBCommit);

    await act(async () => {
      for (const request of requestsFor('/entities/B')) {
        request.deferred.resolve({
          data: { id: 'B', name: '实体 B', version: 2 },
        });
      }
      requestsFor('/entities/A')
        .at(-1)!
        .deferred.resolve({
          data: { id: 'A', name: '实体 A', version: 2 },
        });
      await aRequestDuringSuspense;
    });
  });

  it('v6 floor 拒绝迟到 v5 commitData，且不推进 sequence 误杀后续合法 GET', async () => {
    const v4: Entity = { id: 'A', name: '版本 4', version: 4 };
    const v5: Entity = { id: 'A', name: '迟到版本 5', version: 5 };
    const v6: Entity = { id: 'A', name: '版本 6', version: 6 };
    const v7: Entity = { id: 'A', name: '版本 7', version: 7 };
    const { result } = renderHook(() => useFetchEntity<Entity>('/entities', 'A'), {
      wrapper: strictWrapper,
    });

    await waitFor(() => expect(requestsFor('/entities/A').length).toBeGreaterThan(0));
    await resolveRequests(requestsFor('/entities/A'), v4);
    await waitFor(() => expect(result.current.data).toEqual(v4));

    const beforeV6 = requestsFor('/entities/A').length;
    let v6Promise!: Promise<void>;
    act(() => {
      v6Promise = result.current.refetch();
    });
    await waitFor(() => expect(requestsFor('/entities/A')).toHaveLength(beforeV6 + 1));
    const v6Request = requestsFor('/entities/A')[beforeV6]!;
    await act(async () => {
      v6Request.deferred.resolve({ data: v6 });
      await v6Promise;
    });
    expect(result.current.data).toEqual(v6);

    const beforeV7 = requestsFor('/entities/A').length;
    let v7Promise!: Promise<void>;
    act(() => {
      v7Promise = result.current.refetch();
    });
    await waitFor(() => expect(requestsFor('/entities/A')).toHaveLength(beforeV7 + 1));
    const v7Request = requestsFor('/entities/A')[beforeV7]!;

    act(() => result.current.commitData(v5));
    expect(result.current.data).toEqual(v6);

    // 若被拒 commitData 错误推进 sequence，这个已发出的合法响应会被误杀。
    await act(async () => {
      v7Request.deferred.resolve({ data: v7 });
      await v7Promise;
    });
    expect(result.current.data).toEqual(v7);
    expect(result.current.loading).toBe(false);
  });

  it('已有 floor 后无 version 的 commitData 严格 no-op，且不误杀在途合法响应', async () => {
    const v6: Entity = { id: 'A', name: '版本 6', version: 6 };
    const v7: Entity = { id: 'A', name: '版本 7', version: 7 };
    const versionless = { id: 'A', name: '无版本写响应' } as Entity;
    const { result } = renderHook(() => useFetchEntity<Entity>('/entities', 'A'), {
      wrapper: strictWrapper,
    });

    await waitFor(() => expect(requestsFor('/entities/A').length).toBeGreaterThan(0));
    await resolveRequests(requestsFor('/entities/A'), v6);
    await waitFor(() => expect(result.current.data).toEqual(v6));

    const baseline = requestsFor('/entities/A').length;
    let v7Promise!: Promise<void>;
    act(() => {
      v7Promise = result.current.refetch();
    });
    await waitFor(() => expect(requestsFor('/entities/A')).toHaveLength(baseline + 1));
    const v7Request = requestsFor('/entities/A')[baseline]!;

    act(() => result.current.commitData(versionless));
    expect(result.current.data).toEqual(v6);

    await act(async () => {
      v7Request.deferred.resolve({ data: v7 });
      await v7Promise;
    });
    expect(result.current.data).toEqual(v7);
    expect(result.current.loading).toBe(false);
  });

  it('合法 v7 commitData 更新 state，并栅栏此前发出的更高版本 GET', async () => {
    const v6: Entity = { id: 'A', name: '版本 6', version: 6 };
    const v7: Entity = { id: 'A', name: '写响应版本 7', version: 7 };
    const v8: Entity = { id: 'A', name: '旧 GET 版本 8', version: 8 };
    const { result } = renderHook(() => useFetchEntity<Entity>('/entities', 'A'), {
      wrapper: strictWrapper,
    });

    await waitFor(() => expect(requestsFor('/entities/A').length).toBeGreaterThan(0));
    await resolveRequests(requestsFor('/entities/A'), v6);
    await waitFor(() => expect(result.current.data).toEqual(v6));

    const baseline = requestsFor('/entities/A').length;
    let staleGetPromise!: Promise<void>;
    act(() => {
      staleGetPromise = result.current.refetch();
    });
    await waitFor(() => expect(requestsFor('/entities/A')).toHaveLength(baseline + 1));
    const staleGet = requestsFor('/entities/A')[baseline]!;

    act(() => result.current.commitData(v7));
    expect(result.current.data).toEqual(v7);
    expect(result.current.loading).toBe(false);

    // v8 高于 floor，仍必须因 commitData 的 sequence 栅栏而被丢弃。
    await act(async () => {
      staleGet.deferred.resolve({ data: v8 });
      await staleGetPromise;
    });
    expect(result.current.data).toEqual(v7);
    expect(result.current.loading).toBe(false);
  });
});
