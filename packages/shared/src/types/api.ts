/**
 * API 响应基础结构
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

/**
 * API 错误
 */
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * 批量操作结果
 */
export interface BatchOperationResult {
  success: number;
  failed: number;
  errors?: Array<{
    id: string;
    error: string;
  }>;
}

/**
 * 批量导入结果（用于前端 batchImport() 通用辅助函数）
 */
export interface BatchImportResult {
  success: number;
  failed: number;
  errors: Array<{
    index: number;
    error: string;
  }>;
}

/**
 * 导入结果
 */
export interface ImportResult {
  total: number;
  success: number;
  failed: number;
  errors?: Array<{
    row: number;
    field: string;
    message: string;
  }>;
}

/**
 * 导出请求参数
 */
export interface ExportParams {
  format: 'xlsx' | 'csv' | 'pdf';
  columns?: string[];
  filters?: Record<string, unknown>;
}
