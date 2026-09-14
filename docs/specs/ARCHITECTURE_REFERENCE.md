# Azeroth 架构参考手册

> **文档版本**: 2.0
> **更新日期**: 2026-02-11
> **定位**: 架构设计的「百科全书」，供深入理解和查阅
> **姊妹文档**: `DEVELOPMENT_GUIDE.md`（开发实操指南）、`ENGINEERING_PRACTICES.md`（工程实践）

---

## 目录

1. [整体架构概览](#1-整体架构概览)
2. [数据层架构](#2-数据层架构)
3. [Shared 包详解](#3-shared-包详解)
4. [UI 四层架构](#4-ui-四层架构)
5. [核心组件清单](#5-核心组件清单)
6. [核心 Hooks](#6-核心-hooks)
7. [架构健康度评估](#7-架构健康度评估)

---

## 1. 整体架构概览

### 1.1 项目结构

```
ky-azeroth/
├── apps/
│   ├── web/                 # 前端 React 应用
│   │   └── src/
│   │       ├── components/
│   │       │   ├── ui/           # L1 原子层
│   │       │   ├── patterns/     # L2 业务组件层
│   │       │   ├── templates/    # L3 布局层
│   │       │   └── mobile/       # 移动端专用组件
│   │       ├── pages/            # L4 应用层
│   │       └── hooks/            # 复用 Hooks
│   └── server/              # 后端 NestJS 应用
│       └── src/
│           └── modules/     # 业务模块（含 DTO）
└── packages/
    └── shared/              # 共享包（核心契约）
        └── src/
            ├── types/       # TypeScript 接口
            ├── schemas/     # Zod 验证规则
            └── constants/   # 常量定义
```

### 1.2 双层架构设计

项目采用两套互补的架构设计：

| 层面       | 设计理念                   | 目标                 |
| ---------- | -------------------------- | -------------------- |
| **数据层** | Prisma → Shared → 前后端   | 类型安全、前后端一致 |
| **UI 层**  | L1 → L2 → L3 → L4 四层架构 | 高度复用、易于维护   |

### 1.3 认证方式

项目使用 JWT 双令牌（Access Token + Refresh Token）认证方式，基于 username/password 登录。不做钉钉 SSO 集成。

认证模块位于 `apps/server/src/modules/auth/`，前端认证状态管理位于 `apps/web/src/stores/auth-store.ts`。

---

## 2. 数据层架构

### 2.1 类型流转链路

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              数据库层                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Prisma Schema (schema.prisma)                                      │   │
│  │  model Employee {                                                   │   │
│  │    id              String   @id                                     │   │
│  │    name            String                                           │   │
│  │    dingtalkUserId  String?  ← 数据库允许 NULL                        │   │
│  │  }                                                                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                         npx prisma generate                                 │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  @prisma/client (自动生成，仅后端可用)                                │   │
│  │  type Employee = { id: string; dingtalkUserId: string | null }      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ @prisma/client 只能在后端使用
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Shared 包（桥梁）                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  packages/shared/src/types/employee.ts                              │   │
│  │  // Shared Type —— 前后端共用的契约                                   │   │
│  │  export interface IEmployee {                                       │   │
│  │    id: string                                                       │   │
│  │    dingtalkUserId: string | null  ← 必须与 Prisma 保持一致           │   │
│  │  }                                                                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                          │                           │
            ┌─────────────┘                           └─────────────┐
            ▼                                                       ▼
┌───────────────────────────────────┐       ┌───────────────────────────────────┐
│          后端 (NestJS)            │       │          前端 (React)              │
│  class CreateEmployeeDto          │       │  interface EmployeeProfile         │
│    extends createZodDto(schema)   │       │    extends IEmployeeResponse {     │
│  { ... }                          │       │    departmentNames?: string        │
│                                   │       │  }                                 │
└───────────────────────────────────┘       └───────────────────────────────────┘
                          │                           │
                          └─────────────┬─────────────┘
                                        ▼
                          ┌─────────────────────────────┐
                          │      HTTP API 通信           │
                          │  前后端字段名、类型完全一致   │
                          └─────────────────────────────┘
```

### 2.2 为什么需要 Shared Type

**核心结论：Shared Type = 前后端的「合同」**

```
没有 Shared Type：
══════════════════════════════════════════════════════════════════
  后端自己定义                              前端自己定义
  dingtalkUserId?: string                  dingtalkUserId?: string
       │                                        │
       │     各写各的，没有共同约束               │
       ▼                                        ▼
  后端改成 string | null                   前端不知道，还是 string
       │                                        │
       └──────────────── 运行时崩溃！────────────┘


有 Shared Type：
══════════════════════════════════════════════════════════════════
                    ┌──────────────────────────┐
                    │   Shared Type            │
                    │   (唯一真相来源)           │
                    │   dingtalkUserId?: string │
                    │                  | null   │
                    └──────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
     后端 DTO（nestjs-zod）              前端 Profile（extends）
     基于 shared schema                  基于 shared types
              │                               │
              └───────────────┬───────────────┘
                              ▼
                    编译时就能发现不一致
                    前后端永远同步
```

### 2.3 前端 Profile 强绑定（extends）规范

在Azeroth中，前端展示层类型统一称为 **Profile**，并且必须以 `interface XxxProfile extends IXxxResponse` 的形式声明。

原因：

- 允许在不污染 shared 的前提下添加 UI-only 字段（别名、展平字段等）
- 避免通过 `Omit<...>` 等方式在前端“改写 shared 结构”
- 便于自动化检查脚本统一扫描（`pnpm run check:shared`）

示例：

```typescript
import type { IEmployeeResponse } from '@ky-azeroth/shared/types/employee';

// 禁止：弱绑定别名（不利于统一 Profile 规范与脚本检查）
export type EmployeeProfile = IEmployeeResponse;

// 推荐：Profile 强绑定 + 可扩展 UI 字段
export interface EmployeeProfile extends IEmployeeResponse {
  departmentNames?: string;
}
```

> 备注：本项目会在提交前通过脚本强制该规范，因此 Profile 强绑定覆盖率应保持为 100%。

---

## 3. Shared 包详解

### 3.1 三大组成部分

```
packages/shared/src/
├── types/           类型定义（TypeScript 接口）—— 回答「数据长什么样」
├── schemas/         验证规则（Zod Schema）—— 回答「数据合不合法」
└── constants/       常量定义（枚举值）—— 回答「有哪些合法值」
```

### 3.2 Types（类型定义）

**作用**：定义 TypeScript 接口，让编译器知道数据结构
**检查时机**：编译时

```typescript
// types/employee.ts
export interface IEmployee {
  id: string;
  name: string;
  status: string; // 只知道是 string，不知道具体有哪些值
  dingtalkUserId: string | null;
}

export interface ICreateEmployee {
  name: string;
  status?: string; // 可选，因为有默认值
  dingtalkUserId?: string | null;
}

export interface IEmployeeResponse extends IEmployee {
  departments?: { id: string; name: string }[]; // API 返回的关联数据
}
```

**局限性**：不能在运行时验证、不知道最大长度、不知道允许的值域

### 3.3 Schemas（验证规则）

**作用**：定义 Zod 验证规则，运行时检查数据是否合法
**检查时机**：运行时

```typescript
// schemas/employee.ts
import { z } from 'zod';
import { RECORD_STATUS } from '../constants/status-values';

export const createEmployeeSchema = z.object({
  name: z.string().min(1, '姓名不能为空').max(50, '姓名最多50个字符'),

  phone: z.string().max(20).optional().nullable(),

  status: z
    .enum(Object.values(RECORD_STATUS)) // 引用 Constants
    .optional()
    .default(RECORD_STATUS.ACTIVE),

  dingtalkUserId: z.string().max(50).optional().nullable(),
});

// 从 Schema 推导出 TypeScript 类型
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
```

### 3.4 Constants（常量定义）

**作用**：定义枚举值、状态码、标签映射
**检查时机**：编译时 + 运行时都可用

```typescript
// constants/status-values.ts
export const RECORD_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
} as const;

export const OPPORTUNITY_STAGE = {
  INITIAL: 'initial',
  QUALIFICATION: 'qualification',
  NEEDS_ANALYSIS: 'needs_analysis',
  PROPOSAL: 'proposal',
  NEGOTIATION: 'negotiation',
  CLOSED_WON: 'closed_won',
  CLOSED_LOST: 'closed_lost',
} as const;

// constants/status-labels.ts
export const OPPORTUNITY_STAGE_LABELS = {
  [OPPORTUNITY_STAGE.INITIAL]: '初步接洽',
  [OPPORTUNITY_STAGE.QUALIFICATION]: '资质审查',
  [OPPORTUNITY_STAGE.NEEDS_ANALYSIS]: '需求分析',
  [OPPORTUNITY_STAGE.PROPOSAL]: '方案报价',
  [OPPORTUNITY_STAGE.NEGOTIATION]: '商务谈判',
  [OPPORTUNITY_STAGE.CLOSED_WON]: '赢单',
  [OPPORTUNITY_STAGE.CLOSED_LOST]: '输单',
};
```

### 3.5 三者的协同关系

```
┌──────────────┬────────────────────┬────────────────────┬────────────────────┐
│              │      Types         │      Schemas       │     Constants      │
├──────────────┼────────────────────┼────────────────────┼────────────────────┤
│  回答什么    │  数据长什么样       │  数据合不合法       │  有哪些合法值       │
├──────────────┼────────────────────┼────────────────────┼────────────────────┤
│  检查时机    │  编译时             │  运行时            │  编译时+运行时      │
├──────────────┼────────────────────┼────────────────────┼────────────────────┤
│  技术实现    │  interface         │  z.object()        │  const as const    │
├──────────────┼────────────────────┼────────────────────┼────────────────────┤
│  典型用途    │  函数参数类型       │  表单验证          │  下拉框选项         │
│              │  API 响应类型       │  API 请求验证      │  状态徽章颜色       │
└──────────────┴────────────────────┴────────────────────┴────────────────────┘

依赖关系：
         Constants (定义值域)
             │
             ▼
    ┌────────────────┐
    │    Schemas     │──── 引用 Constants 的值
    │  (验证规则)    │──── 可推导出 Types (z.infer)
    └────────────────┘
             │
             ▼
         Types (类型约束)

缺一不可：
• 只有 Types → 编译通过但运行时可能崩溃
• 只有 Schemas → 有验证但代码不够类型安全
• 只有 Constants → 只有值，没有结构和验证
```

### 3.6 Shared 包目录结构

```
packages/shared/src/
├── types/                    # TypeScript 接口（26 个文件）
│   ├── common.ts             # DecimalNumber, ISODateTime, IAttachment, Pagination
│   ├── api.ts                # API 相关基础类型
│   ├── employee.ts           # IEmployee, IEmployeeResponse（含钉钉字段）
│   ├── department.ts         # IDepartment, IDepartmentResponse（树结构）
│   ├── customer.ts           # ICustomer, ICustomerResponse
│   ├── contact.ts            # IContact, IContactResponse
│   ├── opportunity.ts        # IOpportunity, IOpportunityResponse
│   ├── sale-order.ts         # ISaleOrder, ISaleOrderResponse
│   ├── payment.ts            # IPayment, IPaymentResponse
│   ├── invoice.ts            # IInvoice, IInvoiceResponse
│   ├── keep-record.ts        # IKeepRecord（跟进记录）
│   ├── visit-record.ts       # IVisitRecord（拜访签到）
│   ├── crm-product.ts        # ICrmProduct
│   ├── crm-work-daily.ts     # ICrmWorkDaily（CRM 日报）
│   ├── project.ts            # IProject, IProjectResponse
│   ├── work-item.ts          # IWorkItem, IWorkItemResponse
│   ├── effort-record.ts      # IEffortRecord（工时记录）
│   ├── dingtalk-log.ts       # IDingtalkLog（钉钉日志，只读）
│   ├── calendar-event.ts     # ICalendarEvent（日程事件，只读）
│   ├── employee-leave.ts     # IEmployeeLeave（离职记录，只读）
│   ├── simplified.ts         # ISimpleCustomer, ISimpleProject 等简化类型
│   ├── approval.ts           # 审批相关类型
│   ├── auth.ts               # 认证类型
│   ├── system.ts             # 系统参数类型
│   ├── upload.ts             # 上传类型
│   └── index.ts              # 统一导出
├── schemas/                  # Zod 验证 Schema（25 个文件）
│   ├── common.ts             # paginationSchema, attachmentSchema
│   ├── customer.ts           # createCustomerSchema, queryCustomerSchema
│   ├── opportunity.ts        # createOpportunitySchema
│   ├── sale-order.ts         # createSaleOrderSchema
│   ├── project.ts            # createProjectSchema
│   ├── work-item.ts          # createWorkItemSchema
│   └── index.ts              # 统一导出
├── utils/                    # 工具函数
│   ├── attachment.ts         # createAttachment, toAttachment, toUploadedFile
│   ├── date.ts               # formatDate, formatDateString
│   ├── format.ts             # formatCurrency, formatNumber
│   ├── nullish.ts            # nullToUndefined, undefinedToNull
│   └── index.ts
└── constants/                # 状态值和标签
    ├── status-values.ts      # RECORD_STATUS, OPPORTUNITY_STAGE, ORDER_STATUS 等
    ├── status-labels.ts      # 中文标签映射
    ├── modules.ts            # MODULES（权限模块树）
    ├── approval-events.ts    # APPROVAL_EVENT_REGISTRY
    ├── approval.ts           # 审批相关常量
    ├── notification.ts       # 通知类型常量
    ├── defaults.ts           # 默认值
    └── index.ts
```

---

## 4. UI 四层架构

### 4.1 架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│  L4 应用层 (pages/*)                                                 │
│  职责: 组装 Hook + Layout + Patterns，形成完整页面                    │
│  代码量: 60-150 行/页面                                              │
├─────────────────────────────────────────────────────────────────────┤
│  L3 布局层 (components/templates/)                                   │
│  职责: 页面骨架，空间划分                                             │
│  组件: StandardLayout, MainLayout, MobileLayout, SplitLayout        │
├─────────────────────────────────────────────────────────────────────┤
│  L2 业务组件层 (components/patterns/)                                │
│  职责: 封装业务语义的可复用组件                                       │
│  组件: StandardToolbar, CrudTable, FormDialog, CustomerSelect       │
├─────────────────────────────────────────────────────────────────────┤
│  L1 原子层 (components/ui/)                                          │
│  职责: 纯 UI 元素，无业务逻辑，来自 shadcn/ui                         │
│  组件: Button, Input, Table, Dialog, Badge                          │
└─────────────────────────────────────────────────────────────────────┘
```

**每层的一句话定义**：

- **L1 原子层**：提供基础 UI 构建块，不关心业务
- **L2 业务组件层**：封装通用的业务交互模式
- **L3 布局层**：定义页面的空间结构
- **L4 应用层**：实现具体的业务功能

### 4.2 各层职责边界

| 层级 | 可以做                              | 不应该做               |
| ---- | ----------------------------------- | ---------------------- |
| L1   | 接收 props、渲染 UI、触发事件       | 调用 API、管理业务状态 |
| L2   | 组合 L1、封装交互逻辑、定义业务语义 | 硬编码具体业务数据     |
| L3   | 定义布局结构、处理响应式            | 包含业务内容           |
| L4   | 调用 API、管理页面状态、组合组件    | 重复实现 L2 已有的功能 |

### 4.3 组件放置决策树

```
组件是否是页面导航/布局的组成部分？
├── 是 → 组件是否被 templates/ 布局引用？
│        ├── 是 → components/patterns/（如 Header, Sidebar）
│        └── 否 → components/templates/（如 StandardLayout）
└── 否 → 组件是否有业务逻辑？
         ├── 否 → components/ui/（L1 原子层）
         └── 是 → 组件是否可被多个页面复用？
                  ├── 是 → components/patterns/（L2 业务组件层）
                  └── 否 → pages/*/components/（L4 应用层）
```

### 4.4 布局层级嵌套关系

```
App.tsx (根路由)
└── ResponsiveLayout ──────────────────────────────────────────┐
    │                                                          │
    ├── [桌面端] MainLayout                                     │
    │   ┌──────────┬───────────────────────────────────┐       │
    │   │ Sidebar  │  Header                           │       │
    │   │          ├───────────────────────────────────┤       │
    │   │          │  <Outlet /> ──────────────────────┼───┐   │
    │   └──────────┴───────────────────────────────────┘   │   │
    │                                                      │   │
    └── [移动端] MobileLayout                              │   │
        ┌───────────────────────┐                          │   │
        │  MobileHeader         │                          │   │
        ├───────────────────────┤                          │   │
        │  <Outlet /> ──────────┼──────────────────────────┤   │
        ├───────────────────────┤                          │   │
        │  MobileBottomNav      │                          │   │
        └───────────────────────┘                          │   │
                                                           │   │
                    ┌──────────────────────────────────────┘   │
                    ▼                                          │
             具体业务页面 (L4)                                   │
                    │                                          │
    ┌───────────────┼───────────────┐                          │
    ▼               ▼               ▼                          │
StandardLayout  StandardLayout   自定义布局                     │
 (普通列表)     + SplitLayout    (Dashboard)                    │
               (主从视图)                                       │
                                                               │
独立页面（不在 ResponsiveLayout 内）                              │
├── LoginPage                                                  │
├── NotFoundPage                                               │
└── ForbiddenPage ─────────────────────────────────────────────┘
```

**嵌套顺序固定**: `ResponsiveLayout → MainLayout/MobileLayout → StandardLayout → SplitLayout(可选)`

---

## 5. 核心组件清单

### 5.1 L1 原子层 (components/ui/)

| 分类     | 组件                                                   | 用途           |
| -------- | ------------------------------------------------------ | -------------- |
| 表单类   | Button, Input, Textarea, Select, Checkbox, DatePicker  | 用户输入与交互 |
| 数值输入 | NumberInput, CurrencyInput                             | 数值与货币输入 |
| 文件上传 | FileUpload, MultiFileUpload                            | 文件上传       |
| 展示类   | Badge, Card, Table, DataTable, Tooltip, Skeleton, Tabs | 数据展示       |
| 反馈类   | Dialog, AlertDialog, Sheet, Popover, Toast (Sonner)    | 用户反馈       |
| 导航类   | Pagination, Command, DropdownMenu                      | 页面导航       |
| 特殊用途 | AddressPicker, MultiTag, PrintLayout, ViewFormField    | 特定场景       |

### 5.2 L2 业务组件层 (components/patterns/)

#### 页面核心组件

| 组件              | 职责                                                     |
| ----------------- | -------------------------------------------------------- |
| StandardToolbar   | 页面工具栏：标题 + 搜索 + 筛选 + 操作按钮；批量模式切换  |
| CrudTable         | 数据表格：行选择、排序；桌面端 DataTable，移动端卡片列表 |
| FormDialog        | 表单对话框：view/edit/create 三种模式                    |
| DeleteConfirm     | 单条删除确认对话框                                       |
| BulkDeleteConfirm | 批量删除确认对话框                                       |
| StatusBadge       | 根据状态值和 statusMap 配置显示对应样式的徽章            |

#### 业务选择器

| 组件             | 职责                           |
| ---------------- | ------------------------------ |
| CustomerSelect   | 客户选择器，带搜索             |
| ProjectSelect    | 项目选择器，带搜索             |
| DepartmentSelect | 部门选择器，树结构层级缩进展示 |

#### 导航组件

| 组件            | 端   | 职责                                 |
| --------------- | ---- | ------------------------------------ |
| Header          | 桌面 | 面包屑、全局搜索、主题切换、用户菜单 |
| Sidebar         | 桌面 | Logo、可折叠菜单、路径高亮           |
| MobileHeader    | 移动 | 菜单按钮 + 页面标题 + 通知按钮       |
| MobileBottomNav | 移动 | 底部导航栏                           |
| MobileSideMenu  | 移动 | 侧边抽屉菜单                         |

#### 数据导入导出

| 组件          | 职责                             |
| ------------- | -------------------------------- |
| ExportButton  | 导出按钮，支持 Excel/CSV         |
| ImportButton  | 导入按钮，含模板下载、上传、预览 |
| DataIoToolbar | 整合导入导出的工具栏             |

### 5.3 L3 布局层 (components/templates/)

| 组件             | 职责                                     |
| ---------------- | ---------------------------------------- |
| ResponsiveLayout | 响应式布局选择器，768px 断点自动切换     |
| MainLayout       | 桌面端主布局：Sidebar + Header + 内容区  |
| MobileLayout     | 移动端主布局：Header + 内容 + BottomNav  |
| StandardLayout   | 标准页面布局：工具栏-内容-分页三段式结构 |
| SplitLayout      | 分栏布局：左右分栏，适用于主从视图       |

### 5.4 Props 速查表

#### L3 布局组件

| 组件           | 必填 Props  | 可选 Props                         |
| -------------- | ----------- | ---------------------------------- |
| StandardLayout | children    | toolbar, pagination, className     |
| SplitLayout    | left, right | leftWidth, showRight, onMobileBack |

#### L2 核心组件

| 组件            | 必填 Props                                | 可选 Props                                                             |
| --------------- | ----------------------------------------- | ---------------------------------------------------------------------- |
| StandardToolbar | -                                         | title, search, filters, onCreate, bulkSelection                        |
| CrudTable       | data, columns                             | loading, pagination, sorting, onRowClick, rowSelection, hidePagination |
| FormDialog      | open, onOpenChange, title, mode, children | onSubmit, onDelete, loading, maxWidth                                  |
| DeleteConfirm   | open, onOpenChange, entityName, onConfirm | loading, message                                                       |
| StatusBadge     | status, statusMap                         | fallback                                                               |

---

## 6. 核心 Hooks

### 6.1 useCrud - CRUD 操作核心

**文件位置**: `apps/web/src/hooks/use-crud.ts`

#### 参数说明

```typescript
const crud = useCrud<ApiEntity, FormData>({
  endpoint: '/products',              // 必填：API 端点
  initialFormData: { name: '', ... }, // 必填：表单初始值
  schema: productFormSchema,          // 必填：Zod Schema（只读页面可例外，需进入 allowlist）
  validateMode: 'onSubmit',           // 可选：验证模式
  entityToForm: (entity) => ({...}),  // 可选：实体转表单数据
  formToPayload: (form) => ({...}),   // 可选：表单数据转创建 API 载荷
  formToUpdatePayload: (form) => ({...}), // 可选：表单数据转更新 API 载荷
  getEntityName: (entity) => entity.name, // 可选：获取实体名称
  disableEdit: false,                 // 可选：禁用编辑功能
  transformData: (data) => data,      // 可选：自定义数据转换函数
  paginationOptions: { initialSortBy: 'createdAt', initialSortOrder: 'desc' },
});
```

#### 返回值速查

| 分类       | 属性/方法                                                            | 用途                            |
| ---------- | -------------------------------------------------------------------- | ------------------------------- |
| 数据       | data, loading, error, keyword, setKeyword, refresh                   | 列表数据管理                    |
| 分页       | pagination, sorting                                                  | 传给 StandardLayout / CrudTable |
| 行选择     | selectedKeys, clearSelection, rowSelectionProps                      | 批量操作                        |
| 对话框状态 | dialogOpen, isViewMode, isEditing, editingEntity, formDialogProps    | FormDialog 控制                 |
| 表单       | formData, updateFormField, handleSubmit, submitLoading               | 表单数据管理                    |
| Zod 验证   | errors, getFieldError, isValid, validate, clearErrors                | 需传入 schema                   |
| 对话框控制 | openCreateDialog, openEditDialog, openViewDialog, closeDialog        | 打开/关闭对话框                 |
| 删除       | deleteDialogOpen, handleDelete, openDeleteDialog, deleteConfirmProps | 单条删除                        |
| 批量删除   | handleBulkDelete, openBulkDeleteDialog, bulkDeleteConfirmProps       | 批量删除                        |

#### 生命周期

- **初始化**: 调用 API 获取列表 → `transformData()` → `crud.data`
- **新建**: `openCreateDialog()` → `formData = initialFormData`, `mode = 'create'`
- **查看**: `openViewDialog(entity)` → `formData = entityToForm(entity)`, `mode = 'view'`
- **编辑**: `enterEditMode()` → `mode = 'edit'`
- **提交**: `handleSubmit()` → `schema.parse()` → `formToPayload()` → API → 刷新
- **删除**: `handleDelete()` → DELETE API → 刷新

### 6.2 其他常用 Hooks

| Hook                | 职责                     |
| ------------------- | ------------------------ |
| useIsMobile         | 检测移动端（断点 768px） |
| useServerPagination | 服务端分页状态管理       |
| useRowSelection     | 行选择状态管理           |
| useColumnVisibility | 列可见性状态管理         |
| useApprovalFlow     | 审批流程逻辑             |
| useFileUpload       | 文件上传逻辑             |
| useImportExport     | 数据导入导出逻辑         |
| useVersionConflict  | 版本冲突处理             |

---

## 7. 架构健康度评估

项目的"架构健康度"不是手工打分，而是由 **自动化阻断检查**定义：**所有阻断检查通过 = 架构健康**。

### 7.1 阻断闸门

- 本地提交前：`.husky/pre-commit`
- CI：`.github/workflows/quality-gate.yml`

### 7.2 健康度指标（= 检查脚本）

- 数据层契约一致性：`check:prisma-coverage`、`check:optional`、`check:json-helpers`
- 后端接口契约一致性：`check:query-dto`、`check:controller-query-dto`、`check:controller-return-type`、`check:dto`
- 前端页面范式一致性：`check:shared`、`check:usecrud`、`check:decimal`、`check:transform`
- 基础类型安全：`check:no-any`

### 7.3 解读失败（统一处理方式）

- 优先按脚本输出定位到具体文件并修复，不要通过“临时绕过”来通过检查（会破坏 Single Source of Truth）。

---

## 附录：类型命名规范

| 用途       | 命名规范               | 位置              | 说明                         |
| ---------- | ---------------------- | ----------------- | ---------------------------- |
| 基础实体   | `I[Entity]`            | shared/types/     | 数据库实体的基本结构         |
| 创建输入   | `ICreate[Entity]`      | shared/types/     | 创建 API 的输入参数          |
| 更新输入   | `IUpdate[Entity]`      | shared/types/     | 更新 API 的输入参数          |
| API 响应   | `I[Entity]Response`    | shared/types/     | API 返回（含关联对象时使用） |
| Zod Schema | `create[Entity]Schema` | shared/schemas/   | 验证规则                     |
| 前端展示   | `[Entity]Profile`      | pages/\*/types.ts | 含 UI 别名字段               |
| 前端表单   | `[Entity]FormData`     | pages/\*/types.ts | 表单字段定义                 |

---

## 附录 A：数据模型设计决策

### A.1 chargerId 字符串设计

CRM 模型中 `chargerId String?` + `chargerName String?` 的组合**有意不建立** Employee 外键关联。原因：

1. 历史数据导入时，YCCRM 的 charger_id 存储的是钉钉 userId，与新系统 Employee.id 无法直接映射
2. 部分记录的负责人可能已离职，不在 Employee 表中

对于新系统 CRUD 录入的数据，前端应使用员工选择器组件，将选中员工的名称写入 `chargerName`，`chargerId` 可写入 Employee.id 以便后续关联查询。同理适用于 `CrmWorkDaily.senderId`、`Project.ownerId` 等字段。

### A.2 产品明细行快照模式

`OpportunityProduct` 和 `OrderProduct` 使用 `productName`/`productNumber` 字符串字段存储产品信息，**有意不建立**到 `CrmProduct` 的外键关联。

原因：商机/订单中的产品信息是创建时的快照，后续 `CrmProduct` 的价格、名称变更不应影响历史商机和订单的记录。这是 CRM 系统的标准做法。

### A.3 Payment/Invoice 的 customerId 冗余字段

`Payment` 和 `Invoice` 两张表中均冗余了 `customerId` 字段（它们已通过 `saleOrderId` 关联到 `SaleOrder`，而 `SaleOrder` 本身包含 `customerId`）。

设计原因：

- 便于按客户维度快速查询回款和开票数据（避免 JOIN SaleOrder）
- 数据一致性由 Service 层业务逻辑保证（创建时从 SaleOrder 读取 customerId 写入）
- 是 CRM 系统中常见的查询优化手段

---

## 附录 B：业务编号规则

系统使用 `SerialNumberCounter` 自动生成业务编号，格式为 `前缀 + YYMMDD + 3位序列号`。

| 实体        | 编号前缀 | 示例          |
| ----------- | -------- | ------------- |
| Customer    | `CU`     | `CU260210001` |
| Opportunity | `OP`     | `OP260210001` |
| SaleOrder   | `SO`     | `SO260210001` |
| Payment     | `PM`     | `PM260210001` |
| Invoice     | `IV`     | `IV260210001` |
| Project     | `PJ`     | `PJ260210001` |
| CrmProduct  | `CP`     | `CP260210001` |

**不需要业务编号的实体**：Contact、KeepRecord、VisitRecord、WorkItem（使用项目内部编号体系）、EffortRecord、OpportunityProduct/OrderProduct（明细行）、ProjectMember、DingtalkLog/DingtalkCalendarEvent/EmployeeLeave（历史钉钉同步数据，使用钉钉原始 ID）、CrmWorkDaily。

编号计数器由 `apps/server/src/common/services/serial-number.service.ts` 管理。旧独立 dingtalk-sync 包中的 `generateSerialNumber()` 已随历史包删除。

---

## 附录 C：角色与权限设计

### 种子数据角色定义

| 角色 code     | 名称       | 权限范围                      |
| ------------- | ---------- | ----------------------------- |
| `ADMIN`       | 系统管理员 | 所有模块全部权限              |
| `CRM_MANAGER` | CRM 管理员 | CRM 模块全部权限              |
| `SALES`       | 销售人员   | CRM 模块 view + create + edit |
| `PM`          | 项目经理   | 项目管理模块全部权限          |
| `VIEWER`      | 只读用户   | 所有模块仅 view               |

权限模块树定义在 `packages/shared/src/constants/modules.ts`，包含 6 个一级模块（CRM、项目管理、工作汇报、组织架构、审批管理、系统管理）及其下属菜单。每个菜单支持 view/create/edit/delete/export/approve 操作。

---

## 附录 D：dingtalk-sync 历史架构

### D.1 概述

旧独立 dingtalk-sync 包是历史同步模块，当前已删除，不再部署、不再定时执行、不再作为当前数据同步链路。
本附录仅记录历史架构，不能据此推断线上仍在运行钉钉、YCCRM 或云效同步任务。

- 历史上与主后端（`apps/server`）共享同一份 `prisma/schema.prisma`（通过路径引用）
- 历史部署配置：`infra/s.dingtalk-sync.prod.yaml`
- 历史定时触发器：每日凌晨 2:00
- 当前状态：代码已删除，仅作历史参考

### D.2 目录结构

```
旧独立 dingtalk-sync 包（当前仓库已删除）：
├── src/
│   ├── index.ts          # FC handler 入口
│   ├── cli.ts            # CLI 入口（手动触发）
│   ├── http.ts           # HTTP 入口（测试用）
│   ├── sync-all.ts       # 同步编排逻辑
│   └── syncs/            # 各数据源同步实现
│       ├── employees.ts
│       ├── departments.ts
│       ├── logs.ts
│       ├── calendar.ts
│       └── leaves.ts
├── prisma/ → ../../apps/server/prisma  # 符号链接，共享 schema
├── package.json
└── tsconfig.json
```

### D.3 历史同步策略

| 钉钉 API    | 目标表                     | 同步策略                                  |
| ----------- | -------------------------- | ----------------------------------------- |
| 通讯录-员工 | `employees`                | upsert by `dingtalkUserId`                |
| 通讯录-部门 | `departments`              | upsert by `dingtalkDeptId`                |
| 工作日志    | `dingtalk_logs`            | upsert by `reportId`                      |
| 日历事件    | `dingtalk_calendar_events` | upsert by `eventId`                       |
| 离职人员    | `employee_leaves`          | upsert by (`dingtalkUserId`, `leaveTime`) |

历史同步使用增量模式（通过 `SyncState` 表记录同步游标），支持断点续同步。当前系统不再以该模块作为数据同步入口。

### D.4 历史环境变量

| 变量                  | 说明               |
| --------------------- | ------------------ |
| `DINGTALK_APP_KEY`    | 钉钉应用 AppKey    |
| `DINGTALK_APP_SECRET` | 钉钉应用 AppSecret |
| `DINGTALK_CORP_ID`    | 钉钉企业 CorpId    |
| `DATABASE_URL`        | PostgreSQL 连接串  |

### D.5 历史入口

- **FC handler**（`src/index.ts`）：历史定时触发器入口
- **CLI**（`src/cli.ts`）：历史本地手动触发入口
- **HTTP**（`src/http.ts`）：历史冒烟测试和手动触发入口

---

## 附录 E：后端模块清单

### E.1 系统基础模块（保留自原始架构）

| 模块           | 路径                      | 说明                     |
| -------------- | ------------------------- | ------------------------ |
| auth           | `modules/auth/`           | JWT 认证（不做钉钉 SSO） |
| users          | `modules/users/`          | 用户管理                 |
| roles          | `modules/roles/`          | RBAC 角色权限            |
| sessions       | `modules/sessions/`       | 会话管理                 |
| health         | `modules/health/`         | 健康检查                 |
| upload         | `modules/upload/`         | 文件上传                 |
| notifications  | `modules/notifications/`  | 通知模块                 |
| operation-logs | `modules/operation-logs/` | 操作日志                 |
| system-params  | `modules/system-params/`  | 系统参数                 |
| approval-flows | `modules/approval-flows/` | 审批流程配置             |
| approvals      | `modules/approvals/`      | 审批实例                 |
| dashboard      | `modules/dashboard/`      | 仪表盘                   |

### E.2 CRM 业务模块

| 模块             | 路径                        | 说明     |
| ---------------- | --------------------------- | -------- |
| customers        | `modules/customers/`        | 客户管理 |
| contacts         | `modules/contacts/`         | 联系人   |
| opportunities    | `modules/opportunities/`    | 商机     |
| sale-orders      | `modules/sale-orders/`      | 合同订单 |
| payments         | `modules/payments/`         | 回款管理 |
| invoices         | `modules/invoices/`         | 开票管理 |
| keep-records     | `modules/keep-records/`     | 跟进记录 |
| visit-records    | `modules/visit-records/`    | 拜访签到 |
| crm-products     | `modules/crm-products/`     | 产品管理 |
| crm-work-dailies | `modules/crm-work-dailies/` | CRM 日报 |

### E.3 项目管理模块

| 模块            | 路径                       | 说明     |
| --------------- | -------------------------- | -------- |
| projects        | `modules/projects/`        | 项目列表 |
| project-members | `modules/project-members/` | 项目成员 |
| work-items      | `modules/work-items/`      | 工作项   |
| effort-records  | `modules/effort-records/`  | 工时记录 |

### E.4 工作汇报模块（钉钉同步数据展示，只读）

| 模块                     | 路径                                | 说明     |
| ------------------------ | ----------------------------------- | -------- |
| dingtalk-logs            | `modules/dingtalk-logs/`            | 钉钉日志 |
| dingtalk-calendar-events | `modules/dingtalk-calendar-events/` | 日程事件 |
| employee-leaves          | `modules/employee-leaves/`          | 离职记录 |

### E.5 组织架构模块

| 模块        | 路径                   | 说明                     |
| ----------- | ---------------------- | ------------------------ |
| employees   | `modules/employees/`   | 员工管理（支持钉钉同步） |
| departments | `modules/departments/` | 部门管理（支持钉钉同步） |

---

## 附录 F：环境变量与部署配置

### F.1 开发环境（.env）

| 变量                     | 示例值                                                     | 说明                 |
| ------------------------ | ---------------------------------------------------------- | -------------------- |
| `NODE_ENV`               | `development`                                              | 环境标识             |
| `PORT`                   | `3000`                                                     | 服务端口             |
| `API_PREFIX`             | `api`                                                      | API 前缀             |
| `DATABASE_URL`           | `postgresql://postgres:postgres@localhost:55432/azeroth` | 数据库连接串         |
| `JWT_SECRET`             | `dev-jwt-secret`                                           | JWT 签名密钥         |
| `JWT_ACCESS_EXPIRES_IN`  | `2h`                                                       | Access Token 有效期  |
| `JWT_REFRESH_EXPIRES_IN` | `7d`                                                       | Refresh Token 有效期 |
| `BCRYPT_ROUNDS`          | `12`                                                       | 密码哈希轮数         |
| `UPLOAD_DIR`             | `uploads`                                                  | 上传文件存储目录     |
| `UPLOAD_BASE_URL`        | `http://localhost:3000/uploads`                            | 文件访问 URL 前缀    |
| `CORS_ORIGIN`            | `http://localhost:5173`                                    | CORS 允许源          |
| `THROTTLE_TTL`           | `60`                                                       | 速率限制窗口（秒）   |
| `THROTTLE_LIMIT`         | `100`                                                      | 窗口内最大请求数     |

### F.2 生产环境

本仓库不包含生产部署描述或托管密钥。安装者使用自己的密钥、域名与对象存储。参考 `docs/CONFIGURATION.md`。

### F.3 密钥

不要把数据库口令、对象存储密钥或第三方 token 写入 Git。通过安装者自己的密钥管理注入。

---

## 附录 G：路由-权限模块完整映射

| 路由路径                    | 页面组件                | 权限模块                | 说明     |
| --------------------------- | ----------------------- | ----------------------- | -------- |
| `/`                         | → redirect `/dashboard` | -                       |          |
| `/login`                    | LoginPage               | -                       | 无需认证 |
| `/dashboard`                | DashboardPage           | -                       |          |
| `/crm/customers`            | CustomersPage           | crm.customer            |          |
| `/crm/contacts`             | ContactsPage            | crm.contact             |          |
| `/crm/opportunities`        | OpportunitiesPage       | crm.opportunity         |          |
| `/crm/sale-orders`          | SaleOrdersPage          | crm.saleOrder           |          |
| `/crm/payments`             | PaymentsPage            | crm.payment             |          |
| `/crm/invoices`             | InvoicesPage            | crm.invoice             |          |
| `/crm/keep-records`         | KeepRecordsPage         | crm.keepRecord          |          |
| `/crm/visit-records`        | VisitRecordsPage        | crm.visitRecord         |          |
| `/crm/products`             | CrmProductsPage         | crm.crmProduct          |          |
| `/crm/work-dailies`         | CrmWorkDailiesPage      | crm.workDaily           |          |
| `/projects`                 | ProjectsPage            | project.project         |          |
| `/projects/work-items`      | WorkItemsPage           | project.workItem        |          |
| `/projects/effort-records`  | EffortRecordsPage       | project.effortRecord    |          |
| `/reports/dingtalk-logs`    | DingtalkLogsPage        | report.dingtalkLog      | 只读     |
| `/reports/calendar-events`  | CalendarEventsPage      | report.calendarEvent    | 只读     |
| `/reports/employee-leaves`  | EmployeeLeavesPage      | report.employeeLeave    | 只读     |
| `/organization/employees`   | EmployeesPage           | organization.employee   |          |
| `/organization/departments` | DepartmentsPage         | organization.department |          |
| `/approval/flows`           | ApprovalFlowsPage       | approval.flow           |          |
| `/approval/list`            | ApprovalsPage           | approval.instance       |          |
| `/system/users`             | UsersPage               | system.user             |          |
| `/system/roles`             | RolesPage               | system.role             |          |
| `/system/params`            | SystemParamsPage        | system.config           |          |
| `/system/logs`              | OperationLogsPage       | system.log              |          |
| `/profile`                  | ProfilePage             | -                       | 个人中心 |

---

## 文档维护

- **更新频率**：架构变更时更新
- **姊妹文档**：`DEVELOPMENT_GUIDE.md`（开发实操指南）
