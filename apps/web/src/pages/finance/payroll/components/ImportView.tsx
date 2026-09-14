import type { IUploadResult } from '@ky-azeroth/shared/types/upload';
import { useQuery } from '@tanstack/react-query';
import { FileSpreadsheet, RefreshCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { FileUpload, type UploadedFile } from '@/components/patterns/file-upload';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { api, getErrorMessage } from '@/lib/api';
import { formatDateTimeDisplay } from '@/lib/date-utils';

import type { PayrollImportBatch, PayrollImportPreview } from '../types';

async function uploadExcel(file: File): Promise<IUploadResult> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await api.post<IUploadResult>('/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
}

type PreviewPeriod = PayrollImportPreview['periods'][number];
type PreviewRecord = PreviewPeriod['sampleRecords'][number];
type PreviewIssue = PayrollImportPreview['errors'][number];

const STATUS_MAP: Record<string, string> = {
  completed: '已完成',
  failed: '失败',
  pending: '处理中',
};

function formatImportDate(dateStr?: string) {
  return formatDateTimeDisplay(dateStr) || '-';
}

export function ImportView() {
  const [uploading, setUploading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [fileAssetId, setFileAssetId] = useState<string | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [preview, setPreview] = useState<PayrollImportPreview | null>(null);

  const {
    data: batchesResponse,
    refetch: refetchBatches,
    isLoading: loadingBatches,
  } = useQuery({
    queryKey: ['payroll-import-batches'],
    queryFn: async () => {
      const response = await api.get<{ items: PayrollImportBatch[] }>('/payroll/import-batches');
      return response.data;
    },
  });

  const batches = batchesResponse?.items ?? [];

  const sampleColumns = useMemo<DataTableColumn<PreviewRecord>[]>(
    () => [
      { key: 'employeeNameSnapshot', header: '员工', width: 140 },
      {
        key: 'departmentNameSnapshot',
        header: '部门',
        width: 140,
        render: (record) => record.departmentNameSnapshot || '-',
      },
      {
        key: 'positionSnapshot',
        header: '职位',
        width: 140,
        render: (record) => record.positionSnapshot || '-',
      },
      {
        key: 'netSalary',
        header: '实发工资',
        width: 130,
        align: 'right',
        render: (record) => <AmountText value={record.netSalary} />,
      },
      {
        key: 'totalLaborCost',
        header: '人工成本',
        width: 130,
        align: 'right',
        render: (record) => <AmountText value={record.totalLaborCost} />,
      },
    ],
    []
  );

  const batchColumns = useMemo<DataTableColumn<PayrollImportBatch>[]>(
    () => [
      {
        key: 'sourceFileName',
        header: '文件',
        width: 220,
        render: (batch) => batch.sourceFileName || '未知文件',
      },
      {
        key: 'status',
        header: '状态',
        width: 110,
        render: (batch) => (
          <Badge variant={batch.status === 'failed' ? 'destructive' : 'outline'}>
            {STATUS_MAP[batch.status] ?? batch.status}
          </Badge>
        ),
      },
      {
        key: 'sheets',
        header: 'sheet',
        width: 110,
        render: (batch) => `${batch.parsedSheets}/${batch.totalSheets}`,
      },
      {
        key: 'successRows',
        header: '成功',
        width: 100,
        align: 'right',
        render: (batch) => <span className="font-mono">{batch.successRows}</span>,
      },
      {
        key: 'failedRows',
        header: '失败',
        width: 100,
        align: 'right',
        render: (batch) => <span className="font-mono">{batch.failedRows}</span>,
      },
      {
        key: 'periods',
        header: '期间',
        width: 260,
        render: (batch) =>
          batch.periods && batch.periods.length > 0
            ? batch.periods.map((period) => period.periodKey).join('、')
            : '-',
      },
      {
        key: 'createdAt',
        header: '导入时间',
        width: 180,
        render: (batch) => formatImportDate(batch.createdAt),
      },
    ],
    []
  );

  const handleUpload = async (file: File) => {
    if (!file.name.match(/\.xlsx?$/i)) {
      toast.error('仅支持 .xlsx 或 .xls 格式');
      throw new Error('unsupported file type');
    }

    setUploading(true);
    try {
      const upload = await uploadExcel(file);
      setFileAssetId(upload.id);
      setFileUrl(upload.url);
      const previewResponse = await api.post<PayrollImportPreview>('/payroll/import/preview', {
        fileAssetId: upload.id,
        fileUrl: upload.url,
      });
      setPreview(previewResponse.data);
      toast.success(`已解析 ${previewResponse.data.parsedSheets} 个 sheet`);
      return upload;
    } catch (error) {
      toast.error(getErrorMessage(error, '上传或预览失败'));
      throw error;
    } finally {
      setUploading(false);
    }
  };

  const handleUploadChange = (file: UploadedFile | null) => {
    setUploadedFile(file);
    if (!file) {
      setFileAssetId(null);
      setFileUrl(null);
      setPreview(null);
    }
  };

  const handleRefreshPreview = async () => {
    if (!fileAssetId) return;
    setPreviewLoading(true);
    try {
      const previewResponse = await api.post<PayrollImportPreview>('/payroll/import/preview', {
        fileAssetId,
        fileUrl,
      });
      setPreview(previewResponse.data);
      toast.success('预览已刷新');
    } catch (error) {
      toast.error(getErrorMessage(error, '刷新预览失败'));
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleCommit = async () => {
    if (!fileAssetId) return;

    const periodsText = preview?.periods.map((period) => period.periodKey).join('、') ?? '';
    if (
      !window.confirm(`确定要替换 ${periodsText} 的薪资数据吗？此操作会覆盖已有数据且不可撤销。`)
    ) {
      return;
    }

    setCommitting(true);
    try {
      const response = await api.post('/payroll/import/commit', { fileAssetId, fileUrl });
      toast.success(`导入完成，新增 ${response.data.createdRecords} 条记录`);
      await refetchBatches();
      setPreview(null);
      setFileAssetId(null);
      setFileUrl(null);
      setUploadedFile(null);
    } catch (error) {
      toast.error(getErrorMessage(error, '确认导入失败'));
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div className="space-y-4 p-4 md:p-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">上传工资簿</CardTitle>
          <CardDescription>
            支持 2021-2026 历史工资簿导入。重复导入同月份时会按“替换整月”覆盖旧数据。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FileUpload
            value={uploadedFile}
            onChange={handleUploadChange}
            onUpload={handleUpload}
            accept=".xlsx,.xls"
            maxSize={10}
            disabled={uploading}
            data-testid="payroll-import-upload"
          />

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              onClick={handleRefreshPreview}
              disabled={!fileAssetId}
              loading={previewLoading}
            >
              <RefreshCcw className="mr-2 h-4 w-4" />
              刷新预览
            </Button>
            <Button
              onClick={handleCommit}
              disabled={!preview || preview.errors.length > 0}
              loading={committing}
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              确认导入
            </Button>
          </div>
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">解析预览</CardTitle>
            <CardDescription>
              共识别 {preview.totalSheets} 个 sheet，成功解析 {preview.parsedSheets} 个，合计{' '}
              {preview.totalRows} 条记录。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {preview.errors.length > 0 && (
              <IssueAlert title="错误" issues={preview.errors} variant="destructive" />
            )}

            {preview.warnings.length > 0 && (
              <IssueAlert title="警告" issues={preview.warnings} variant="warning" />
            )}

            <div className="space-y-3">
              {preview.periods.map((period) => (
                <div key={period.periodKey} className="space-y-3 rounded-md border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-medium">
                        {period.periodKey} · {period.sheetName}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {period.companyName || '未知公司'} · 应出勤 {period.expectedWorkDays ?? '-'}{' '}
                        天 · {period.rowCount} 条记录
                      </div>
                    </div>
                  </div>

                  {period.sampleRecords.length > 0 && (
                    <DataTable
                      data={period.sampleRecords}
                      columns={sampleColumns}
                      hidePagination
                      storageId={`payroll-import-sample-${period.periodKey}`}
                    />
                  )}

                  {period.warnings.length > 0 && (
                    <IssueAlert title="期间警告" issues={period.warnings} variant="warning" />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">历史导入批次</CardTitle>
          <CardDescription>用于追踪每次工资簿导入和替换期间。</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            data={batches}
            columns={batchColumns}
            loading={loadingBatches}
            hidePagination
            emptyState={{
              title: '暂无导入批次',
              description: '还没有工资簿导入记录',
            }}
            storageId="payroll-import-batches"
          />
        </CardContent>
      </Card>
    </div>
  );
}

function IssueAlert({
  title,
  issues,
  variant,
}: {
  title: string;
  issues: PreviewIssue[];
  variant: 'warning' | 'destructive';
}) {
  return (
    <Alert variant={variant}>
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <ul className="space-y-1">
          {issues.map((issue, index) => (
            <li key={`${issue.sheetName}-${issue.rowIndex}-${index}`}>
              [{issue.sheetName || '未知 sheet'}
              {issue.rowIndex ? ` / 第 ${issue.rowIndex} 行` : ''}] {issue.message}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

function AmountText({ value }: { value: number | null | undefined }) {
  return (
    <span className="font-mono tabular-nums">{value != null ? Number(value).toFixed(2) : '-'}</span>
  );
}
