/**
 * 业务实体「显示名」统一规约：subject 字段预设下拉值。
 *
 * 这些预设值仅用于 UI Combobox 下拉提示，避免每个销售/财务自由发挥导致风格不一。
 * 后端 zod 校验只约束「非空 ≤ 100 字」，预设之外的自定义值仍可被接受。
 *
 * @see assets/20260614/ky-azeroth业务实体显示名统一规约.md（设计文档）
 * @see packages/shared/src/utils/entity-display-name.ts（消费这些 subject 的派生函数）
 */

/**
 * 回款（direction='IN'）业务摘要预设。
 * 业务覆盖：合同分期付款 / 续费 / 月度结算 / 培训 / 硬件 / 一次性买断。
 */
export const PAYMENT_SUBJECT_IN_PRESETS = [
  '首期款',
  '进度款',
  '验收款',
  '尾款',
  '质保金返还',
  '年费续费',
  '月度服务费',
  '培训费',
  '硬件款',
  '一次性买断',
  '其他',
] as const;

/**
 * 退款（direction='OUT'）业务摘要预设。
 * 业务覆盖：客户退款 / 多收退还 / 质保金退还。
 */
export const PAYMENT_SUBJECT_OUT_PRESETS = ['客户退款', '多收退还', '质保金退还', '其他'] as const;

/**
 * 开票业务摘要预设。
 * 业务覆盖：软件开发 / 技术服务 / 钉钉 SaaS / 钉钉硬件 / 培训 / 咨询 / 年度授权 / 维护。
 */
export const INVOICE_SUBJECT_PRESETS = [
  '软件开发服务费',
  '技术服务费',
  '钉钉软件费',
  '钉钉硬件款',
  '培训费',
  '咨询服务费',
  '年度授权费',
  '维护服务费',
  '其他',
] as const;

export type PaymentSubjectInPreset = (typeof PAYMENT_SUBJECT_IN_PRESETS)[number];
export type PaymentSubjectOutPreset = (typeof PAYMENT_SUBJECT_OUT_PRESETS)[number];
export type InvoiceSubjectPreset = (typeof INVOICE_SUBJECT_PRESETS)[number];
