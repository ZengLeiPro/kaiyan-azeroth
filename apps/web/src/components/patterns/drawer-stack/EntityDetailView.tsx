import { AlertCircle, Loader2, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';

import { ActionItemSourceBanner } from '../sales-action/action-item-source-banner';
import type { DrawerEntry } from './context';
import { getEntityRenderer, loadEntityRenderers, subscribeRegistry } from './entity-registry';

interface EntityDetailViewProps {
  entry: DrawerEntry;
}

type LoadState = 'loading' | 'failed' | 'missing' | 'ready';

/**
 * 栈顶 Entry 的渲染入口。委托给 entity-registry 中各实体注册的 renderer.render(id)。
 * lazy loader 的失败在本层转成可重试错误态；requestGenerationRef 防止旧代失败覆盖新代注册成功。
 */
export function EntityDetailView({ entry }: EntityDetailViewProps) {
  const [, setVersion] = useState(0);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>(() =>
    getEntityRenderer(entry.type) ? 'ready' : 'loading'
  );
  const requestGenerationRef = useRef(0);

  useEffect(() => {
    const unsubscribe = subscribeRegistry(() => {
      if (getEntityRenderer(entry.type)) {
        // register 事件是比任何在途 promise 更强的新成功代，旧 reject 不得再改写错误态。
        requestGenerationRef.current += 1;
        setLoadState('ready');
      }
      setVersion((version) => version + 1);
    });
    return unsubscribe;
  }, [entry.type]);

  useEffect(() => {
    if (getEntityRenderer(entry.type)) {
      requestGenerationRef.current += 1;
      setLoadState('ready');
      return;
    }

    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    let active = true;
    setLoadState('loading');

    void loadEntityRenderers().then(
      () => {
        if (!active || requestGenerationRef.current !== generation) return;
        setVersion((version) => version + 1);
        setLoadState(getEntityRenderer(entry.type) ? 'ready' : 'missing');
      },
      () => {
        if (!active || requestGenerationRef.current !== generation) return;
        setLoadState('failed');
      }
    );

    return () => {
      active = false;
    };
  }, [entry.type, retryGeneration]);

  const renderer = getEntityRenderer(entry.type);
  if (!renderer) {
    if (loadState === 'failed') {
      return (
        <div
          role="alert"
          className="flex flex-col items-center gap-3 rounded-md border border-dashed border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive"
        >
          <AlertCircle className="h-5 w-5" aria-hidden="true" />
          <span>详情组件加载失败，请重试。</span>
          <Button
            type="button"
            variant="outline"
            onClick={() => setRetryGeneration((generation) => generation + 1)}
          >
            <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
            重试
          </Button>
        </div>
      );
    }

    if (loadState === 'missing') {
      return (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
          <AlertCircle className="h-5 w-5" aria-hidden="true" />
          <span>未注册的实体类型：{entry.type}</span>
        </div>
      );
    }

    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground" role="status">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
        <span className="text-sm">加载中...</span>
      </div>
    );
  }

  const mode = entry.mode ?? 'detail';
  if (mode === 'create') {
    if (typeof renderer.renderCreate !== 'function') {
      return (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
          <AlertCircle className="h-5 w-5" aria-hidden="true" />
          <span>实体 {entry.type} 未实现创建视图</span>
        </div>
      );
    }
    return <>{renderer.renderCreate(entry.presets)}</>;
  }

  if (typeof renderer.render !== 'function') {
    return (
      <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
        <AlertCircle className="h-5 w-5" aria-hidden="true" />
        <span>未注册的实体类型：{entry.type}</span>
      </div>
    );
  }

  const sourceActionItemId =
    typeof entry.context?.sourceActionItemId === 'string'
      ? entry.context.sourceActionItemId
      : undefined;
  const sourceActionItemTitle =
    typeof entry.context?.sourceActionItemTitle === 'string'
      ? entry.context.sourceActionItemTitle
      : undefined;

  return (
    <>
      {sourceActionItemId && (
        <ActionItemSourceBanner actionItemId={sourceActionItemId} title={sourceActionItemTitle} />
      )}
      {renderer.render(entry.id, entry.context)}
    </>
  );
}
