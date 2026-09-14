import type { ICloudCostOverview } from '@ky-azeroth/shared/types/cloud-bill-snapshot';
import { format } from 'date-fns';
import { CalendarClock, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { StandardToolbar } from '@/components/patterns/standard-toolbar';
import { StandardLayout } from '@/components/templates/standard-layout';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { api, getErrorMessage } from '@/lib/api';
import { logger } from '@/lib/logger';

import { type CloudRenewalItemProfile, toCloudRenewalItemProfile } from './types';

export function CloudRenewalPage() {
  const [items, setItems] = useState<CloudRenewalItemProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchRenewal = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.get<ICloudCostOverview>('/cloud-bill-snapshots/overview', {
        params: { vendor: 'aliyun' },
      });
      const sorted = [...(res.data.upcomingExpirations ?? [])].sort(
        (a, b) => a.daysLeft - b.daysLeft
      );
      setItems(sorted.map(toCloudRenewalItemProfile));
    } catch (error) {
      logger.warn('CloudRenewalPage', 'fetch renewal failed', error);
      setErrorMsg(getErrorMessage(error, '加载续费日历失败'));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRenewal();
  }, [fetchRenewal]);

  const grouped = useMemo(() => {
    const danger: CloudRenewalItemProfile[] = [];
    const warn: CloudRenewalItemProfile[] = [];
    const normal: CloudRenewalItemProfile[] = [];
    for (const item of items) {
      if (item.daysLeft <= 7) danger.push(item);
      else if (item.daysLeft <= 30) warn.push(item);
      else normal.push(item);
    }
    return { danger, warn, normal };
  }, [items]);

  return (
    <StandardLayout
      toolbar={
        <StandardToolbar
          onReset={fetchRenewal}
          filters={
            <div className="text-sm text-muted-foreground">30 天内到期资源（按倒计时升序）</div>
          }
        />
      }
    >
      <div className="space-y-3">
        {errorMsg && <p className="text-sm text-destructive">{errorMsg}</p>}

        <div className="grid gap-3 sm:grid-cols-3">
          <Card className="border border-red-200">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">紧急（≤ 7 天）</p>
              <p className="mt-1 text-2xl font-bold text-red-700">{grouped.danger.length}</p>
            </CardContent>
          </Card>
          <Card className="border border-amber-200">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">关注（≤ 30 天）</p>
              <p className="mt-1 text-2xl font-bold text-amber-700">{grouped.warn.length}</p>
            </CardContent>
          </Card>
          <Card className="border">
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">其他</p>
              <p className="mt-1 text-2xl font-bold">{grouped.normal.length}</p>
            </CardContent>
          </Card>
        </div>

        {loading ? (
          <Card className="border">
            <CardContent className="flex h-40 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        ) : items.length === 0 ? (
          <Card className="border">
            <CardContent className="flex h-40 flex-col items-center justify-center text-sm text-muted-foreground">
              <CalendarClock className="mb-2 h-8 w-8 opacity-50" />
              暂无到期资源
            </CardContent>
          </Card>
        ) : (
          <Card className="border">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">资源类型</th>
                      <th className="px-3 py-2 text-left">产品代码</th>
                      <th className="px-3 py-2 text-left">实例 ID</th>
                      <th className="px-3 py-2 text-left">资源名称</th>
                      <th className="px-3 py-2 text-left">到期日</th>
                      <th className="px-3 py-2 text-left">倒计时</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const danger = item.daysLeft <= 7;
                      const warn = !danger && item.daysLeft <= 30;
                      const cls = danger
                        ? 'bg-red-100 text-red-800'
                        : warn
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-gray-100 text-gray-800';
                      return (
                        <tr
                          key={`${item.kind}-${item.instanceId}`}
                          className="border-b last:border-b-0"
                        >
                          <td className="px-3 py-2">
                            <Badge variant="outline" className="text-[11px]">
                              {item.kind === 'package' ? '资源包' : '订阅'}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">{item.productCode}</td>
                          <td className="px-3 py-2 font-mono text-xs">{item.instanceId}</td>
                          <td className="px-3 py-2">{item.label}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {format(new Date(item.expiryTime), 'yyyy-MM-dd')}
                          </td>
                          <td className="px-3 py-2">
                            <Badge className={cls}>剩余 {item.daysLeft} 天</Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </StandardLayout>
  );
}
