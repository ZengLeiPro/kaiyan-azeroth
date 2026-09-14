#!/usr/bin/env node
/**
 * Helmet 安全中间件启用检查脚本
 *
 * 目标（CLAUDE.md MUST #11.4）：
 * - apps/server/src/main.ts 必须导入 helmet
 * - apps/server/src/main.ts 必须调用 app.use(helmet())
 * - 任一缺失则 exit 1 阻断
 *
 * 检测范围：
 * - apps/server/src/main.ts
 *
 * 输出：
 * - errors：阻断提交/CI（exit 1）
 */

const fs = require('fs');
const path = require('path');

const MAIN_TS_PATH = path.join(__dirname, '../apps/server/src/main.ts');

const errors = [];

function main() {
  console.log('检查 Helmet 安全中间件启用状态...\n');

  if (!fs.existsSync(MAIN_TS_PATH)) {
    console.log('未找到 apps/server/src/main.ts，跳过检查');
    process.exit(0);
  }

  const content = fs.readFileSync(MAIN_TS_PATH, 'utf-8');

  // 检查 helmet 导入：匹配 import helmet from 'helmet' 或 import * as helmet from 'helmet' 等
  const hasHelmetImport = /import\s+.*helmet.*from\s+['"]helmet['"]/.test(content);
  if (!hasHelmetImport) {
    errors.push({
      file: 'apps/server/src/main.ts',
      message: "缺少 helmet 导入语句（需要 import helmet from 'helmet'）",
    });
  }

  // 检查 app.use(helmet()) 调用
  const hasHelmetUsage = /app\.use\(\s*helmet\s*\(/.test(content);
  if (!hasHelmetUsage) {
    errors.push({
      file: 'apps/server/src/main.ts',
      message: '缺少 app.use(helmet()) 调用',
    });
  }

  if (errors.length > 0) {
    const separator = '='.repeat(50);
    console.log('错误（必须修复）:');
    console.log(separator);
    for (const e of errors) {
      console.log(`  ${e.file}`);
      console.log(`    ${e.message}`);
    }
    console.log('');
    console.log(`检查失败：发现 ${errors.length} 处问题。`);
    console.log('');
    console.log('修复建议：');
    console.log('  确保 main.ts 中包含以下内容：');
    console.log("  import helmet from 'helmet';");
    console.log('  app.use(helmet());');
    console.log('  参考规范：CLAUDE.md 第 11.4 节');
    process.exit(1);
  }

  console.log('Helmet 安全中间件检查通过！');
  process.exit(0);
}

main();
