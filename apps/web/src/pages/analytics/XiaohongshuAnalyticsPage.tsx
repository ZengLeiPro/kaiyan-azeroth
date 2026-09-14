import type {
  XiaohongshuMetricCoverageStatus,
  XiaohongshuRankingMetric,
  XiaohongshuReportLevel,
  XiaohongshuSyncStatus,
} from '@ky-azeroth/shared/types';
import { useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import {
  Activity,
  CircleDollarSign,
  ExternalLink,
  Eye,
  FileCheck2,
  FileText,
  Loader2,
  type LucideIcon,
  MessageCircle,
  MousePointerClick,
  Percent,
  RefreshCw,
  UserRoundCheck,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Pagination } from '@/components/ui/pagination';
import {
  SelectContent,
  SelectItem,
  SelectRoot as Select,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTimeDisplay } from '@/lib/date-utils';
import { ChartCard } from '@/pages/analytics/components/ChartCard';
import { KpiCard } from '@/pages/analytics/components/KpiCard';
import { RankingBarChart } from '@/pages/analytics/components/RankingBarChart';

import {
  useXiaohongshuLatestSyncRun,
  useXiaohongshuRanking,
  useXiaohongshuReports,
  useXiaohongshuSummary,
  useXiaohongshuTrend,
} from './hooks/use-xiaohongshu-analytics-data';
import { useXiaohongshuCenter } from './xiaohongshu/xiaohongshu-center-context';
import { XiaohongshuCoverageStrip } from './xiaohongshu/XiaohongshuCoverageStrip';
import {
  XiaohongshuOperatingBrief,
  XiaohongshuTrendWorkbench,
} from './xiaohongshu/XiaohongshuOperatingInsights';
import {
  buildXiaohongshuFunnelStages,
  formatXiaohongshuDeltaHint,
  formatXiaohongshuFunnelCost,
  formatXiaohongshuFunnelRate,
  formatXiaohongshuReportValue,
  getSafeXiaohongshuHttpUrl,
  getSafeXiaohongshuImageUrl,
  getXiaohongshuReportColumnValue,
  getXiaohongshuReportDataColumns,
  type XiaohongshuFunnelStage,
} from './xiaohongshu-analytics-page-utils';

const SYNC_STATUS: Record<
  XiaohongshuSyncStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  running: { label: '同步中', variant: 'secondary' },
  success: { label: '成功', variant: 'default' },
  partial: { label: '部分成功', variant: 'outline' },
  failed: { label: '失败', variant: 'destructive' },
};

const RANKING_METRICS: Array<{ value: XiaohongshuRankingMetric; label: string }> = [
  { value: 'fee', label: '消费' },
  { value: 'impression', label: '曝光' },
  { value: 'click', label: '点击' },
  { value: 'interaction', label: '互动' },
  { value: 'messageConsult', label: '私信咨询' },
  { value: 'messageLead', label: '私信留资' },
  { value: 'formSubmit', label: '表单提交' },
  { value: 'validFormSubmit', label: '有效表单' },
];

const RANKING_LEVELS: Array<{ value: XiaohongshuReportLevel; label: string }> = [
  { value: 'campaign', label: '计划' },
  { value: 'unit', label: '单元' },
  { value: 'creative', label: '创意' },
  { value: 'note', label: '笔记' },
];

const fmtAmount = (value: unknown): string => {
  const number = Number(value);
  if (value == null || !Number.isFinite(number)) return '-';
  return `¥${number.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtInteger = (value: number | null | undefined): string =>
  value == null ? '-' : value.toLocaleString('zh-CN');

const fmtPercent = (value: unknown): string => {
  if (value == null) return '-';
  const number = Number(value);
  return Number.isFinite(number) ? `${(number * 100).toFixed(2)}%` : '-';
};

function coveredValue(
  value: number | null | undefined,
  coverage?: XiaohongshuMetricCoverageStatus
): number | null {
  return coverage === 'unavailable' ? null : (value ?? null);
}

function CoverageLabel({ status }: { status?: XiaohongshuMetricCoverageStatus }) {
  if (!status || status === 'full') return null;
  return (
    <Badge variant="outline" className="ml-1 px-1 py-0 text-[10px] font-normal">
      {status === 'partial' ? '部分覆盖' : '不可用'}
    </Badge>
  );
}

function FunnelRow({ title, stages }: { title: string; stages: XiaohongshuFunnelStage[] }) {
  return (
    <div>
      <h4 className="mb-2 text-sm font-medium">{title}</h4>
      <div className="grid gap-2 sm:grid-cols-4">
        {stages.map((stage, index) => (
          <div key={stage.label} className="relative rounded-md border bg-muted/20 px-3 py-2">
            <p className="text-xs text-muted-foreground">
              {stage.label}
              <CoverageLabel status={stage.coverage} />
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{fmtInteger(stage.value)}</p>
            {(stage.rateLabel || stage.costLabel) && (
              <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {stage.rateLabel && (
                  <p>
                    {stage.rateLabel}：
                    <span className="font-medium tabular-nums text-foreground">
                      {formatXiaohongshuFunnelRate(stage.rate)}
                    </span>
                  </p>
                )}
                {stage.costLabel && (
                  <p>
                    {stage.costLabel}：
                    <span className="font-medium tabular-nums text-foreground">
                      {formatXiaohongshuFunnelCost(stage.cost)}
                    </span>
                  </p>
                )}
              </div>
            )}
            {index < stages.length - 1 && (
              <span className="absolute -right-2.5 top-1/2 z-10 hidden -translate-y-1/2 bg-background px-0.5 text-muted-foreground sm:block">
                →
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function XiaohongshuAnalyticsPage() {
  const queryClient = useQueryClient();
  const { range, advertiserId, dataCaliber, advertisers } = useXiaohongshuCenter();
  const [rankingLevel, setRankingLevel] = useState<XiaohongshuReportLevel>('creative');
  const [rankingMetric, setRankingMetric] = useState<XiaohongshuRankingMetric>('fee');
  const [reportPage, setReportPage] = useState(1);
  const [reportPageSize, setReportPageSize] = useState(100);

  useEffect(() => {
    setReportPage(1);
  }, [range, advertiserId, dataCaliber]);

  const summary = useXiaohongshuSummary(range, dataCaliber, advertiserId);
  const trend = useXiaohongshuTrend(range, dataCaliber, advertiserId);
  const ranking = useXiaohongshuRanking(
    range,
    rankingMetric,
    dataCaliber,
    advertiserId,
    rankingLevel
  );
  const reports = useXiaohongshuReports(
    range,
    dataCaliber,
    advertiserId,
    reportPage,
    reportPageSize
  );
  const latestSync = useXiaohongshuLatestSyncRun(advertiserId);

  const totals = summary.data?.totals;
  const coverage = totals?.metricCoverage;
  const reportColumns = useMemo(
    () =>
      getXiaohongshuReportDataColumns(reports.data?.items ?? [], reports.data?.rawFieldKeys ?? []),
    [reports.data?.items, reports.data?.rawFieldKeys]
  );
  const isSummaryLoading = summary.isLoading || advertisers.isLoading;
  const hasError = [advertisers, summary, trend, ranking, reports, latestSync].some(
    (query) => query.isError
  );
  const selectedAdvertiser = advertisers.data?.find((item) => item.advertiserId === advertiserId);

  const rankingData = useMemo(
    () =>
      (ranking.data?.items ?? [])
        .filter((item) => item.valueCoverage !== 'unavailable')
        .map((item) => ({
          id: item.id,
          name: item.name || item.id,
          value: Number(item.value),
          hint: [
            `${item.click.toLocaleString('zh-CN')} 点击`,
            `${item.impression.toLocaleString('zh-CN')} 曝光`,
            item.valueCoverage === 'partial' ? '部分覆盖' : null,
          ]
            .filter(Boolean)
            .join(' · '),
        })),
    [ranking.data]
  );
  const rankingLevelLabel = RANKING_LEVELS.find((item) => item.value === rankingLevel)?.label;
  const rankedFee = (ranking.data?.items ?? []).reduce((sum, item) => sum + Number(item.fee), 0);
  const accountFee = Number(totals?.fee ?? 0);
  const rankedFeeShare = accountFee > 0 ? rankedFee / accountFee : null;

  const { messageStages, formStages } = buildXiaohongshuFunnelStages(totals);

  const kpis: Array<{
    label: string;
    value: string;
    hint?: string;
    icon: LucideIcon;
    iconColor: string;
    iconBg: string;
  }> = [
    {
      label: '消费',
      value: fmtAmount(totals?.fee),
      hint: formatXiaohongshuDeltaHint(summary.data?.deltas?.fee),
      icon: CircleDollarSign,
      iconColor: 'text-rose-600',
      iconBg: 'bg-rose-50',
    },
    {
      label: '曝光',
      value: fmtInteger(totals?.impression),
      hint: formatXiaohongshuDeltaHint(summary.data?.deltas?.impression),
      icon: Eye,
      iconColor: 'text-violet-600',
      iconBg: 'bg-violet-50',
    },
    {
      label: '点击',
      value: fmtInteger(totals?.click),
      hint: formatXiaohongshuDeltaHint(summary.data?.deltas?.click),
      icon: MousePointerClick,
      iconColor: 'text-blue-600',
      iconBg: 'bg-blue-50',
    },
    {
      label: '点击率（CTR）',
      value: fmtPercent(totals?.ctr),
      icon: Percent,
      iconColor: 'text-cyan-600',
      iconBg: 'bg-cyan-50',
    },
    {
      label: '互动',
      value: fmtInteger(totals?.interaction),
      hint: formatXiaohongshuDeltaHint(summary.data?.deltas?.interaction),
      icon: Users,
      iconColor: 'text-purple-600',
      iconBg: 'bg-purple-50',
    },
    {
      label: '互动成本',
      value: fmtAmount(totals?.cpi),
      icon: Activity,
      iconColor: 'text-orange-600',
      iconBg: 'bg-orange-50',
    },
    {
      label: '私信咨询',
      value: fmtInteger(coveredValue(totals?.messageConsult, coverage?.messageConsult)),
      hint: formatXiaohongshuDeltaHint(
        summary.data?.deltas?.messageConsult,
        coverage?.messageConsult
      ),
      icon: MessageCircle,
      iconColor: 'text-amber-600',
      iconBg: 'bg-amber-50',
    },
    {
      label: '私信留资',
      value: fmtInteger(coveredValue(totals?.messageLead, coverage?.messageLead)),
      hint: formatXiaohongshuDeltaHint(summary.data?.deltas?.messageLead, coverage?.messageLead),
      icon: UserRoundCheck,
      iconColor: 'text-emerald-600',
      iconBg: 'bg-emerald-50',
    },
    {
      label: '表单提交',
      value: fmtInteger(coveredValue(totals?.formSubmit, coverage?.formSubmit)),
      hint: formatXiaohongshuDeltaHint(summary.data?.deltas?.formSubmit, coverage?.formSubmit),
      icon: FileText,
      iconColor: 'text-sky-600',
      iconBg: 'bg-sky-50',
    },
    {
      label: '有效表单',
      value: fmtInteger(coveredValue(totals?.validFormSubmit, coverage?.validFormSubmit)),
      hint: formatXiaohongshuDeltaHint(
        summary.data?.deltas?.validFormSubmit,
        coverage?.validFormSubmit
      ),
      icon: FileCheck2,
      iconColor: 'text-teal-600',
      iconBg: 'bg-teal-50',
    },
  ];

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['analytics', 'xiaohongshu'] });
  };
  const lastRun = latestSync.data;
  const lastRunStatus = lastRun ? SYNC_STATUS[lastRun.status] : null;

  return (
    <div className="space-y-6 p-6">
      <XiaohongshuCoverageStrip />

      {hasError && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
            <span>部分数据（含笔记明细）加载失败，请检查服务状态后重试。</span>
            <Button size="sm" variant="outline" onClick={refresh}>
              <RefreshCw className="mr-2 h-4 w-4" />
              重试
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">连接状态</span>
              <Badge variant={selectedAdvertiser?.status === 'active' ? 'default' : 'destructive'}>
                {advertisers.isLoading
                  ? '加载中'
                  : selectedAdvertiser?.status === 'active'
                    ? '已连接'
                    : '异常'}
              </Badge>
            </div>
            {advertisers.data?.[0] && (
              <span className="font-medium">
                {advertisers.data.find((item) => item.advertiserId === advertiserId)
                  ?.advertiserName ?? advertisers.data[0].advertiserName}
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              广告主标识（ID）：{advertiserId || '-'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">最近同步</span>
            {lastRun ? (
              <>
                <span className="font-medium" title={formatDateTimeDisplay(lastRun.startedAt)}>
                  {formatDistanceToNowStrict(new Date(lastRun.startedAt), {
                    addSuffix: true,
                    locale: zhCN,
                  })}
                </span>
                {lastRunStatus && (
                  <Badge variant={lastRunStatus.variant}>{lastRunStatus.label}</Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  {lastRun.startDate} ~ {lastRun.endDate} · {lastRun.syncedRows} 行
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">暂无记录</span>
            )}
            <Button size="sm" variant="ghost" onClick={refresh} aria-label="刷新看板数据">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <XiaohongshuOperatingBrief data={summary.data} loading={isSummaryLoading} />

      <section>
        <div className="mb-3">
          <h2 className="text-lg font-semibold">关键指标总览（KPI）</h2>
          <p className="text-xs text-muted-foreground">
            环比均与上一等长周期比较；无可比基数时不计算比例
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {kpis.map((kpi) => (
            <KpiCard key={kpi.label} {...kpi} loading={isSummaryLoading} />
          ))}
        </div>
      </section>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">内容互动</CardTitle>
          <p className="text-xs text-muted-foreground">互动量及其相对曝光的互动率</p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>指标</TableHead>
                {['点赞', '收藏', '评论', '关注', '分享'].map((label) => (
                  <TableHead key={label} className="text-right">
                    {label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">互动量</TableCell>
                {[
                  totals?.like,
                  totals?.collect,
                  totals?.comment,
                  totals?.follow,
                  totals?.share,
                ].map((value, index) => (
                  <TableCell key={index} className="text-right tabular-nums">
                    {fmtInteger(value)}
                  </TableCell>
                ))}
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">互动率</TableCell>
                {[
                  totals?.likeRate,
                  totals?.collectRate,
                  totals?.commentRate,
                  totals?.followRate,
                  totals?.shareRate,
                ].map((value, index) => (
                  <TableCell key={index} className="text-right tabular-nums">
                    {fmtPercent(value)}
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">转化漏斗</CardTitle>
          <p className="text-xs text-muted-foreground">
            两条获客链路独立展示；未知或不可用指标显示为 “-”
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <FunnelRow title="私信链路" stages={messageStages} />
          <FunnelRow title="表单链路" stages={formStages} />
        </CardContent>
      </Card>

      <XiaohongshuTrendWorkbench data={trend.data} loading={trend.isLoading} />

      <ChartCard
        title={`${rankingLevelLabel}效果排行`}
        description={`${rankingLevelLabel}按${RANKING_METRICS.find((item) => item.value === rankingMetric)?.label}降序；当前榜单对象合计消费${rankedFeeShare == null ? '占比不可计算' : `占账户消费 ${(rankedFeeShare * 100).toFixed(1)}%`}，不把前十名冒充全量`}
        action={
          <div className="flex flex-wrap gap-2">
            <Select
              value={rankingLevel}
              onValueChange={(value) => value && setRankingLevel(value as XiaohongshuReportLevel)}
            >
              <SelectTrigger className="w-[110px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANKING_LEVELS.map((level) => (
                  <SelectItem key={level.value} value={level.value}>
                    {level.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={rankingMetric}
              onValueChange={(value) =>
                value && setRankingMetric(value as XiaohongshuRankingMetric)
              }
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANKING_METRICS.map((metric) => (
                  <SelectItem key={metric.value} value={metric.value}>
                    {metric.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
        loading={ranking.isLoading}
        empty={rankingData.length === 0}
        emptyText="所选指标暂无可用排行数据"
        height={360}
      >
        <div className="space-y-4">
          <RankingBarChart
            data={rankingData}
            isAmount={rankingMetric === 'fee'}
            limit={10}
            height={340}
            yAxisWidth={180}
          />
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>{rankingLevelLabel}</TableHead>
                <TableHead className="text-right">消费</TableHead>
                <TableHead className="text-right">点击率</TableHead>
                <TableHead className="text-right">点击成本</TableHead>
                <TableHead className="text-right">互动</TableHead>
                <TableHead className="text-right">私信咨询</TableHead>
                <TableHead className="text-right">私信留资</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ranking.data?.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="max-w-[320px]">
                    <p className="truncate font-medium" title={item.name || item.id}>
                      {item.name || item.id}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">标识（ID）：{item.id}</p>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtAmount(item.fee)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtPercent(item.ctr)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtAmount(item.cpc)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtInteger(item.interaction)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.metricCoverage.messageConsult === 'unavailable'
                      ? '-'
                      : fmtInteger(item.messageConsult)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.metricCoverage.messageLead === 'unavailable'
                      ? '-'
                      : fmtInteger(item.messageLead)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </ChartCard>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">笔记完整数据明细</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                固定展示笔记与日期；当前页返回的所有原始字段统一展开，并按业务分组稳定排列
              </p>
            </div>
            <Badge variant="outline">
              返回口径：{reports.data?.dataCaliber === 1 ? '转化时间' : '计费时间'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {reports.isLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (reports.data?.items.length ?? 0) === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              暂无笔记数据明细
            </div>
          ) : (
            <Table className="min-w-max" wrapperClassName="max-h-[560px]">
              <TableHeader sticky>
                <TableRow className="bg-muted/40">
                  <TableHead className="sticky left-0 z-20 w-[288px] min-w-[288px] bg-background shadow-[1px_0_0_0_hsl(var(--border))]">
                    笔记
                  </TableHead>
                  <TableHead className="sticky left-[288px] z-20 w-[112px] min-w-[112px] whitespace-nowrap bg-background shadow-[1px_0_0_0_hsl(var(--border))]">
                    日期
                  </TableHead>
                  {reportColumns.map((column) => (
                    <TableHead key={column.id} className="min-w-[132px] whitespace-nowrap">
                      <span className="block text-[10px] font-normal text-muted-foreground/70">
                        {column.group}
                      </span>
                      <span title={column.key}>{column.label}</span>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.data?.items.map((report) => {
                  const noteImageUrl = getSafeXiaohongshuImageUrl(report.noteImage);
                  const noteJumpUrl = getSafeXiaohongshuHttpUrl(report.noteJumpUrl);
                  const noteTitle = report.noteTitle || report.noteId || '-';

                  return (
                    <TableRow key={report.id}>
                      <TableCell className="sticky left-0 z-[5] w-[288px] min-w-[288px] bg-background shadow-[1px_0_0_0_hsl(var(--border))]">
                        <div className="flex items-start gap-2">
                          {noteImageUrl ? (
                            <img
                              src={noteImageUrl}
                              alt=""
                              className="h-14 w-14 shrink-0 rounded-md border object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-dashed text-[10px] text-muted-foreground">
                              无封面
                            </div>
                          )}
                          <div className="min-w-0 space-y-0.5">
                            <p className="truncate font-medium" title={noteTitle}>
                              {noteTitle}
                            </p>
                            <p
                              className="truncate text-xs text-muted-foreground"
                              title={report.noteId ?? '-'}
                            >
                              笔记标识（ID）：{report.noteId ?? '-'}
                            </p>
                            {noteJumpUrl ? (
                              <a
                                href={noteJumpUrl}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                title={noteJumpUrl}
                              >
                                查看原文 <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : report.noteJumpUrl ? (
                              <p
                                className="truncate text-xs text-muted-foreground"
                                title={report.noteJumpUrl}
                              >
                                原文：{report.noteJumpUrl}
                              </p>
                            ) : (
                              <p className="text-xs text-muted-foreground">原文：-</p>
                            )}
                            {report.noteImage && !noteImageUrl && (
                              <p
                                className="truncate text-xs text-muted-foreground"
                                title={report.noteImage}
                              >
                                封面：{report.noteImage}
                              </p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="sticky left-[288px] z-[5] w-[112px] min-w-[112px] whitespace-nowrap bg-background shadow-[1px_0_0_0_hsl(var(--border))]">
                        {report.statDate}
                      </TableCell>
                      {reportColumns.map((column) => {
                        const value = formatXiaohongshuReportValue(
                          getXiaohongshuReportColumnValue(report, column),
                          column.key
                        );
                        return (
                          <TableCell
                            key={column.id}
                            className="max-w-[240px] truncate whitespace-nowrap tabular-nums"
                            title={value}
                          >
                            {value}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          {(reports.data?.total ?? 0) > 0 && (
            <div className="mt-3 border-t pt-2">
              <Pagination
                total={reports.data?.total ?? 0}
                page={reportPage}
                pageSize={reportPageSize}
                pageSizeOptions={[30, 50, 100]}
                onPageChange={setReportPage}
                onPageSizeChange={(pageSize) => {
                  setReportPageSize(pageSize);
                  setReportPage(1);
                }}
              />
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            “-”表示空值；布尔值显示“是/否”；数组和对象按中文字段紧凑展示，悬停可查看完整内容。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
