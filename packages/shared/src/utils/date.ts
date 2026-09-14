/**
 * 将日期转换为 YYYY-MM-DD 格式
 * 支持 ISO 字符串、Date 对象、纯日期字符串
 *
 * @example
 * formatDateString('2024-01-21T08:30:00.000Z') // '2024-01-21'
 * formatDateString('2024-01-21') // '2024-01-21'
 * formatDateString(new Date()) // '2024-01-21'
 */
export function formatDateString(date: string | Date | null | undefined): string {
  if (!date) return '';

  if (typeof date === 'string') {
    // 如果已经是 YYYY-MM-DD 格式，直接返回
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return date;
    }
    // ISO 格式，提取日期部分
    if (date.includes('T')) {
      const parts = date.split('T');
      return parts[0] || '';
    }
    // 其他格式尝试解析
    try {
      const d = new Date(date);
      if (!isNaN(d.getTime())) {
        const parts = d.toISOString().split('T');
        return parts[0] || '';
      }
    } catch {
      // 解析失败，返回空字符串
    }
    return '';
  }

  // Date 对象
  const parts = date.toISOString().split('T');
  return parts[0] || '';
}

/**
 * 将日期转换为用于 API 提交的格式
 * 空字符串会被转换为 null
 *
 * @example
 * toAPIDateString('2024-01-21') // '2024-01-21'
 * toAPIDateString('') // null
 * toAPIDateString(null) // null
 */
export function toAPIDateString(date: string | null | undefined): string | null {
  if (!date || date.trim() === '') return null;
  return formatDateString(date);
}

/**
 * 格式化日期
 */
export function formatDate(
  date: Date | string,
  format: 'date' | 'datetime' | 'time' | 'chinese' = 'date'
): string {
  const d = typeof date === 'string' ? new Date(date) : date;

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');

  switch (format) {
    case 'datetime':
      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    case 'time':
      return `${hours}:${minutes}`;
    case 'chinese':
      return `${year}年${month}月${day}日`;
    case 'date':
    default:
      return `${year}-${month}-${day}`;
  }
}

/**
 * 获取相对时间描述
 */
export function getRelativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diff = now.getTime() - d.getTime();

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;
  if (days < 30) return `${Math.floor(days / 7)}周前`;
  if (days < 365) return `${Math.floor(days / 30)}个月前`;
  return `${Math.floor(days / 365)}年前`;
}

/**
 * 计算剩余保质期
 */
export function getRemainingShelfLife(
  productionDate: Date | string,
  shelfLifeDays: number
): {
  days: number;
  status: 'normal' | 'warning' | 'expired';
  text: string;
} {
  const production = typeof productionDate === 'string' ? new Date(productionDate) : productionDate;
  const expiryDate = new Date(production);
  expiryDate.setDate(expiryDate.getDate() + shelfLifeDays);

  const now = new Date();
  const diff = expiryDate.getTime() - now.getTime();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

  if (days <= 0) {
    return { days: 0, status: 'expired', text: '已过期' };
  }
  if (days <= 7) {
    return { days, status: 'warning', text: `还剩${days}天` };
  }
  return { days, status: 'normal', text: `还剩${days}天` };
}

/**
 * 获取当前财务期间（年月）
 */
export function getCurrentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, '0')}月`;
}

/**
 * 判断是否是今天
 */
export function isToday(date: Date | string): boolean {
  const d = typeof date === 'string' ? new Date(date) : date;
  const today = new Date();
  return (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  );
}

/**
 * 获取本月第一天和最后一天
 */
export function getMonthRange(date?: Date): { start: Date; end: Date } {
  const d = date ?? new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { start, end };
}
