# @ky-azeroth/seo-sync

SEO 监测数据每日同步 FC 子应用。

## 数据源与抓取策略

| 数据源               | 接口                                                           | 频次                        | 写入表                  | 状态              |
| -------------------- | -------------------------------------------------------------- | --------------------------- | ----------------------- | ----------------- |
| Bing Webmaster Tools | `/GetQueryStats?siteUrl=...&apikey=...`                        | 每日 1 次                   | `seo_search_queries`    | ✅ 上线           |
| Microsoft Clarity    | `POST /export-data/api/v1/project-live-insights`（Bearer JWT） | 每日 1 次（10 次/天硬上限） | `seo_page_insights`     | ✅ 上线           |
| 百度统计 OpenAPI     | OAuth 2.0 + `getReportData`                                    | 每日 1 次                   | `seo_traffic_snapshots` | ⏸️ 待 PV>100 开通 |

每次同步落一条 `seo_sync_runs` 记录便于审计。

## 运行模式与安全边界

| 入口         | 来源                                    | 用途                          |
| ------------ | --------------------------------------- | ----------------------------- |
| event/timer  | s.yaml cron，payload 固定为 `{}`        | 每日 09:00 自动同步           |
| HTTP trigger | SeoMonitor 手动按钮 / NestJS 09:00 兜底 | 受密钥保护的手动或兜底同步    |
| HTTP health  | `GET /health`、`/_health`、`/healthz`   | 匿名部署冒烟与健康检查        |
| 本地 CLI     | 受控运维环境                            | 本地手动验证（不启动 server） |

生产同时保留 timer 与 anonymous HTTP trigger。Custom Runtime 只以 FC 自动注入的 `x-fc-control-path` 判定调用类型：event/timer 为 `/invoke`，HTTP 为 `/http-invoke`；缺失或未知值直接拒绝。除匿名 GET 健康检查外，HTTP 同步仅接受 POST，且必须在真实 header 提供 `x-trigger-secret`；运行时在读取 body 前使用常量时间比较完成校验，其他方法返回 405。query/body 中的 secret 无效，body 内 `source`、`action`、伪造 headers 也不承担授权或审计来源判定；SeoSyncRun 的 `triggerSource` 由可信 runtime context 固定为 `timer` 或 `http`。

JSON body 上限 64 KiB；HTTP 非法 JSON 返回 400、超限返回 413，内部错误不向调用方回显细节。event 完全成功返回 HTTP 200 与 `x-fc-status: 200`；部分失败、配置错误、异常或非法 body 统一映射为 HTTP 404 与 `x-fc-status: 404`，确保 InvokeFunction 识别失败并保留 JSON 报告。

## 本地开发

```bash
# dry-run（boot 自检，不写库）
pnpm sync:dry

# 完整同步（需 .env 配 SEO_BING_API_KEY / SEO_CLARITY_API_TOKEN / DATABASE_URL）
pnpm sync
```

## 环境变量

| 变量                      | 用途                                                                                                                                                                  | 必填 |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `DATABASE_URL`            | PostgreSQL 连接串                                                                                                                                                     | ✅   |
| `SEO_BING_API_KEY`        | Bing API key。未配置则不要启动同步                                                                                                                                    | ✅   |
| `SEO_BING_SITE_URL`       | Bing 监测站点，必须与 Webmaster 后台 siteUrl 完全一致                                                                                                                 | ❌   |
| `SEO_GOOGLE_HTTPS_PROXY`  | Google Search Console API 专用 HTTPS 代理。未配置则不走代理                                                                                                           | ❌   |
| `SEO_CLARITY_API_TOKEN`   | Clarity Data Export JWT。未配置则跳过 Clarity                                                                                                                         | ❌   |
| `SEO_CLARITY_PROJECT_ID`  | Clarity 项目 ID。无默认值                                                                                                                                             | ❌   |
| `SEO_CLARITY_SITE_URL`    | Clarity 数据归属的站点                                                                                                                                                | ❌   |
| `SEO_CLARITY_NUM_OF_DAYS` | 抓近 N 天（1-3）                                                                                                                                                      | ❌   |
| `SEO_THROTTLE_MS`         | 请求间隔（默认 300）                                                                                                                                                  | ❌   |
| `SEO_TRIGGER_SECRET`      | FC HTTP trigger 共享密钥；Custom Runtime 缺失时拒绝启动，本地 CLI 不读取                                                                                              | ✅   |

## 部署

本仓库不包含生产部署描述文件。由安装者自己的运行环境注入 `SEO_TRIGGER_SECRET` 等密钥。手动调用仅使用 `x-trigger-secret` header；不要把密钥放入 URL/query 或 JSON body。未配置密钥时不要启动同步。

## 灰度策略

push 1: schema + types + 空表上线
push 2: FC 部署，timer `enable: false`；用 workflow_dispatch dry-run 测试
push 3: timer `enable: true`，每日自动跑
