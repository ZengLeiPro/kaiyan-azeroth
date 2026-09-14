/**
 * 表格列宽统一常量
 *
 * 设计原则：
 * - 固定宽度列（width）：内容长度可预测的列（编号、状态、金额、日期等）
 * - 弹性宽度列（无 width）：内容长度不定的列（名称、文本等），依赖默认 minWidth
 * - 基于 14px/text-sm 字体、中文为主的 CRM 场景设计
 * - 统一使用 number 类型（单位 px）
 *
 * 放在 shared 包以便前后端/CLI/Schema metadata 共享同一数值来源。
 */

/** 编号列：工号、序列号、产品编号（font-mono, 6-12位） */
export const COL_SERIAL = 100;

/** 状态/标签列：Badge 组件，3-4个中文字 */
export const COL_STATUS = 100;

/** 极短状态列：性别、是/否、单字 Badge */
export const COL_STATUS_SM = 80;

/** 金额列：右对齐 font-mono，含2位小数 */
export const COL_AMOUNT = 120;

/** 百分比列：如 "85%"、"100%" */
export const COL_PERCENT = 80;

/** 小数值/计数列：1-4位整数或工时数 */
export const COL_NUMBER = 90;

/** 纯日期列：yyyy-MM-dd */
export const COL_DATE = 120;

/** 日期时间列：yyyy-MM-dd HH:mm */
export const COL_DATETIME = 160;

/** IP 地址列 */
export const COL_IP = 130;

/** 操作列：1-2个图标按钮 */
export const COL_ACTION = 80;

/** 列默认最小宽度（px），所有表格列统一使用同一下限 */
export const DEFAULT_COL_MIN_WIDTH = 80;

/** 列默认宽度（px），schema 无 width、页面无覆盖时的兜底值 */
export const DEFAULT_COL_WIDTH = 160;
