/**
 * 统一状态/分类色板（单一配色来源 + 暗色适配）
 *
 * 设计目标：
 * - `status-maps.ts` 的所有 map、各页面 Badge 渲染都只引用这里的 token，
 *   不再散落裸 Tailwind class（`bg-x-100 text-x-800`），统一支持暗色模式。
 * - 状态机字段用语义别名（success/danger/warning/info/neutral）。
 * - 高基数分类字段（行业 21 值等）用 `categoricalColor` 按序确定性分配，
 *   无需手写几十行配色，且每次结果稳定、相邻值差异明显。
 *
 * Tailwind 注意：token 为源码字面量字符串，content 扫描可识别，不会被 purge。
 */

/** 单个色板 token：浅色基调（-100/-800）+ 暗色适配（-900/40 + -300） */
export const STATUS_PALETTE = {
  gray: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  red: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  orange: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  yellow: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  lime: 'bg-lime-100 text-lime-800 dark:bg-lime-900/40 dark:text-lime-300',
  green: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  emerald: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  teal: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300',
  cyan: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300',
  sky: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  indigo: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  violet: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300',
  purple: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  fuchsia: 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/40 dark:text-fuchsia-300',
  pink: 'bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-300',
  rose: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
} as const;

export type StatusColorToken = keyof typeof STATUS_PALETTE;

/** 默认兜底色（未命中映射时） */
export const FALLBACK_COLOR = STATUS_PALETTE.gray;

/**
 * 语义别名 —— 状态机字段（成功/失败/警告/进行/中性）引用，保持语义一致。
 */
export const SEMANTIC_COLOR = {
  neutral: STATUS_PALETTE.gray,
  success: STATUS_PALETTE.green,
  danger: STATUS_PALETTE.red,
  warning: STATUS_PALETTE.amber,
  info: STATUS_PALETTE.blue,
} as const;

/**
 * 分类字段循环色板顺序：刻意打散相邻色相，让 `categoricalColor` 循环时
 * 相邻取值的颜色差异尽量大（避免一串相近色挤在一起难分辨）。
 * gray 放最后，作为循环到末尾时的中性收尾。
 */
export const CATEGORICAL_ORDER: StatusColorToken[] = [
  'blue',
  'green',
  'amber',
  'purple',
  'cyan',
  'rose',
  'teal',
  'indigo',
  'orange',
  'lime',
  'pink',
  'sky',
  'violet',
  'emerald',
  'fuchsia',
  'yellow',
  'red',
  'gray',
];

/**
 * 按索引取分类色板（确定性，按 `CATEGORICAL_ORDER` 循环）。
 * 用于高基数分类字段（行业/来源/类型等），index 通常是字段取值在其 labels 中的枚举序号。
 */
export function categoricalColor(
  index: number,
  order: StatusColorToken[] = CATEGORICAL_ORDER
): string {
  const safeIndex = ((index % order.length) + order.length) % order.length;
  return STATUS_PALETTE[order[safeIndex] ?? 'gray'];
}
