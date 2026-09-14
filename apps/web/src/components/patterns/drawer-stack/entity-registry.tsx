import { ReactNode } from 'react';

import type { DrawerEntityType } from './context';

/**
 * 实体在叠加抽屉里的注册条目。
 *
 * 设计选择：每个实体在自己的 `<entity>-fields.tsx` 中实现详情/创建视图函数：
 * - `render(id)`：fetch + view-mode 渲染 + 嵌套 RelatedEntityList
 * - `renderCreate(presets)`（可选）：渲染创建表单，提交后由调用方 pop 抽屉
 *
 * 通过 `registerEntityDetail` 在 registry 中注册。EntityDetailView 根据 entry.mode 选择 renderer。
 */
export interface EntityDetailRenderer {
  /** 详情视图渲染。内部自己 fetch + 渲染 fields + 嵌套 RelatedEntityList。 */
  render: (id: string, context?: Record<string, unknown>) => ReactNode;
  /** 抽屉头部默认标题（push 时未传 title 则 fallback 到这里）。 */
  defaultTitle?: string;
  /**
   * 创建视图渲染（可选）。push 时传 mode='create' 即调用此函数，presets 中是预填字段
   * （例如 `{ customerId }` 用于在客户详情里就地新建关联记录）。
   * 内部应在创建成功后调用 `useDrawerStack().pop()` 关闭当前层。
   */
  renderCreate?: (presets?: Record<string, unknown>) => ReactNode;
  /** 创建模式默认标题（如 `新建跟进`），push create 模式且未传 title 时 fallback。 */
  defaultCreateTitle?: string;
}

const REGISTRY: Partial<Record<DrawerEntityType, EntityDetailRenderer>> = {};
/** registry 变化时通知订阅者（EntityDetailView 等待 lazy 加载完成后强制刷新） */
const subscribers = new Set<() => void>();

/** 在业务 composition root 加载 fields 模块时同步注册。 */
export function registerEntityDetail(type: DrawerEntityType, renderer: EntityDetailRenderer): void {
  REGISTRY[type] = renderer;
  // 通知 EntityDetailView lazy 加载完成
  for (const cb of subscribers) cb();
}

export function getEntityRenderer(type: DrawerEntityType): EntityDetailRenderer | undefined {
  return REGISTRY[type];
}

/** EntityDetailView 订阅 registry 变化（lazy 加载完成时触发重渲染） */
export function subscribeRegistry(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

export type EntityRendererLoader = () => Promise<unknown>;

let rendererLoader: EntityRendererLoader | undefined;
let rendererLoaderPromise: Promise<unknown> | null = null;

/**
 * Installs the business-owned lazy loader. App/feature shells are the composition boundary; the
 * generic registry never imports a page module. Reinstalling the same loader is idempotent (notably
 * for React StrictMode/HMR), while changing it starts a new loader generation.
 */
export function configureEntityRendererLoader(loader: EntityRendererLoader): void {
  if (rendererLoader === loader) return;
  rendererLoader = loader;
  rendererLoaderPromise = null;
}

/**
 * Loads the configured business renderers once. A rejected load is cleared so a later drawer open
 * may retry; successful concurrent calls share one promise and preserve the existing lazy semantics.
 */
export function loadEntityRenderers(): Promise<unknown> {
  if (!rendererLoader) {
    return Promise.reject(new Error('Entity renderer loader has not been configured'));
  }
  if (!rendererLoaderPromise) {
    const generationLoader = rendererLoader;
    const pending = Promise.resolve()
      .then(generationLoader)
      .catch((error: unknown) => {
        if (rendererLoader === generationLoader && rendererLoaderPromise === pending) {
          rendererLoaderPromise = null;
        }
        throw error;
      });
    rendererLoaderPromise = pending;
  }
  return rendererLoaderPromise;
}
