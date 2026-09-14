# Azeroth 项目指南

## 项目概述

Azeroth（CRM + 项目管理 + 工作汇报）系统：

- 架构：pnpm monorepo + Turbo
- 前端：`apps/web`（React）
- 后端：`apps/server`（NestJS + Prisma）
- 共享包：`packages/shared`（types + schemas + constants）

本项目的核心目标是 **前后端类型、字段、校验规则严格一致**，并通过 shared 包实现 **Single Source of Truth**。

---

## 重要状态：旧 dingtalk-sync 包已删除

- 旧 `apps/dingtalk-sync/` 独立 FC 包已删除；当前不再部署、不再定时执行、不再作为数据同步链路。
- AI Coding Agent 不应基于历史文档推断系统仍在使用旧钉钉、YCCRM、云效同步任务。
- 当前业务逻辑应以 `apps/web`、`apps/server`、`packages/shared` 以及现行部署配置为准。

---

## 规则分级（必须按此理解）

### MUST（强制）

#### 1. 交流与工具边界

- 所有反馈都用中文。
- 未经用户允许，禁止执行 `git push`；如必须 `git push`，需先取消沙箱并明确告知风险。
- 涉及数据库结构或数据变更，必须遵循 Prisma 规范（详见第 9 章）；禁止手写 SQL、禁止 `db push`、禁止直接操作数据库。
- 多步骤大任务：
  - 支持子 agent 的环境（如 Claude Code）：交给 general-purpose 子 agent 执行，主 agent 只做 prompt 传递与严格复核。
  - 不支持子 agent 的环境（如 OpenAI Codex CLI）：可直接执行，但仍需分阶段验证与复核。

#### 2. Single Source of Truth（类型与校验来源唯一）

- shared（`packages/shared`）是唯一事实来源：
  - Types：`packages/shared/src/types/**`
  - Zod Schemas：`packages/shared/src/schemas/**`
  - Constants：`packages/shared/src/constants/**`
- 前端与后端严禁“重复定义同名同义字段/结构”；如必须引入 UI 额外字段，只能在 Profile 类型上做“前端扩展”。

#### 3. 前端类型强绑定（Web）

- 业务页面（尤其是 CRUD 页面）必须有独立的 `types.ts`，并遵循：
  - Profile 类型必须强绑定：`interface XxxProfile extends IXxxResponse { ... }`
  - 禁止弱绑定：`type XxxProfile = IXxxResponse`
- 前端类型来源唯一性：
  - 禁止在前端重复定义 `ICustomer/IEmployee/...`、`ICreateXxx/IUpdateXxx`、`IXxxResponse`、枚举常量、shared schema。
  - 禁止前端直接导入 `@prisma/client`（必须使用 `@ky-azeroth/shared/types`）。
- 每个业务页面的 `types.ts` 必须包含：
  - `toXxxProfile()`（API 响应 → 前端展示）
  - `toXxxFormData()`（展示/响应 → 表单）
  - 若页面可提交：`toXxxPayload()`（表单 → API payload，含必要转换）

#### 4. Zod 表单验证规范（Web + shared）

- 所有使用 `useCrud` 的页面必须传入 `schema` 参数，启用自动校验。
- 禁止手动 `if (!formData.xxx) { toast.error() }` 形式的验证；必须通过 Zod schema 声明式校验。
- 表单字段必须使用 `FormField`（`components/patterns/form-field.tsx`）并传入 `error={crud.getFieldError('fieldName')}`。`FormField` 通过 `FormModeProvider`（由 `FormDialog` 自动注入）感知 view/edit/create 模式，无需手动三元表达式切换。
- 优先使用 shared schema：从 `@ky-azeroth/shared/schemas` 导入并 `.extend()`；仅当 shared 中不存在时才允许页面本地定义 schema（且需写明原因：UI-only / 动态校验 / 兼容旧接口等）。

#### 5. 后端 DTO 与校验（Server）

> 说明：DTO 按用途分为 Create/Update/Response/Query 四类，规则不同，勿混淆。

- **Create/Update/Response DTO（强制使用 nestjs-zod）**：
  - 必须使用 `nestjs-zod`：`export class CreateXxxDto extends createZodDto(createXxxSchema) {}`
  - 必须从 `@ky-azeroth/shared/schemas` 导入 schema（Response Schema 必须补齐到 shared）
  - 禁止使用 `class-validator` 装饰器（`@IsString()` / `@IsOptional()` 等已废弃）
  - 禁止使用 `implements` 手动声明接口（nestjs-zod 自动推导类型）
- **Query DTO（强制使用 nestjs-zod）**：
  - 必须使用 `nestjs-zod`：`export class QueryXxxDto extends createZodDto(queryXxxSchema) {}`
  - 必须从 `@ky-azeroth/shared/schemas` 导入 schema
  - 禁止继续使用 `class-validator` 装饰器与导入
- **覆盖率要求（强制）**：
  - 任何包含分页/筛选/排序参数的列表接口必须使用 `@Query() QueryXxxDto`
  - 禁止在 controller 层手写 `@Query('page')` / `parseInt` 等参数解析与默认值（会绕开 shared schema）
  - 自动化检查：`pnpm run check:controller-query-dto`（扫描 controller 并阻断不合规）
- JSON 字段处理：
  - 写入 Prisma JSON 字段必须使用 `apps/server/src/common/utils/json-type-helpers.ts` 的封装函数
  - 禁止在业务代码中直接 `as unknown as Prisma.InputJsonValue`（封装内部如有 cast 属允许范围）

#### 6. Decimal 精度敏感字段（Web + shared + Server）

> 口径：`DecimalNumber` 在 TS 侧通常仍是 `number`（便于计算/表单），但 API/DB 侧往往是 Decimal。

- shared 类型中金额/数量等精度敏感字段必须使用 `DecimalNumber`，并添加 `@precision Decimal` 注释。
- 前端读取：必须 `Number(entity.xxx)`（避免字符串/Decimal-like 透传）。
- 前端提交：必须 `String(form.xxx)`（避免 JS 浮点精度丢失；禁止不转换直接传递）。

#### 7. 类型安全（any / ts-ignore）

- 严禁使用 `any`。
- 严禁使用 `@ts-ignore`。
- 如必须忽略类型错误，只允许 `@ts-expect-error`，并在同一行写明原因（例如：`// @ts-expect-error: library types are incorrect`）。

#### 8. 列表页面四层架构与组件目录规范（Web）

- 列表页面采用统一分层（L1 原子层 → L2 业务组件层 → L3 布局层 → L4 应用层）。
- 修改列表页面通用能力（行选择/批量操作/工具栏等）必须优先修改复用组件（`useCrud`、`CrudTable`、`StandardToolbar`），禁止在页面内重复造轮子。
- UI 组件目录规范：
  - `components/ui/`：L1 原子层，仅放置无业务逻辑的纯 UI 组件（来自 shadcn/ui）
  - `components/patterns/`：L2 业务组件层，放置业务语义可复用组件
  - `components/templates/`：L3 布局层，页面骨架组件
  - `components/mobile/`：跨模块复用的移动端组件（已登记的合法子目录）
  - `pages/*/components/`：仅页面特有组件；可复用必须上提到 `patterns/`
  - `components/` 顶层只允许 `ui`/`patterns`/`templates`/`mobile` 四个子目录（由 `check:ui-layering` 阻断越界）
- UI 组件来源规范：
  - 优先使用 shadcn/ui 原生组件；确需增强时，只能在 shadcn/ui 组件基础上做无业务语义的增强，禁止"从零造组件"。

#### 9. Prisma 数据库规范（Server）

> 核心原则：自动数据库变更必须通过 Prisma expand 迁移；旧代码退出后的 contract 收口只允许进入受控人工目录，二者都必须完整、可追溯、可回滚。

##### 9.1 Schema 变更流程（强制）

1. **修改 schema** → 编辑 `apps/server/prisma/schema.prisma`
2. **生成迁移** → `npx prisma migrate dev --name <描述性名称>`
3. **检查生成的 SQL** → 查看 `prisma/migrations/<timestamp>_<name>/migration.sql`
4. **自动发布只允许 expand 迁移** → 新增可空列/新表/普通索引；禁止同批删除或重命名表列、改列类型、收紧 NOT NULL/唯一/FK 等旧代码不兼容操作。`contract` 必须等旧代码完全退出后进入 `prisma/contract-migrations/` 独立人工批次，绝不进入 `migrate deploy` 或部署 workflow。CI 由 `pnpm check:expand-only-migrations` 与 `pnpm check:no-loose-sql` 强制校验。
5. **提交迁移文件** → 迁移文件必须纳入版本控制

##### 9.2 命令使用规范

| 命令                    | 用途         | 允许场景                  |
| ----------------------- | ------------ | ------------------------- |
| `prisma migrate dev`    | 开发环境迁移 | 本地开发时修改 schema 后  |
| `prisma migrate deploy` | 生产环境迁移 | CI/CD 部署时              |
| `prisma db seed`        | 填充种子数据 | 初始化或重置开发数据      |
| `prisma generate`       | 生成 Client  | schema 变更后、安装依赖后 |

##### 9.3 禁止操作（MUST NOT）

- **禁止** 使用 `prisma db push`（会跳过迁移历史）
- **禁止** 使用 `prisma db execute` 执行原生 SQL 文件
- **禁止** Agent、应用与自动化 workflow 使用 `psql`/`mysql` 等命令行工具直接操作数据库；唯一例外是获批人工操作员按受控 contract runbook 执行
- **禁止** 在 Service 中使用 `$executeRaw()` / `$queryRaw()`（除非有充分理由并注释说明）
- **禁止** 手写 SQL 文件进行数据迁移、回填或修脏数据（必须使用 seed 或 Prisma Client 脚本）
- **禁止** 散落 `.sql` 文件。允许范围仅为：`apps/server/prisma/migrations/<batch>/migration.sql`、下节定义的受控 contract 四件套、测试库初始化及 ALLOWLIST 中已执行的历史审计文件。不得为新数据迁移逐文件扩充 ALLOWLIST。对应门禁：`pnpm run check:no-loose-sql`
- **禁止** 在生产环境运行 `migrate dev`（只能用 `migrate deploy`）
- **禁止** 删除或修改已提交的迁移文件（会导致迁移状态不一致）

##### 9.3.1 Contract migration 受控人工目录（唯一例外）

- 路径必须严格为 `apps/server/prisma/contract-migrations/<14位时间>_<lower_snake_case_slug>/`
- 每批必须且只能包含 `README.md`、`audit.sql`、`migration.sql`、`verify.sql`、`rollback.sql`；禁止缺件、额外文件、嵌套目录、符号链接或异常命名
- 根目录 README 与批次中文 runbook 必须明确：不属于 Prisma migration、不进入 `migrate deploy`/CI/CD/应用启动 workflow、仅旧代码完全退出后由获批人工执行
- `audit.sql` 只读；`migration.sql` 必须 fail-closed 且不得修脏数据；`verify.sql` 必须校验完整对象定义和唯一批次 marker；`rollback.sql` 删除前必须校验同一 marker 与完整定义，不得仅按对象名称删除
- contract DDL 应优先保证单事务原子性。若普通非 `CONCURRENTLY` DDL 会阻塞读写，必须设置锁/语句超时并在 runbook 明确维护窗口与准确锁影响；不得为降低阻塞而静默拆成非原子步骤
- `pnpm check:no-loose-sql` 对目录结构与四件套 fail-closed 校验；contract 文件不得逐个加入历史 ALLOWLIST

##### 9.4 Seed 数据规范

- Seed 文件位置：`apps/server/prisma/seed.ts`，分模块脚本位于 `apps/server/prisma/seeds/`
- **必须** 使用 Prisma Client API（`prisma.xxx.create/upsert/findFirst`）
- **禁止** 在 seed 中使用 `$executeRaw` / `$executeRawUnsafe` / `$queryRaw` / `$queryRawUnsafe`，**无例外**。Seed 的所有操作都可以通过 Prisma Client API 实现，不存在需要原生 SQL 的合理场景
- Seed 应该是幂等的（多次运行结果一致）
- 对应自动化检查：`pnpm run check:seed-no-raw-sql`

##### 9.5 原生 SQL 的例外情况

仅在以下场景允许使用 `$queryRaw`（需注释说明原因）：

- 复杂聚合查询（Prisma 不支持的 SQL 特性）
- 性能关键路径的批量操作
- 数据库特定函数调用

```typescript
// 允许：性能关键的批量统计（Prisma 不支持窗口函数）
// @prisma-raw-sql: 使用窗口函数计算排名
const result = await prisma.$queryRaw`
  SELECT *, RANK() OVER (ORDER BY score DESC) as rank FROM scores
`;
```

##### 9.6 迁移冲突处理

- 多人协作时出现迁移冲突，**禁止** 手动合并 SQL
- 正确做法：
  1. `prisma migrate resolve` 标记冲突
  2. 重新基于最新 schema 生成迁移
  3. 测试迁移在干净数据库上可正常执行

##### 9.7 数据模型设计规范（强制）

1. **审计字段标准**：新增 model 必须包含以下 6 个审计字段（与现有模型保持一致）：
   - `createdAt DateTime @default(now())`
   - `updatedAt DateTime @updatedAt`
   - `deletedAt DateTime?`（软删除标记）
   - `createdBy String?`
   - `updatedBy String?`
   - `version Int @default(1)`（乐观锁）

2. **软删除策略**：
   - 所有业务实体使用软删除（`deletedAt`），Service 层的删除操作应设置 `deletedAt = now()` 而非调用 `prisma.xxx.delete()`
   - 软删除本质上是 `prisma.xxx.update()`，因此 Prisma 会自动更新 `@updatedAt` 修饰的 `updatedAt` 字段（这是预期行为，无需手动赋值）
   - 外键关联**不设置** `onDelete: Cascade`（防止级联物理删除）
   - 物理删除仅用于系统模型（如 `Session`）和纯中间表（如 `EmployeeDepartment`）

3. **外键索引策略**：所有外键字段必须添加 `@@index`（PostgreSQL 不会自动为外键创建索引）。示例：

   ```prisma
   model Contact {
     customerId String
     customer   Customer @relation(fields: [customerId], references: [id])
     @@index([customerId])
   }
   ```

4. **枚举策略**：使用 `String` + 常量替代 Prisma enum。在 `packages/shared/src/constants/status-values.ts` 中定义常量对象，Prisma schema 中使用 `String @db.VarChar(50)` 而非 `enum`。原因：Prisma enum 变更需要迁移，String + 常量更灵活。

#### 10. API 路由约定

采用**扁平路由风格**，不按模块分组命名空间：

- Controller 只需声明资源名：`@Controller('customers')`，**不要**在路径中写版本号
- `globalPrefix` 为 `api`，`defaultVersion` 为 `'1'`（见 `apps/server/src/main.ts`），NestJS 自动组合为 `/api/v1/` 前缀
- 最终路由自动生成为 `/api/v1/customers`

#### 11. 安全规范

##### 11.1 注入防护

- SQL 注入：已通过 Prisma ORM 和自动化检查脚本覆盖（见第 9 章），Service 层禁止拼接用户输入到 `$queryRaw` 模板字符串
- XSS：React 默认转义 JSX 输出；**禁止**使用 `dangerouslySetInnerHTML`，如确需使用必须经过 DOMPurify 等库消毒，并在 PR 中说明原因
- 命令注入：**禁止**将用户输入传入 `child_process.exec/spawn` 等系统调用

##### 11.2 认证与授权

- 所有 `/api/v1/*` 业务接口必须经过 JWT Guard 保护（`@UseGuards(JwtAuthGuard)`），公开接口必须显式标记 `@Public()`
- 敏感操作（删除、批量修改、角色变更）应校验操作者权限
- JWT Secret 禁止硬编码，必须通过环境变量注入

##### 11.3 敏感数据

- **禁止**在日志中输出密码、Token、API Key 等敏感信息
- 密码存储必须使用 bcrypt（已配置 `BCRYPT_ROUNDS=12`）
- API 响应中**禁止**返回密码哈希字段（Response DTO 中不包含 `password`/`passwordHash`）

##### 11.4 HTTP 安全头

- 后端已启用 Helmet（见 `main.ts`），**禁止**移除或降低 Helmet 默认配置
- CORS 配置必须限制 `origin`（通过 `CORS_ORIGIN` 环境变量），**禁止** `origin: '*'`（开发环境除外）

##### 11.5 依赖安全

- 定期执行 `pnpm audit`，Critical/High 级别漏洞必须在一周内修复或评估 workaround
- **禁止**引入已知存在安全漏洞且无修复版本的依赖

##### 11.6 环境变量与密钥

- 关键环境变量必须用 Zod 定义 schema 并经 `ConfigModule.forRoot({ validate })` 在启动期校验，校验失败立即 fail-fast（`DATABASE_URL` / `JWT_SECRET` / `JWT_REFRESH_SECRET` / `CORS_ORIGIN` / `BCRYPT_ROUNDS` 等）。
- 用于签名/校验/加密的密钥缺失必须抛错，**禁止** `A || B` 形式回落到其它密钥（access 与 refresh 必须使用相互独立的密钥）。
- 生产环境（`NODE_ENV=production`）须额外断言 `JWT_SECRET` 非默认占位值、`CORS_ORIGIN` 非 `*`。
- **禁止**在业务代码散落 `process.env.X || '默认值'` 读取关键安全配置。
- （现状：`ConfigModule` 暂未接 `validate`、`JWT_REFRESH_SECRET` 存在静默回落，本节列为待落地标准。）

#### 12. 错误处理与全局异常过滤器（Server）

- 必须实现并以 `APP_FILTER` 注册全局异常过滤器，统一错误响应结构（如 `{ statusCode, message, code, traceId, timestamp }`），对 Prisma 已知错误码（`P2002`/`P2025` 等）做统一映射。
- **禁止**把数据库原始错误信息、`error.stack`、绝对文件路径直接返回客户端；调试信息须以 `NODE_ENV !== 'production'` 为前置条件。
- Service 层抛语义化 `HttpException`，由全局过滤器统一序列化。
- （现状：`src` 下暂无 `*.filter.ts`，本条列为待落地标准；落地后补对应自动化检查。）

#### 13. API 响应与 HTTP 方法约定（Server）

- 列表分页必须返回 `PaginatedResponse<T>`（`items/total/page/pageSize/totalPages`），禁止自造分页字段。
- 删除/纯动作类接口统一返回 `{ success: boolean }`（或 `204 No Content`），**禁止** `{ ok }`/`{ message }`/`{ success: true }` 等异构形态；批量操作统一返回 `{ success: number; failed?: string[] }`。成功/删除返回结构应收敛到 shared 通用类型。
- 整资源更新（全量替换）统一使用 `@Put(':id')`（与前端 `useCrud` 默认 `api.put` 一致）；部分字段/状态切换才用 `@Patch`。同一资源的标准 update 端点不得在不同模块间 PUT/PATCH 混用。
- （现状：删除返回值与 PUT/PATCH 在部分模块尚未统一，列为收敛目标；落地后补对应自动化检查。）

---

### SHOULD（强烈建议）

- shared schema 的分页统一使用 `paginationSchema`（`page>=1`、`pageSize 1-100`、默认值由 schema 负责）。**选择器/下拉框场景**需一次性加载大量选项时，使用 `selectionPaginationSchema`（pageSize 上限 10000，默认 100，内置 keyword）。选择器 schema 应独立命名（如 `xxxSelectionQuerySchema`），与标准 `queryXxxSchema` 分开定义，不可混用。
- 前端页面若存在字段别名/兼容逻辑，应集中放在 `toXxxProfile/toXxxPayload` 中，避免在页面组件里散落映射。
- 建议关注 `pnpm run check:transform` 的转换完整性启发式扫描结果（当前已在 pre-commit 中执行并阻断；如遇误报需人工复核与修正规则/脚本）。
- 日志与可观测性：前端业务代码不应直接调用 `console.*`，应经 `src/lib/logger`（生产静默/上报）；后端不应使用 `console.log`，应使用 NestJS `Logger`（带上下文）。确需绕过须以 `// @log-ok: <原因>` 注释说明（如 `main.ts` 启动横幅）。日志中禁止输出密码/Token/手机号等敏感字段（呼应 11.3）。

---

### MAY（允许/例外，但必须可解释）

- 纯展示/路由/错误页（无 CRUD、无 shared Profile 概念）允许不提供 `types.ts`。
- 需要动态校验（依赖运行时数据，如库存上限）的场景允许页面本地 schema，但应 `.extend(sharedSchema)` 后再做 refine/superRefine。

---

## 新模块开发流程（强制顺序）

1. **先 shared**
   - 在 `packages/shared/src/types/<module>.ts` 定义：
     - `I{Module}`（实体）
     - `I{Module}Response`（API 响应）
     - `ICreate{Module}`（创建契约）
   - 在 `packages/shared/src/schemas/<module>.ts` 定义：
     - `create{Module}Schema`、`update{Module}Schema`、`query{Module}Schema`
   - 在 `packages/shared/src/types/index.ts` 与 `packages/shared/src/schemas/index.ts` 导出
2. **后端 DTO**
   - Query：必须 `createZodDto(queryXxxSchema)`（shared schema 唯一来源）
   - Create/Update：必须使用 `nestjs-zod`（与 MUST 第 5 条一致）：`export class CreateXxxDto extends createZodDto(createXxxSchema) {}`
3. **前端 types.ts**
   - Profile：`interface extends I{Module}Response`（强绑定）
   - Schema：优先 `createXxxSchema` 或 `.extend()`，禁止重新定义 shared 已有字段
   - 必须提供 `to{Module}Profile()` / `to{Module}FormData()`（以及必要的 `to{Module}Payload()`）
4. **null/undefined 约定**
   - `undefined`：字段未提供（创建时可省略）
   - `null`：明确清空（更新时重置）
   - shared schema 中可选字段建议 `.optional().nullable()` 同时支持两者

---

## 现有模块字段变更流程（强制顺序）

> 日常迭代中最高频的操作是为现有模块增删改字段，必须按以下链路逐层更新，不可跳过。

### 增加字段

1. **Prisma Schema** → 编辑 `apps/server/prisma/schema.prisma`，添加字段
2. **生成迁移** → `npx prisma migrate dev --name <描述性名称>`，检查生成的 SQL
3. **Shared Types** → 在 `packages/shared/src/types/<module>.ts` 的对应接口中添加字段
4. **Shared Schemas** → 在 `packages/shared/src/schemas/<module>.ts` 的对应 schema 中添加字段
5. **后端 Service** → 在 Service 层的 `create`/`update`/`findAll` 等方法中处理新字段（select/include）
6. **前端 types.ts** → 更新 Profile 类型、FormData 类型、`toXxxProfile()`/`toXxxFormData()`/`toXxxPayload()` 转换函数
7. **前端页面** → 在表单、表格列等位置渲染新字段
8. **验证** → `pnpm run check:all` + `pnpm typecheck`

### 删除字段

1. **前端页面** → 先移除对该字段的 UI 引用
2. **前端 types.ts** → 从 Profile/FormData/转换函数中移除
3. **Shared Types + Schemas** → 从接口和 schema 中移除
4. **后端 Service** → 从 select/include 和业务逻辑中移除
5. **Prisma Schema** → 删除字段，生成迁移
6. **验证** → `pnpm run check:all` + `pnpm typecheck`

### 修改字段（类型变更/重命名）

1. 按"删除旧字段 + 增加新字段"的流程处理，或：
2. 修改 Prisma Schema → 生成迁移 → 同步修改 Shared Types/Schemas → 后端 → 前端 → 验证
3. **重命名**时特别注意：搜索全仓库引用（`grep -r "oldFieldName"`），确保无遗漏

### 关键原则

- **顺序不可逆**：增加字段时从底层（数据库）往上层（UI）走；删除字段时从上层往底层走
- **每层都要更新**：跳过任何一层都会导致 `check:all` 或 `typecheck` 失败
- **先验证再提交**：完成变更后必须运行 `pnpm run check:all` 和 `pnpm typecheck`

---

## 提交前强制自检（严禁跳过）

> 不要依赖 Git Hooks 来发现错误；在准备提交前必须手动运行。

1. 依赖完整性
   - 新增的 import 必须在对应 `package.json` 的 dependencies/devDependencies 中声明
   - 若修改了 `package.json`，必须运行 `pnpm install` 并提交 `pnpm-lock.yaml`
2. 类型安全
   - 运行 `pnpm typecheck`（或 `tsc --noEmit`）确保无类型错误
3. 构建验证
   - 运行 `pnpm build` 确保构建通过（可发现缺依赖/缺导出等问题）
4. 接口一致性扫描
   - 若修改了 shared types / 页面 `types.ts` / DTO：必须搜索所有引用并逐一核对字段名与结构
   - 如果不执行导致流水线失败，视为任务未完成

---

## 自动化检查（命令 → 覆盖范围 → 预期阻断）

> 这些检查会在 pre-commit 中执行（见 `.husky/pre-commit`）。  
> 目标状态：以下“预期阻断”的检查一旦发现问题必须导致提交失败。若当前脚本实现未阻断，应视为脚本缺陷并尽快修复。

| 脚本                                    | 命令                                       | 覆盖范围                                                                                       | 预期阻断     |
| --------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------ |
| `check-shared-imports.js`               | `pnpm run check:shared`                    | 前端 types.ts 强绑定、转换函数存在性、shared 导入约束                                          | 是           |
| `check-dto-implements.js`               | `pnpm run check:dto`                       | 后端 DTO implements 与字段完整性                                                               | 是           |
| `check-query-dto.js`                    | `pnpm run check:query-dto`                 | Query DTO 必须为 `createZodDto(queryXxxSchema)` 且禁 class-validator                           | 是           |
| `check-decimal.js`                      | `pnpm run check:decimal`                   | Decimal 字段提交 `String()` / 读取 `Number()` 转换                                             | 是           |
| `check-decimal-precision.js`            | `pnpm run check:decimal-precision`         | shared 类型中 `DecimalNumber` 字段必须带 `@precision Decimal` 注释（keep-record 暂豁免）       | 是           |
| `check-no-any.js`                       | `pnpm run check:no-any`                    | 禁止 `any` 类型使用                                                                            | 是           |
| `check-no-double-assertion.js`          | `pnpm run check:no-double-assertion`       | 全部生产 workspace 禁止新增双重断言；既有债务按路径 + AST 节点精确 baseline，只降不升          | 是           |
| `check-optional.js`                     | `pnpm run check:optional`                  | shared schema vs interface 可选性一致性                                                        | 是           |
| `check-usecrud-schema.js`               | `pnpm run check:usecrud`                   | `useCrud` 必须传入 schema                                                                      | 是           |
| `check-transform-completeness.js`       | `pnpm run check:transform`                 | 转换函数字段映射完整性（启发式）                                                               | 是（启发式） |
| `check-controller-query-dto.js`         | `pnpm run check:controller-query-dto`      | Controller 必须整体接入 Query DTO，禁止手写参数解析                                            | 是           |
| `check-controller-body-dto.js`          | `pnpm run check:controller-body-dto`       | Controller `@Body` 参数必须使用 DTO 类型                                                       | 是           |
| `check-no-inline-dto-schema.js`         | `pnpm run check:no-inline-dto-schema`      | DTO 文件禁止 import zod 内联定义 schema（须来自 shared）                                       | 是           |
| `check-prisma-coverage.js`              | `pnpm run check:prisma-coverage`           | 每个 Prisma Model 必须有对应的 Shared Types 定义                                               | 是           |
| `check-controller-return-type.js`       | `pnpm run check:controller-return-type`    | Controller 方法必须有明确的返回类型                                                            | 是           |
| `check-json-helpers.js`                 | `pnpm run check:json-helpers`              | Prisma JSON 字段必须使用 json-type-helpers                                                     | 是           |
| `check-seed-no-raw-sql.js`              | `pnpm run check:seed-no-raw-sql`           | Seed 文件禁止使用原生 SQL（无例外）                                                            | 是           |
| `check-no-loose-sql.js`                 | `pnpm run check:no-loose-sql`              | 迁移目录外禁止出现未登记的 `.sql`（防手写 SQL 数据迁移）                                       | 是           |
| `check-expand-only-migrations.js`       | `pnpm run check:expand-only-migrations`    | 自动发布迁移只允许 expand 操作，阻断删除/改名/改类型/收紧约束等 contract 变更                  | 是           |
| `check-ts-expect-error.js`              | `pnpm run check:ts-expect-error`           | `@ts-expect-error` 必须附原因；禁用 `@ts-ignore`                                               | 是           |
| `check-query-schema-pagination.js`      | `pnpm run check:query-schema-pagination`   | Query Schema 必须基于 `paginationSchema` 或 `selectionPaginationSchema` 扩展                   | 是           |
| `check-manual-validation.js`            | `pnpm run check:manual-validation`         | 禁止手动 `if + toast.error` 表单验证模式                                                       | 是           |
| `check-ui-layering.js`                  | `pnpm run check:ui-layering`               | pages 组件禁跨页面引用、上提 patterns；components 顶层仅 ui/patterns/templates/mobile          | 是           |
| `check-no-prisma-client-in-web.js`      | `pnpm run check:no-prisma-web`             | 前端禁止直接导入 `@prisma/client`                                                              | 是           |
| `check-service-raw-sql-comment.js`      | `pnpm run check:service-raw-sql`           | Service 层原生 SQL 注释：安全变体需 `@prisma-raw-sql`，Unsafe 变体需 `@prisma-raw-sql-unsafe:` | 是           |
| `check-controller-route-naming.js`      | `pnpm run check:controller-route-naming`   | Controller 路由必须扁平 kebab-case，禁止版本号/api/命名空间前缀                                | 是           |
| `check-jwt-guard.js`                    | `pnpm run check:jwt-guard`                 | 全局 JWT Guard 启用校验（业务接口必须经 `JwtAuthGuard` 保护）                                  | 是           |
| `check-route-authorization-metadata.js` | `pnpm run check:route-authorization`       | 所有 Controller 路由必须显式声明业务权限、超管、公开或仅登录用户语义                           | 是           |
| `check-web-route-authorization.js`      | `pnpm run check:web-route-authorization`   | AST 校验 App 业务路由必须由 PermissionRoute/RoleRoute 保护，仅允许显式登记的自服务路由         | 是           |
| `check-helmet-enabled.js`               | `pnpm run check:helmet`                    | `main.ts` 必须导入并启用 Helmet 安全中间件                                                     | 是           |
| `check-response-no-sensitive-fields.js` | `pnpm run check:response-sensitive`        | Response 接口/Schema 禁止包含 password/secret/apiKey 等敏感字段                                | 是           |
| `check-no-production-console.js`        | `pnpm run check:no-production-console`     | 生产代码禁止 console 调试输出，精确豁免需写明理由                                              | 是           |
| `check-finance-import-batch-ssot.js`    | `pnpm run check:finance-import-batch-ssot` | 财务导入批次展示字段必须使用 shared 单源 helper                                                | 是           |
| `check-optimistic-lock.js`              | `pnpm run check:optimistic-lock`           | Service update 方法必须实现乐观锁（version where + P2025 catch + ConflictException）           | 是           |
| `check-no-business-cascade.js`          | `pnpm run check:no-business-cascade`       | 业务实体外键禁止 `onDelete: Cascade`（仅系统模型/中间表可级联）                                | 是           |
| `check-fk-index.js`                     | `pnpm run check:fk-index`                  | 外键字段（`@relation`）必须有 `@@index` 覆盖（9.7.3）                                          | 是           |
| `check-audit-fields.js`                 | `pnpm run check:audit-fields`              | 业务实体必须含 6 审计字段（接受双命名；跳过系统/中间/配置/同步源表）                           | 是           |
| `check-prisma-config.js`                | `pnpm run check:prisma-config`             | Prisma 包必须使用 prisma.config.ts，静态验证 schema/migrations/seed 路径                       | 是           |
| `check-production-env-mapping.js`       | `pnpm run check:production-env-mapping`    | 公开树禁止包含生产部署文件，且 env 示例必须声明 SUPER_ADMIN_EMPLOYEE_ID 保护锁                | 是           |
| `check-permission-menu-consistency.js`  | `pnpm run check:permission-menu`           | 后端 `@RequirePermission` 的 module/menu 必须登记到 shared `MODULES` 权限菜单树                | 是           |
| `check-cli-capabilities.js`             | `pnpm run check:cli-capabilities`          | CLI Agent capabilities 必须完整声明 operations/guards，并与 shared 权限矩阵一致                | 是           |
| `check-cli-doctor.js`                   | `pnpm run check:cli-doctor`                | 服务端非标路由必须有 CLI 覆盖，禁止 ghost extras 与权限装饰器缺口                              | 是           |
| `check-display-name.js`                 | `pnpm run check:display-name`              | CRM 核心业务实体显示名必须走 `getEntityDisplayName`，禁止散落编号兜底链                        | 是           |
| `check-meta-consistency.js`             | `pnpm run check:meta-consistency`          | README 技术栈版本及 rules.md / package.json / check:all 脚本集合一致性                         | 是           |
| （内置）                                | `prisma validate`                          | Prisma Schema 语法与引用完整性验证                                                             | 是           |

运行全部阻断检查：`pnpm run check:all`。实际脚本集合由 `check:meta-consistency` 从本表与 `package.json` 自动核对，不手写维护数量。

> **CI 强制性（重要）**：`pre-commit` 可被 `git commit --no-verify` 跳过。公开副本只保留不受 `paths` 过滤的 `.github/workflows/quality-gate.yml`（`check:all` + `typecheck` + `lint` + 全 workspace `test`/`build` + 空库 migrate/bootstrap）。不要加入生产部署 workflow。`.husky/pre-commit` 必须走同一组根脚本。`check:meta-consistency` 会动态发现 workspace 并阻断缺失/占位 task 或门禁调用漂移，`check:cli-doctor` 则阻断服务端路由与 Agent CLI 的覆盖漂移。

### 豁免注释规范

> 当检查脚本产生误报时，允许通过以下注释进行豁免。注释必须写在对应代码的**行尾**或**前一行**，并附带简短说明。

| 注释关键字                | 适用脚本                           | 使用场景                                                                                   | 示例                                                                  |
| ------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `@no-payload`             | `check-shared-imports.js`          | 只读展示页面无需 `toXxxPayload()`（如审批列表、钉钉日志、日程事件）                        | `// @no-payload: 只读页面，数据来自钉钉同步`                          |
| `@no-formdata-needed`     | `check-shared-imports.js`          | 只读展示页面无需 `toXxxFormData()`                                                         | `// @no-formdata-needed: 只读展示页面`                                |
| `@decimal-ignore`         | `check-decimal.js`                 | 字段名命中 Decimal 检测但实际类型为 `Int`/`number`（如 `score: Int`）                      | `score: item.score ?? 0, // @decimal-ignore: score 是 Int 非 Decimal` |
| `@no-pagination`          | `check-query-schema-pagination.js` | 查询 schema 不需要分页（如汇总查询、版本历史查询）                                         | `// @no-pagination: 汇总查询，返回聚合数据`                           |
| `@validation-ok`          | `check-manual-validation.js`       | `toast.error` 用于业务规则检查（如批量操作前选中项检查）而非表单字段验证                   | `// @validation-ok: 操作前置状态检查，非表单字段验证`                 |
| `@prisma-raw-sql-unsafe:` | `check-service-raw-sql-comment.js` | `$queryRawUnsafe`/`$executeRawUnsafe` 变体必须使用此注释说明原因（替代 `@prisma-raw-sql`） | `// @prisma-raw-sql-unsafe: 动态表名，Prisma Client 不支持`           |
| `@no-optimistic-lock`     | `check-optimistic-lock.js`         | Service 确实不需要乐观锁（如只读模块、纯系统内部更新）                                     | `// @no-optimistic-lock: 数据来自 FC 同步，无用户编辑场景`            |

---

## 术语表（口径统一，避免跑偏）

- **shared**：`packages/shared`，项目唯一事实来源（types + schemas + constants）。
- **Profile**：前端展示用类型，必须 `interface extends IXxxResponse`，可添加 UI 扩展字段。
- **FormData**：前端表单用数据结构，应与 shared 的 create/update schema 可选性一致。
- **Payload**：提交到 API 的请求体；必须在 `toXxxPayload()` 内完成字段别名映射与类型/精度转换（例如 Decimal `String()`）。
- **Create/Update/Response DTO**：用于 body 校验与 Swagger；必须使用 `nestjs-zod`（`createZodDto(schema)`），禁止 `implements` 手动声明接口。
- **Query DTO**：用于 query 校验；必须 `createZodDto(queryXxxSchema)` 且 controller 必须整体接入（禁止手写参数解析）。
- **DecimalNumber**：TS 侧数值类型别名，用于标记“精度敏感字段”；读取 `Number()`、提交 `String()`。
- **undefined vs null**：
  - `undefined` 表示“不提供该字段”
  - `null` 表示“明确清空”

---

## 历史模块：旧 dingtalk-sync

旧 `apps/dingtalk-sync/` 独立 FC 包已删除。历史文档中关于钉钉、YCCRM、云效同步的说明不代表当前系统运行状态。

### 历史 chargerId 映射规则

- YCCRM API 中的 `charger_id` 存储的是**钉钉 userId**（如 `dt-user-1001`）
- 历史同步时：`chargerId` 直接存 dingtalkUserId，`chargerName` 需通过 `employees.dingtalkUserId` 反查真实姓名

### CrmProduct 与产品明细行的关系

- OpportunityProduct 和 OrderProduct 是**快照模式**，只存 `productName`/`productNumber`，不建立 CrmProduct 外键

---

## 参考文档

- `docs/specs/ARCHITECTURE_REFERENCE.md`：架构参考手册
- `docs/specs/DEVELOPMENT_GUIDE.md`：开发指南（新建页面前必读）
- `docs/specs/ENGINEERING_PRACTICES.md`：工程实践（错误处理/性能/测试）
- `docs/INSTALLATION.md`：本地安装
- `docs/CONFIGURATION.md`：环境变量

---

## 数据库连接信息

- 数据库凭据只能从受控环境变量或 Secret 获取，禁止写入 Git、文档、命令历史和日志。
- 本地与 CI 统一使用 `DATABASE_URL`；E2E 自定义连接只能通过 `TEST_DATABASE_URL` 指向本机固定测试库。
