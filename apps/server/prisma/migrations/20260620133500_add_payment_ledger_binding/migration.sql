-- CRM Payment ↔ Finance Ledger 1:1 绑定方案 v2.1 (Phase 1 schema)
-- 详见 assets/20260620/CRM回款与财务流水绑定方案v2.md
-- 纯 DDL，全 ADD COLUMN / CREATE INDEX / ADD CONSTRAINT，无 DROP，零数据破坏
-- 字典调整（mybank 新增 / 4 个虚拟账户停用 / 1104 条 financeAccountId 回填）走独立 seed 18-finance-binding-init.ts

-- 1) payments 加两个可选 FK：财务账户（必填级在 service 层兜底）+ 财务科目（可选覆盖）
ALTER TABLE "payments" ADD COLUMN "financeAccountId" TEXT;
ALTER TABLE "payments" ADD COLUMN "financeSubjectId" TEXT;

CREATE INDEX "payments_financeAccountId_idx" ON "payments"("financeAccountId");
CREATE INDEX "payments_financeSubjectId_idx" ON "payments"("financeSubjectId");

ALTER TABLE "payments" ADD CONSTRAINT "payments_financeAccountId_fkey"
  FOREIGN KEY ("financeAccountId") REFERENCES "finance_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments" ADD CONSTRAINT "payments_financeSubjectId_fkey"
  FOREIGN KEY ("financeSubjectId") REFERENCES "finance_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2) finance_ledgers 加 paymentId（@unique，强 1:1）
ALTER TABLE "finance_ledgers" ADD COLUMN "paymentId" TEXT;

CREATE UNIQUE INDEX "finance_ledgers_paymentId_key" ON "finance_ledgers"("paymentId");

ALTER TABLE "finance_ledgers" ADD CONSTRAINT "finance_ledgers_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
