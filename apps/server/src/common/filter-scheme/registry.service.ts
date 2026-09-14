import { Injectable, Logger } from '@nestjs/common';

import type { FilterRegistry } from './define';

type RegistryListener = (registry: FilterRegistry) => void | Promise<void>;

@Injectable()
export class FilterSchemeRegistry {
  private readonly logger = new Logger(FilterSchemeRegistry.name);
  private readonly registries = new Map<string, FilterRegistry>();
  private readonly listeners = new Set<RegistryListener>();

  register(registry: FilterRegistry): void {
    const existing = this.registries.get(registry.pageKey);
    if (existing) {
      if (existing === registry) {
        return;
      }
      this.logger.warn(`检测到重复注册 pageKey=${registry.pageKey}，将覆盖旧 registry`);
    }

    this.registries.set(registry.pageKey, registry);

    for (const listener of this.listeners) {
      void Promise.resolve(listener(registry)).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '未知错误';
        this.logger.error(`registry listener 执行失败 pageKey=${registry.pageKey}: ${message}`);
      });
    }
  }

  get(pageKey: string): FilterRegistry | undefined {
    return this.registries.get(pageKey);
  }

  list(): FilterRegistry[] {
    return Array.from(this.registries.values()).sort((left, right) =>
      left.pageKey.localeCompare(right.pageKey)
    );
  }

  subscribe(listener: RegistryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
