/**
 * 回款 bankName → finance_account.code 反向映射（v2.2 PR-C 后端补漏）
 *
 * v2.2 设计上 `payment.financeAccountId` 是 syncFromPayment 派生 ledger 的强校验字段，
 * 但 v2.2 规划阶段漏了「这字段在前端没有任何输入入口」。前端 payment 表单的「收款账户」
 * 字段语义对应的是 `bankName`（自由文本枚举），而 `financeAccountId` 既不在
 * createPaymentSchema 也不在 web 表单里——这导致 Phase 13 开 FEATURE_FLAG 后，
 * 所有新建回款审批通过都因 `financeAccountId=null` 失败。
 *
 * 修复策略：保留前端 bankName 作为「收款账户」UX 入口（与现有 bankNameOptions 5 项一致），
 * 后端 payment create/update 时按本映射表自动反查 finance_account.id 写入 financeAccountId；
 * syncFromPayment 入口加懒迁移兜底处理老 payment 撤回再审批的路径。
 *
 * 5 项映射跟 `apps/web/src/pages/crm/payments/payment-fields.tsx` 的 bankNameOptions 一一对齐：
 * - 招商银行 → cmb（直收）
 * - 浙江网商银行 → company_total（钉钉天元代收，PaymentItem 实际跳过 ledger 派生；映射到虚拟账户作占位）
 * - 微信 → wechat
 * - 支付宝 → alipay
 * - 现金 → cash
 *
 * 任何不在表内的 bankName（如自定义文本、历史脏数据）返回 null，由调用方决定降级行为。
 */
export const BANK_NAME_TO_FINANCE_ACCOUNT_CODE: Readonly<Record<string, string>> = Object.freeze({
  招商银行: 'cmb',
  浙江网商银行: 'company_total',
  微信: 'wechat',
  支付宝: 'alipay',
  现金: 'cash',
});

/**
 * bankName 反查 finance_account.code
 *
 * - 空 / null / undefined → 返回 null
 * - 未命中映射表 → 返回 null（调用方按需 warn / 报错）
 * - 命中 → 返回 finance_account.code 字符串（仍需 DB 端按 code 查 id）
 */
export function resolveFinanceAccountCodeByBankName(
  bankName: string | null | undefined
): string | null {
  if (!bankName) return null;
  return BANK_NAME_TO_FINANCE_ACCOUNT_CODE[bankName] ?? null;
}
