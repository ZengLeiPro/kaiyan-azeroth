import type * as XLSXTypes from 'xlsx';

export interface ExcelColumn<T> {
  header: string;
  key: keyof T | string;
  width?: number;
  formatter?: (value: unknown, row: T) => string | number;
}

export interface ExportExcelOptions<T> {
  data: T[];
  columns: ExcelColumn<T>[];
  filename: string;
  sheetName?: string;
}

// 缓存 XLSX 模块
let xlsxModule: typeof XLSXTypes | null = null;

async function getXLSX(): Promise<typeof XLSXTypes> {
  if (!xlsxModule) {
    xlsxModule = await import('xlsx');
  }
  return xlsxModule;
}

/**
 * 导出数据为 Excel 文件
 */
export async function exportToExcel<T extends object>({
  data,
  columns,
  filename,
  sheetName = 'Sheet1',
}: ExportExcelOptions<T>): Promise<void> {
  const XLSX = await getXLSX();

  // 准备表头
  const headers = columns.map((col) => col.header);

  // 嵌套属性访问辅助函数
  const getNestedValue = (obj: Record<string, unknown>, path: string): unknown => {
    return path.split('.').reduce<unknown>((acc, key) => {
      if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[key];
      }
      return undefined;
    }, obj);
  };

  // 准备数据行
  const rows = data.map((item) => {
    return columns.map((col) => {
      const key = col.key as string;
      const value = key.includes('.')
        ? getNestedValue(item as Record<string, unknown>, key)
        : (item as Record<string, unknown>)[key];

      if (col.formatter) {
        return col.formatter(value, item);
      }
      return value ?? '';
    });
  });

  // 创建工作表数据
  const wsData = [headers, ...rows];

  // 创建工作簿和工作表
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // 设置列宽
  const colWidths = columns.map((col) => ({
    wch: col.width || 15,
  }));
  ws['!cols'] = colWidths;

  // 添加工作表到工作簿
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  // 生成 Excel 文件并下载
  const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  // 创建下载链接
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * 导出数据为 CSV 文件
 */
export function exportToCsv<T extends object>({
  data,
  columns,
  filename,
}: Omit<ExportExcelOptions<T>, 'sheetName'>): void {
  // 嵌套属性访问辅助函数
  const getNestedValue = (obj: Record<string, unknown>, path: string): unknown => {
    return path.split('.').reduce<unknown>((acc, key) => {
      if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[key];
      }
      return undefined;
    }, obj);
  };

  // 准备表头
  const headers = columns.map((col) => col.header);

  // 准备数据行
  const rows = data.map((item) => {
    return columns.map((col) => {
      const key = col.key as string;
      const value = key.includes('.')
        ? getNestedValue(item as Record<string, unknown>, key)
        : (item as Record<string, unknown>)[key];

      const cellValue = col.formatter ? col.formatter(value, item) : value;

      // CSV 需要转义包含逗号或引号的值；formatter 输出同样需要经过转义。
      const strValue = String(cellValue ?? '');
      if (strValue.includes(',') || strValue.includes('"') || strValue.includes('\n')) {
        return `"${strValue.replace(/"/g, '""')}"`;
      }
      return strValue;
    });
  });

  // 创建 CSV 内容
  const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');

  // 添加 BOM 以支持中文
  const bom = '\uFEFF';
  const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });

  // 创建下载链接
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
