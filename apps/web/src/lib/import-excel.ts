import type * as XLSXTypes from 'xlsx';

export interface ImportColumn<T> {
  header: string;
  key: keyof T | string;
  required?: boolean;
  // 数据转换函数
  transform?: (value: unknown) => unknown;
  // 数据验证函数
  validate?: (value: unknown) => string | null;
}

export interface ImportResult<T> {
  success: boolean;
  data: T[];
  errors: ImportError[];
  totalRows: number;
  validRows: number;
}

export interface ImportError {
  row: number;
  column: string;
  value: unknown;
  message: string;
}

export interface ImportExcelOptions<T> {
  columns: ImportColumn<T>[];
  sheetIndex?: number;
  headerRow?: number;
  skipEmptyRows?: boolean;
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
 * 解析 Excel 文件并返回数据
 */
export async function parseExcelFile<T extends Record<string, unknown>>(
  file: File,
  options: ImportExcelOptions<T>
): Promise<ImportResult<T>> {
  const { columns, sheetIndex = 0, headerRow = 0, skipEmptyRows = true } = options;

  const XLSX = await getXLSX();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'array' });

        // 获取工作表
        const sheetNames = workbook.SheetNames;
        if (sheetIndex >= sheetNames.length) {
          reject(new Error('工作表索引超出范围'));
          return;
        }

        const sheetName = sheetNames[sheetIndex];
        if (!sheetName) {
          reject(new Error('工作表不存在'));
          return;
        }
        const worksheet = workbook.Sheets[sheetName];
        if (!worksheet) {
          reject(new Error('无法读取工作表'));
          return;
        }

        // 将工作表转换为 JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet, {
          header: 1,
          defval: '',
        }) as unknown[][];

        if (jsonData.length === 0) {
          resolve({
            success: false,
            data: [],
            errors: [{ row: 0, column: '', value: '', message: 'Excel 文件为空' }],
            totalRows: 0,
            validRows: 0,
          });
          return;
        }

        // 获取表头
        const headers = jsonData[headerRow] as string[];

        // 验证表头是否匹配
        const headerErrors = validateHeaders(headers, columns);
        if (headerErrors.length > 0) {
          resolve({
            success: false,
            data: [],
            errors: headerErrors,
            totalRows: 0,
            validRows: 0,
          });
          return;
        }

        // 构建表头到列索引的映射
        const headerIndexMap = new Map<string, number>();
        headers.forEach((h, i) => {
          if (h) {
            headerIndexMap.set(h.trim(), i);
          }
        });

        // 解析数据行
        const result: T[] = [];
        const errors: ImportError[] = [];
        let validRows = 0;

        for (let i = headerRow + 1; i < jsonData.length; i++) {
          const row = jsonData[i];

          // 跳过空行或 undefined 行
          if (!row || (skipEmptyRows && isEmptyRow(row))) {
            continue;
          }

          const rowData: Record<string, unknown> = {};
          let hasError = false;

          for (const col of columns) {
            const colIndex = headerIndexMap.get(col.header);
            let value = colIndex !== undefined && row ? row[colIndex] : undefined;

            // 处理空值
            if (value === undefined || value === null || value === '') {
              value = null;
            }

            // 必填验证
            if (col.required && (value === null || value === '')) {
              errors.push({
                row: i + 1,
                column: col.header,
                value,
                message: `${col.header} 是必填字段`,
              });
              hasError = true;
              continue;
            }

            // 数据转换
            if (col.transform && value !== null) {
              try {
                value = col.transform(value);
              } catch (e: unknown) {
                const errorMessage = e instanceof Error ? e.message : String(e);
                errors.push({
                  row: i + 1,
                  column: col.header,
                  value,
                  message: `${col.header} 数据转换失败: ${errorMessage}`,
                });
                hasError = true;
                continue;
              }
            }

            // 数据验证
            if (col.validate && value !== null) {
              const errorMsg = col.validate(value);
              if (errorMsg) {
                errors.push({
                  row: i + 1,
                  column: col.header,
                  value,
                  message: errorMsg,
                });
                hasError = true;
                continue;
              }
            }

            rowData[col.key as string] = value;
          }

          if (!hasError) {
            result.push(rowData as T);
            validRows++;
          }
        }

        resolve({
          success: errors.length === 0,
          data: result,
          errors,
          totalRows: jsonData.length - headerRow - 1,
          validRows,
        });
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        reject(new Error(`解析 Excel 文件失败: ${errorMessage}`));
      }
    };

    reader.onerror = () => {
      reject(new Error('读取文件失败'));
    };

    reader.readAsArrayBuffer(file);
  });
}

/**
 * 验证表头是否匹配
 */
function validateHeaders<T>(headers: string[], columns: ImportColumn<T>[]): ImportError[] {
  const errors: ImportError[] = [];
  const headerSet = new Set(headers.map((h) => h?.trim()).filter(Boolean));

  for (const col of columns) {
    if (col.required && !headerSet.has(col.header)) {
      errors.push({
        row: 1,
        column: col.header,
        value: '',
        message: `缺少必填列: ${col.header}`,
      });
    }
  }

  return errors;
}

/**
 * 检查是否为空行
 */
function isEmptyRow(row: unknown[]): boolean {
  return row.every((cell) => cell === undefined || cell === null || cell === '');
}

/**
 * 生成导入模板
 */
export async function generateImportTemplate<T>(
  columns: ImportColumn<T>[],
  filename: string,
  sheetName = 'Sheet1',
  sampleData?: Partial<T>[]
): Promise<void> {
  const XLSX = await getXLSX();

  // 准备表头
  const headers = columns.map((col) => col.header);

  // 准备示例数据（如果有）
  const rows: unknown[][] = sampleData
    ? sampleData.map((item) =>
        columns.map((col) => {
          const key = col.key as string;
          return item[key as keyof T] ?? '';
        })
      )
    : [];

  // 创建工作表数据
  const wsData = [headers, ...rows];

  // 创建工作簿和工作表
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // 设置列宽
  const colWidths = columns.map(() => ({ wch: 15 }));
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
