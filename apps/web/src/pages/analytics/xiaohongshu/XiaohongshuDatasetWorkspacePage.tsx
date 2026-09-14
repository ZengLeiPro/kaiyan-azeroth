import type { XiaohongshuDatasetGroup } from '@ky-azeroth/shared/types';
import { Database, Loader2, RefreshCw, ShieldCheck, Unplug } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectRoot as Select,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { useXiaohongshuDatasetCatalog } from './use-xiaohongshu-datasets';
import { useXiaohongshuCenter } from './xiaohongshu-center-context';
import { XiaohongshuDatasetPanel } from './XiaohongshuDatasetPanel';

const GROUP_LABELS: Record<XiaohongshuDatasetGroup, string> = {
  report: '效果报表',
  delivery: '投放对象',
  content: '内容素材',
  search: '搜索词库',
  audience: '人群定向',
  conversion: '线索转化',
  account: '账户资金',
  asset: '资产能力',
  audit: '治理审计',
};

export function XiaohongshuDatasetWorkspacePage({
  title,
  description,
  groups,
  datasetIds,
  initialDataset,
}: {
  title: string;
  description: string;
  groups?: XiaohongshuDatasetGroup[];
  datasetIds?: string[];
  initialDataset?: string;
}) {
  const { advertiserId, range, dataCaliber } = useXiaohongshuCenter();
  const catalog = useXiaohongshuDatasetCatalog(advertiserId);
  const [searchParams, setSearchParams] = useSearchParams();
  const datasets = useMemo(
    () =>
      (catalog.data?.datasets ?? []).filter(
        (item) =>
          (!groups || groups.includes(item.group)) && (!datasetIds || datasetIds.includes(item.id))
      ),
    [catalog.data?.datasets, datasetIds, groups]
  );
  const requestedDatasetId = searchParams.get('dataset') ?? '';
  const datasetId = datasets.some((item) => item.id === requestedDatasetId)
    ? requestedDatasetId
    : (datasets.find((item) => item.id === initialDataset)?.id ?? datasets[0]?.id ?? '');

  useEffect(() => {
    if (!datasetId || requestedDatasetId === datasetId) return;
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set('dataset', datasetId);
        next.delete('datasetPage');
        return next;
      },
      { replace: true }
    );
  }, [datasetId, requestedDatasetId, setSearchParams]);

  const selectDataset = (value: string) => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set('dataset', value);
        next.delete('datasetPage');
        return next;
      },
      { replace: true }
    );
  };

  const available = datasets.filter((item) => item.queryable).length;
  const conditional = datasets.length - available;
  const grouped = useMemo(() => {
    const result = new Map<XiaohongshuDatasetGroup, typeof datasets>();
    for (const dataset of datasets) {
      const items = result.get(dataset.group) ?? [];
      items.push(dataset);
      result.set(dataset.group, items);
    }
    return [...result.entries()];
  }, [datasets]);

  if (catalog.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (catalog.isError) {
    return (
      <div className="p-6">
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex items-center justify-between gap-4 p-5 text-sm">
            <span>数据目录加载失败，当前无法判断哪些能力可查询。</span>
            <Button size="sm" variant="outline" onClick={() => void catalog.refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              重试
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <Select value={datasetId} onValueChange={(value) => value && selectDataset(value)}>
          <SelectTrigger className="w-[320px]">
            <SelectValue placeholder="选择数据集" />
          </SelectTrigger>
          <SelectContent>
            {grouped.map(([group, items]) => (
              <SelectGroup key={group}>
                <SelectLabel>{GROUP_LABELS[group]}</SelectLabel>
                {items.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <Database className="h-4 w-4 text-primary" />
              本页 {datasets.length} 个数据集
            </span>
            <Badge variant="outline" className="gap-1">
              <ShieldCheck className="h-3 w-3 text-emerald-600" /> 已接入 {available}
            </Badge>
            <Badge variant="outline" className="gap-1">
              <Unplug className="h-3 w-3 text-amber-600" /> 条件开放 {conditional}
            </Badge>
          </div>
          {datasets.length === 0 ? (
            <p className="text-sm text-muted-foreground">当前页面没有匹配的数据集。</p>
          ) : (
            <div className="space-y-3">
              {grouped.map(([group, items]) => (
                <div key={group} className="flex items-start gap-3">
                  <span className="w-20 shrink-0 pt-1 text-xs font-medium text-muted-foreground">
                    {GROUP_LABELS[group]}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {items.map((item) => (
                      <button key={item.id} type="button" onClick={() => selectDataset(item.id)}>
                        <Badge variant={item.id === datasetId ? 'default' : 'outline'}>
                          {item.label}
                          {!item.queryable && <span className="ml-1 opacity-60">· 条件开放</span>}
                        </Badge>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {datasetId && (
        <XiaohongshuDatasetPanel
          key={`${datasetId}:${advertiserId}:${range.preset}:${range.startDate ?? ''}:${range.endDate ?? ''}:${dataCaliber}`}
          datasetId={datasetId}
        />
      )}
    </div>
  );
}
