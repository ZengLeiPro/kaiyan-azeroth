#!/usr/bin/env node
/**
 * JWT Guard 检查脚本
 *
 * 目标（rules.md 安全规范）：
 * - 所有 Controller 必须受 JwtAuthGuard 保护
 * - 支持两种模式：
 *   1. APP_GUARD 全局注册（app.module.ts 中注册 JwtAuthGuard）→ 所有 Controller 自动受保护
 *   2. 逐 Controller 手动 @UseGuards(JwtAuthGuard) → 每个 Controller 单独检查
 * - 豁免列表中的 Controller 除外（如 health、internal），这些需要 @Public() 跳过全局 Guard
 *
 * 检测范围：
 * - apps/server/src/modules/ 下所有 *.controller.ts 文件
 * - apps/server/src/internal/ 下所有 *.controller.ts 文件
 *
 * 输出：
 * - errors：阻断提交/CI（exit 1）
 */

const fs = require('fs');
const path = require('path');

const SERVER_SRC = path.join(__dirname, '../apps/server/src');

// ============ 豁免列表 ============
// 不需要 JwtAuthGuard 的 Controller（需注明原因）
const EXEMPT_CONTROLLERS = [
  'health.controller.ts', // 健康检查端点，无需认证
  'internal.controller.ts', // 内部运维端点，使用 MIGRATION_TOKEN 认证
  'auth.controller.ts', // 认证端点：login/refresh 为公开路由，logout 已单独加 Guard
];

const errors = [];
let checkedFiles = 0;

function findControllers(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;

  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      files.push(...findControllers(fullPath));
    } else if (item.isFile() && item.name.endsWith('.controller.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

function checkController(filePath) {
  const fileName = path.basename(filePath);

  // 跳过豁免列表
  if (EXEMPT_CONTROLLERS.includes(fileName)) {
    return;
  }

  const content = fs.readFileSync(filePath, 'utf-8');

  // 检查是否有 @UseGuards(JwtAuthGuard) 类级装饰器
  // 匹配模式：@UseGuards(JwtAuthGuard) 在 @Controller 之后、class 之前
  const hasClassLevelGuard = /^@UseGuards\(JwtAuthGuard\)/m.test(content);

  if (!hasClassLevelGuard) {
    // 检查是否所有路由方法都有方法级 Guard
    // 找到所有 HTTP 方法装饰器
    const httpMethods = content.match(/^\s*@(Get|Post|Put|Patch|Delete|Head|Options|All)\(/gm);

    if (httpMethods && httpMethods.length > 0) {
      // 找到所有方法级 @UseGuards(JwtAuthGuard)
      const methodGuards = content.match(/^\s*@UseGuards\(JwtAuthGuard\)/gm);
      const guardCount = methodGuards ? methodGuards.length : 0;

      if (guardCount < httpMethods.length) {
        errors.push({
          file: path.relative(process.cwd(), filePath),
          message: `缺少 @UseGuards(JwtAuthGuard)：发现 ${httpMethods.length} 个路由方法，但只有 ${guardCount} 个受 JwtAuthGuard 保护`,
        });
      }
    }
  }

  checkedFiles++;
}

/**
 * 检查 app.module.ts 是否全局注册了 JwtAuthGuard（APP_GUARD 模式）
 */
function isGlobalGuardRegistered() {
  const appModulePath = path.join(SERVER_SRC, 'app.module.ts');
  if (!fs.existsSync(appModulePath)) return false;
  const content = fs.readFileSync(appModulePath, 'utf-8');
  // 检查是否有 APP_GUARD + JwtAuthGuard 的组合
  return content.includes('APP_GUARD') && content.includes('JwtAuthGuard');
}

function main() {
  console.log('检查 Controller JWT Guard 覆盖率...\n');

  // 如果 APP_GUARD 全局注册了 JwtAuthGuard，所有 Controller 自动受保护
  if (isGlobalGuardRegistered()) {
    console.log('检测到 APP_GUARD 全局注册 JwtAuthGuard，所有 Controller 自动受保护。');
    console.log('\nJWT Guard 检查通过！');
    process.exit(0);
  }

  const controllers = findControllers(SERVER_SRC);

  if (controllers.length === 0) {
    console.log('未找到 Controller 文件');
    process.exit(0);
  }

  for (const file of controllers) {
    checkController(file);
  }

  console.log(`已检查 ${checkedFiles} 个 Controller 文件\n`);

  if (errors.length > 0) {
    const separator = '='.repeat(50);
    console.log('错误（必须修复）:');
    console.log(separator);
    for (const e of errors) {
      console.log(`  ${e.file}`);
      console.log(`    ${e.message}`);
    }
    console.log('');
    console.log(`检查失败：发现 ${errors.length} 个 Controller 缺少 JWT 认证保护。`);
    console.log('');
    console.log('修复建议：');
    console.log('  1. 在 Controller 类上添加 @UseGuards(JwtAuthGuard) 装饰器');
    console.log(
      '  2. 如果该 Controller 无需认证，请将其添加到 scripts/check-jwt-guard.js 的 EXEMPT_CONTROLLERS 列表中并注明原因'
    );
    process.exit(1);
  }

  console.log('JWT Guard 检查通过！');
  process.exit(0);
}

main();
