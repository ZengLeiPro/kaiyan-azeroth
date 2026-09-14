# @ky-azeroth/cloud-cost-sync

阿里云成本与用量每日同步 FC 应用。

## 职责

每日 09:30（北京时间）执行：

1. **BSS 快照**：拉账户余额 + 当月按产品账单 + 当月按实例账单 + 全部产品资源包 + 包年订阅实例 → 写入 `CloudBillSnapshot` 一行。
2. **CMS 用量**：拉 FC / OSS / 百炼 近 7 天的关键指标 → 按日聚合写入 `CloudUsageMetric`。
3. **预警引擎**：比对快照生成预警写入 `CloudAlert`，并自动恢复已不再触发的旧预警。

## 触发方式与安全边界

- **Timer 触发器**：cron `CRON_TZ=Asia/Shanghai 0 30 9 * * *`，payload 固定为 `{}`。
- **HTTP 触发器**：保留匿名 FC 网关；`GET /health`、`GET /_health`、`GET /healthz` 可匿名健康检查；同步仅接受带 `x-trigger-secret` 的 POST，非健康 GET 等其他方法返回 405。

Custom Runtime 只以 FC 自动注入的 `x-fc-control-path` 判定调用类型：event/timer 为 `/invoke`，HTTP 为 `/http-invoke`。缺失或未知值直接拒绝。业务 body/query/header 中伪造 `source`、`action`、`secret` 均不承担授权或来源判定；query/body secret 无效。HTTP 密钥使用常量时间比较，并在读取 body 前校验；JSON body 上限 64 KiB，HTTP 非法 JSON 返回 400、超限返回 413，内部错误不向调用方回显细节。event 完全成功返回 HTTP 200 与 `x-fc-status: 200`；部分失败、配置错误、异常或非法 body 统一映射为 HTTP 404 与 `x-fc-status: 404`，确保 InvokeFunction 识别失败并保留 JSON 报告。

## 环境变量

| 变量                        | 必需 | 说明                                                                               |
| --------------------------- | ---- | ---------------------------------------------------------------------------------- |
| `DATABASE_URL`              | ✅   | 主库连接（与 server 共用 schema）                                                  |
| `ALIYUN_ACCESS_KEY_ID`      | ✅   | RAM 子账号 AK（需 `AliyunBSSReadOnlyAccess` + `AliyunCloudMonitorReadOnlyAccess`） |
| `ALIYUN_ACCESS_KEY_SECRET`  | ✅   | SK                                                                                 |
| `ALIYUN_ACCOUNT_UID`        | ⬜   | 主账号 UID，写入快照 accountId 字段（多账号扩展用）                                |
| `ALIYUN_BSS_ENDPOINT`       | ⬜   | 默认 `business.aliyuncs.com`                                                       |
| `ALIYUN_CMS_ENDPOINT`       | ⬜   | 默认 `metrics.cn-hangzhou.aliyuncs.com`                                            |
| `ALIYUN_BSS_THROTTLE_MS`    | ⬜   | 默认 150ms（防 10 QPS 限流）                                                       |
| `CLOUD_USAGE_LOOKBACK_DAYS` | ⬜   | 默认 7                                                                             |
| `CLOUD_COST_TRIGGER_SECRET` | ✅   | FC HTTP trigger 共享密钥；Custom Runtime 缺失时拒绝启动（本地 CLI 不读取）         |
| `DRY_RUN`                   | ⬜   | `true` 时不写 DB                                                                   |

## 本地开发

```bash
pnpm install
pnpm -C apps/cloud-cost-sync sync:dry         # 干跑（不需要 AK）
pnpm -C apps/cloud-cost-sync sync             # 实际跑（需 .env）
pnpm -C apps/cloud-cost-sync typecheck
pnpm -C apps/cloud-cost-sync build
```

## 数据模型

写入 4 张表（schema 在 `apps/server/prisma/schema.prisma`）：

- `CloudBillSnapshot` — 每日快照（按 vendor+snapshotDate 唯一，upsert）
- `CloudUsageMetric` — 每日用量（按 vendor+productCode+metricName+instanceId+metricDate 唯一，upsert）
- `CloudAlert` — 预警事件（按 category+relatedResource+active 去重）
- `CloudInstanceMeta` — 实例元数据（人工维护，本 app 只读）

## 预警规则

| 规则                  | 等级 | 触发条件                                                        |
| --------------------- | ---- | --------------------------------------------------------------- |
| balance_low           | P0   | 余额 < ¥100                                                     |
| package_low           | P1   | 资源包余量 / 总量 < 20%                                         |
| package_expiring      | P1   | 资源包 30 天内到期                                              |
| package_runout_early  | P1   | FC 资源包按近 7 日均预测耗尽日 < 实际到期日                     |
| spike_anomaly         | P1   | 总扣费或单产品扣费环比上月 > 50% 且 > ¥200                      |
| subscription_expiring | P1   | 订阅实例 30 天内到期（V1 暂留接口，BSS 月账单不直接返回到期日） |

去重：相同 `(category, relatedResource)` 已有 `active` 时跳过新建。
自动恢复：active 但本次扫描未触发 → 状态变 `resolved`，备注"自动恢复"。

## 部署

公开副本不包含生产拓扑、云函数配置或部署脚本。本地验证：

```bash
pnpm -C apps/cloud-cost-sync build
pnpm -C apps/cloud-cost-sync sync:dry
```

接入安装方自己的调度环境时，自行提供 `DATABASE_URL`、云厂商只读密钥和 HTTP trigger secret。未配置时不要启动同步。
