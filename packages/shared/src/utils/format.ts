/**
 * 格式化金额（人民币）
 */
export function formatCurrency(
  amount: number,
  options?: { showSymbol?: boolean; decimals?: number }
): string {
  const { showSymbol = true, decimals = 2 } = options ?? {};
  const formatted = amount.toLocaleString('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return showSymbol ? `¥${formatted}` : formatted;
}

/**
 * 格式化百分比
 */
export function formatPercent(value: number, decimals = 2): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * 格式化数量（带千分位）
 */
export function formatNumber(value: number, options?: { decimals?: number }): string {
  const { decimals = 0 } = options ?? {};
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * 格式化手机号（隐藏中间四位）
 */
export function formatPhone(phone: string, mask = true): string {
  if (!phone || phone.length !== 11) return phone;
  if (mask) {
    return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
  }
  return phone;
}

/**
 * 生成业务单号
 * @param prefix 前缀，如 'PO', 'PI', 'SO'
 * @param sequence 序号
 * @param date 日期
 */
export function generateSerialNumber(prefix: string, sequence: number, date?: Date): string {
  const d = date ?? new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const seq = String(sequence).padStart(3, '0');
  return `${prefix}${year}${month}${seq}`;
}

/**
 * 截断文本
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}
