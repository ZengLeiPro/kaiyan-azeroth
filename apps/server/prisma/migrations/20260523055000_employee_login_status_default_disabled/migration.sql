-- 员工 loginStatus 默认值：'active' → 'disabled'
--
-- 背景：5-23 排查到员工「登录状态」会自动从 disabled 翻回 active 的根因之一，
-- 是 schema 列默认值为 'active'。任何 `prisma.employee.create()` 路径未显式
-- 指定 loginStatus（如前端「新增员工」按钮、yccrm-sync placeholder、钉钉同步
-- 新增员工）都会默认拿到 'active'，与 canLogin 默认 false 的设计冲突。
--
-- 鉴权门是 `loginStatus !== 'active' || !canLogin`，新建员工应当默认不能登录；
-- 启用动作走管理后台 users.updateStatus()，会同步写 loginStatus + canLogin。
--
-- 同步源码：apps/server/prisma/schema.prisma:290（已改 @default("disabled")），
-- apps/server/src/modules/employees/employees.service.ts create 已显式声明
-- loginStatus:'disabled' + canLogin:false。

ALTER TABLE "employees" ALTER COLUMN "loginStatus" SET DEFAULT 'disabled';
