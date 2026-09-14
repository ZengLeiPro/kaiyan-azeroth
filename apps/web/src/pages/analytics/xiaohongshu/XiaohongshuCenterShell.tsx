import {
  BarChart3,
  BookOpenText,
  CircleDollarSign,
  Database,
  Layers3,
  Search,
  Target,
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  SelectContent,
  SelectItem,
  SelectRoot as Select,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AnalyticsDateRangePicker } from '@/pages/analytics/components/AnalyticsDateRangePicker';

import { useXiaohongshuCenter } from './xiaohongshu-center-context';

const NAV_ITEMS = [
  { path: 'overview', label: '经营总览', icon: BarChart3 },
  { path: 'delivery', label: '投放结构', icon: Layers3 },
  { path: 'content', label: '内容与笔记', icon: BookOpenText },
  { path: 'search', label: '搜索与人群', icon: Search },
  { path: 'leads', label: '线索与成交', icon: Target },
  { path: 'account', label: '账户与资金', icon: CircleDollarSign },
  { path: 'data', label: '全量数据', icon: Database },
] as const;

const GLOBAL_SEARCH_KEYS = new Set(['advertiser', 'range', 'start', 'end', 'caliber']);

// eslint-disable-next-line react-refresh/only-export-components -- 纯 URL 规则随壳组件放置并供单元测试复用。
export function getXiaohongshuGlobalSearch(search: string): string {
  const current = new URLSearchParams(search);
  const next = new URLSearchParams();
  for (const [key, value] of current.entries()) {
    if (GLOBAL_SEARCH_KEYS.has(key)) next.append(key, value);
  }
  const result = next.toString();
  return result ? `?${result}` : '';
}

export function XiaohongshuCenterShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const {
    range,
    setRange,
    advertiserId,
    setAdvertiserId,
    dataCaliber,
    setDataCaliber,
    advertisers,
  } = useXiaohongshuCenter();

  return (
    <div className="h-full overflow-auto bg-muted/10">
      <div className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-4 px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">小红书分析中心</h1>
              <Badge variant="outline">官方接口（API）全量目录</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              经营结论、逐层穿透与完整原始数据分开呈现
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {advertisers.isError ? (
              <Button size="sm" variant="destructive" onClick={() => void advertisers.refetch()}>
                广告主加载失败 · 重试
              </Button>
            ) : !advertisers.isLoading && (advertisers.data?.length ?? 0) === 0 ? (
              <Badge variant="destructive">尚未绑定可用广告主</Badge>
            ) : null}
            <Select
              value={String(dataCaliber)}
              onValueChange={(value) => setDataCaliber(value === '1' ? 1 : 0)}
            >
              <SelectTrigger className="w-[132px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">计费时间</SelectItem>
                <SelectItem value="1">转化时间</SelectItem>
              </SelectContent>
            </Select>
            <Select value={advertiserId} onValueChange={(value) => value && setAdvertiserId(value)}>
              <SelectTrigger className="w-[250px]">
                <SelectValue placeholder="选择广告主" />
              </SelectTrigger>
              <SelectContent>
                {(advertisers.data ?? []).map((advertiser) => (
                  <SelectItem key={advertiser.advertiserId} value={advertiser.advertiserId}>
                    {advertiser.advertiserName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <AnalyticsDateRangePicker value={range} onChange={setRange} />
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-6">
          {NAV_ITEMS.map((item) => {
            const active = location.pathname.endsWith(`/xiaohongshu/${item.path}`);
            const Icon = item.icon;
            return (
              <Link
                key={item.path}
                to={{
                  pathname: `/analytics/xiaohongshu/${item.path}`,
                  search: getXiaohongshuGlobalSearch(location.search),
                }}
                className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
      {children}
    </div>
  );
}
