#!/usr/bin/env node
/**
 * 业务实体「显示名」统一规约守门脚本
 *
 * 目标（详见 docs/conventions/entity-display-name.md）：
 *   1. 禁止在已纳入规约的代码路径里新增 `xxxTitle || serialNumber` 之类兜底链；
 *      全部走 `getEntityDisplayName(type, entity, variant)`。
 *   2. 禁止在 `useCrud` / `useDrawerEntityDetail` 调用处用 inline lambda 传
 *      `getEntityName: (e) => e.someField` / `entityNameOf: (e) => e.someField`；
 *      统一走 `getEntityDisplayName(type, e, variant)`。
 *
 * 渐进式守门设计：
 *   当前 `getEntityDisplayName` 仅覆盖 4 个核心实体（opportunity / sale-order /
 *   payment / invoice）。脚本只对**已纳入规约的路径**做硬守门（SCOPE_PATHS），其余
 *   路径暂时不检查。每扩展一个实体到统一规约时，把对应路径加进 SCOPE_PATHS。
 *
 *   待办：server 端 `apps/server/src/modules/{sale-orders,invoices,payments}` 还
 *   未完成 service 层替换（与 lead stage 工作冲突，留 P2 收尾阶段处理）；完成后
 *   把这三条加入 SCOPE_PATHS。
 *
 * 输出：
 *   - errors：阻断 commit / CI（exit 1）
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');

// ============ Scope 配置（白名单路径前缀，相对仓库根） ============
// 仅检查这些路径下的文件；其他路径未纳入规约，跳过。
const SCOPE_PATHS = [
  // web CRM 四模块（已完成 P0+P1 替换）
  'apps/web/src/pages/crm/opportunities/',
  'apps/web/src/pages/crm/sale-orders/',
  'apps/web/src/pages/crm/payments/',
  'apps/web/src/pages/crm/invoices/',
  // 跨模块引用组件（已替换）
  'apps/web/src/components/patterns/sale-order-select.tsx',
  // 客户抽屉里的关联订单/回款列表（已替换）
  'apps/web/src/pages/crm/customers/components/CustomerDrawerBody.tsx',
  // shared 层 zod schema + types（subject 字段已加，未来扩展实体时同此目录）
  'packages/shared/src/schemas/payment.ts',
  'packages/shared/src/schemas/invoice.ts',
  'packages/shared/src/schemas/sale-order.ts',
  'packages/shared/src/schemas/opportunity.ts',
  // CLI registry（DISPLAY_NAME_OVERRIDES 收敛地）
  'apps/cli/src/registry.ts',
];

// ============ Allowlist 配置 ============
// 即使在 SCOPE 内，以下文件仍允许保留兜底链 / 默认 lambda（边界情况）
const ALLOWLIST_PATHS = [
  // 统一函数本体：fallback 逻辑由其负责
  'packages/shared/src/utils/entity-display-name.ts',
  // 单测 fixture 必然涉及多种 fallback 组合
  'packages/shared/src/utils/__tests__/entity-display-name.spec.ts',
  // useCrud 默认实现：不知道 entityType 无法走统一函数，保留 e.name || e.id 兜底
  'apps/web/src/hooks/use-crud.ts',
  // useDrawerEntityDetail 内部 defaultEntityNameOf：未覆盖类型走 e.name || e.title || e.id
  'apps/web/src/hooks/use-drawer-entity-detail.ts',
];

function inScope(relativePath) {
  return SCOPE_PATHS.some((p) => relativePath === p || relativePath.startsWith(p));
}

// ============ 排除模式 ============
const EXCLUDE_PATTERNS = [
  /node_modules/,
  /\.d\.ts$/,
  // Prisma 生成的 client 类型
  /\.prisma\//,
];

// ============ 检测模式 ============
//
// 模式 1：`|| serialNumber` / `?? serialNumber` 兜底链
//   误判规避：跳过 entity-display-name 本体（白名单）、注释行
const FALLBACK_SERIAL_PATTERNS = [
  { regex: /\|\|\s*\w*\.?serialNumber\b/, message: '使用 `|| serialNumber` 兜底链' },
  { regex: /\?\?\s*\w*\.?serialNumber\b/, message: '使用 `?? serialNumber` 兜底链' },
];

// 模式 2：inline lambda 传 getEntityName / entityNameOf（字面量赋值，非类型签名）
//   配合 line.includes('getEntityDisplayName') 二次判定剔除合规调用。
//   类型签名（`getEntityName?: (e: T) => string`）由 isTypeSignature 剔除。
const INLINE_LAMBDA_REGEX = /\b(getEntityName|entityNameOf)\s*:\s*\([^)]*\)\s*=>/;

const errors = [];
let checkedFiles = 0;

function isExcluded(filePath) {
  return EXCLUDE_PATTERNS.some((pattern) => pattern.test(filePath));
}

function isAllowlisted(filePath) {
  const relativePath = path.relative(process.cwd(), filePath);
  return ALLOWLIST_PATHS.some((p) => relativePath === p || relativePath.endsWith(p));
}

function isCommentLine(line) {
  const trimmed = line.trim();
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*') ||
    trimmed === '*/'
  );
}

function isTypeSignature(line) {
  // 类型签名：以 `: (...) => xxx;` / `,` / `;` 收尾（注意排除 JSX 的 `=> (` 多行函数体）
  // 简化判定：行包含 ' => string' / ' => Promise' / ' => void' / ' => ReactNode' / ' => unknown' / ' => T'
  // 或者紧邻 `?:` 这种 optional 字段语法
  return (
    /=>\s*(string|Promise|void|unknown|React\.?\w*|JSX|number|boolean|T\b)/.test(line) ||
    /\?\s*:\s*\(/.test(line)
  );
}

function checkFile(filePath) {
  if (isExcluded(filePath)) return;
  const relativePath = path.relative(REPO_ROOT, filePath);
  if (!inScope(relativePath)) return; // SCOPE 外完全跳过，不计数
  if (isAllowlisted(filePath)) {
    checkedFiles++;
    return;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    if (isCommentLine(line)) continue;

    // 检测兜底链
    for (const pat of FALLBACK_SERIAL_PATTERNS) {
      if (pat.regex.test(line)) {
        errors.push({
          file: path.relative(process.cwd(), filePath),
          line: lineNum,
          message: `${pat.message}: ${line.trim().slice(0, 120)}`,
        });
      }
    }

    // 检测 inline lambda（排除类型签名 + 排除已走统一函数）
    if (isTypeSignature(line)) continue;
    if (INLINE_LAMBDA_REGEX.test(line) && !line.includes('getEntityDisplayName')) {
      errors.push({
        file: path.relative(process.cwd(), filePath),
        line: lineNum,
        message: `inline lambda 传 getEntityName/entityNameOf，应走 getEntityDisplayName(type, e, variant): ${line.trim().slice(0, 120)}`,
      });
    }
  }

  checkedFiles++;
}

function findFiles(dir, extensions) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      files.push(...findFiles(fullPath, extensions));
    } else if (item.isFile()) {
      const ext = path.extname(item.name);
      if (extensions.includes(ext)) files.push(fullPath);
    }
  }
  return files;
}

function main() {
  console.log('检查业务实体「显示名」统一规约...\n');
  console.log('SCOPE 路径（仅检查这些，其余已纳入规约前跳过）：');
  for (const p of SCOPE_PATHS) console.log(`  - ${p}`);
  console.log('');

  // 扫描所有可能的目录，inScope 在 checkFile 内部过滤
  const webFiles = findFiles(path.join(REPO_ROOT, 'apps/web/src'), ['.ts', '.tsx']);
  const cliFiles = findFiles(path.join(REPO_ROOT, 'apps/cli/src'), ['.ts']);
  const serverFiles = findFiles(path.join(REPO_ROOT, 'apps/server/src'), ['.ts']);
  const sharedFiles = findFiles(path.join(REPO_ROOT, 'packages/shared/src'), ['.ts']);
  const allFiles = [...webFiles, ...cliFiles, ...serverFiles, ...sharedFiles];

  if (allFiles.length === 0) {
    console.log('未找到需要检查的文件');
    process.exit(0);
  }

  for (const file of allFiles) checkFile(file);

  console.log(`已检查 ${checkedFiles} 个文件\n`);

  if (errors.length > 0) {
    const sep = '='.repeat(50);
    console.log('错误（必须修复）:');
    console.log(sep);
    for (const e of errors) {
      console.log(`  ${e.file}:${e.line}`);
      console.log(`    ${e.message}`);
    }
    console.log('');
    console.log(`检查失败：发现 ${errors.length} 处问题。`);
    console.log('');
    console.log('修复建议：');
    console.log('  1. 把 `xxxTitle || serialNumber` 之类兜底链替换为');
    console.log('     `getEntityDisplayName(type, entity, variant)` 调用');
    console.log('  2. 把 `getEntityName: (e) => e.xxx` inline lambda 替换为');
    console.log('     `getEntityName: (e) => getEntityDisplayName(type, e, "short")`');
    console.log('  3. 详见 docs/conventions/entity-display-name.md');
    console.log('  4. 如确属边界情况无法收敛，在 scripts/check-display-name.js');
    console.log('     的 ALLOWLIST_PATHS 中添加文件路径并注明理由');
    process.exit(1);
  }

  console.log('业务实体显示名规约检查通过！');
  process.exit(0);
}

main();
