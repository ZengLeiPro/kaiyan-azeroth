# 业务实体「显示名」统一规约

> 状态：已落地（CRM 四模块全覆盖：opportunity / sale-order / payment / invoice）
> 设计文档：`assets/20260614/ky-azeroth业务实体显示名统一规约.md`（在 workspace 仓库）
> CI 守门：`pnpm run check:display-name`（已串入 `check:all` / husky pre-commit / quality-gate.yml）

## 为什么有这套规约

以前 CRM 模块的实体「显示名」散落在各页面 inline lambda 里，导致：

1. **跨模块引用看不清是谁**——回款列表里「关联合同」列只显示订单 `serialNumber`，订单的 `orderTitle` 被丢弃；订单详情下的「回款 Tab」列定义只有金额/日期/编号，没有业务摘要，**同一订单下若有多笔同额回款（分期付款）肉眼无法区分**。
2. **字段名误导**——`Invoice.title` 实际是「发票抬头」（客户公司名），不是发票主题；新人看 schema 容易误用。
3. **散落兜底链**——`xxxTitle || serialNumber` 这种模式在 server/web/cli 散落 15+ 处，没有单一来源，每个调用方各自心理建模。
4. **DB 缺字段**——回款/开票从 schema 到 UI 都不存在「业务摘要」概念，新加业务场景（首期款/质保金返还等）只能塞 remark。

## 核心抽象

`packages/shared/src/utils/entity-display-name.ts` 提供唯一函数：

```ts
getEntityDisplayName(
  type: EntityType,           // 'opportunity' | 'sale-order' | 'payment' | 'invoice'
  entity: EntityDisplayShapeMap[type] | null | undefined,
  variant?: DisplayVariant    // 'short' | 'long' | 'withContext'，默认 'short'
): string
```

### 三种 variant 的使用场景

| variant       | 用途                                           | 长度    | 典型出处                                   |
| ------------- | ---------------------------------------------- | ------- | ------------------------------------------ |
| `short`       | 列表加粗主列、移动卡 title、删除确认           | ≤ 30 字 | `getEntityName: (e) => …`                  |
| `long`        | 抽屉面包屑、Tab 标题、消息推送                 | ≤ 60 字 | `entityNameOf: (e) => …`（默认实现就是它） |
| `withContext` | 跨模块引用列（订单详情看回款、回款表单选订单） | ≤ 80 字 | 列表「关联合同」「关联商机」列             |

### 各实体派生规则

| 实体            | short                                     | long                                                      | withContext                         |
| --------------- | ----------------------------------------- | --------------------------------------------------------- | ----------------------------------- |
| `opportunity`   | `opportunityName`                         | `opportunityName（serialNumber）`                         | `opportunityName`（引用方关心名字） |
| `sale-order`    | `orderTitle`                              | `orderTitle（serialNumber）`                              | `orderTitle（serialNumber）`        |
| `payment` (IN)  | `subject·¥金额`                           | `subject·¥金额·业务日期（serialNumber）`                  | `subject·¥金额·业务日期`            |
| `payment` (OUT) | `(subject ?? refundType ?? "退款")·¥金额` | 同左 + 业务日期 + 编号                                    | 同左 + 业务日期                     |
| `invoice`       | `subject·¥金额`                           | `subject·¥金额·开票日期（invoiceNumber 或 serialNumber）` | `subject·¥金额·开票日期`            |

## 必填硬规则（CI 守门会查）

### 1. 禁止 `|| serialNumber` 兜底链

```tsx
// ❌ 禁止
{ render: (item) => item.saleOrder?.serialNumber ?? '-' }
title={item.orderTitle || item.serialNumber}

// ✅ 必须
{ render: (item) => getEntityDisplayName('sale-order', item.saleOrder, 'withContext') }
title={getEntityDisplayName('sale-order', item, 'short')}
```

### 2. 禁止 inline lambda 传 `getEntityName` / `entityNameOf`

```tsx
// ❌ 禁止
useCrud({ getEntityName: (e) => e.opportunityName, ... })
useDrawerEntityDetail({ entityNameOf: (e) => e.orderTitle || e.serialNumber, ... })

// ✅ 必须
useCrud({
  getEntityName: (e) => getEntityDisplayName('opportunity', e, 'short'),
  ...
})

// ✅ useDrawerEntityDetail 直接省略 entityNameOf，默认值已走统一函数
useDrawerEntityDetail({ /* 不传 entityNameOf */ ... })
```

### 3. 新建业务实体时

如果新加一个业务实体（如 `customer` / `contact` / `keep-record` 等）并且需要跨模块引用：

1. 在 `packages/shared/src/utils/entity-display-name.ts` 加 `EntityType` union 项 + 派生函数 + shape interface
2. 写单测覆盖 short / long / withContext
3. 在 `apps/cli/src/registry.ts` 的 `DISPLAY_NAME_OVERRIDES` 中映射 `commandName → entityType`
4. 在 `scripts/check-display-name.js` 的 `SCOPE_PATHS` 加上该实体的相关路径
5. 把该实体散落的 inline lambda 替换为统一函数调用

## subject 字段规约（payment / invoice 专属）

`payment.subject` 和 `invoice.subject` 都是 **`@db.VarChar(100) NOT NULL`** 字段（P2 阶段落库），作为统一显示名的派生主源：

- **必填**：所有新建/编辑表单必须让用户填或选预设值
- **预设值**：`PAYMENT_SUBJECT_IN_PRESETS` / `PAYMENT_SUBJECT_OUT_PRESETS` / `INVOICE_SUBJECT_PRESETS`（在 `packages/shared/src/constants/subject-presets.ts`）
- **UI 模式**：`<Input list="...-presets">` + `<datalist>` 组合，既能下拉选预设也能自由输入
- **OUT 方向特殊**：refund 表单 subject 可选；后端 service 层若发现 subject 为空，用 `refundType` 兜底（保持与 P0 阶段 `getEntityDisplayName` 退化逻辑一致）

### 历史数据回填策略

两步 migration，详见 `apps/server/prisma/migrations/20260615010000_add_payment_invoice_subject` 和 `20260615010100_enforce_payment_invoice_subject_not_null`：

1. **A 步**：`ADD COLUMN subject VARCHAR(100) NOT NULL DEFAULT '回款'/'开票'`，并 `UPDATE WHERE direction='OUT'` 把 payment subject 改成 '退款'
2. **B 步**：`ALTER COLUMN ... DROP DEFAULT` 强制新数据必须显式提供

## 命名一致性

`EntityType` 用 **kebab-case**（`'sale-order'`），与以下保持一致：

- `apps/web/src/components/patterns/drawer-stack/context.tsx` 的 `DrawerEntityType`
- Prisma `@@map` 表名（`sale_orders` 复数 snake_case）的单数形式
- URL slug 风格
- CLI commandName 复数形式 `'sale-orders'`

不要用 `'saleOrder'` camelCase（历史命名，已弃用）。

## Invoice.title 字段澄清

⚠️ **重要历史包袱**：`Invoice.title` 字段名在 schema 里看起来像"标题/主题"，**实际含义是"发票抬头"（客户公司名）**。

- DB 字段名保留 `title`（不重命名，避免 schema 迁移风险）
- 所有 UI label 必须显示「**发票抬头**」消除歧义
- 真正的"开票业务主题"是 `Invoice.subject`（P2 新增）

## 边界情况（允许保留兜底，已在脚本 ALLOWLIST）

以下文件允许保留 fallback / 默认 lambda：

1. `packages/shared/src/utils/entity-display-name.ts` —— 统一函数本体，fallback 逻辑由其负责
2. `packages/shared/src/utils/__tests__/entity-display-name.spec.ts` —— 单测 fixture 必然涉及多种 fallback 组合
3. `apps/web/src/hooks/use-crud.ts` —— useCrud 默认实现不知道 entityType，保留 `e.name || e.id` 兜底；调用方仍应显式传 `getEntityName`
4. `apps/web/src/hooks/use-drawer-entity-detail.ts` —— 内部 `defaultEntityNameOf`：未覆盖类型（customer/contact/keep-record/visit-record 等）走 `e.name || e.title || e.id`

## 渐进式守门 SCOPE

CI 脚本 `scripts/check-display-name.js` **只对已纳入规约的路径硬守门**（`SCOPE_PATHS`），其余路径暂时不检查。

当前 SCOPE：

```
apps/web/src/pages/crm/{opportunities,sale-orders,payments,invoices}/
apps/web/src/components/patterns/sale-order-select.tsx
apps/web/src/pages/crm/customers/components/CustomerDrawerBody.tsx
packages/shared/src/schemas/{payment,invoice,sale-order,opportunity}.ts
apps/cli/src/registry.ts
```

**待办**（统一规约扩展时同步更新 SCOPE_PATHS）：

- [ ] `apps/server/src/modules/{sale-orders,invoices,payments}/` —— server service 层 `?? serialNumber` 替换为 `getEntityDisplayName`（P2 收尾阶段，待 lead stage commit 后做）
- [ ] 扩展 customer / contact / keep-record / visit-record / project / contract 等实体到统一规约
- [ ] mobile 端（若未来重启）按本规约落地

## 参考代码

- 函数实现：`packages/shared/src/utils/entity-display-name.ts`
- 单测：`packages/shared/src/utils/__tests__/entity-display-name.spec.ts`
- 预设值：`packages/shared/src/constants/subject-presets.ts`
- CLI 注入：`apps/cli/src/registry.ts`（`DISPLAY_NAME_OVERRIDES`）/ `apps/cli/src/utils.ts`（`printTable` 的 `_display` 列）
- hook 默认值：`apps/web/src/hooks/use-drawer-entity-detail.ts`（`defaultEntityNameOf`）
- CI 守门：`scripts/check-display-name.js`
