import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { batchImport, getErrorMessage } from '@/lib/api';
import { type ExcelColumn, exportToCsv, exportToExcel } from '@/lib/export-excel';
import {
  generateImportTemplate,
  ImportColumn,
  ImportError,
  ImportExcelOptions,
  ImportResult,
  parseExcelFile,
} from '@/lib/import-excel';
import { logger } from '@/lib/logger';

export type ExportFormat = 'excel' | 'csv';

export interface UseImportExportOptions<TImport, TExport = TImport> {
  entityName: string;
  importColumns: ImportColumn<TImport>[];
  exportColumns?: ExcelColumn<TExport>[];
  importEndpoint?: string;
  mapImportItem?: (item: TImport) => Record<string, unknown>;
  onImportSuccess?: () => void;
  getExportData?: (filters?: Record<string, unknown>) => TExport[] | Promise<TExport[]>;
  exportSheetName?: string;
  getExportFilename?: () => string;
  templateFileName?: string;
  templateSheetName?: string;
  templateSampleData?: Partial<TImport>[];
  parseOptions?: Omit<ImportExcelOptions<TImport>, 'columns'>;
  onConfirmImport?: (data: TImport[]) => Promise<void>;
}

export interface UseImportExportReturn<TImport> {
  handleImportFile: (file: File) => Promise<ImportResult<TImport>>;
  handleConfirmImport: (data: TImport[]) => Promise<void>;
  downloadTemplate: () => Promise<void>;
  handleExport: (format: ExportFormat, filters?: Record<string, unknown>) => Promise<void>;
  importing: boolean;
  exporting: boolean;
  importErrors: ImportError[];
}

function formatDateStamp(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

export function useImportExport<
  TImport extends Record<string, unknown>,
  TExport extends object = TImport,
>(options: UseImportExportOptions<TImport, TExport>): UseImportExportReturn<TImport> {
  const {
    entityName,
    importColumns,
    exportColumns,
    importEndpoint,
    mapImportItem,
    onImportSuccess,
    getExportData,
    exportSheetName,
    getExportFilename,
    templateFileName,
    templateSheetName,
    templateSampleData,
    parseOptions,
    onConfirmImport,
  } = options;

  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importErrors, setImportErrors] = useState<ImportError[]>([]);

  const downloadTemplate = useCallback(async () => {
    const filename = templateFileName || `${entityName}导入模板`;
    const sheetName = templateSheetName || entityName;
    await generateImportTemplate(importColumns, filename, sheetName, templateSampleData);
    toast.success('模板下载成功');
  }, [entityName, importColumns, templateFileName, templateSampleData, templateSheetName]);

  const handleImportFile = useCallback(
    async (file: File) => {
      const result = await parseExcelFile<TImport>(file, {
        columns: importColumns,
        headerRow: 0,
        skipEmptyRows: true,
        ...parseOptions,
      });
      setImportErrors(result.errors);
      return result;
    },
    [importColumns, parseOptions]
  );

  const handleConfirmImport = useCallback(
    async (data: TImport[]) => {
      if (data.length === 0) return;
      setImporting(true);
      try {
        if (onConfirmImport) {
          await onConfirmImport(data);
          onImportSuccess?.();
          return;
        }

        if (!importEndpoint || !mapImportItem) {
          throw new Error('缺少导入处理器或导入端点配置');
        }

        const items = data.map((item) => mapImportItem(item));
        const result = await batchImport(importEndpoint, items);

        if (result.failed === 0) {
          toast.success(`成功导入 ${result.success} 条${entityName}数据`);
        } else {
          toast.warning(`导入完成: 成功 ${result.success} 条, 失败 ${result.failed} 条`);
        }

        onImportSuccess?.();
      } catch (error: unknown) {
        toast.error(getErrorMessage(error, '导入失败，请重试'));
      } finally {
        setImporting(false);
      }
    },
    [entityName, importEndpoint, mapImportItem, onConfirmImport, onImportSuccess]
  );

  const handleExport = useCallback(
    async (format: ExportFormat, filters?: Record<string, unknown>) => {
      if (!exportColumns || !getExportData) {
        toast.error('未配置导出列或导出数据源');
        return;
      }

      setExporting(true);
      try {
        const exportData = await getExportData(filters);
        if (!exportData || exportData.length === 0) {
          toast.error('没有可导出的数据');
          return;
        }

        const filename = getExportFilename?.() || `${entityName}_${formatDateStamp(new Date())}`;
        const sheetName = exportSheetName || entityName;

        if (format === 'excel') {
          await exportToExcel({
            data: exportData,
            columns: exportColumns,
            filename,
            sheetName,
          });
        } else {
          exportToCsv({
            data: exportData,
            columns: exportColumns,
            filename,
          });
        }

        toast.success(`成功导出 ${exportData.length} 条${entityName}数据`);
      } catch (error: unknown) {
        logger.error('useImportExport', 'Export error:', error);
        toast.error('导出失败，请重试');
      } finally {
        setExporting(false);
      }
    },
    [entityName, exportColumns, exportSheetName, getExportData, getExportFilename]
  );

  return {
    handleImportFile,
    handleConfirmImport,
    downloadTemplate,
    handleExport,
    importing,
    exporting,
    importErrors,
  };
}
