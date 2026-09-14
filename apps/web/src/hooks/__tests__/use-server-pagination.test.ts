import { act, render, renderHook, waitFor } from '@testing-library/react';
import {
  createElement,
  type PropsWithChildren,
  startTransition,
  StrictMode,
  Suspense,
  useEffect,
  useLayoutEffect,
  useState,
} from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';

import {
  buildSortingStorageKey,
  loadPersistedSorting,
  type ServerPaginationResponse,
  SORTING_STORAGE_PREFIX,
  SORTING_STORAGE_VERSION,
  useServerPagination,
  writePersistedSorting,
} from '../use-server-pagination';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
  },
}));

const getMock = vi.mocked(api.get);

type Row = { id: string; name?: string };
type MockResponse = { data: ServerPaginationResponse<Row> };
type Transform = (data: unknown) => ServerPaginationResponse<Row>;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function paginatedResponse(
  id: string,
  {
    total = 1,
    page = 1,
    pageSize = 100,
    totalPages = Math.ceil(total / pageSize),
  }: { total?: number; page?: number; pageSize?: number; totalPages?: number } = {}
): MockResponse {
  return {
    data: {
      items: [{ id }],
      total,
      page,
      pageSize,
      totalPages,
    },
  };
}

function mockDeferredGet<T>(request: Deferred<T>): void {
  getMock.mockReturnValueOnce(request.promise as ReturnType<typeof api.get>);
}

async function resolveRequest<T>(request: Deferred<T>, response: T) {
  await act(async () => {
    request.resolve(response);
    await request.promise;
  });
}

async function rejectRequest<T>(request: Deferred<T>, error: Error) {
  await act(async () => {
    request.reject(error);
    await request.promise.catch(() => undefined);
  });
}

function StrictModeWrapper({ children }: PropsWithChildren) {
  return createElement(StrictMode, null, children);
}

describe('useServerPagination', () => {
  beforeEach(() => {
    getMock.mockReset();
    localStorage.clear();
    window.history.replaceState(null, '', '/customers');
  });

  it('构建带 pathname 和 storageId 的排序持久化 key', () => {
    expect(buildSortingStorageKey('table-a')).toBe(`${SORTING_STORAGE_PREFIX}/customers:table-a`);
  });

  it('读写排序持久化时会忽略版本不匹配和非法 sortOrder', () => {
    writePersistedSorting(
      {
        v: SORTING_STORAGE_VERSION,
        sortBy: 'createdAt',
        sortOrder: 'desc',
        appliedServerVersion: 3,
      },
      'main'
    );

    expect(loadPersistedSorting('main')).toEqual({
      v: SORTING_STORAGE_VERSION,
      sortBy: 'createdAt',
      sortOrder: 'desc',
      appliedServerVersion: 3,
    });

    localStorage.setItem(
      buildSortingStorageKey('legacy'),
      JSON.stringify({ v: 0, sortBy: 'name' })
    );
    localStorage.setItem(
      buildSortingStorageKey('bad-order'),
      JSON.stringify({ v: SORTING_STORAGE_VERSION, sortBy: 'name', sortOrder: 'down' })
    );

    expect(loadPersistedSorting('legacy')).toBeNull();
    expect(loadPersistedSorting('bad-order')?.sortOrder).toBeUndefined();
  });

  it('自动加载分页数据并合并排序与额外查询参数', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        items: [{ id: 'c1', name: '客户' }],
        total: 41,
        page: 2,
        pageSize: 20,
        totalPages: 3,
      },
    });

    const { result } = renderHook(() =>
      useServerPagination<{ id: string; name: string }>({
        endpoint: '/customers',
        initialPage: 2,
        initialPageSize: 20,
        initialSortBy: 'createdAt',
        initialSortOrder: 'desc',
        extraParams: { keyword: '示例' },
      })
    );

    await waitFor(() => expect(result.current.data).toEqual([{ id: 'c1', name: '客户' }]));

    expect(getMock).toHaveBeenCalledWith('/customers', {
      params: {
        page: 2,
        pageSize: 20,
        keyword: '示例',
        sortBy: 'createdAt',
        sortOrder: 'desc',
      },
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.pagination.total).toBe(41);
    expect(result.current.pagination.totalPages).toBe(3);
  });

  it('排序操作会回到第一页并持久化用户选择', async () => {
    getMock
      .mockResolvedValueOnce({
        data: { items: [{ id: 'p1' }], total: 1, page: 1, pageSize: 100, totalPages: 1 },
      })
      .mockResolvedValueOnce({
        data: { items: [{ id: 'p2' }], total: 1, page: 1, pageSize: 100, totalPages: 1 },
      });

    const { result } = renderHook(() =>
      useServerPagination<{ id: string }>({ endpoint: '/projects', sortingStorageId: 'main' })
    );

    await waitFor(() => expect(result.current.data).toEqual([{ id: 'p1' }]));

    act(() => result.current.sorting.changeSort('name', 'asc'));

    expect(result.current.sorting.sortBy).toBe('name');
    expect(loadPersistedSorting('main')).toMatchObject({ sortBy: 'name', sortOrder: 'asc' });
    await waitFor(() => expect(result.current.data).toEqual([{ id: 'p2' }]));
  });

  it('sortingStorageId 切换隔离排序，并以各 storage 的 applied version 为下限', async () => {
    writePersistedSorting(
      {
        v: SORTING_STORAGE_VERSION,
        sortBy: 'createdAt',
        sortOrder: 'asc',
        appliedServerVersion: 5,
      },
      'mine'
    );
    writePersistedSorting(
      {
        v: SORTING_STORAGE_VERSION,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
        appliedServerVersion: 10,
      },
      'all'
    );
    getMock.mockResolvedValue({
      data: { items: [], total: 0, page: 1, pageSize: 100, totalPages: 0 },
    });

    const { result, rerender } = renderHook(
      ({ storageId }) =>
        useServerPagination<Row>({ endpoint: '/customers', sortingStorageId: storageId }),
      { initialProps: { storageId: 'mine' } }
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sorting.sortBy).toBe('createdAt');

    act(() => result.current.sorting.applyServerSorting('ignored', 'desc', 5));
    expect(result.current.sorting.sortBy).toBe('createdAt');

    rerender({ storageId: 'all' });
    await waitFor(() => expect(result.current.sorting.sortBy).toBe('updatedAt'));
    expect(result.current.sorting.sortOrder).toBe('desc');
    await waitFor(() =>
      expect(getMock).toHaveBeenLastCalledWith('/customers', {
        params: {
          page: 1,
          pageSize: 100,
          sortBy: 'updatedAt',
          sortOrder: 'desc',
        },
      })
    );

    act(() => result.current.sorting.applyServerSorting('too-old', 'asc', 9));
    expect(result.current.sorting.sortBy).toBe('updatedAt');

    act(() => result.current.sorting.applyServerSorting('priority', 'asc', 11));
    expect(result.current.sorting.sortBy).toBe('priority');
    expect(loadPersistedSorting('all')).toMatchObject({
      sortBy: 'priority',
      sortOrder: 'asc',
      appliedServerVersion: 11,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('首次加载失败时暴露错误并保持空分页快照', async () => {
    const error = new Error('network down');
    getMock.mockRejectedValueOnce(error);

    const { result } = renderHook(() => useServerPagination<{ id: string }>({ endpoint: '/bad' }));

    await waitFor(() => expect(result.current.error).toBe(error));

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual([]);
    expect(result.current.pagination.total).toBe(0);
    expect(result.current.pagination.totalPages).toBe(0);
    expect(result.current.stale).toBe(false);
  });

  it('A 慢、B 快成功时只提交 B 数据和分页元数据', async () => {
    const requestA = createDeferred<MockResponse>();
    const requestB = createDeferred<MockResponse>();
    mockDeferredGet(requestA);
    mockDeferredGet(requestB);

    const { result, rerender } = renderHook(
      ({ endpoint, keyword }) => useServerPagination<Row>({ endpoint, extraParams: { keyword } }),
      { initialProps: { endpoint: '/customers-a', keyword: 'A' } }
    );

    expect(getMock).toHaveBeenNthCalledWith(1, '/customers-a', {
      params: { page: 1, pageSize: 100, keyword: 'A' },
    });

    rerender({ endpoint: '/customers-b', keyword: 'B' });

    expect(getMock).toHaveBeenNthCalledWith(2, '/customers-b', {
      params: { page: 1, pageSize: 100, keyword: 'B' },
    });

    await resolveRequest(requestB, paginatedResponse('B', { total: 201, totalPages: 3 }));
    expect(result.current.data).toEqual([{ id: 'B' }]);
    expect(result.current.pagination.total).toBe(201);
    expect(result.current.pagination.totalPages).toBe(3);

    await resolveRequest(requestA, paginatedResponse('A', { total: 101, totalPages: 2 }));
    expect(result.current.data).toEqual([{ id: 'B' }]);
    expect(result.current.pagination.total).toBe(201);
    expect(result.current.pagination.totalPages).toBe(3);
    expect(result.current.error).toBeNull();
  });

  it('A 慢失败、B 快成功时旧失败不能覆盖 B 状态', async () => {
    const requestA = createDeferred<MockResponse>();
    const requestB = createDeferred<MockResponse>();
    const staleError = new Error('A failed');
    mockDeferredGet(requestA);
    mockDeferredGet(requestB);

    const { result, rerender } = renderHook(
      ({ keyword }) =>
        useServerPagination<Row>({ endpoint: '/customers', extraParams: { keyword } }),
      { initialProps: { keyword: 'A' } }
    );

    rerender({ keyword: 'B' });
    await resolveRequest(requestB, paginatedResponse('B', { total: 108, totalPages: 2 }));
    await rejectRequest(requestA, staleError);

    expect(getMock).toHaveBeenNthCalledWith(1, '/customers', {
      params: { page: 1, pageSize: 100, keyword: 'A' },
    });
    expect(getMock).toHaveBeenNthCalledWith(2, '/customers', {
      params: { page: 1, pageSize: 100, keyword: 'B' },
    });
    expect(result.current.data).toEqual([{ id: 'B' }]);
    expect(result.current.pagination.total).toBe(108);
    expect(result.current.pagination.totalPages).toBe(2);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('A 成功后 B 失败时保留 A 快照并展示 B 错误', async () => {
    const requestA = createDeferred<MockResponse>();
    const requestB = createDeferred<MockResponse>();
    const latestError = new Error('B failed');
    mockDeferredGet(requestA);
    mockDeferredGet(requestB);

    const { result, rerender } = renderHook(
      ({ keyword }) =>
        useServerPagination<Row>({ endpoint: '/customers', extraParams: { keyword } }),
      { initialProps: { keyword: 'A' } }
    );

    await resolveRequest(requestA, paginatedResponse('A', { total: 317, totalPages: 4 }));
    rerender({ keyword: 'B' });

    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual([{ id: 'A' }]);
    expect(result.current.pagination.total).toBe(317);
    expect(result.current.pagination.totalPages).toBe(4);

    await rejectRequest(requestB, latestError);

    expect(getMock).toHaveBeenNthCalledWith(2, '/customers', {
      params: { page: 1, pageSize: 100, keyword: 'B' },
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(latestError);
    expect(result.current.data).toEqual([{ id: 'A' }]);
    expect(result.current.stale).toBe(true);
    expect(result.current.pagination.total).toBe(317);
    expect(result.current.pagination.totalPages).toBe(4);
  });

  it('连续手动 loadData/refresh 同样由最后发起的请求获胜', async () => {
    const first = createDeferred<MockResponse>();
    const second = createDeferred<MockResponse>();
    mockDeferredGet(first);
    mockDeferredGet(second);

    const { result } = renderHook(() =>
      useServerPagination<Row>({
        endpoint: '/manual',
        extraParams: { scope: 'mine' },
        autoLoad: false,
      })
    );

    act(() => {
      void result.current.loadData();
      result.current.refresh();
    });

    expect(getMock).toHaveBeenCalledTimes(2);
    expect(getMock).toHaveBeenNthCalledWith(1, '/manual', {
      params: { page: 1, pageSize: 100, scope: 'mine' },
    });
    expect(getMock).toHaveBeenNthCalledWith(2, '/manual', {
      params: { page: 1, pageSize: 100, scope: 'mine' },
    });

    await resolveRequest(second, paginatedResponse('second', { total: 2, totalPages: 1 }));
    await resolveRequest(first, paginatedResponse('first', { total: 1, totalPages: 1 }));

    expect(result.current.data).toEqual([{ id: 'second' }]);
    expect(result.current.pagination.total).toBe(2);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('配置切换与卸载后，旧 loadData/refresh closure 不再发请求', async () => {
    const requestB = createDeferred<MockResponse>();
    mockDeferredGet(requestB);

    const { result, rerender, unmount } = renderHook(
      ({ keyword }) =>
        useServerPagination<Row>({
          endpoint: '/manual',
          extraParams: { keyword },
          autoLoad: false,
        }),
      { initialProps: { keyword: 'A' } }
    );

    const staleLoadData = result.current.loadData;
    const staleRefresh = result.current.refresh;
    rerender({ keyword: 'B' });

    act(() => {
      void staleLoadData();
      staleRefresh();
    });
    expect(getMock).not.toHaveBeenCalled();

    act(() => void result.current.loadData());
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(getMock).toHaveBeenCalledWith('/manual', {
      params: { page: 1, pageSize: 100, keyword: 'B' },
    });

    const currentLoadData = result.current.loadData;
    unmount();
    act(() => void currentLoadData());
    expect(getMock).toHaveBeenCalledTimes(1);

    await resolveRequest(requestB, paginatedResponse('late'));
  });

  it('旧请求结束不能提前清除新请求的 loading', async () => {
    const requestA = createDeferred<MockResponse>();
    const requestB = createDeferred<MockResponse>();
    mockDeferredGet(requestA);
    mockDeferredGet(requestB);

    const { result, rerender } = renderHook(
      ({ keyword }) =>
        useServerPagination<Row>({ endpoint: '/customers', extraParams: { keyword } }),
      { initialProps: { keyword: 'A' } }
    );

    rerender({ keyword: 'B' });
    await resolveRequest(requestA, paginatedResponse('A'));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toEqual([]);
    expect(result.current.error).toBeNull();

    await resolveRequest(requestB, paginatedResponse('B'));
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual([{ id: 'B' }]);
  });

  it('参数切换的 effect cleanup 在没有下一次自动请求时也会使旧请求失效', async () => {
    const requestA = createDeferred<MockResponse>();
    mockDeferredGet(requestA);

    const { result, rerender } = renderHook(
      ({ keyword, autoLoad }) =>
        useServerPagination<Row>({
          endpoint: '/customers',
          extraParams: { keyword },
          autoLoad,
        }),
      { initialProps: { keyword: 'A', autoLoad: true } }
    );

    rerender({ keyword: 'B', autoLoad: false });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(getMock).toHaveBeenCalledTimes(1);
    expect(getMock).toHaveBeenCalledWith('/customers', {
      params: { page: 1, pageSize: 100, keyword: 'A' },
    });

    await resolveRequest(requestA, paginatedResponse('A', { total: 109, totalPages: 2 }));

    expect(result.current.data).toEqual([]);
    expect(result.current.pagination.total).toBe(0);
    expect(result.current.pagination.totalPages).toBe(0);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it.each([
    ['items 缺失', { total: 0, page: 1, pageSize: 100, totalPages: 0 }],
    ['total 为 NaN', { items: [], total: Number.NaN, page: 1, pageSize: 100, totalPages: 0 }],
    [
      'total 超过安全整数',
      {
        items: [],
        total: Number.MAX_SAFE_INTEGER + 1,
        page: 1,
        pageSize: 100,
        totalPages: 0,
      },
    ],
    ['page 为 undefined', { items: [], total: 0, page: undefined, pageSize: 100, totalPages: 0 }],
    [
      'pageSize 为 Infinity',
      { items: [], total: 0, page: 1, pageSize: Number.POSITIVE_INFINITY, totalPages: 0 },
    ],
    ['totalPages 为负数', { items: [], total: 0, page: 1, pageSize: 100, totalPages: -1 }],
    [
      'totalPages 超过安全整数',
      {
        items: [],
        total: 0,
        page: 1,
        pageSize: 100,
        totalPages: Number.MAX_SAFE_INTEGER + 1,
      },
    ],
    [
      'totalPages 与 total/pageSize 不一致',
      { items: [], total: 101, page: 1, pageSize: 100, totalPages: 1 },
    ],
  ])('HTTP 畸形分页响应（%s）整体拒绝并进入安全 error 状态', async (_label, data) => {
    getMock.mockResolvedValueOnce({ data });

    const { result } = renderHook(() => useServerPagination<Row>({ endpoint: '/malformed-http' }));

    await waitFor(() => expect(result.current.error?.message).toMatch(/分页响应无效/));
    expect(result.current.data).toEqual([]);
    expect(result.current.pagination.total).toBe(0);
    expect(result.current.pagination.totalPages).toBe(0);
    expect(result.current.loading).toBe(false);
  });

  it('畸形 transform 结果不部分覆盖最后成功分页快照', async () => {
    const validRequest = createDeferred<MockResponse>();
    const malformedRequest = createDeferred<MockResponse>();
    mockDeferredGet(validRequest);
    mockDeferredGet(malformedRequest);

    const { result, rerender } = renderHook(
      ({ malformed, transformKey }) =>
        useServerPagination<Row>({
          endpoint: '/malformed-transform',
          transformKey,
          transform: (data) =>
            malformed
              ? ({
                  items: 'not-an-array',
                  total: 999,
                  page: 1,
                  pageSize: 100,
                  totalPages: 10,
                } as unknown as ServerPaginationResponse<Row>)
              : (data as ServerPaginationResponse<Row>),
        }),
      { initialProps: { malformed: false, transformKey: 'valid' } }
    );

    await resolveRequest(validRequest, paginatedResponse('snapshot', { total: 201 }));
    expect(result.current.data).toEqual([{ id: 'snapshot' }]);
    expect(result.current.pagination.total).toBe(201);
    expect(result.current.pagination.totalPages).toBe(3);

    rerender({ malformed: true, transformKey: 'malformed' });
    await resolveRequest(malformedRequest, paginatedResponse('should-not-commit'));

    expect(result.current.error?.message).toMatch(/items 必须是数组/);
    expect(result.current.data).toEqual([{ id: 'snapshot' }]);
    expect(result.current.pagination.total).toBe(201);
    expect(result.current.pagination.totalPages).toBe(3);
    expect(result.current.loading).toBe(false);
  });

  it('卸载后响应不会执行 transform 或提交状态', async () => {
    const request = createDeferred<MockResponse>();
    const transform = vi.fn((data: unknown) => data as ServerPaginationResponse<Row>);
    mockDeferredGet(request);

    const { result, unmount } = renderHook(() =>
      useServerPagination<Row>({ endpoint: '/customers', transform })
    );

    const stateBeforeUnmount = result.current;
    unmount();
    await resolveRequest(request, paginatedResponse('late'));

    expect(transform).not.toHaveBeenCalled();
    expect(result.current).toBe(stateBeforeUnmount);
  });

  it('inline transform rerender 不创建新代际，并由响应读取最近 commit 的 transform', async () => {
    const request = createDeferred<MockResponse>();
    mockDeferredGet(request);

    const { result, rerender } = renderHook(
      ({ suffix }) =>
        useServerPagination<Row>({
          endpoint: '/transformed',
          transform: (data) => {
            const response = data as ServerPaginationResponse<Row>;
            return {
              ...response,
              items: response.items.map((row) => ({ ...row, id: `${row.id}-${suffix}` })),
            };
          },
        }),
      { initialProps: { suffix: 'A' } }
    );

    rerender({ suffix: 'B' });
    expect(getMock).toHaveBeenCalledTimes(1);

    await resolveRequest(request, paginatedResponse('row'));

    expect(getMock).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual([{ id: 'row-B' }]);
    expect(result.current.loading).toBe(false);
  });

  it('显式 transformKey 变化使旧响应失效并按最新转换语义重载', async () => {
    const requestA = createDeferred<MockResponse>();
    const requestB = createDeferred<MockResponse>();
    const transformA = vi.fn((data: unknown) => data as ServerPaginationResponse<Row>);
    const transformB = vi.fn((data: unknown) => data as ServerPaginationResponse<Row>);
    mockDeferredGet(requestA);
    mockDeferredGet(requestB);

    const { result, rerender } = renderHook(
      ({ transform, transformKey }: { transform: Transform; transformKey: string }) =>
        useServerPagination<Row>({ endpoint: '/transformed', transform, transformKey }),
      { initialProps: { transform: transformA, transformKey: 'A' } }
    );

    rerender({ transform: transformB, transformKey: 'B' });
    await resolveRequest(requestA, paginatedResponse('stale'));

    expect(transformA).not.toHaveBeenCalled();
    expect(transformB).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);

    await resolveRequest(requestB, paginatedResponse('current'));

    expect(getMock).toHaveBeenCalledTimes(2);
    expect(transformB).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual([{ id: 'current' }]);
  });

  it('已排队的 loading updater 在 generation 变化后实际应用时被拒绝', async () => {
    const requestA = createDeferred<MockResponse>();
    const renderBlocker = createDeferred<void>();
    let allowLoadingCommit = false;
    let loadingRenderCount = 0;
    let setKeyword!: (keyword: string) => void;
    let staleLoadData!: () => Promise<void>;
    mockDeferredGet(requestA);

    function Harness() {
      const [keyword, updateKeyword] = useState('A');
      const pagination = useServerPagination<Row>({
        endpoint: '/queued-updater',
        extraParams: { keyword },
        autoLoad: false,
      });

      useLayoutEffect(() => {
        setKeyword = updateKeyword;
        staleLoadData = pagination.loadData;
      }, [pagination.loadData]);

      if (pagination.loading && !allowLoadingCommit) {
        loadingRenderCount += 1;
        throw renderBlocker.promise;
      }

      return createElement('span', null, `${keyword}:${pagination.loading ? 'loading' : 'idle'}`);
    }

    const view = render(
      createElement(
        StrictMode,
        null,
        createElement(
          Suspense,
          { fallback: createElement('span', null, 'fallback') },
          createElement(Harness)
        )
      )
    );

    act(() => {
      startTransition(() => void staleLoadData());
    });
    await waitFor(() => expect(loadingRenderCount).toBeGreaterThan(0));

    act(() => setKeyword('B'));
    expect(view.container.textContent).toBe('B:idle');

    allowLoadingCommit = true;
    await act(async () => {
      renderBlocker.resolve();
      await renderBlocker.promise;
    });

    await waitFor(() => expect(view.container.textContent).toBe('B:idle'));
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(getMock).toHaveBeenCalledWith('/queued-updater', {
      params: { page: 1, pageSize: 100, keyword: 'A' },
    });
  });

  it('StrictMode 下 B layout commit 后、A passive cleanup 前释放 A 仍不能落入 B', async () => {
    const strictProbeRequest = createDeferred<MockResponse>();
    const requestA = createDeferred<MockResponse>();
    const requestB = createDeferred<MockResponse>();
    let passiveCleanupA = false;
    let releasedBeforePassiveCleanup = false;
    mockDeferredGet(strictProbeRequest);
    mockDeferredGet(requestA);
    mockDeferredGet(requestB);

    const { result, rerender } = renderHook(
      ({ keyword }) => {
        const pagination = useServerPagination<Row>({
          endpoint: '/layout-race',
          extraParams: { keyword },
        });

        useLayoutEffect(() => {
          if (keyword !== 'B') return;
          releasedBeforePassiveCleanup = !passiveCleanupA;
          requestA.resolve(paginatedResponse('stale-A'));
        }, [keyword]);

        useEffect(
          () => () => {
            if (keyword === 'A') passiveCleanupA = true;
          },
          [keyword]
        );

        return pagination;
      },
      { initialProps: { keyword: 'A' }, wrapper: StrictModeWrapper }
    );

    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
    passiveCleanupA = false;
    rerender({ keyword: 'B' });

    await act(async () => {
      await requestA.promise;
      await Promise.resolve();
    });

    expect(releasedBeforePassiveCleanup).toBe(true);
    expect(result.current.data).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(true);

    await resolveRequest(requestB, paginatedResponse('current-B'));
    expect(result.current.data).toEqual([{ id: 'current-B' }]);
    expect(getMock).toHaveBeenCalledTimes(3);
  });

  it('Suspense 中止的参数 render 不会在 commit 前使当前请求失效', async () => {
    interface HarnessConfig {
      keyword: string;
      suspend: boolean;
    }

    const requestA = createDeferred<MockResponse>();
    const blocker = new Promise<void>(() => undefined);
    let setConfig!: (config: HarnessConfig) => void;
    let suspendedRenderCount = 0;
    mockDeferredGet(requestA);

    function Harness() {
      const [config, updateConfig] = useState<HarnessConfig>({ keyword: 'A', suspend: false });
      const pagination = useServerPagination<Row>({
        endpoint: '/customers',
        extraParams: { keyword: config.keyword },
      });

      useLayoutEffect(() => {
        setConfig = updateConfig;
      }, [updateConfig]);

      if (config.suspend) {
        suspendedRenderCount += 1;
        throw blocker;
      }

      return createElement('span', null, pagination.data[0]?.id ?? 'empty');
    }

    const view = render(
      createElement(
        Suspense,
        { fallback: createElement('span', null, 'fallback') },
        createElement(Harness)
      )
    );

    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      startTransition(() => setConfig({ keyword: 'B', suspend: true }));
      await Promise.resolve();
    });
    await waitFor(() => expect(suspendedRenderCount).toBeGreaterThan(0));

    // 取消未提交的 B transition；若 render 阶段错误推进了请求 identity，A 仍会被误判 stale。
    act(() => setConfig({ keyword: 'A', suspend: false }));
    await resolveRequest(requestA, paginatedResponse('A'));

    await waitFor(() => expect(view.container.textContent).toBe('A'));
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(getMock).toHaveBeenCalledWith('/customers', {
      params: { page: 1, pageSize: 100, keyword: 'A' },
    });
  });

  it('StrictMode 双 effect 中陈旧响应不会重复提交旧 state', async () => {
    const firstMountRequest = createDeferred<MockResponse>();
    const currentRequest = createDeferred<MockResponse>();
    const committedIds: string[] = [];
    mockDeferredGet(firstMountRequest);
    mockDeferredGet(currentRequest);

    const { result } = renderHook(
      () => {
        const state = useServerPagination<Row>({ endpoint: '/strict' });
        if (state.data[0]) committedIds.push(state.data[0].id);
        return state;
      },
      { wrapper: StrictModeWrapper }
    );

    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
    await resolveRequest(currentRequest, paginatedResponse('current'));
    await resolveRequest(firstMountRequest, paginatedResponse('stale'));

    expect(getMock).toHaveBeenNthCalledWith(1, '/strict', {
      params: { page: 1, pageSize: 100 },
    });
    expect(getMock).toHaveBeenNthCalledWith(2, '/strict', {
      params: { page: 1, pageSize: 100 },
    });
    expect(result.current.data).toEqual([{ id: 'current' }]);
    expect(result.current.loading).toBe(false);
    expect(committedIds).not.toContain('stale');
  });
});
