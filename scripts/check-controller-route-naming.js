#!/usr/bin/env node
/**
 * Controller 路由命名规范检查脚本
 *
 * 目标（rules.md MUST #10）：
 * - 采用扁平路由风格，Controller 只声明资源名
 * - 禁止版本号前缀（如 v1/customers）
 * - 禁止 API 前缀（如 api/customers）
 * - 禁止命名空间分组（路径含 /，如 crm/customers）
 * - 禁止前导斜杠（如 /customers）
 * - 必须 kebab-case（仅允许 [a-z0-9-]）
 *
 * 豁免：
 * - @Controller({ path: '...', version: VERSION_NEUTRAL }) 形式
 *
 * 检测范围：
 * - apps/server/src/ 下所有 *.controller.ts 文件
 *
 * 输出：
 * - errors：阻断提交/CI（exit 1）
 */

const fs = require('fs');
const path = require('path');

const SERVER_SRC = path.join(__dirname, '../apps/server/src');

const errors = [];
let checkedFiles = 0;
let checkedRoutes = 0;

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
  const content = fs.readFileSync(filePath, 'utf-8');
  const relPath = path.relative(process.cwd(), filePath);

  // 匹配 @Controller('xxx') 形式（字符串参数）
  const stringArgPattern = /@Controller\(\s*['"]([^'"]*)['"]\s*\)/g;
  // 匹配 @Controller({ ... }) 形式（对象参数）
  const objectArgPattern = /@Controller\(\s*\{([^}]*)\}\s*\)/g;

  let match;
  let hasRoute = false;

  // 检查字符串参数形式：@Controller('xxx')
  while ((match = stringArgPattern.exec(content)) !== null) {
    hasRoute = true;
    const routePath = match[1];
    validateRoute(relPath, routePath, match.index, content);
    checkedRoutes++;
  }

  // 检查对象参数形式：@Controller({ path: '...', ... })
  while ((match = objectArgPattern.exec(content)) !== null) {
    hasRoute = true;
    const objectBody = match[1];

    // 豁免：含 VERSION_NEUTRAL 的对象形式
    if (objectBody.includes('VERSION_NEUTRAL')) {
      checkedRoutes++;
      continue;
    }

    // 提取 path 值
    const pathMatch = objectBody.match(/path\s*:\s*['"]([^'"]*)['"]/);
    if (pathMatch) {
      validateRoute(relPath, pathMatch[1], match.index, content);
      checkedRoutes++;
    }
  }

  if (hasRoute) {
    checkedFiles++;
  }
}

function validateRoute(filePath, routePath, matchIndex, content) {
  const line = content.substring(0, matchIndex).split('\n').length;

  // 规则 1：禁止版本号前缀
  if (/^v\d+[/]/.test(routePath)) {
    errors.push({
      file: filePath,
      line,
      route: routePath,
      message: `禁止版本号前缀：路由 "${routePath}" 含版本号。Controller 不应包含版本号，globalPrefix + enableVersioning 会自动组合`,
    });
  }

  // 规则 2：禁止 API 前缀
  if (/^api[/]/i.test(routePath)) {
    errors.push({
      file: filePath,
      line,
      route: routePath,
      message: `禁止 API 前缀：路由 "${routePath}" 含 api/ 前缀。globalPrefix 已设置为 api，无需在 Controller 中重复`,
    });
  }

  // 规则 3：禁止命名空间分组（路径含 /）
  if (routePath.includes('/')) {
    errors.push({
      file: filePath,
      line,
      route: routePath,
      message: `禁止命名空间分组：路由 "${routePath}" 含 /。应采用扁平路由风格，不按模块分组`,
    });
  }

  // 规则 4：禁止前导斜杠
  if (routePath.startsWith('/')) {
    errors.push({
      file: filePath,
      line,
      route: routePath,
      message: `禁止前导斜杠：路由 "${routePath}" 以 / 开头`,
    });
  }

  // 规则 5：必须 kebab-case（仅允许 [a-z0-9-]）
  if (routePath && !/^[a-z0-9-]+$/.test(routePath)) {
    errors.push({
      file: filePath,
      line,
      route: routePath,
      message: `必须 kebab-case：路由 "${routePath}" 包含非法字符，仅允许小写字母、数字和连字符 [a-z0-9-]`,
    });
  }
}

function main() {
  console.log('检查 Controller 路由命名规范...\n');

  const controllers = findControllers(SERVER_SRC);

  if (controllers.length === 0) {
    console.log('未找到 Controller 文件');
    process.exit(0);
  }

  for (const file of controllers) {
    checkController(file);
  }

  console.log(`已检查 ${checkedFiles} 个 Controller 文件（${checkedRoutes} 条路由）\n`);

  if (errors.length > 0) {
    const separator = '='.repeat(50);
    console.log('错误（必须修复）:');
    console.log(separator);
    for (const e of errors) {
      console.log(`  ${e.file}:${e.line}`);
      console.log(`    ${e.message}`);
    }
    console.log('');
    console.log(`检查失败：发现 ${errors.length} 个路由命名违规。`);
    console.log('');
    console.log('修复建议：');
    console.log("  1. Controller 只声明资源名：@Controller('customers')");
    console.log('  2. 不要包含版本号/api前缀/命名空间：globalPrefix + enableVersioning 自动组合');
    console.log('  3. 使用 kebab-case 命名（小写字母、数字、连字符）');
    console.log(
      "  4. 如需 VERSION_NEUTRAL，使用对象形式：@Controller({ path: '...', version: VERSION_NEUTRAL })"
    );
    process.exit(1);
  }

  console.log('Controller 路由命名规范检查通过！');
  process.exit(0);
}

main();
