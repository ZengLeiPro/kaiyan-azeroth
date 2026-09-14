# Azeroth 前端开发指南

> **文档版本**: 2.0
> **更新日期**: 2026-02-11
> **定位**: 新建页面的「操作手册」，供实际开发时对照
> **姊妹文档**: `ARCHITECTURE_REFERENCE.md`（架构参考手册）

---

## 目录

0. [文档索引（长期规范 / 阶段性计划）](#0-文档索引长期规范--阶段性计划) - 快速定位
1. [新建页面检查清单](#1-新建页面检查清单) - **必读**
2. [代码模板](#2-代码模板) - 复制即用
3. [组件放置规则](#3-组件放置规则)
4. [前后端类型共享](#4-前后端类型共享)
5. [Zod 表单验证](#5-zod-表单验证)
   - [5.5 useCrud 后端 API 约定](#55-usecrud-后端-api-约定)
6. [后端 JSON 数据规范](#6-后端-json-数据规范)
7. [示范文件索引](#7-示范文件索引)
8. [高级表单处理（进阶）](#8-高级表单处理进阶)
   - [8.1 动态表单](#81-动态表单)
   - [8.2 联合验证](#82-联合验证)
   - [8.3 多步骤表单](#83-多步骤表单)
   - [8.4 复杂数组字段](#84-复杂数组字段)
   - [8.5 非 useCrud 表单范式](#85-非-useCrud-表单范式)

---

## 0. 文档索引（长期规范 / 阶段性计划）

> 目标：让 `docs/specs/` 保持“少而准”（长期有效规范），阶段性计划统一放到 `docs/stage/<迭代日期>/`。

### 0.1 长期规范（docs/specs，默认可信）

| 文档                                   | 状态           | 读者      | 用途                                      |
| -------------------------------------- | -------------- | --------- | ----------------------------------------- |
| `docs/specs/ARCHITECTURE_REFERENCE.md` | Active         | 全员      | 架构原则/分层/Single Source of Truth 口径 |
| `docs/specs/DEVELOPMENT_GUIDE.md`      | Active         | 前端/全员 | 新建页面/改页面的操作手册与强制规范入口   |
| `docs/specs/ENGINEERING_PRACTICES.md`  | Active         | 全员      | 工程实践（错误处理/性能/测试）统一口径    |
| （已合并至本指南 §8）                  | Active（可选） | 前端      | 复杂表单/动态校验/高级场景的补充范式      |

### 0.2 阶段性计划

| 文档                                   | 状态     | 用途                                              | 备注                         |
| -------------------------------------- | -------- | ------------------------------------------------- | ---------------------------- |
| `docs/AZEROTH_TRANSFORMATION_GUIDE.md` | Archived | 从 DX7H 烘焙 ERP 改造为Azeroth的完整实施手册 | Phase 0-6 全部已完成，已归档 |

### 0.3 维护规则（防止文档过时）

- **长期规范（specs）**：只写“最终应当如何做”，避免写阶段性步骤。
- **阶段性计划（stage）**：必须包含 `状态/适用范围/最后更新`（建议写在文档头部），并在每个里程碑结束后更新。
- **工程实践（错误处理/性能/测试）**：统一写入 `docs/specs/ENGINEERING_PRACTICES.md`，不再分散到多个 specs 文档。
- **迁移类计划完成后**：把计划移到 `docs/stage/<完成日期>/`（或后续新增 `docs/archive/`），并在 `DEVELOPMENT_GUIDE.md` 更新为最终口径。

## 1. 新建页面检查清单

新建或修改页面前，**必须**逐项检查以下内容：

### 1.1 类型定义检查

| #   | 检查项                                   | 必须 | 说明                                               |
| --- | ---------------------------------------- | ---- | -------------------------------------------------- |
| 1   | 页面有 `types.ts` 文件                   | Yes  | 放在 `pages/[module]/[page]/types.ts`              |
| 2   | Profile 类型继承 shared 接口（强绑定）   | Yes  | 仅允许 `interface XxxProfile extends IXxxResponse` |
| 3   | FormData 字段可选性与 shared schema 一致 | Yes  | 严禁前端 required 而 shared 为 optional            |
| 4   | 有 `toXxxProfile()` 转换函数             | Yes  | 处理字段别名（如 managerName←manager.name）        |
| 5   | 有 `toXxxFormData()` 转换函数            | Yes  | 用于 useCrud 的 entityToForm                       |
| 6   | 有 `toXxxPayload()` 转换函数             | Yes  | 用于 useCrud 的 formToPayload                      |

### 1.2 页面结构检查

| #   | 检查项                                           | 必须 | 说明                                |
| --- | ------------------------------------------------ | ---- | ----------------------------------- |
| 1   | 使用 `useCrud` Hook                              | Yes  | 不要自己写 CRUD 逻辑                |
| 2   | `useCrud` 传入 `schema` 参数                     | Yes  | 启用 Zod 自动验证                   |
| 3   | 使用 `StandardLayout` 布局                       | Yes  | 或其他 templates/ 布局              |
| 4   | 使用 `CrudTable` 表格                            | Yes  | 不要自己写表格                      |
| 5   | 使用 `FormDialog` 对话框                         | Yes  | 不要自己写对话框                    |
| 6   | 表单字段用 `CrudFormField` 包装                  | Yes  | 传入 `error={crud.getFieldError()}` |
| 7   | 无手动 `if (!formData.xxx)` 验证                 | Yes  | 用 Zod Schema 替代                  |
| 8   | 页面代码 < 150 行                                | 建议 | 过长应拆分组件                      |
| 9   | 使用 `displayData = crud.data.map(toXxxProfile)` | Yes  | 数据展示前转换                      |

### 1.3 组件放置检查

| #   | 检查项                               | 必须 | 说明                                     |
| --- | ------------------------------------ | ---- | ---------------------------------------- |
| 1   | 通用业务组件在 `patterns/`           | Yes  | 如 CustomerSelect、ApprovalDialog        |
| 2   | 页面特有组件在 `pages/*/components/` | Yes  | 如 MobileCard、Columns                   |
| 3   | 纯 UI 组件在 `ui/`                   | Yes  | 无业务逻辑                               |
| 4   | 布局组件在 `templates/`              | Yes  | 如 StandardLayout                        |
| 5   | 导航组件在 `patterns/`               | Yes  | Header、Sidebar（被 templates 布局引用） |
| 6   | 高级输入组件在 `ui/`                 | Yes  | FileUpload、AddressPicker（见 3.2 说明） |

---

## 2. 代码模板

### 2.1 types.ts 模板

```typescript
// apps/web/src/pages/[module]/[page]/types.ts

import type { IXxxResponse } from '@ky-azeroth/shared/types/xxx';
import type { CreateXxxInput } from '@ky-azeroth/shared/schemas/xxx';
import type { UploadedFile } from '@/components/ui/multi-file-upload';

// ============================================================
// 1. 展示类型：继承 shared 接口 + 添加 UI 别名
// ============================================================
//
// 必须使用 interface extends（强绑定），禁止 type alias（弱绑定）。
// 即使当前无 UI 扩展字段，也应使用空 interface extends 而非 type =，
// 原因：保持写法统一 + 便于未来扩展（加别名/展平关联字段）而无需改写声明方式。
//
// 示例 A：有 UI 扩展字段
export interface XxxProfile extends IXxxResponse {
  code?: string; // serialNumber 别名
  categoryName?: string; // 从关联对象展平
}
// 示例 B：暂无扩展字段（仍使用 interface extends）
// export interface XxxProfile extends IXxxResponse {}

// ============================================================
// 2. 表单类型：基于 shared schema 输入类型
// ============================================================
export type XxxFormData = Omit<CreateXxxInput, 'attachments'> & {
  attachments: UploadedFile[]; // 前端特有的文件类型
};

// ============================================================
// 3. 转换函数：后端响应 → 前端展示类型
// ============================================================
export function toXxxProfile(data: IXxxResponse): XxxProfile {
  return {
    ...data,
    code: data.serialNumber,
    categoryName: data.category?.name,
  };
}

// ============================================================
// 4. 转换函数：后端响应 → 表单数据
// ============================================================
export function toXxxFormData(data: IXxxResponse): XxxFormData {
  return {
    name: data.name,
    type: data.type || '',
    // ... 其他字段，注意处理 null/undefined
    attachments:
      data.attachments?.map((att) => ({
        id: att.id || '',
        name: att.name,
        url: att.url,
        size: att.size,
        type: att.type || '',
      })) || [],
  };
}

// ============================================================
// 5. 转换函数：表单数据 → API 请求格式
// ============================================================
export function toXxxPayload(form: XxxFormData) {
  return {
    name: form.name.trim(),
    type: form.type,
    // ... 其他字段
    attachments: form.attachments?.map((att) => ({
      id: att.id,
      name: att.name,
      url: att.url,
      size: att.size,
      type: att.type,
    })),
  };
}
```

### 2.2 Page.tsx 模板

```typescript
// apps/web/src/pages/[module]/[page]/XxxPage.tsx

import { useMemo } from 'react';
import { Package } from 'lucide-react';
import { z } from 'zod';

// L3 布局层
import { StandardLayout } from '@/components/templates/standard-layout';

// L2 业务组件层
import { StandardToolbar } from '@/components/patterns/standard-toolbar';
import { CrudTable } from '@/components/patterns/crud-table';
import { FormDialog } from '@/components/patterns/form-dialog';
import { DeleteConfirm } from '@/components/patterns/delete-confirm';

// Hooks
import { useCrud } from '@/hooks/use-crud';
import { useIsMobile } from '@/hooks/use-mobile';

// Shared 类型和 Schema
import { createXxxSchema } from '@ky-azeroth/shared/schemas/xxx';
import { XXX_STATUS } from '@ky-azeroth/shared/constants/status-values';

// 本地类型
import type { XxxProfile, XxxFormData } from './types';
import { toXxxFormData, toXxxProfile, toXxxPayload } from './types';

// 本地组件
import { XxxFormFields } from './components/XxxFormFields';
import { createXxxColumns } from './components/xxx-columns';

// ============================================================
// Schema：从 shared 导入并扩展（如有需要）
// ============================================================
const xxxFormSchema = createXxxSchema.extend({
  // 前端特有字段扩展
}) as z.ZodType<XxxFormData>;

// ============================================================
// 页面组件
// ============================================================
export function XxxPage() {
  const isMobile = useIsMobile();

  // useCrud：必须传入 schema
  const crud = useCrud<XxxProfile, XxxFormData>({
    endpoint: '/xxx',
    schema: xxxFormSchema,
    initialFormData: {
      name: '',
      type: XXX_STATUS.DEFAULT,
      // ... 初始值
    },
    entityToForm: toXxxFormData,
    formToPayload: (form) => toXxxPayload(form),
    formToUpdatePayload: (form) => ({
      ...toXxxPayload(form),
      // 更新时可能需要排除某些字段
    }),
    getEntityName: (entity) => entity.name,
  });

  // 表格列定义
  const columns = useMemo(() => createXxxColumns(), []);

  // 数据转换：将后端数据转换为前端展示格式
  const displayData = useMemo(() => {
    return crud.data.map(toXxxProfile);
  }, [crud.data]);

  return (
    <StandardLayout
      toolbar={
        <StandardToolbar
          title="XXX管理"
          description="管理XXX数据"
          search={{
            value: crud.keyword,
            onChange: crud.setKeyword,
            placeholder: '搜索编号或名称',
          }}
          onCreate={crud.openCreateDialog}
          createLabel="新建"
          onRefresh={crud.refresh}
          bulkSelection={{
            selectedCount: crud.selectedKeys.size,
            onClearSelection: crud.clearSelection,
            onBulkDelete: crud.openBulkDeleteDialog,
          }}
        />
      }
    >
      <CrudTable
        data={displayData}
        columns={columns}
        loading={crud.loading}
        pagination={crud.pagination}
        sorting={crud.sorting}
        onRowClick={crud.openEditDialog}
        rowSelection={crud.rowSelectionProps}
        emptyState={{
          icon: <Package className="mx-auto mb-2 h-8 w-8 opacity-50" />,
          title: '暂无数据',
          description: '没有找到任何记录',
        }}
      />

      <FormDialog
        {...crud.formDialogProps}
        title={crud.isEditing ? '编辑XXX' : '新建XXX'}
        onSubmit={crud.handleSubmit}
      >
        <XxxFormFields crud={crud} />
      </FormDialog>

      <DeleteConfirm {...crud.deleteConfirmProps} />
    </StandardLayout>
  );
}
```

### 2.3 FormFields.tsx 模板

```typescript
// apps/web/src/pages/[module]/[page]/components/XxxFormFields.tsx

import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { CrudFormField } from '@/components/patterns/crud-form-field';
import type { UseCrudReturn } from '@/hooks/use-crud';
import type { XxxProfile, XxxFormData } from '../types';

interface XxxFormFieldsProps {
  crud: UseCrudReturn<XxxProfile, XxxFormData>;
}

export function XxxFormFields({ crud }: XxxFormFieldsProps) {
  const { formData, updateFormField, getFieldError, isViewMode } = crud;

  return (
    <div className="space-y-4 py-4">
      {/* 必填字段示例 */}
      <CrudFormField
        name="name"
        label="名称"
        required
        error={getFieldError('name')}
      >
        {isViewMode ? (
          <div className="rounded-md bg-muted/50 px-3 py-2">{formData.name}</div>
        ) : (
          <Input
            value={formData.name}
            onChange={(e) => updateFormField('name', e.target.value)}
            placeholder="请输入名称"
          />
        )}
      </CrudFormField>

      {/* 下拉选择示例 */}
      <CrudFormField
        name="type"
        label="类型"
        error={getFieldError('type')}
      >
        {isViewMode ? (
          <div className="rounded-md bg-muted/50 px-3 py-2">{formData.type}</div>
        ) : (
          <Select
            value={formData.type}
            onChange={(value) => updateFormField('type', value)}
            options={typeOptions}
          />
        )}
      </CrudFormField>
    </div>
  );
}
```

### 2.4 columns.tsx 模板

```typescript
// apps/web/src/pages/[module]/[page]/components/xxx-columns.tsx

import { StatusBadge } from '@/components/patterns/status-badge';
import { xxxStatusMap } from '@/lib/status-maps';
import type { DataTableColumn } from '@/components/ui/data-table';
import type { XxxProfile } from '../types';

export function createXxxColumns(): DataTableColumn<XxxProfile>[] {
  return [
    {
      key: 'code',
      header: '编码',
      width: '100px',
      render: (item) => <span className="font-mono">{item.code}</span>,
    },
    {
      key: 'name',
      header: '名称',
      render: (item) => <span className="font-medium">{item.name}</span>,
    },
    {
      key: 'status',
      header: '状态',
      render: (item) => <StatusBadge status={item.status} statusMap={xxxStatusMap} />,
    },
  ];
}
```

---

## 3. 组件放置规则

### 3.1 判断决策树

```
组件是否是页面导航/布局的组成部分？
├── 是 → 组件是否被 templates/ 布局引用？
│        ├── 是 → components/patterns/（如 Header, Sidebar）
│        └── 否 → components/templates/（如 StandardLayout）
└── 否 → 组件是否有业务逻辑（API调用、状态管理）？
         ├── 否 → components/ui/（L1 原子层）
         └── 是 → 组件是否可被多个页面复用？
                  ├── 是 → components/patterns/（L2 业务组件层）
                  └── 否 → pages/*/components/（L4 应用层）
```

### 3.2 特殊组件说明

#### 导航组件（Header、Sidebar 等）

导航组件放在 `patterns/` 而非 `templates/` 中，原因：

- 导航组件有复杂的业务逻辑（路由、权限、状态管理）
- `templates/` 中的布局组件（如 MainLayout）通过导入引用它们
- 便于导航组件独立迭代，不影响布局结构

#### 高级输入组件（FileUpload、AddressPicker 等）

这些组件虽包含状态管理逻辑，但放在 `ui/` 中，原因：

- 它们是通用的输入控件，不绑定特定业务实体
- 遵循 shadcn/ui 的设计模式，作为原子输入组件
- 业务逻辑仅限于输入交互（上传、选择），不涉及 API 数据获取

### 3.3 目录结构速查

| 组件类型                 | 放置目录                | 示例                                     |
| ------------------------ | ----------------------- | ---------------------------------------- |
| 纯 UI 组件（无业务逻辑） | `components/ui/`        | Button, Input, Dialog                    |
| 高级输入组件             | `components/ui/`        | FileUpload, AddressPicker, CurrencyInput |
| 导航组件                 | `components/patterns/`  | Header, Sidebar, MobileHeader            |
| 业务选择器               | `components/patterns/`  | CustomerSelect, ProjectSelect            |
| 审批/确认对话框          | `components/patterns/`  | DeleteConfirm, BulkDeleteConfirm         |
| 移动端特殊组件           | `components/mobile/`    | ResponsiveDialog, MobilePageContainer    |
| 页面布局                 | `components/templates/` | StandardLayout, MainLayout               |
| 页面特有组件             | `pages/*/components/`   | XxxMobileCard, xxx-columns.tsx           |

---

## 4. 前后端类型共享

### 4.1 类型安全链路

```
┌────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Shared    │ →→→ │  Server DTO  │ →→→ │  API Response │ →→→ │  Frontend    │
│  Types +   │     │ (createZodDto)│     │              │     │  types.ts    │
│  Schemas   │     └──────────────┘     └──────────────┘     └──────────────┘
└────────────┘
```

### 4.2 类型命名规范

| 用途       | 命名规范               | 位置              | 说明                         |
| ---------- | ---------------------- | ----------------- | ---------------------------- |
| 基础实体   | `I[Entity]`            | shared/types/     | 数据库实体的基本结构         |
| 创建输入   | `ICreate[Entity]`      | shared/types/     | 创建 API 的输入参数          |
| 更新输入   | `IUpdate[Entity]`      | shared/types/     | 更新 API 的输入参数          |
| API 响应   | `I[Entity]Response`    | shared/types/     | API 返回（含关联对象时使用） |
| Zod Schema | `create[Entity]Schema` | shared/schemas/   | 验证规则                     |
| 前端展示   | `[Entity]Profile`      | pages/\*/types.ts | 含 UI 别名字段               |
| 前端表单   | `[Entity]FormData`     | pages/\*/types.ts | 表单字段定义                 |

> **Response 后缀说明**：当 API 返回值需要包含关联对象（如 `product.category`）时，定义 `I[Entity]Response extends I[Entity]`。若 API 返回值与基础实体相同，可直接使用 `I[Entity]`。

### 4.3 Query 参数统一验证（前后端一致）

列表页的 Query 参数（分页、排序、筛选）以 shared 的 `queryXxxSchema` 为唯一来源，后端会直接使用该 Schema 做验证（避免前后端重复定义）。

> **注意**：`paginationSchema.pageSize` 默认限制为 `1-100`，前端分页参数必须遵守该范围。

### 4.4 字段别名处理

后端字段与前端 UI 习惯可能不同，有两种实现方式：

#### 方式 A：在 types.ts 中定义别名字段（推荐）

```typescript
// pages/crm/customers/types.ts
export interface CustomerProfile extends ICustomerResponse {
  code?: string; // serialNumber 的别名
}

export function toCustomerProfile(data: ICustomerResponse): CustomerProfile {
  return {
    ...data,
    code: data.serialNumber,
  };
}
```

**优点**：类型安全，IDE 自动补全，别名在类型定义中清晰可见

#### 方式 B：在列定义中通过 accessor 实现

```typescript
// pages/crm/customers/components/customer-columns.tsx
{
  key: 'code',
  header: '编号',
  accessor: (item) => item.serialNumber,  // 直接访问原字段
}
```

**优点**：无需修改类型，表现层灵活

#### 常见别名映射

```typescript
serialNumber → code          // 编号
chargerName → ownerName      // 负责人
customer?.customerName → customerName  // 关联字段展平
```

---

## 5. Zod 表单验证

### 5.1 验证架构

```
用户输入 → Zod Schema 验证 → 验证通过 → API 调用
                ↓
           验证失败 → 显示错误信息（CrudFormField）
```

### 5.2 Schema 来源优先级

1. **优先**：从 `@ky-azeroth/shared/schemas` 导入并扩展
2. **其次**：在页面本地定义（仅当 shared 中不存在或需要特殊验证逻辑）

```typescript
// 推荐：从 shared 导入并扩展
import { createCustomerSchema } from '@ky-azeroth/shared/schemas/customer';

const customerFormSchema = createCustomerSchema.extend({
  // 前端特有字段扩展（如有）
});

// 允许的例外：shared 中不存在或需要前端特殊验证逻辑
const specialFormSchema = z.object({
  name: z.string().min(1, '请输入名称'),
  // 前端特有的验证逻辑...
});
```

> **何时允许本地完整定义 Schema**：
>
> - shared 中没有对应的 createXxxSchema
> - 前端需要特殊的验证逻辑（如联合字段验证、动态规则）
> - 前端表单结构与 API 输入差异较大

### 5.3 useCrud + Zod 集成

```typescript
const crud = useCrud<CustomerProfile, CustomerFormData>({
  endpoint: '/customers',
  schema: customerFormSchema, // ← 必须传入
  // ...
});

// 自动行为：
// 1. handleSubmit() 会在提交前自动验证
// 2. 验证失败时设置 errors 并显示 toast
// 3. getFieldError('fieldName') 返回该字段的错误信息
```

### 5.4 错误显示

```typescript
<CrudFormField
  name="name"
  label="名称"
  required
  error={crud.getFieldError('name')}  // ← 传入错误信息
>
  <Input ... />
</CrudFormField>
```

### 5.5 useCrud 后端 API 约定

`useCrud` Hook 内部自动管理 API 调用，后端 Controller 必须遵循以下路由与格式约定，否则 Hook 无法正常工作。

#### 路由约定

| 操作     | HTTP 方法 | 路由模式                          | 说明                       |
| -------- | --------- | --------------------------------- | -------------------------- |
| 列表查询 | GET       | `/api/v1/{resource}`              | 支持分页/排序/筛选参数     |
| 创建     | POST      | `/api/v1/{resource}`              | 请求体为 CreateDto         |
| 更新     | PUT       | `/api/v1/{resource}/{id}`         | 请求体为 UpdateDto         |
| 删除     | DELETE    | `/api/v1/{resource}/{id}`         |                            |
| 批量删除 | POST      | `/api/v1/{resource}/batch-delete` | 请求体 `{ ids: string[] }` |

> `{resource}` 对应 `useCrud` 的 `endpoint` 参数（如 `endpoint: '/customers'` 对应 `/api/v1/customers`）。路由前缀由 `globalPrefix` + `enableVersioning` 自动组合，Controller 只需声明资源名（参见 CLAUDE.md 第 10 章 API 路由约定）。

#### 列表接口返回格式（必须）

```typescript
{
  items: T[];      // 当前页数据
  total: number;   // 总记录数
  page: number;    // 当前页码
  pageSize: number; // 每页数据量
  totalPages: number; // 总页数
}
```

后端列表接口必须返回该扁平分页结构，`apps/server/src/common/interfaces/pagination.interface.ts` 中的 `PaginatedResponse<T>` 是统一类型约束；前端 `useServerPagination` 通过 `.items` 解析数据列表。如果后端返回格式不一致，列表将无法正常渲染。

#### 分页参数（由 paginationSchema 定义）

| 参数        | 类型   | 默认值      | 说明              |
| ----------- | ------ | ----------- | ----------------- |
| `page`      | number | `1`         | 页码（>=1）       |
| `pageSize`  | number | `20`        | 每页条数（1-100） |
| `sortField` | string | `createdAt` | 排序字段          |
| `sortOrder` | string | `desc`      | 排序方向          |
| `keyword`   | string | -           | 搜索关键词        |

> 这些参数由 shared 的 `paginationSchema` 统一定义，前后端共享同一份校验规则。后端 Query DTO 必须基于 `paginationSchema` 扩展（参见 4.3 节）。

#### 选择器分页（由 selectionPaginationSchema 定义）

当下拉选择器、弹窗选人等场景需要一次性加载大量选项时，应使用 `selectionPaginationSchema` 替代标准 `paginationSchema`：

| 参数       | 类型   | 默认值 | 说明                             |
| ---------- | ------ | ------ | -------------------------------- |
| `page`     | number | `1`    | 页码（>=1）                      |
| `pageSize` | number | `100`  | 每页条数（1-**10000**）          |
| `keyword`  | string | -      | 搜索关键词（内置，无需额外定义） |

> **与标准 `paginationSchema` 的区别**：pageSize 上限从 100 放宽到 10000，默认值从 20 调整为 100，且内置 `keyword` 字段。选择器 Query Schema 应独立命名（如 `xxxSelectionQuerySchema`），与标准 `queryXxxSchema` 分开定义，不可混用。

---

## 6. 后端 JSON 数据规范

对于存储在 Prisma JSON 字段中的复杂数据（如 `attachments` 或 `scoreDetails`），必须遵守以下规范。

### 6.1 禁止直接断言

禁止在 Service 层直接使用 `as unknown as Prisma.InputJsonValue`。

### 6.2 使用 JsonTypeHelper 工具函数

必须使用 `apps/server/src/common/utils/json-type-helpers.ts` 中提供的转换函数。

#### 示例：处理附件 (Attachments)

```typescript
import { toJsonAttachments, fromJsonAttachments } from '@/common/utils/json-type-helpers';

// 写入数据库
await this.prisma.product.create({
  data: {
    ...dto,
    attachments: toJsonAttachments(dto.attachments),
  },
});

// 从数据库读取并返回给前端
const product = await this.prisma.product.findUnique({ where: { id } });
return {
  ...product,
  attachments: fromJsonAttachments(product.attachments),
};
```

#### 示例：处理通用 JSON 对象

```typescript
import { toJsonValue } from '@/common/utils/json-type-helpers';

await this.prisma.config.update({
  where: { key },
  data: {
    value: toJsonValue(configObject),
  },
});
```

### 6.3 转换逻辑位置

转换逻辑应尽量在 Service 层处理，确保返回给 Controller 的 DTO 已经是完全类型化的对象。

---

## 7. 示范文件索引

> 以下文件路径相对于 `apps/web/src/`

### 7.1 最佳实践参考

| 文件                                      | 说明           | 特点                                 |
| ----------------------------------------- | -------------- | ------------------------------------ |
| `pages/crm/customers/CustomersPage.tsx`   | 完整 CRUD 示范 | Zod 验证、组件拆分、转换函数         |
| `pages/crm/customers/types.ts`            | 类型定义示范   | Profile + FormData + 转换函数        |
| `pages/crm/opportunities/types.ts`        | 转换函数示范   | Decimal 字段转换、关联字段处理       |
| `pages/projects/work-items/types.ts`      | 完整 CRUD 类型 | Profile + FormData + Payload 转换    |
| `pages/crm/customers/CustomersPage.tsx`   | 列定义示范     | 列定义内嵌、StatusBadge + 自定义渲染 |
| `pages/reports/dingtalk-logs/types.ts`    | 只读页面示范   | @no-payload + @no-formdata-needed    |
| `components/patterns/crud-form-field.tsx` | 表单字段组件   | 错误显示                             |

### 7.2 核心 Hooks

| Hook                       | 用途                 |
| -------------------------- | -------------------- |
| `use-crud.ts`              | CRUD 操作 + Zod 验证 |
| `use-server-pagination.ts` | 服务端分页           |
| `use-approval-flow.ts`     | 审批流程             |
| `use-import-export.ts`     | 导入导出             |

### 7.3 核心组件

| 组件                | 层级 | 用途             |
| ------------------- | ---- | ---------------- |
| `StandardLayout`    | L3   | 标准页面布局     |
| `MainLayout`        | L3   | 主布局（含导航） |
| `MobileLayout`      | L3   | 移动端布局       |
| `Header`            | L2   | 顶部导航栏       |
| `Sidebar`           | L2   | 侧边栏导航       |
| `StandardToolbar`   | L2   | 工具栏           |
| `CrudTable`         | L2   | CRUD 表格        |
| `FormDialog`        | L2   | 表单对话框       |
| `CrudFormField`     | L2   | 表单字段包装     |
| `CustomerSelect`    | L2   | 客户选择器       |
| `ProjectSelect`     | L2   | 项目选择器       |
| `DeleteConfirm`     | L2   | 删除确认         |
| `BulkDeleteConfirm` | L2   | 批量删除确认     |

---

## 8. 高级表单处理（进阶）

> 本章节整合自原 `docs/specs/ADVANCED_FORMS.md`（已归档），用于补齐复杂表单场景的统一做法。

### 8.1 动态表单（Dynamic Forms）

**典型场景**：

- 根据用户选择动态显示/隐藏字段
- 根据选项动态改变其他字段的校验规则

**推荐模式**：

- UI 展示层：优先直接在 render 中判断是否显示（最直观）
- 数据一致性：必要时在 `useEffect` 中联动清空不再适用的字段

```tsx
// 示例：根据类型显示不同字段
const { formData, updateFormField } = crud;

// 方式 A: 直接在 render 中判断 (推荐)
{
  formData.type === 'SPECIAL' && <CrudFormField /* ... */ />;
}

// 方式 B: useEffect 联动清空（当字段不再适用时，避免脏数据提交）
useEffect(() => {
  if (formData.type !== 'SPECIAL') {
    updateFormField('specialField', '');
  }
}, [formData.type, updateFormField]);
```

### 8.2 联合验证（Cross-Field Validation）

**典型场景**：

- 结束时间必须晚于开始时间
- 密码与确认密码必须一致

**规范**：

- 业务规则（前后端一致）：优先放在 shared schema（`packages/shared/src/schemas/**`）中用 `superRefine` 表达
- UI-only / 动态校验：允许页面本地 schema，但应 `.extend(sharedSchema)` 后再做 `refine/superRefine`

```typescript
import { z } from 'zod';

export const createEventSchema = z
  .object({
    startTime: z.string(),
    endTime: z.string(),
  })
  .superRefine((data, ctx) => {
    if (new Date(data.endTime) <= new Date(data.startTime)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '结束时间必须晚于开始时间',
        path: ['endTime'],
      });
    }
  });
```

### 8.3 多步骤表单（Wizard）

**建议**：不要在 `FormDialog` 中塞入过复杂的多步骤流程。

推荐方案：

1. 使用独立路由页（例如 `pages/xxx/create`）承载创建流程
2. 用 `tabs/stepper` 管理 UI 状态
3. 状态暂存可使用 `zustand`（或现有项目统一方案），最后统一组装 payload 提交

### 8.4 复杂数组字段（Field Arrays）

**典型场景**：订单产品明细、商机产品明细等主子表结构。

**建议实现**：

- 用标准表格/列表组件渲染行
- 行内 `Input` 通过 `onChange` 更新局部 state
- 在 `toXxxPayload()` / `formToPayload` 中统一组装提交结构（避免在 UI 组件散落字段映射）

```tsx
// 示例：更新 items 某一行字段
const handleUpdateItem = (index: number, value: number) => {
  const newItems = [...crud.formData.items];
  newItems[index].qty = value;
  crud.updateFormField('items', newItems);
};
```

### 8.5 非 useCrud 表单范式

**允许场景**（不使用 `useCrud`）：

- 多步骤向导（Wizard），如跨模块的复杂创建流程
- 独立审批/确认面板（非列表页内的弹窗）
- 特殊业务流（与主 CRUD 入口解耦的独立操作）

**强制规范**：

1. **Schema 来源**：必须从 shared schema `.extend()`，禁止完全本地定义
2. **验证方式**：必须使用 Zod schema 声明式验证（禁止手写 `if (!field) toast.error()`）
3. **错误展示**：使用统一的错误展示机制（如 `zodError.errors[0].message`）

```typescript
// 推荐：使用 Zod + safeParse
import { createSaleOrderSchema } from '@ky-azeroth/shared/schemas/sale-order';

const formSchema = createSaleOrderSchema.extend({
  // 前端特有字段扩展
});

function useSaleOrderForm() {
  const parse = formSchema.safeParse(formData);

  if (!parse.success) {
    // 统一错误展示
    toast.error(parse.error.errors[0].message);
    return;
  }

  // 提交逻辑...
}
```

**例外规则**（可使用 `toast.error`）：

- 业务规则提示（非必填校验），如"请先选择客户"
- 后置校验（需调用 API 后才能确定的规则）
- 用户确认类提示，如"确定要删除吗？"

**错误示范**：

```typescript
// 错误：禁止手写必填校验
if (!formData.productId) {
  toast.error('请选择产品');
  return;
}

// 错误：禁止手写数字范围校验
if (formData.quantity <= 0) {
  toast.error('数量必须大于 0');
  return;
}
```

**正确做法**：

```typescript
// 正确：在 Zod schema 中声明
const formSchema = z.object({
  productId: z.string().min(1, '请选择产品'),
  quantity: z.number().positive('数量必须大于 0'),
});

// 正确：业务规则提示使用 confirm/toast（@validation-ok: 操作前置状态检查）
if (selectedKeys.size === 0) {
  toast.warning('请先选择要操作的记录');
}
```

---

## 文档维护

- **更新频率**：开发规范变更时更新
- **姊妹文档**：`ARCHITECTURE_REFERENCE.md`（架构参考手册）

| 版本 | 日期       | 更新内容                                                      |
| ---- | ---------- | ------------------------------------------------------------- |
| 2.0  | 2026-02-11 | 适配Azeroth新业务（CRM/项目管理/工作汇报），更新所有示例 |
| 1.3  | 2026-01-31 | 合并工程实践文档，更新索引与阶段性文档状态                    |
| 1.2  | 2026-01-27 | 新增 8.5 非 useCrud 表单范式                                  |
| 1.1  | 2026-01-27 | 合并 ADVANCED_FORMS.md 内容，新增第 8 章                      |
| 1.0  | 2026-01-23 | 从 ARCHITECTURE_ANALYSIS_AND_FIXES.md 精简而成                |
