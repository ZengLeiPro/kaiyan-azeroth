import { Boxes, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { StandardToolbar } from '@/components/patterns/standard-toolbar';
import { StandardLayout } from '@/components/templates/standard-layout';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { api, getErrorMessage } from '@/lib/api';
import { logger } from '@/lib/logger';

import { type CloudPackageProjectionProfile, toCloudPackageProjectionProfile } from './types';

const fmtNum = (v: number | string | null | undefined, decimals = 2): string => {
  if (v == null || v === '') return '-';
  const n = typeof v === 'number' ? v : Number(v);
  if (Number.isNaN(n)) return '-';
  return n.toLocaleString('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

const fmtDate = (s: string | null | undefined): string => {
  if (!s) return '-';
  // expect ISO-ish; take first 10 chars (YYYY-MM-DD)
  return s.slice(0, 10);
};

function ProgressBar({ percentRemaining }: { percentRemaining: number }) {
  const clamped = Math.max(0, Math.min(100, percentRemaining));
  const color = clamped >= 50 ? 'bg-green-500' : clamped >= 20 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="h-2 w-full overflow-hidden rounded bg-muted">
      <div className={`h-full ${color}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

export function CloudPackagesPage() {
  const [packages, setPackages] = useState<CloudPackageProjectionProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchPackages = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.get('/cloud-bill-snapshots/package-projection', {
        params: { vendor: 'aliyun' },
      });
      const items = (Array.isArray(res.data) ? res.data : (res.data?.items ?? [])) as Array<
        Parameters<typeof toCloudPackageProjectionProfile>[0]
      >;
      setPackages(items.map(toCloudPackageProjectionProfile));
    } catch (error) {
      logger.warn('CloudPackagesPage', 'fetch package projection failed', error);
      setErrorMsg(getErrorMessage(error, '加载资源包列表失败'));
      setPackages([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPackages();
  }, [fetchPackages]);

  const rows = useMemo(() => {
    return packages.map((p) => {
      const total = Number(p.totalAmount) || 0;
      const remaining = Number(p.remainingAmount) || 0;
      const percentRemaining = total > 0 ? (remaining / total) * 100 : 0;
      const percentUsed = total > 0 ? 100 - percentRemaining : 0;
      return {
        ...p,
        percentRemaining,
        percentUsed,
      };
    });
  }, [packages]);

  return (
    <StandardLayout
      toolbar={
        <StandardToolbar
          onReset={fetchPackages}
          filters={
            <div className="text-sm text-muted-foreground">
              资源包健康度（按产品 / 实例查看预测耗尽日）
            </div>
          }
        />
      }
    >
      <div className="space-y-3">
        {errorMsg && <p className="text-sm text-destructive">{errorMsg}</p>}
        {loading ? (
          <Card className="border">
            <CardContent className="flex h-40 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        ) : rows.length === 0 ? (
          <Card className="border">
            <CardContent className="flex h-40 flex-col items-center justify-center text-sm text-muted-foreground">
              <Boxes className="mb-2 h-8 w-8 opacity-50" />
              暂无资源包数据
            </CardContent>
          </Card>
        ) : (
          <Card className="border">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">包名 / 实例</th>
                      <th className="px-3 py-2 text-left">产品</th>
                      <th className="px-3 py-2 text-right">余量 / 总量</th>
                      <th className="px-3 py-2 text-left">占用率</th>
                      <th className="px-3 py-2 text-right">近 7 日日均</th>
                      <th className="px-3 py-2 text-left">预测耗尽日</th>
                      <th className="px-3 py-2 text-left">实际到期日</th>
                      <th className="px-3 py-2 text-left">余裕天数</th>
                      <th className="px-3 py-2 text-left">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const surplus = row.runoutSurplusDays;
                      let surplusEl: React.ReactNode = (
                        <span className="text-muted-foreground">-</span>
                      );
                      if (surplus != null) {
                        if (surplus < 0) {
                          surplusEl = (
                            <Badge className="bg-red-100 text-red-800">
                              提前耗尽 {Math.abs(surplus)} 天
                            </Badge>
                          );
                        } else if (surplus > 0) {
                          surplusEl = (
                            <Badge className="bg-gray-100 text-gray-800">用不完 {surplus} 天</Badge>
                          );
                        } else {
                          surplusEl = <Badge className="bg-amber-100 text-amber-800">刚好</Badge>;
                        }
                      }
                      return (
                        <tr key={row.instanceId} className="border-b last:border-b-0">
                          <td className="px-3 py-2">
                            <div className="font-medium">
                              {row.packageType || row.instanceId.slice(0, 24)}
                            </div>
                            <div className="font-mono text-[11px] text-muted-foreground">
                              {row.instanceId}
                            </div>
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">{row.productCode}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {fmtNum(row.remainingAmount)} / {fmtNum(row.totalAmount)}
                            <div className="text-[11px] text-muted-foreground">
                              {row.unit ?? ''}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <ProgressBar percentRemaining={row.percentRemaining} />
                              <span className="w-12 shrink-0 text-right text-xs tabular-nums">
                                {row.percentUsed.toFixed(0)}%
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {fmtNum(row.recentDailyAvg)}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {fmtDate(row.projectedRunoutDate)}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {fmtDate(row.expiryTime)}
                          </td>
                          <td className="px-3 py-2">{surplusEl}</td>
                          <td className="px-3 py-2">
                            <Badge variant="outline" className="text-[11px]">
                              {row.status ?? '-'}
                            </Badge>
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
