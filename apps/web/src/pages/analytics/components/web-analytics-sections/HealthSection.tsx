import { Bot, Clock, Download, Gauge } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Pagination } from '@/components/ui/pagination';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ChartCard } from '@/pages/analytics/components/ChartCard';
import { KpiCard } from '@/pages/analytics/components/KpiCard';
import {
  EVENT_LABELS,
  fmtNumber,
  fmtPercent,
  fmtTime,
} from '@/pages/analytics/components/web-analytics-presenters';
import type { WebAnalyticsSectionProps } from '@/pages/analytics/components/web-analytics-sections/types';
import { VidDetailDrawer } from '@/pages/analytics/components/web-analytics-sections/VidDetailDrawer';
import {
  useWebAnalyticsEvents,
  useWebAnalyticsSummary,
} from '@/pages/analytics/hooks/use-web-analytics-data';

export function HealthSection({ dashboard }: WebAnalyticsSectionProps) {
  const { range, effectiveFilters, page, setPage, pageSize, setPageSize, vidDetail, setVidDetail } =
    dashboard;
  const summary = useWebAnalyticsSummary(range, effectiveFilters);
  const events = useWebAnalyticsEvents(range, effectiveFilters, page, pageSize);

  return (
    <>
      <>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <KpiCard
            label="资料下载"
            value={fmtNumber(summary.data?.resourceDownloads)}
            icon={Download}
            iconColor="text-blue-600"
            iconBg="bg-blue-100"
            loading={summary.isLoading}
          />
          <KpiCard
            label="标题覆盖率"
            value={fmtPercent(summary.data?.dataQuality.titleCoverage)}
            icon={Gauge}
            iconColor="text-emerald-600"
            iconBg="bg-emerald-100"
            loading={summary.isLoading}
          />
          <KpiCard
            label="来源域名覆盖率"
            value={fmtPercent(summary.data?.dataQuality.refHostCoverage)}
            hint="直接访问为空属正常"
            icon={Gauge}
            iconColor="text-cyan-600"
            iconBg="bg-cyan-100"
            loading={summary.isLoading}
          />
          <KpiCard
            label="UTM 来源覆盖率"
            value={fmtPercent(summary.data?.dataQuality.utmSourceCoverage)}
            icon={Gauge}
            iconColor="text-amber-600"
            iconBg="bg-amber-100"
            loading={summary.isLoading}
          />
          <KpiCard
            label="UTM Campaign 覆盖率"
            value={fmtPercent(summary.data?.dataQuality.utmCampaignCoverage)}
            icon={Gauge}
            iconColor="text-rose-600"
            iconBg="bg-rose-100"
            loading={summary.isLoading}
          />
          <KpiCard
            label="最后事件时间"
            value={fmtTime(summary.data?.lastEventAt)}
            icon={Clock}
            iconColor="text-violet-600"
            iconBg="bg-violet-100"
            loading={summary.isLoading}
          />
        </div>

        <ChartCard
          title={`事件明细（${fmtNumber(events.data?.total ?? 0)}）`}
          loading={events.isLoading}
          empty={!events.data || events.data.items.length === 0}
          height={420}
        >
          {events.data && (
            <div className="overflow-hidden rounded-md border">
              <div className="max-h-[420px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>时间</TableHead>
                      <TableHead>事件</TableHead>
                      <TableHead>页面</TableHead>
                      <TableHead>来源</TableHead>
                      <TableHead>位置/渠道</TableHead>
                      <TableHead>VID</TableHead>
                      <TableHead>IP</TableHead>
                      <TableHead className="text-right">Bot</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {events.data.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="whitespace-nowrap text-xs tabular-nums">
                          {fmtTime(item.receivedAt)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={item.event === 'pageview' ? 'secondary' : 'default'}>
                            {EVENT_LABELS[item.event] ?? item.event}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div
                            className="max-w-[360px] truncate font-medium"
                            title={item.title ?? item.path ?? ''}
                          >
                            {item.title ?? item.path ?? '-'}
                          </div>
                          <div
                            className="max-w-[360px] truncate text-xs text-muted-foreground"
                            title={item.path ?? ''}
                          >
                            {item.path ?? '-'}
                            {item.pageType ? ` · ${item.pageType}` : ''}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="max-w-[240px] truncate" title={item.refHost ?? ''}>
                            {item.utmSource ?? item.refHost ?? '(direct)'}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {item.utmMedium ?? item.refHost ?? '-'}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>{item.placement ?? '-'}</div>
                          <div className="text-xs text-muted-foreground">{item.channel ?? '-'}</div>
                        </TableCell>
                        <TableCell>
                          {item.vid ? (
                            <button
                              type="button"
                              onClick={() => setVidDetail(item.vid)}
                              className="font-mono text-xs text-primary hover:underline focus:outline-none"
                              title={`查看 ${item.vid} 全部事件`}
                            >
                              {item.vid.slice(0, 12)}…
                            </button>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {item.ip ? (
                            <a
                              href={`https://whois.domaintools.com/${item.ip}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-xs text-primary hover:underline"
                              title={`whois 查询 ${item.ip}（B2B 线索定位）`}
                            >
                              {item.ip}
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {item.isBot ? (
                            <Bot className="ml-auto h-4 w-4 text-amber-600" />
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="border-t bg-card">
                <Pagination
                  total={events.data.total}
                  page={page}
                  pageSize={pageSize}
                  onPageChange={setPage}
                  onPageSizeChange={(size) => {
                    setPageSize(size);
                    setPage(1);
                  }}
                  showPageSizeChanger
                  showQuickJumper
                  showTotal
                />
              </div>
            </div>
          )}
        </ChartCard>
      </>
      <VidDetailDrawer vid={vidDetail} range={range} onClose={() => setVidDetail(null)} />
    </>
  );
}
