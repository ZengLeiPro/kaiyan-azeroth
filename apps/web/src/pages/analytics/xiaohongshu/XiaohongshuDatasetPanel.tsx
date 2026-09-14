import type {
  IXiaohongshuDatasetDefinition,
  IXiaohongshuDatasetField,
  XiaohongshuJsonValue,
  XiaohongshuReportRawPayload,
} from '@ky-azeroth/shared/types';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Braces,
  Loader2,
  Search,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { resolveXiaohongshuRange } from '@/pages/analytics/hooks/use-xiaohongshu-analytics-data';

import {
  useXiaohongshuDatasetCatalog,
  useXiaohongshuDatasetQuery,
} from './use-xiaohongshu-datasets';
import { useXiaohongshuCenter } from './xiaohongshu-center-context';
import { formatXiaohongshuDisplayValue, getXiaohongshuFieldLabel } from './xiaohongshu-display';

/** 保持穷举，服务端新增可用性状态时必须同步产品文案。 */
const AVAILABILITY: Record<IXiaohongshuDatasetDefinition['availability'], string> = {
  available: '已接入',
  connection_missing: '未连接',
  scope_missing: '缺少授权',
  requires_context: '需对象参数',
  requires_whitelist: '待白名单',
  requires_extra_scope: '需独立授权',
  role_unsupported: '取决于账户角色',
  contract_probe: '待契约探测',
};

function parseParam(value: string): XiaohongshuJsonValue {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^(true|false|null)$/.test(trimmed) || trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return JSON.parse(trimmed) as XiaohongshuJsonValue;
  }
  // 小红书对象 ID 常为超长纯数字字符串；禁止用 JSON.parse 猜成 number 而损失精度。
  return value;
}

type SortDirection = 'asc' | 'desc';

function compareValues(left: unknown, right: unknown): number {
  const leftNumber = typeof left === 'number' ? left : Number.NaN;
  const rightNumber = typeof right === 'number' ? right : Number.NaN;
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
  return String(left ?? '').localeCompare(String(right ?? ''), 'zh-CN', {
    numeric: true,
    sensitivity: 'base',
  });
}

function ResponseFacts({
  aggregation,
  metadata,
}: {
  aggregation?: XiaohongshuReportRawPayload | null;
  metadata?: XiaohongshuReportRawPayload | null;
}) {
  const groups = [
    ['官方汇总', aggregation],
    ['返回元数据', metadata],
  ] as const;
  const visible = groups.filter(([, value]) => value && Object.keys(value).length > 0);
  if (visible.length === 0) return null;

  return (
    <div className="mb-4 grid gap-3 lg:grid-cols-2">
      {visible.map(([label, value]) => (
        <section key={label} className="rounded-lg border bg-muted/20 p-3">
          <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{label}</h3>
          <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
            {Object.entries(value ?? {}).map(([key, item]) => (
              <div key={key} className="min-w-0">
                <dt className="truncate text-[11px] text-muted-foreground">
                  {getXiaohongshuFieldLabel(key)}
                </dt>
                <dd className="break-all text-sm tabular-nums">
                  {formatXiaohongshuDisplayValue(item, key)}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

function RecordDrawer({
  row,
  fields,
  onClose,
}: {
  row: XiaohongshuReportRawPayload | null;
  fields: IXiaohongshuDatasetField[];
  onClose: () => void;
}) {
  const grouped = useMemo(() => {
    const result = new Map<string, IXiaohongshuDatasetField[]>();
    for (const field of fields) {
      const current = result.get(field.group) ?? [];
      current.push(field);
      result.set(field.group, current);
    }
    return result;
  }, [fields]);

  return (
    <Sheet open={Boolean(row)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>完整记录</SheetTitle>
          <SheetDescription>按中文业务字段分组展示；技术原始数据收在底部折叠区。</SheetDescription>
        </SheetHeader>
        {row && (
          <div className="mt-5 space-y-6">
            {[...grouped.entries()].map(([group, groupFields]) => (
              <section key={group}>
                <h3 className="mb-2 text-sm font-semibold">{group}</h3>
                <dl className="grid gap-x-5 gap-y-3 rounded-lg border p-4 sm:grid-cols-2">
                  {groupFields.map((field) => (
                    <div
                      key={field.key}
                      className={
                        field.valueType === 'object' || field.valueType === 'array'
                          ? 'sm:col-span-2'
                          : ''
                      }
                    >
                      <dt className="text-xs text-muted-foreground">
                        {getXiaohongshuFieldLabel(field.key, field.label)}
                      </dt>
                      <dd className="mt-1 break-all text-sm tabular-nums">
                        {formatXiaohongshuDisplayValue(row[field.key], field.key)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
            <details className="rounded-lg border">
              <summary className="flex cursor-pointer items-center gap-1.5 px-4 py-3 text-sm font-semibold">
                <Braces className="h-4 w-4" />
                技术原始数据（JSON，供核对与排障）
              </summary>
              <div className="border-t p-4">
                <p className="mb-2 text-xs text-muted-foreground">
                  此处保留小红书接口原始字段名；业务阅读请以上方中文字段为准。
                </p>
                <pre className="max-h-[420px] overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-5 text-slate-100">
                  {JSON.stringify(row, null, 2)}
                </pre>
              </div>
            </details>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function XiaohongshuDatasetPanel({
  datasetId,
  title,
}: {
  datasetId: string;
  title?: string;
}) {
  const { advertiserId, range, dataCaliber } = useXiaohongshuCenter();
  const catalog = useXiaohongshuDatasetCatalog(advertiserId);
  const definition = catalog.data?.datasets.find((item) => item.id === datasetId);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [paramInputs, setParamInputs] = useState<Record<string, string>>({});
  const [submittedParams, setSubmittedParams] = useState<Record<
    string,
    XiaohongshuJsonValue
  > | null>(null);
  const [paramError, setParamError] = useState('');
  const [rowFilter, setRowFilter] = useState('');
  const [sortKey, setSortKey] = useState('');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [selected, setSelected] = useState<XiaohongshuReportRawPayload | null>(null);
  const resolvedRange = resolveXiaohongshuRange(range);
  const missingRequired = (definition?.requiredParams ?? []).some(
    (key) => !paramInputs[key]?.trim()
  );
  const requiresSubmit = (definition?.requiredParams.length ?? 0) > 0;
  const params = requiresSubmit ? (submittedParams ?? {}) : {};
  const query = useXiaohongshuDatasetQuery(
    {
      datasetId,
      advertiserId,
      startDate: resolvedRange.startDate,
      endDate: resolvedRange.endDate,
      dataCaliber,
      page,
      pageSize,
      params,
    },
    Boolean(definition?.queryable && (!requiresSubmit || submittedParams))
  );

  useEffect(() => {
    setPage(1);
    setParamInputs({});
    setSubmittedParams(null);
    setParamError('');
    setRowFilter('');
    setSortKey('');
    setSortDirection('asc');
    setSelected(null);
  }, [datasetId, advertiserId, range, dataCaliber]);

  const columns = useMemo(() => {
    const fields = query.data?.fields ?? [];
    const core = fields.filter((field) => field.isCore);
    const scalar = fields.filter(
      (field) => field.valueType !== 'object' && field.valueType !== 'array'
    );
    return [...new Map([...core, ...scalar].map((field) => [field.key, field])).values()].slice(
      0,
      12
    );
  }, [query.data?.fields]);

  const displayedRows = useMemo(() => {
    const normalizedFilter = rowFilter.trim().toLocaleLowerCase('zh-CN');
    const rows = (query.data?.items ?? [])
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => {
        if (!normalizedFilter) return true;
        return columns.some((column) =>
          formatXiaohongshuDisplayValue(row[column.key], column.key)
            .toLocaleLowerCase('zh-CN')
            .includes(normalizedFilter)
        );
      });
    if (!sortKey) return rows;
    return [...rows].sort((left, right) => {
      const compared = compareValues(left.row[sortKey], right.row[sortKey]);
      return sortDirection === 'asc' ? compared : -compared;
    });
  }, [columns, query.data?.items, rowFilter, sortDirection, sortKey]);

  const submitParams = () => {
    if (missingRequired) {
      setParamError('请先填写全部必填参数');
      return;
    }
    try {
      const parsed = Object.fromEntries(
        Object.entries(paramInputs)
          .filter(([, value]) => value.trim())
          .map(([key, value]) => [key, parseParam(value)])
      );
      setParamError('');
      setSubmittedParams(parsed);
      setPage(1);
    } catch {
      setParamError('数组或对象参数必须使用有效的 JSON 格式');
    }
  };

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDirection('asc');
  };

  if (catalog.isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (catalog.isError) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-destructive">
        数据目录加载失败，请返回页面顶部重试。
      </div>
    );
  }

  if (!definition) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
        当前数据集不存在，或不属于本页面的数据范围。
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{title ?? definition.label}</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">{definition.description}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={definition.queryable ? 'default' : 'outline'}>
              {AVAILABILITY[definition.availability]}
            </Badge>
            <Badge variant="outline">
              {definition.source === 'local_report' ? '本地已同步日报' : '官方接口·按需读取'}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {definition.availabilityReason && (
          <div className="mb-4 flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{definition.availabilityReason}</span>
          </div>
        )}
        {definition.requiredParams.length > 0 && (
          <div className="mb-4 space-y-3 rounded-lg border bg-muted/10 p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {definition.requiredParams.map((key) => (
                <label key={key} className="space-y-1 text-xs text-muted-foreground">
                  <span>{getXiaohongshuFieldLabel(key)}</span>
                  <Input
                    value={paramInputs[key] ?? ''}
                    onChange={(event) =>
                      setParamInputs((current) => ({ ...current, [key]: event.target.value }))
                    }
                    placeholder="请输入参数值；数组/对象使用 JSON"
                  />
                </label>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" onClick={submitParams} disabled={missingRequired}>
                查询
              </Button>
              <p className="text-xs text-muted-foreground">
                参数只在点击查询后提交；纯数字对象标识（ID）按字符串保留，不会损失精度。
              </p>
              {paramError && <p className="text-xs text-destructive">{paramError}</p>}
            </div>
          </div>
        )}
        {!definition.queryable ? (
          <div className="flex h-36 items-center justify-center text-sm text-muted-foreground">
            该能力已列入完整目录，但当前不能调用；这不等于真实数据为 0。
          </div>
        ) : requiresSubmit && !submittedParams ? (
          <div className="flex h-36 items-center justify-center text-sm text-muted-foreground">
            填写上方必填参数并点击“查询”；参数只会传给固定的官方只读接口。
          </div>
        ) : query.isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : query.isError ? (
          <div className="flex h-36 flex-col items-center justify-center gap-3 text-sm text-destructive">
            <span>当前数据集查询失败。接口存在不代表当前账户角色或白名单一定可用。</span>
            <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
              重试查询
            </Button>
          </div>
        ) : (
          <>
            <ResponseFacts aggregation={query.data?.aggregation} metadata={query.data?.metadata} />
            {(query.data?.items.length ?? 0) === 0 ? (
              <div className="flex h-36 items-center justify-center text-sm text-muted-foreground">
                当前筛选范围确实没有返回记录
              </div>
            ) : (
              <>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="relative w-full max-w-sm">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={rowFilter}
                      onChange={(event) => setRowFilter(event.target.value)}
                      className="pl-9"
                      placeholder="筛选当前页核心字段"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    当前页显示 {displayedRows.length} / {query.data?.items.length ?? 0} 条
                  </p>
                </div>
                <Table wrapperClassName="max-h-[560px]" className="min-w-max">
                  <TableHeader sticky>
                    <TableRow className="bg-muted/40">
                      {columns.map((column) => (
                        <TableHead key={column.key} className="min-w-[140px] whitespace-nowrap">
                          <button
                            type="button"
                            className="flex w-full items-center gap-1 text-left"
                            title="仅对当前页排序"
                            onClick={() => toggleSort(column.key)}
                          >
                            <span>
                              <span className="block text-[10px] font-normal text-muted-foreground">
                                {column.group}
                              </span>
                              {getXiaohongshuFieldLabel(column.key, column.label)}
                            </span>
                            {sortKey === column.key ? (
                              sortDirection === 'asc' ? (
                                <ArrowUp className="h-3.5 w-3.5" />
                              ) : (
                                <ArrowDown className="h-3.5 w-3.5" />
                              )
                            ) : (
                              <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/60" />
                            )}
                          </button>
                        </TableHead>
                      ))}
                      <TableHead className="w-[92px]">全部字段</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayedRows.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={columns.length + 1}
                          className="h-28 text-center text-muted-foreground"
                        >
                          当前页没有匹配记录
                        </TableCell>
                      </TableRow>
                    ) : (
                      displayedRows.map(({ row, index }) => (
                        <TableRow
                          key={`${page}-${index}`}
                          className="cursor-pointer"
                          onClick={() => setSelected(row)}
                        >
                          {columns.map((column) => {
                            const value = formatXiaohongshuDisplayValue(
                              row[column.key],
                              column.key
                            );
                            return (
                              <TableCell
                                key={column.key}
                                className="max-w-[260px] truncate whitespace-nowrap tabular-nums"
                                title={value}
                              >
                                {value}
                              </TableCell>
                            );
                          })}
                          <TableCell>
                            <Badge variant="outline">{query.data?.fields.length ?? 0} 项</Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
                <div className="mt-3 border-t pt-2">
                  <Pagination
                    total={query.data?.total ?? 0}
                    page={page}
                    pageSize={pageSize}
                    pageSizeOptions={[20, 50, 100]}
                    onPageChange={setPage}
                    onPageSizeChange={(value) => {
                      setPageSize(value);
                      setPage(1);
                    }}
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  筛选与排序只作用于当前页；跨页查看请翻页或增加每页数量。点击任意一行查看{' '}
                  {query.data?.fields.length ?? 0} 个完整中文字段；技术原始数据按需展开。
                  {query.data?.totalMode === 'estimated' &&
                    ' 当前官方接口没有返回精确总数，分页总量为保守估算。'}
                </p>
              </>
            )}
          </>
        )}
      </CardContent>
      <RecordDrawer
        row={selected}
        fields={query.data?.fields ?? []}
        onClose={() => setSelected(null)}
      />
    </Card>
  );
}

export { AVAILABILITY as XIAOHONGSHU_DATASET_AVAILABILITY_LABELS };
