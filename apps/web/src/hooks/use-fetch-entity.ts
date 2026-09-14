import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { api, getErrorMessage } from '@/lib/api';

export interface UseFetchEntityResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  /**
   * 接受同一实体写请求返回的最新快照，并使此前已发出的 GET 全部过期。
   * 若快照带严格正整数 version，后续更低版本的 GET 不会覆盖它。
   */
  commitData: (data: T) => void;
}

interface FetchState<T> {
  identity: string;
  data: T | null;
  loading: boolean;
  error: string | null;
}

interface CommittedFetchToken {
  identity: string;
  generation: number;
  mounted: boolean;
}

interface VersionFloor {
  identity: string;
  generation: number;
  version: number;
}

function getEntityVersion(value: unknown): number | null {
  if (!value || typeof value !== 'object' || !('version' in value)) return null;
  const version = (value as { version?: unknown }).version;
  return typeof version === 'number' && Number.isInteger(version) && version > 0 ? version : null;
}

function createFetchState<T>(identity: string, hasId: boolean): FetchState<T> {
  return {
    identity,
    data: null,
    loading: hasId,
    error: null,
  };
}

/**
 * 通用「按 id 拉单条详情」hook，封装 GET <endpoint>/<id>。
 *
 * 用途：DrawerStack 体系下的 EntityDetailView 在 push 入栈时用 entry.id 拉详情。
 * 不复用 useCrud（useCrud 是列表+表单一体的状态机，不适合纯只读单条 fetch）。
 *
 * 竞态不变量：
 * - endpoint + id 共同定义 identity；render 只根据最后一次 commit 计算候选 generation。
 * - identity/generation 仅在 layout commit 发布，Suspense 中止的 render 不得使已提交闭包失效。
 * - 每个 refetch 闭包只属于创建它的 generation。旧闭包不得推进 sequence，也不得发请求。
 * - 响应、异常和 finally 同时校验 identity、generation、sequence 和 mounted 状态。
 * - commitData 会栅栏此前的 GET，并以 version 下界拒绝同 identity 的降版本响应。
 */
export function useFetchEntity<T>(
  endpoint: string,
  id: string | null | undefined
): UseFetchEntityResult<T> {
  const identity = JSON.stringify([endpoint, id ?? null]);
  const hasId = !!id;

  const committedRef = useRef<CommittedFetchToken>({
    identity,
    generation: 1,
    mounted: false,
  });
  const sequenceRef = useRef(0);
  const versionFloorRef = useRef<VersionFloor | null>(null);

  // 只读取最后一次 commit 的 token。候选 token 在 render 中不写 ref，aborted render 因而无副作用。
  const committed = committedRef.current;
  const generation =
    committed.identity === identity ? committed.generation : committed.generation + 1;

  const [state, setState] = useState<FetchState<T>>(() => createFetchState<T>(identity, hasId));

  const isCurrentGeneration = useCallback(() => {
    const current = committedRef.current;
    return current.mounted && current.identity === identity && current.generation === generation;
  }, [generation, identity]);

  const commitData = useCallback(
    (nextData: T) => {
      // 旧 identity / 已卸载闭包必须是严格 no-op，连 sequence 都不能推进。
      if (!isCurrentGeneration()) return;

      const version = getEntityVersion(nextData);
      const floor = versionFloorRef.current;
      const currentFloor =
        floor?.identity === identity && floor.generation === generation ? floor : null;

      // 已建立 version 下界后，低版本或无合法版本的写响应必须是严格 no-op。
      if (currentFloor && (version === null || version < currentFloor.version)) return;

      sequenceRef.current += 1;
      if (version !== null) {
        versionFloorRef.current = {
          identity,
          generation,
          version: currentFloor ? Math.max(currentFloor.version, version) : version,
        };
      }
      setState({ identity, data: nextData, loading: false, error: null });
    },
    [generation, identity, isCurrentGeneration]
  );

  const refetch = useCallback(async () => {
    // 检查必须发生在 sequence++ 和 api.get 之前，避免旧闭包干扰当前实体。
    if (!isCurrentGeneration()) return;

    sequenceRef.current += 1;
    const requestSequence = sequenceRef.current;

    if (!id) {
      setState(createFetchState<T>(identity, false));
      return;
    }

    setState((current) => ({
      identity,
      data: current.identity === identity ? current.data : null,
      loading: true,
      error: null,
    }));

    try {
      const response = await api.get<T>(`${endpoint}/${id}`);
      if (!isCurrentGeneration() || requestSequence !== sequenceRef.current) return;

      const responseVersion = getEntityVersion(response.data);
      const floor = versionFloorRef.current;
      const hasCurrentFloor = floor?.identity === identity && floor.generation === generation;
      const wouldRegressCommittedVersion =
        hasCurrentFloor && (responseVersion === null || responseVersion < floor.version);

      if (!wouldRegressCommittedVersion) {
        if (responseVersion !== null) {
          versionFloorRef.current = {
            identity,
            generation,
            version: hasCurrentFloor ? Math.max(floor.version, responseVersion) : responseVersion,
          };
        }
        setState({ identity, data: response.data, loading: true, error: null });
      }
    } catch (err) {
      if (!isCurrentGeneration() || requestSequence !== sequenceRef.current) return;
      setState({
        identity,
        data: null,
        loading: true,
        error: getErrorMessage(err, '加载失败'),
      });
    } finally {
      if (isCurrentGeneration() && requestSequence === sequenceRef.current) {
        setState((current) =>
          current.identity === identity ? { ...current, loading: false } : current
        );
      }
    }
  }, [endpoint, generation, id, identity, isCurrentGeneration]);

  // 只有 commit 才发布 identity/generation。cleanup 同步让旧闭包和所有在途请求失效。
  useLayoutEffect(() => {
    const previous = committedRef.current;
    if (previous.identity !== identity || previous.generation !== generation) {
      sequenceRef.current += 1;
      versionFloorRef.current = null;
    }
    committedRef.current = { identity, generation, mounted: true };

    return () => {
      const current = committedRef.current;
      if (current.identity !== identity || current.generation !== generation) return;
      committedRef.current = { ...current, mounted: false };
      sequenceRef.current += 1;
    };
  }, [generation, identity]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // identity-tagged state 确保切换 render 从不向调用方暴露上一实体的数据/错误/loading。
  const visibleState = state.identity === identity ? state : createFetchState<T>(identity, hasId);

  return { ...visibleState, refetch, commitData };
}
