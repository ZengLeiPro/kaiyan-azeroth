# 安装

适用于空的本地 PostgreSQL。不要对任何已有业务库执行 seed。

## 1. 依赖

- Node.js 22.x
- pnpm >=11.17.0
- Docker Compose，或本机 PostgreSQL 16

## 2. 仓外密码

```bash
mkdir -p "$HOME/.azeroth-local"
umask 077
openssl rand -base64 24 > "$HOME/.azeroth-local/admin.password"
openssl rand -base64 24 > "$HOME/.azeroth-local/approver.password"
chmod 600 "$HOME/.azeroth-local/"*.password
```

可选演示账号（销售 A / 销售 B）：

```bash
openssl rand -base64 24 > "$HOME/.azeroth-local/sales_a.password"
openssl rand -base64 24 > "$HOME/.azeroth-local/sales_b.password"
chmod 600 "$HOME/.azeroth-local/sales_a.password" "$HOME/.azeroth-local/sales_b.password"
```

## 3. 环境

```bash
cp .env.example apps/server/.env
```

至少设置：

- `DATABASE_URL` 指向本地库
- `AZEROTH_BOOTSTRAP_PASSWORD_FILE`
- `AZEROTH_APPROVER_PASSWORD_FILE`
- `JWT_SECRET` / `JWT_REFRESH_SECRET`（互不相同，且不要用示例值上生产）

可选：`AZEROTH_SEED_DEMO=1` 以及销售 A/B 密码文件。

## 4. 启动

```bash
pnpm install
docker compose up -d
# 默认映射 localhost:55432，避免占用本机已有 5432
pnpm db:migrate
pnpm db:seed
```

seed 会打印 admin / approver 的 employee UUID。把 admin UUID 写入 `SUPER_ADMIN_EMPLOYEE_ID`。再次执行 seed 是幂等的：不改密、不改 UUID、不改角色。

```bash
pnpm dev
```

## 5. 不要做的事

- 不要对云数据库或生产库跑 seed / reset
- 不要把密码文件放进仓库
- 不要恢复已删除的健康应用层或 管理员 特权通道
