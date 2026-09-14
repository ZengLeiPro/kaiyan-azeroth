# Azeroth 工程实践（错误处理 / 性能 / 测试）

> **文档版本**: 1.0  
> **更新日期**: 2026-01-31  
> **定位**: `docs/specs/` 下关于工程实践的唯一长期规范（删繁就简、以仓库现状为准）  
> **范围**: Web + Server + CI

---

## 0. 规范原则（长期有效）

- 本文只写“最终应当如何做”，不保留大段示例/操作步骤（避免快速过时）。
- 任何口径冲突时，以以下文件为准（Single Source of Truth）：
  - 提交前阻断：`.husky/pre-commit`
  - 自动化检查脚本：`scripts/`
  - CI：`.github/workflows/quality-gate.yml`
  - 前端请求层：`apps/web/src/lib/api.ts`
  - 后端启动与全局管道：`apps/server/src/main.ts`、`apps/server/src/app.module.ts`

---

## 1. 错误处理

### 1.1 前端（Web）

- 所有 HTTP / 鉴权 / 限流 / 网络降级逻辑，统一收敛在 `apps/web/src/lib/api.ts`（避免各页面重复处理）。
- 表单校验只允许走 **Zod + `useCrud({ schema })`**：
  - 页面必须传 `schema`（由 `scripts/check-usecrud-schema.js` 检查并阻断）。
  - 字段错误必须通过 `CrudFormField` + `crud.getFieldError('field')` 展示（禁止手写必填校验 toast）。
- UI 级“全局错误状态”走统一组件/状态：
  - 网络异常提示：`apps/web/src/components/patterns/network-error.tsx`
  - 429 限流提示：`apps/web/src/components/patterns/rate-limit-toast.tsx`
- 后端错误信息必须优先提供 `message` 字段（前端 `getErrorMessage()` 会优先读取 `response.data.message`）。

### 1.2 后端（Server）

- DTO 校验统一使用 `nestjs-zod`，并且 schema 来自 `@ky-azeroth/shared/schemas`（由 `scripts/check-query-dto.js` 等检查保证）。
- 全局校验链路（兼容双栈）：
  - Zod 校验（主力）：`apps/server/src/app.module.ts`（`APP_PIPE: ZodValidationPipe`）
  - class-validator 兼容校验（**已废弃，仅保留向后兼容**）：`apps/server/src/main.ts`（`ClassValidatorValidationPipe` 会跳过 ZodDto）。新 DTO 必须使用 `nestjs-zod`，禁止新增 `class-validator` 装饰器。
- 限流（429）由 Throttler 负责：`apps/server/src/app.module.ts`。
- 错误响应口径：优先使用 Nest 标准异常（`HttpException` / `BadRequestException` / `NotFoundException` 等），并确保返回体包含可读的 `message`（与前端一致）。

### 1.3 错误响应格式（Server）

所有 API 错误响应必须遵循统一格式：

```json
{
  "statusCode": 400,
  "message": "用户可读的错误描述",
  "error": "Bad Request"
}
```

- `message` 必须是中文、用户可读的描述（前端直接展示给用户）
- NestJS 标准异常已自动满足此格式，**禁止**自定义错误响应结构

#### Zod 验证失败的错误响应

当请求 Body/Query 未通过 `nestjs-zod`（`ZodValidationPipe`）校验时，返回 `400` 且 `message` 为包含逐字段错误的数组：

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [
    {
      "code": "too_small",
      "minimum": 1,
      "type": "string",
      "inclusive": true,
      "exact": false,
      "message": "String must contain at least 1 character(s)",
      "path": ["customerName"]
    }
  ]
}
```

- `errors` 数组来自 `ZodError.issues`，每个元素包含 `path`（字段路径）、`message`（错误描述）、`code`（Zod 错误码）等
- 前端 `useCrud` 的 `getFieldError()` 已自动解析此格式并按 `path` 匹配展示，无需手动处理

### 1.4 日志级别标准

| 级别    | 使用场景                             | 示例                             |
| ------- | ------------------------------------ | -------------------------------- |
| `error` | 系统错误、未捕获异常、外部服务不可用 | 数据库连接失败、第三方 API 超时  |
| `warn`  | 可恢复的异常、业务规则违反           | 重复提交、权限不足、数据校验失败 |
| `info`  | 关键业务事件                         | 用户登录、订单创建、数据导入完成 |
| `debug` | 调试信息（生产环境默认关闭）         | SQL 查询、请求/响应详情          |

- 日志框架使用 pino（已配置），**禁止**使用 `console.log` 替代结构化日志
- 错误日志必须包含上下文信息（userId、requestId 等），禁止只打印 `error.message`

---

## 2. 性能

### 2.1 前端（Web）

- 超过 50 条记录的列表必须使用服务端分页能力（`useServerPagination` / `useCrud.paginationOptions`），避免一次性拉取全量。默认每页 20 条（由 shared 的 `paginationSchema` 定义），最大允许 100 条/页。
- 请求并发与节流由请求队列控制（`apps/web/src/lib/api.ts` 的 `REQUEST_QUEUE_CONFIG`）。
- 打包策略以 Vite 配置为准：`apps/web/vite.config.ts`（`manualChunks` + `--mode analyze` 生成报告）。

### 2.2 后端（Server）

- Prisma 查询避免 N+1，优先 `select/include`，必要时为高频过滤字段加索引（以 `apps/server/prisma/schema.prisma` 为准）。
- 对外列表接口：必须整体接入 Query DTO（`@Query() QueryXxxDto`），避免 controller 层手写解析导致性能与一致性问题（由 `scripts/check-controller-query-dto.js` 阻断）。
- 列表接口默认分页（pageSize 默认 20，上限 100），由 `paginationSchema` 统一约束。
- 单次查询返回超过 500 条记录的场景必须评估是否需要流式处理或导出功能替代。

---

## 3. 测试

### 3.1 测试分层（现状）

- Web 单测：Vitest（`apps/web/package.json`）
- Server 单测：Vitest（`apps/server/package.json`）
- 旧 `tests/backend/*` 与 `tests/e2e/*` 脚本已删除；不要再基于这些历史 Puppeteer 脚本设计验证路径。

### 3.2 CI 口径（以 workflow 为准）

- 公开副本 CI 只跑 `.github/workflows/quality-gate.yml`：check:all、typecheck、lint、test、build，以及空库 migrate + bootstrap。

---

## 4. 部署与 CI 注意事项

### 4.1 FC 原生 URL vs 自定义域名

- **函数计算原生 URL**：CI 用平台查询命令取得，用于健康检查和迁移请求。请求直达 NestJS，没有路径前缀剥离，`/api/v1/health` 可正常访问。
- **自定义域名**（例如 `http://localhost:3000`）：面向前端；网关可能剥离路径前缀后再转到 NestJS。
- **不可混用**：健康检查不要打带前缀的自定义域名，否则路径会多一层应用名前缀。

### 4.2 历史钉钉同步函数

- 旧独立 dingtalk-sync FC 包已删除，不再部署、不再定时执行、不再作为当前数据同步链路。
- 历史上它是独立 FC 函数，用于从钉钉 API 拉取员工、部门、工作日志、日历事件、离职人员等数据。
- AI Coding Agent 不应基于历史文档推断线上仍在运行旧钉钉、YCCRM 或云效同步任务。

---

## 5. 变更规则（防止再次过时）

- 只要你修改了错误处理 / 性能 / 测试 / 部署相关实现或 CI 步骤，就必须同步更新本文（以"文件路径 + 口径"描述为主）。
