# Changelog

## 1.2.0 (2026-08-30)

### Added

- **小红书聚光完整数据集查询**：
  - `xiaohongshu datasets`：按真实广告主授权发现全部只读数据集与可用状态。
  - `xiaohongshu describe-dataset <dataset>`：读取方法、分页、日期/口径支持、默认值、核心字段和参数提示。
  - `xiaohongshu query-dataset <dataset> --json <path|->`：查询任意 registry 数据集并保留原始行、汇总、元数据与 `requestId`。
  - `query-dataset --all`：串行拉取完整数据，items 输出 NDJSON；页面契约、字段并集、汇总、元数据和 requestId 写入 metadata sidecar。
  - `--resume-from-page`：失败后续传 NDJSON，并校验 sidecar 的数据集与广告主一致。

### Changed

- 全量分页优先使用服务端 `hasMore` 判停，同时兼容标准 CRUD 的 `totalPages`/页长度判停。
- CLI capability 与 system/roles 菜单声明正式纳入 `xiaohongshu` 完整查询入口。

## 1.1.0 (2026-04-22)

### Added

- **`--all` 自动翻页模式**：串行翻页拉取 endpoint 全量数据，输出 NDJSON（`one JSON object per line`），可被 DuckDB `read_json_auto('file.ndjson', format='newline_delimited')` 直接读取。
  - `--output <file>`：写入文件（未指定则 stdout）。失败时保留半成品。
  - `--resume-from-page <n>`：失败后从指定页续传（stderr 会自动打印完整续传命令）。
  - 单页失败指数退避重试：[500, 2000, 5000, 10000]ms，共 4 次。
  - HTTP timeout 在 `--all` 模式下自动放宽到 120s；也可通过 `AZEROTH_HTTP_TIMEOUT_MS` 环境变量覆盖默认 30s。
  - 进度与 `snapshot_at` ISO 时间戳输出到 stderr。
  - 与 `--page` / `--quiet` / `--format table` 互斥。

- **只读实体支持**（registry 两件套发现）：仅暴露 `queryXxxSchema + xxxResponseSchema` 的 shared schema 会被自动注册为只读实体，只挂载 `list` / `get` 子命令，不注册 `create / update / delete / restore`。当前已识别：
  - `dingtalk-logs` — 钉钉日志
  - `dingtalk-calendar-events` — 钉钉日程事件
  - `employee-leaves` — 员工离职记录

- `EntityConfig.readOnly: boolean` 字段标识只读实体。

### Changed

- **默认 pageSize：20 → 100**（与后端 `paginationSchema.default(100)` 对齐）。
- `printTable` 最多显示 50 行，超出在末尾提示 `... (N more rows omitted, use --format json for full output)`，避免终端被大结果淹没。

### Notes

- 非 ADMIN 用户在 `customers` / `keep-records` / `opportunities` 上传入 `pageSize > 500` 会收到服务端 403。需要批量导出请走 `--all`（自动翻页，每次请求遵守 pageSize 上限）。
