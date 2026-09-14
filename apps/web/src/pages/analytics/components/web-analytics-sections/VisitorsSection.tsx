import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ChartCard } from '@/pages/analytics/components/ChartCard';
import { RankingBarChart } from '@/pages/analytics/components/RankingBarChart';
import { fmtNumber } from '@/pages/analytics/components/web-analytics-presenters';
import type { WebAnalyticsSectionProps } from '@/pages/analytics/components/web-analytics-sections/types';
import {
  useWebAnalyticsLeadRadar,
  useWebAnalyticsSearchKeywords,
} from '@/pages/analytics/hooks/use-web-analytics-data';

export function VisitorsSection({ dashboard }: WebAnalyticsSectionProps) {
  const { range, effectiveFilters } = dashboard;
  const searchKeywords = useWebAnalyticsSearchKeywords(range, effectiveFilters, 30);
  const leadRadar = useWebAnalyticsLeadRadar(range, effectiveFilters, 30);

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <ChartCard
        title="搜索词"
        description="从 referrer 提取的搜索 query。HTTPS 屏蔽下命中率天然偏低，命中即赚。"
        loading={searchKeywords.isLoading}
        empty={!searchKeywords.data || searchKeywords.data.items.length === 0}
        height={360}
      >
        {searchKeywords.data && (
          <RankingBarChart
            data={searchKeywords.data.items.map((item) => ({
              id: item.keyword,
              name: item.keyword,
              value: item.count,
            }))}
            limit={15}
            height={330}
            yAxisWidth={220}
          />
        )}
      </ChartCard>

      <ChartCard
        title="B2B 线索雷达"
        description="按 IP 聚合疑似企业访客，点 IP 跳 whois 反查公司。仅 admin 可见。"
        loading={leadRadar.isLoading}
        empty={!leadRadar.data || leadRadar.data.items.length === 0}
        height={360}
      >
        {leadRadar.data && (
          <div className="max-h-[360px] overflow-auto rounded-md border">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>IP / 归属</TableHead>
                  <TableHead className="text-right">会话</TableHead>
                  <TableHead className="text-right">浏览</TableHead>
                  <TableHead className="text-right">页数</TableHead>
                  <TableHead className="text-right">咨询</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leadRadar.data.items.map((item) => (
                  <TableRow key={item.ip} className={item.hasConsult ? 'bg-emerald-50' : undefined}>
                    <TableCell>
                      <a
                        href={`https://whois.domaintools.com/${item.ip}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs text-primary hover:underline"
                        title={`whois 查询 ${item.ip}`}
                      >
                        {item.ip}
                      </a>
                      <div className="text-xs text-muted-foreground">
                        {[item.region, item.city].filter(Boolean).join(' ') || '-'}
                        {item.isp ? ` · ${item.isp}` : ''}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtNumber(item.sessions)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtNumber(item.pageviews)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtNumber(item.distinctPages)}
                    </TableCell>
                    <TableCell className="text-right">
                      {item.hasLead ? (
                        <Badge variant="default">已留资</Badge>
                      ) : item.hasConsult ? (
                        <Badge variant="secondary">有咨询意向</Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </ChartCard>
    </div>
  );
}
