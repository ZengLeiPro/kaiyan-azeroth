# 配置

未列出的外部集成默认关闭。不要把任何托管生产 URL 当作默认值。

## 必填（本地开发）

| 变量 | 说明 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 连接串，仅本地或安装者自己的库 |
| `JWT_SECRET` | Access token 密钥，至少 16 字符 |
| `JWT_REFRESH_SECRET` | Refresh token 密钥，必须与 access 不同 |
| `CORS_ORIGIN` | 前端 origin |
| `AZEROTH_BOOTSTRAP_PASSWORD_FILE` | 仓外 admin 密码文件 |
| `AZEROTH_APPROVER_PASSWORD_FILE` | 仓外审批员密码文件 |

## 保护锁

| 变量 | 说明 |
| --- | --- |
| `SUPER_ADMIN_EMPLOYEE_ID` | 受保护员工 UUID。不授予额外权限，只阻止通用管理接口删除/停用/改名/改角色。生产启动缺失则失败。 |

角色变更仍要求 `system/user_role` 权限 + 5 分钟内 JWT，拒绝 PAT。

## 可选

| 变量 | 缺省行为 |
| --- | --- |
| `AMAP_WEB_SERVICE_KEY` | 未配置则服务端签到逆地理编码不可用 |
| `VITE_AMAP_WEB_KEY` | 未配置则浏览器端逆地理编码返回 null，界面回退到坐标字符串 |
| `WEBSITE_LEAD_WEBHOOK_SECRET` | 未配置则官网留资 webhook 不可用 |
| `WEBSITE_LEAD_DEFAULT_OWNER_EMPLOYEE_ID` | 未配置则官网留资无法解析接单人 |
| `APP_WEB_BASE_URL` | 通知卡片跳转基址，默认 `http://localhost:5173` |
| `PUBLIC_API_BASE_URL` | 生产必填；本地可用 `http://localhost:3000` |
| `AZEROTH_SEED_DEMO` | `1` 时创建销售 A/B |
| SEO / 云成本 / 小红书 / 钉钉 | 未提供密钥则保持关闭 |

钉钉登录未配置时明确不可用；账号密码登录独立可用。
