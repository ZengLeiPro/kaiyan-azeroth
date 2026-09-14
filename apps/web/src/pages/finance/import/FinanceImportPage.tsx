import type {
  FinanceBalanceDiff,
  FinanceImportCommitResponse,
  FinanceImportPreviewResponse,
  FinancePnlDiff,
} from '@ky-azeroth/shared/schemas';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { StandardLayout } from '@/components/templates/standard-layout';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { api, getErrorMessage } from '@/lib/api';

const DEFAULT_WORKBOOK_ID = '';

type ImportErrorRow = FinanceImportPreviewResponse['errors'][number];
type ImportStrategy = 'replace_year' | 'append_only';

const STRATEGY_OPTIONS = [
  { value: 'replace_year', label: 'replace_year（按年覆盖）' },
  { value: 'append_only', label: 'append_only（仅追加）' },
];

/**
 * 钉钉迁移页（仅 admin 用户可见）
 *
 * 双阶段：preview → commit。
 */
export function FinanceImportPage() {
  const [workbookId, setWorkbookId] = useState(DEFAULT_WORKBOOK_ID);
  const [yearsStr, setYearsStr] = useState('2025,2026');
  const [strategy, setStrategy] = useState<ImportStrategy>('replace_year');
  const [preview, setPreview] = useState<FinanceImportPreviewResponse | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState<FinanceImportCommitResponse | null>(null);

  const errorColumns = useMemo<DataTableColumn<ImportErrorRow>[]>(
    () => [
      { key: 'sheetName', header: 'sheet', width: 160 },
      { key: 'rowIndex', header: '行', width: 80, align: 'right' },
      { key: 'reason', header: '原因', width: 420 },
    ],
    []
  );

  const balanceDiffColumns = useMemo<DataTableColumn<FinanceBalanceDiff>[]>(
    () => [
      { key: 'sheetName', header: 'sheet', width: 160 },
      { key: 'rowIndex', header: '行', width: 80, align: 'right' },
      { key: 'accountCode', header: '账户', width: 120 },
      {
        key: 'expected',
        header: '期望',
        width: 130,
        align: 'right',
        render: (item) => <AmountText value={item.expected} />,
      },
      {
        key: 'actual',
        header: '实际',
        width: 130,
        align: 'right',
        render: (item) => <AmountText value={item.actual} />,
      },
      {
        key: 'diff',
        header: 'diff',
        width: 130,
        align: 'right',
        render: (item) => <AmountText value={item.diff} danger />,
      },
    ],
    []
  );

  const pnlDiffColumns = useMemo<DataTableColumn<FinancePnlDiff>[]>(
    () => [
      {
        key: 'period',
        header: '年月',
        width: 110,
        render: (item) => `${item.year}-${String(item.month).padStart(2, '0')}`,
      },
      { key: 'subjectCode', header: '科目代码', width: 140 },
      { key: 'subjectName', header: '科目', width: 180 },
      {
        key: 'expected',
        header: '期望',
        width: 130,
        align: 'right',
        render: (item) => <AmountText value={item.expected} />,
      },
      {
        key: 'actual',
        header: '实际',
        width: 130,
        align: 'right',
        render: (item) => <AmountText value={item.actual} />,
      },
      {
        key: 'diff',
        header: 'diff',
        width: 130,
        align: 'right',
        render: (item) => <AmountText value={item.diff} danger />,
      },
    ],
    []
  );

  const handlePreview = async () => {
    setPreviewing(true);
    setPreview(null);
    setCommitted(null);
    try {
      const years = yearsStr
        .split(',')
        .map((year) => parseInt(year.trim(), 10))
        .filter(Boolean);
      const resp = await api.post<FinanceImportPreviewResponse>(
        '/finance-import/dingtalk/preview',
        {
          workbookId,
          years,
        }
      );
      setPreview(resp.data);
      if (resp.data.reconciliation.passed) {
        toast.success('预览完成，对账通过');
      } else {
        toast.warning(
          `预览完成，对账未通过：余额 diff ${resp.data.reconciliation.balanceDiffs.length} / PnL diff ${resp.data.reconciliation.pnlDiffs.length}`
        );
      }
    } catch (e) {
      toast.error(getErrorMessage(e, '预览失败'));
    } finally {
      setPreviewing(false);
    }
  };

  const handleCommit = async () => {
    if (!preview) return;
    if (
      !confirm(
        `确认提交批次 ${preview.batchId} 用策略 ${strategy}？此操作会改写 financeLedger 表。`
      )
    ) {
      return;
    }
    setCommitting(true);
    try {
      const resp = await api.post<FinanceImportCommitResponse>('/finance-import/dingtalk/commit', {
        batchId: preview.batchId,
        strategy,
      });
      setCommitted(resp.data);
      toast.success(`提交完成：${resp.data.successRows} 公司 + ${resp.data.personalRows} 私账`);
    } catch (e) {
      toast.error(getErrorMessage(e, '提交失败'));
    } finally {
      setCommitting(false);
    }
  };

  const canCommit = Boolean(preview && preview.reconciliation.passed && !committed);

  return (
    <StandardLayout>
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">钉钉表迁移</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(280px,1fr)_220px]">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">钉钉 workbookId</label>
                <Input
                  value={workbookId}
                  onChange={(event) => setWorkbookId(event.target.value)}
                  className="font-mono text-xs"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">年份</label>
                <Input
                  value={yearsStr}
                  onChange={(event) => setYearsStr(event.target.value)}
                  placeholder="2025,2026"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={handlePreview}
                disabled={!workbookId || !yearsStr}
                loading={previewing}
              >
                预览
              </Button>
              <span className="text-xs text-muted-foreground">
                预览不入库，会读取钉钉表并执行账户余额 + 财报勾稽双对账。
              </span>
            </div>
          </CardContent>
        </Card>

        {preview && (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">预览结果</CardTitle>
                <span className="font-mono text-xs text-muted-foreground">
                  batchId: {preview.batchId}
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert variant={preview.reconciliation.passed ? 'default' : 'destructive'}>
                {preview.reconciliation.passed ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                <AlertDescription>
                  {preview.reconciliation.passed
                    ? '双对账通过：账户余额 + 财报勾稽 0 差异'
                    : `对账未通过：余额 diff ${preview.reconciliation.balanceDiffs.length} 条 / PnL diff ${preview.reconciliation.pnlDiffs.length} 条`}
                </AlertDescription>
              </Alert>

              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <SummaryTile label="总行数" value={preview.summary.totalRows} />
                <SummaryTile label="公司流水" value={preview.summary.companyRows} />
                <SummaryTile label="私账" value={preview.summary.personalRows} hint="个人科目" />
                <SummaryTile
                  label="错误"
                  value={preview.summary.errorRows}
                  danger={preview.summary.errorRows > 0}
                />
              </div>

              {preview.errors.length > 0 && (
                <ResultBlock title={`错误行 (${preview.errors.length})`}>
                  <DataTable
                    data={preview.errors.slice(0, 50)}
                    columns={errorColumns}
                    hidePagination
                    storageId="finance-import-errors"
                  />
                </ResultBlock>
              )}

              {preview.reconciliation.balanceDiffs.length > 0 && (
                <ResultBlock
                  title={`账户余额 diff (${preview.reconciliation.balanceDiffs.length})`}
                >
                  <DataTable
                    data={preview.reconciliation.balanceDiffs.slice(0, 100)}
                    columns={balanceDiffColumns}
                    hidePagination
                    storageId="finance-import-balance-diffs"
                  />
                </ResultBlock>
              )}

              {preview.reconciliation.pnlDiffs.length > 0 && (
                <ResultBlock title={`财报勾稽 diff (${preview.reconciliation.pnlDiffs.length})`}>
                  <DataTable
                    data={preview.reconciliation.pnlDiffs.slice(0, 100)}
                    columns={pnlDiffColumns}
                    hidePagination
                    storageId="finance-import-pnl-diffs"
                  />
                </ResultBlock>
              )}

              <div className="flex flex-wrap items-center gap-3 border-t pt-4">
                <Select
                  value={strategy}
                  onChange={(value) => setStrategy((value || 'replace_year') as ImportStrategy)}
                  options={STRATEGY_OPTIONS}
                  className="w-64"
                />
                <Button
                  onClick={handleCommit}
                  disabled={!canCommit}
                  loading={committing}
                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  提交
                </Button>
                {!preview.reconciliation.passed && (
                  <span className="text-xs text-destructive">对账未通过，无法提交</span>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {committed && (
          <Card className="border-emerald-200 bg-emerald-50 dark:bg-emerald-950">
            <CardHeader>
              <div className="flex items-center gap-2">
                <CardTitle className="text-base text-emerald-900 dark:text-emerald-100">
                  提交完成
                </CardTitle>
                <Badge variant="success">{committed.status}</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <SummaryTile label="公司流水" value={committed.successRows} />
                <SummaryTile label="私账" value={committed.personalRows} />
                <SummaryTile label="已存在跳过" value={committed.skippedRows} />
                <SummaryTile
                  label="失败"
                  value={committed.failedRows}
                  danger={committed.failedRows > 0}
                />
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </StandardLayout>
  );
}

function ResultBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-md border bg-background p-3">
      <div className="text-sm font-medium">{title}</div>
      {children}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  hint,
  danger,
}: {
  label: string;
  value: number;
  hint?: string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 font-mono text-lg ${danger ? 'text-destructive' : ''}`}>{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function AmountText({ value, danger }: { value: number; danger?: boolean }) {
  return (
    <span className={`font-mono tabular-nums ${danger ? 'text-destructive' : ''}`}>
      {value.toFixed(2)}
    </span>
  );
}
