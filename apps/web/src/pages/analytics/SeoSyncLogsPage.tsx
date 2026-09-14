import { format } from 'date-fns';
import { History } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Pagination } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select-legacy';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { useSeoSyncRunDetail, useSeoSyncRuns } from './hooks/use-seo-analytics-data';

const STATUS_OPTIONS = [
  { value: null, label: '全部状态' },
  { value: 'success', label: '成功' },
  { value: 'partial', label: '部分成功' },
  { value: 'failed', label: '失败' },
  { value: 'running', label: '进行中' },
];

const TRIGGER_OPTIONS = [
  { value: null, label: '全部触发源' },
  { value: 'timer', label: '定时' },
  { value: 'http', label: 'HTTP' },
  { value: 'manual', label: '手动' },
];

type StatusBadgeMeta = {
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
  label: string;
};

const STATUS_BADGE_FALLBACK: StatusBadgeMeta = { variant: 'outline', label: '未知' };

const STATUS_BADGE: Record<string, StatusBadgeMeta> = {
  success: { variant: 'default', label: '成功' },
  partial: { variant: 'secondary', label: '部分成功' },
  failed: { variant: 'destructive', label: '失败' },
  running: { variant: 'outline', label: '进行中' },
};

function getStatusBadge(status: string): StatusBadgeMeta {
  return STATUS_BADGE[status] ?? STATUS_BADGE_FALLBACK;
}

function fmtTime(iso: string): string {
  try {
    return format(new Date(iso), 'yyyy-MM-dd HH:mm:ss');
  } catch {
    return iso;
  }
}

function fmtElapsed(ms: number | null | undefined): string {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function SeoSyncLogsPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(30);
  const [status, setStatus] = useState<string | null>(null);
  const [triggerSource, setTriggerSource] = useState<string | null>(null);
  /** 选中行 id（仅 id；report 由 useSeoSyncRunDetail 单独拉取，避免列表也回传完整 report） */
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filters = useMemo(
    () => ({
      page,
      pageSize,
      status: status ?? undefined,
      triggerSource: triggerSource ?? undefined,
    }),
    [page, pageSize, status, triggerSource]
  );

  const { data, isLoading } = useSeoSyncRuns(filters);
  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  const detail = useSeoSyncRunDetail(selectedId);
  const selected = detail.data ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 头 */}
      <div className="shrink-0 space-y-3 p-6 pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">SEO 同步日志</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              FC 子应用 seo-sync 每次运行的执行记录与错误明细
            </p>
          </div>
        </div>

        {/* 工具栏（手动同步按钮 M1 暂不放，二期再加） */}
        <div className="flex flex-wrap items-center gap-2">
          <Select
            options={STATUS_OPTIONS}
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            placeholder="全部状态"
            className="h-9 w-32"
            contentClassName="min-w-[160px] max-w-[calc(100vw-2rem)]"
          />
          <Select
            options={TRIGGER_OPTIONS}
            value={triggerSource}
            onChange={(v) => {
              setTriggerSource(v);
              setPage(1);
            }}
            placeholder="全部触发源"
            className="h-9 w-32"
            contentClassName="min-w-[160px] max-w-[calc(100vw-2rem)]"
          />
          {(status || triggerSource) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setStatus(null);
                setTriggerSource(null);
                setPage(1);
              }}
            >
              清空筛选
            </Button>
          )}
        </div>
      </div>

      {/* 列表 */}
      <div className="min-h-0 flex-1 overflow-auto px-6">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>开始时间</TableHead>
                  <TableHead>触发源</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">耗时</TableHead>
                  <TableHead className="text-right">Bing</TableHead>
                  <TableHead className="text-right">Google</TableHead>
                  <TableHead className="text-right">Clarity</TableHead>
                  <TableHead className="text-right">百度</TableHead>
                  <TableHead className="text-right">错误数</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                      加载中...
                    </TableCell>
                  </TableRow>
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                      <History className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
                      暂无同步记录
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((it) => {
                    const badge = getStatusBadge(it.status);
                    const errCount = it.errors?.length ?? 0;
                    return (
                      <TableRow
                        key={it.id}
                        className="cursor-pointer"
                        onClick={() => setSelectedId(it.id)}
                      >
                        <TableCell className="font-medium">{fmtTime(it.startedAt)}</TableCell>
                        <TableCell>{it.triggerSource}</TableCell>
                        <TableCell>
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtElapsed(it.elapsedMs)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {it.counts.bing ?? 0}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {it.counts.google ?? 0}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {it.counts.clarity ?? 0}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {it.counts.baiduTongji ?? 0}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums ${errCount > 0 ? 'font-medium text-rose-600' : ''}`}
                        >
                          {errCount}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* 分页 */}
      {total > 0 && (
        <div className="shrink-0 border-t bg-card">
          <Pagination
            total={total}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(s) => {
              setPageSize(s);
              setPage(1);
            }}
            showPageSizeChanger
            showQuickJumper
            showTotal
          />
        </div>
      )}

      {/* 详情 dialog：列表 select 排除了 report，点开后单独拉详情端点 */}
      <Dialog open={!!selectedId} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent className="max-h-[80vh] max-w-3xl overflow-auto">
          <DialogHeader>
            <DialogTitle>同步记录详情</DialogTitle>
            {selected && (
              <DialogDescription>
                {fmtTime(selected.startedAt)} · 触发源 {selected.triggerSource} · 状态{' '}
                {getStatusBadge(selected.status).label} · 耗时 {fmtElapsed(selected.elapsedMs)}
              </DialogDescription>
            )}
          </DialogHeader>
          {detail.isLoading ? (
            <p className="text-sm text-muted-foreground">加载中...</p>
          ) : detail.isError ? (
            <p className="text-sm text-rose-600">加载详情失败</p>
          ) : (
            selected && (
              <div className="space-y-4 text-sm">
                <section>
                  <div className="mb-1 font-medium">各数据源写入条数</div>
                  <pre className="overflow-auto rounded border bg-muted/30 p-3 text-xs">
                    {JSON.stringify(selected.counts, null, 2)}
                  </pre>
                </section>
                <section>
                  <div className="mb-1 font-medium">
                    错误清单（{selected.errors?.length ?? 0} 条）
                  </div>
                  <pre className="overflow-auto rounded border bg-muted/30 p-3 text-xs">
                    {JSON.stringify(selected.errors ?? [], null, 2)}
                  </pre>
                </section>
                <section>
                  <div className="mb-1 font-medium">完整运行报告</div>
                  <pre className="overflow-auto rounded border bg-muted/30 p-3 text-xs">
                    {selected.report ? JSON.stringify(selected.report, null, 2) : '（无）'}
                  </pre>
                </section>
              </div>
            )
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
