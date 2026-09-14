import type {
  FilterRegistryMeta,
  FilterSchemeConfig,
} from '@ky-azeroth/shared/schemas/filter-scheme';
import { useMemo, useState } from 'react';

import { CrudFilterBar } from '@/components/patterns/crud-filter-bar';
import { previewComposeScheme } from '@/hooks/use-filter-scheme';
import type { FilterValue } from '@/hooks/use-manual-filter';

export interface PreviewPanelProps {
  registry: FilterRegistryMeta;
  config: FilterSchemeConfig;
}

/**
 * 实时预览 —— 用当前草稿配置构造 CrudFilterBar，但完全不发请求。
 * 纯 UI，值仅维护在本地 state 里便于 admin 体验交互效果。
 */
export function PreviewPanel({ registry, config }: PreviewPanelProps) {
  const scheme = useMemo(
    () => previewComposeScheme({ registry, config, version: 1 }),
    [registry, config]
  );
  const [values, setValues] = useState<Record<string, FilterValue>>(scheme.initialFilters);

  // 草稿变化时重置本地预览值，避免脏值挂在失效 key 上
  useMemo(() => {
    setValues(scheme.initialFilters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheme.fields.length, config.keyword.enabled, config.keyword.fieldKeys.length]);

  const handleChange = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  if (scheme.fields.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
        当前没有任何筛选字段（含关键词搜索）
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-muted/20 p-4">
      <CrudFilterBar fields={scheme.fields} values={values} onChange={handleChange} />
    </div>
  );
}
