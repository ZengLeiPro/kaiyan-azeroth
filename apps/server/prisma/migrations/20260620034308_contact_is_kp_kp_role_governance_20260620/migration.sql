-- 联系人 KP 维度（2026-06-20 治理引入）
-- 背景：CRM 缺乏"关键决策人"标记能力。联系人数量增大后无法
--      快速筛"找谁能拍板"，销售判断 KP 只能靠职位字符串推断，且并不稳定。
-- 字段：
--   isKp   BOOLEAN NOT NULL DEFAULT false  —— 是否 KP（人工标记）
--   kpRole VARCHAR(50)                     —— 决策角色（拍板/技术守门/财务守门/影响人/其他），仅 isKp=true 时填
-- 数据迁移影响：
--   - 现有联系人 isKp 全部默认 false（DEFAULT 兜底，零数据迁移）
--   - 后续由销售在联系人详情页面勾选
-- 索引：(isKp, customerId) 用于"某客户的 KP 联系人"这种最高频查询

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "isKp" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "kpRole" VARCHAR(50);

-- CreateIndex
CREATE INDEX "contacts_isKp_customerId_idx" ON "contacts"("isKp", "customerId");
