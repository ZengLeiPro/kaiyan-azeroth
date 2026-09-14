# Azeroth

通用 CRM、项目管理与工作汇报系统。

建议的独立仓库名：`kaiyan-azeroth`。本仓库不含生产凭据、真实客户或内部运维拓扑。所有者决定不附带 `LICENSE` 文件；不要将本项目表述为 MIT 或已开源。许可依赖说明见 `docs/LICENSE-REVIEW.md`。

## 核心功能

| 模块     | 功能                                                                                 |
| -------- | ------------------------------------------------------------------------------------ |
| CRM      | 客户、联系人、商机、合同订单、回款、开票、跟进、拜访签到、产品、日报                 |
| 项目管理 | 项目列表、工作项、工时记录                                                           |
| 工作汇报 | 外部日志/日程/离职记录的只读同步适配器（默认关闭）                                   |
| 组织架构 | 员工、部门                                                                           |
| 审批管理 | 审批流程配置、审批列表                                                               |
| 系统管理 | 登录账号、角色权限（RBAC）、系统参数、操作日志                                       |

## 技术栈

- 前端：React 18 + TypeScript 5 + Vite + shadcn/ui
- 后端：NestJS 11（Node.js 22）
- ORM：Prisma 6.19
- 数据库：PostgreSQL 16
- 认证：JWT 双令牌
- Monorepo：pnpm >=11.17.0 + Turborepo
- 共享包：`packages/shared`（Types + Zod Schemas + Constants）

## 快速开始

完整步骤见 `docs/INSTALLATION.md`。

```bash
pnpm install
cp .env.example apps/server/.env
# 在仓外创建 chmod 600 的密码文件，并设置：
# AZEROTH_BOOTSTRAP_PASSWORD_FILE
# AZEROTH_APPROVER_PASSWORD_FILE
docker compose up -d
pnpm db:migrate
pnpm db:seed
pnpm dev
```

本地地址：前端 `http://localhost:5173`，API `http://localhost:3000`。

管理员用户名为 `admin`。密码只来自仓外文件，仓库和本文都不提供默认密码。
`SUPER_ADMIN_EMPLOYEE_ID` 是保护锁，不授予额外权限；把 bootstrap 输出的 admin UUID 写入环境变量。

## 工程门禁

```bash
pnpm run check:all
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:linux
```

检查集合由 `package.json#scripts` 定义，并由 `check:meta-consistency` 核对 `rules.md`、Husky 与 quality-gate。

## 项目结构

```
├── apps/web
├── apps/server
├── packages/shared
├── scripts
├── docker-compose.yml
└── docs
```

## 开发规范

见 `rules.md`（`AGENTS.md` / `CLAUDE.md` 为同一份公开规则的普通文件副本）。
