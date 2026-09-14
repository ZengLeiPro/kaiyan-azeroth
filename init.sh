#!/bin/bash
# ============================================================
# KY-Azeroth 开发环境初始化脚本
# 用途：安装依赖、启动基础设施、运行数据库迁移、启动开发服务
# ============================================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 项目根目录
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

echo ""
echo "============================================"
echo "  KY-Azeroth 开发环境初始化"
echo "============================================"
echo ""

# ---- Step 1: 检查前置条件 ----
log_info "Step 1: 检查前置条件..."

# 检查 Node.js
if ! command -v node &> /dev/null; then
    log_error "Node.js 未安装，需要 >= 22.0.0"
    exit 1
fi
NODE_VERSION=$(node -v | sed 's/v//')
log_success "Node.js $NODE_VERSION"

# 检查 pnpm
if ! command -v pnpm &> /dev/null; then
    log_error "pnpm 未安装，需要 >= 9.0.0"
    log_info "安装方法: npm install -g pnpm"
    exit 1
fi
PNPM_VERSION=$(pnpm -v)
log_success "pnpm $PNPM_VERSION"

# 检查 Docker
if ! command -v docker &> /dev/null; then
    log_error "Docker 未安装，需要 Docker + Docker Compose"
    exit 1
fi
log_success "Docker 已安装"

# ---- Step 2: 安装依赖 ----
log_info "Step 2: 安装项目依赖..."
pnpm install
log_success "依赖安装完成"

# ---- Step 3: 环境配置 ----
log_info "Step 3: 检查环境配置..."
if [ ! -f "apps/server/.env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example apps/server/.env
        log_warn "已从 .env.example 复制到 apps/server/.env，请检查配置"
    else
        log_error "缺少 .env 文件，请参考 .env.example 创建"
        exit 1
    fi
else
    log_success "apps/server/.env 已存在"
fi

# ---- Step 4: 启动 Docker 服务 ----
log_info "Step 4: 启动 Docker 基础设施服务..."
docker compose up -d
log_info "等待 PostgreSQL 就绪..."
sleep 3

# 等待 PostgreSQL 健康
MAX_RETRIES=30
RETRY=0
until docker compose exec -T postgres pg_isready -U postgres > /dev/null 2>&1; do
    RETRY=$((RETRY + 1))
    if [ $RETRY -ge $MAX_RETRIES ]; then
        log_error "PostgreSQL 启动超时"
        exit 1
    fi
    sleep 1
done
log_success "PostgreSQL 就绪"

# ---- Step 5: Prisma 迁移和代码生成 ----
log_info "Step 5: 运行 Prisma 迁移..."
cd apps/server
npx prisma generate
npx prisma migrate dev
cd "$PROJECT_DIR"
log_success "数据库迁移完成"

# ---- Step 6: 安装 Playwright 浏览器（E2E 测试用） ----
log_info "Step 6: 安装 Playwright 浏览器..."
npx playwright install chromium --with-deps 2>/dev/null || true
log_success "Playwright 安装完成（或已跳过）"

# ---- Step 7: 启动开发服务 ----
log_info "Step 7: 启动开发服务..."
echo ""
echo "============================================"
echo "  初始化完成！"
echo "============================================"
echo ""
echo "  启动后端服务:  pnpm dev:server"
echo "  启动前端服务:  pnpm dev:web"
echo "  同时启动:      pnpm dev"
echo ""
echo "  前端地址:      http://localhost:5173"
echo "  后端地址:      http://localhost:3000"
echo "  API 文档:      http://localhost:3000/api"
echo "  健康检查:      http://localhost:3000/api/v1/health"
echo ""
echo "  代码质量检查:  pnpm run check:all"
echo "  类型检查:      pnpm typecheck"
echo "  构建:          pnpm build"
echo ""
echo "============================================"
