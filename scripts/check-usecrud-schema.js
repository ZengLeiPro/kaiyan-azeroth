#!/usr/bin/env node
/**
 * useCrud schema 参数检查脚本（增强版）
 *
 * 检查前端所有 useCrud 调用是否传入了有效的 schema 参数：
 * 1. 扫描 apps/web/src/pages/ 目录下的所有 .ts 和 .tsx 文件
 * 2. 使用 TypeScript AST 解析文件
 * 3. 查找所有 useCrud(...) 或 useCrud<...>(...) 调用
 * 4. 检查调用参数中是否包含 schema 属性
 * 5. 检查 schema 是否为有效的 Zod schema（禁止 z.object({})）
 *
 * 使用方式：node scripts/check-usecrud-schema.js
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const PAGES_DIR = path.join(__dirname, '../apps/web/src/pages');

// ============ Allowlist 配置 ============
// 允许使用空 schema 的页面（只读/无表单场景）
const ALLOWLIST = [
  // 格式: '文件路径:行号' 或 '文件路径'
  // 下面是需要例外放行的只读页面（useCrud 仅用于列表 + 删除，无 FormDialog 表单校验场景）
  'apps/web/src/pages/system/notifications/NotificationsPage.tsx',
  'apps/web/src/pages/system/operation-logs/LoginLogView.tsx',
  'apps/web/src/pages/system/operation-logs/OperationLogView.tsx',
  // approvals：审批列表为只读页面，详情走 ApprovalDetailDrawer（非 FormDialog），无表单需校验
  'apps/web/src/pages/approvals/ApprovalsPage.tsx',
  // 云账单：只读快照页（数据来自 cloud-cost-sync 同步），无新建/编辑
  'apps/web/src/pages/ops/cloud-cost/bills/CloudBillsPage.tsx',
  // 请假/日程：钉钉同步只读报表，无新建/编辑
  'apps/web/src/pages/reports/employee-leaves/EmployeeLeavesPage.tsx',
  'apps/web/src/pages/reports/calendar-events/CalendarEventsPage.tsx',
];

// ============ 只读页面目录模式 ============
const READONLY_DIR_PATTERNS = [/apps\/web\/src\/pages\/system\//];

// 检查结果
const errors = [];
const warnings = [];
let checkedFiles = 0;
let useCrudCalls = 0;
let emptySchemaCount = 0;

/**
 * 递归查找所有 .ts 和 .tsx 文件
 */
function findTsFiles(dir) {
  const files = [];

  if (!fs.existsSync(dir)) {
    return files;
  }

  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dir, item.name);

    if (item.isDirectory()) {
      files.push(...findTsFiles(fullPath));
    } else if (item.isFile() && (item.name.endsWith('.ts') || item.name.endsWith('.tsx'))) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * 解析 Typescript 文件获取 AST
 */
function parseFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf-8');
  return ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
}

/**
 * 获取节点所在行号
 */
function getLineNumber(sourceFile, node) {
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
  return line + 1; // 转换为 1-based
}

/**
 * 检查是否在白名单中
 */
function isInAllowlist(relativePath, line) {
  // 精确匹配：文件路径 + 行号
  if (ALLOWLIST.includes(`${relativePath}:${line}`)) return true;
  // 文件路径匹配
  if (ALLOWLIST.includes(relativePath)) return true;
  return false;
}

/**
 * 检查是否为只读页面目录
 */
function isReadonlyDir(relativePath) {
  return READONLY_DIR_PATTERNS.some((pattern) => pattern.test(relativePath));
}

/**
 * 检查 useCrud 调用是否包含 schema 属性，并检查其是否为空
 */
function checkSchemaProperty(node, sourceFile) {
  if (node.arguments.length === 0) {
    return { hasSchema: false, isEmpty: false };
  }

  const firstArg = node.arguments[0];

  if (!ts.isObjectLiteralExpression(firstArg)) {
    return { hasSchema: false, isEmpty: false };
  }

  for (const prop of firstArg.properties) {
    if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
      const propName = prop.name && ts.isIdentifier(prop.name) ? prop.name.text : null;
      if (propName === 'schema') {
        // 检查 schema 值是否为 z.object({})
        const schemaValue = prop.initializer;
        const isEmpty = isEmptyZodObject(schemaValue);
        return { hasSchema: true, isEmpty };
      }
    }
  }

  return { hasSchema: false, isEmpty: false };
}

/**
 * 剥离 as 断言 / 括号 / 非空(!) / satisfies 包装，取得底层表达式。
 */
function unwrapExpression(node) {
  while (
    node &&
    (ts.isAsExpression(node) ||
      ts.isParenthesizedExpression(node) ||
      ts.isNonNullExpression(node) ||
      (ts.isSatisfiesExpression && ts.isSatisfiesExpression(node)))
  ) {
    node = node.expression;
  }
  return node;
}

/**
 * 精确匹配 z.object({})（CallExpression，expression 为属性访问 z.object，参数为空对象字面量）。
 * 注意：z.object({}) 的 CallExpression.expression 是 PropertyAccessExpression(z.object)，
 * 不是 Identifier(z) —— 旧实现误用 ts.isIdentifier 判断导致永远返回 false（死代码）。
 */
function isEmptyZObjectCall(node) {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'z' &&
    node.expression.name.text === 'object' &&
    node.arguments.length === 1 &&
    ts.isObjectLiteralExpression(node.arguments[0]) &&
    node.arguments[0].properties.length === 0
  );
}

/**
 * 检查 Zod schema 是否实质为空对象（无任何字段校验）。
 * 覆盖：z.object({})、z.object({}).passthrough()/.partial()/.strict() 等链式，
 * 以及 (z.object({}) as z.ZodType<X>) 类型断言/括号包装。
 * 形变方法（.extend/.merge/.pick/.omit/.required）会改变字段集合，不视为空。
 */
function isEmptyZodObject(node) {
  node = unwrapExpression(node);
  if (!node) return false;

  // 直接形式：z.object({})
  if (isEmptyZObjectCall(node)) return true;

  // 链式形式：z.object({}).passthrough()/.partial()/... → 递归到接收者
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const SHAPE_CHANGING = new Set([
      'extend',
      'merge',
      'and',
      'pick',
      'omit',
      'required',
      'augment',
    ]);
    if (!SHAPE_CHANGING.has(node.expression.name.text)) {
      return isEmptyZodObject(node.expression.expression);
    }
  }

  return false;
}

/**
 * 检查单行注释是否表明是只读页面
 */
function hasReadonlyComment(sourceFile, line) {
  // 获取当前行之前的内容
  const lines = sourceFile.getFullText().split('\n');
  const currentLine = line - 1; // 0-based

  // 检查当前行和前几行是否有只读注释
  for (let i = Math.max(0, currentLine - 3); i <= currentLine; i++) {
    const lineText = lines[i] || '';
    if (
      lineText.includes('// read-only') ||
      lineText.includes('// 只读') ||
      lineText.includes('// readonly')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * 检查单个文件中的 useCrud 调用
 */
function checkFile(filePath) {
  const sourceFile = parseFile(filePath);
  if (!sourceFile) return [];

  const relativePath = path.relative(process.cwd(), filePath);
  const fileErrors = [];

  function visit(node) {
    if (ts.isCallExpression(node)) {
      let funcName = null;

      if (ts.isIdentifier(node.expression)) {
        funcName = node.expression.text;
      }

      if (funcName === 'useCrud') {
        useCrudCalls++;
        const lineNumber = getLineNumber(sourceFile, node);

        const schemaCheck = checkSchemaProperty(node, sourceFile);

        if (!schemaCheck.hasSchema) {
          fileErrors.push({
            line: lineNumber,
            type: 'error',
            message: `useCrud 调用缺少 schema 参数`,
          });
        } else if (schemaCheck.isEmpty) {
          emptySchemaCount++;

          // 检查是否在白名单中
          if (isInAllowlist(relativePath, lineNumber)) {
            // 白名单内的不报错
            return;
          }

          // 检查是否为只读页面目录
          if (isReadonlyDir(relativePath) && hasReadonlyComment(sourceFile, lineNumber)) {
            // 只读页面带注释的不报错
            return;
          }

          fileErrors.push({
            line: lineNumber,
            type: 'error',
            message: `useCrud 使用了空 schema (z.object({}))，需要传入有效的校验规则`,
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return fileErrors.length > 0 ? { filePath: relativePath, errors: fileErrors } : null;
}

/**
 * 主函数
 */
function main() {
  console.log('正在检查 useCrud schema 参数...\n');

  const tsFiles = findTsFiles(PAGES_DIR);

  if (tsFiles.length === 0) {
    console.log('未找到 TypeScript 文件');
    process.exit(0);
  }

  for (const file of tsFiles) {
    checkedFiles++;
    const result = checkFile(file);

    if (result) {
      errors.push(result);
    }
  }

  console.log(`已检查 ${checkedFiles} 个文件，发现 ${useCrudCalls} 个 useCrud 调用`);
  if (emptySchemaCount > 0) {
    console.log(`发现 ${emptySchemaCount} 个空 schema 调用\n`);
  } else {
    console.log('');
  }

  if (errors.length > 0) {
    console.log('错误（必须修复）:');
    console.log('================');
    for (const { filePath, errors: fileErrors } of errors) {
      console.log(`\n  ${filePath}:`);
      for (const err of fileErrors) {
        console.log(`    - 第 ${err.line} 行: ${err.message}`);
      }
    }
    console.log('');
    console.log(`发现 ${errors.length} 个文件存在问题，请修复后再提交。`);
    console.log('');
    console.log('修复建议:');
    console.log('  1. 从 @ky-azeroth/shared/schemas 导入对应的 schema');
    console.log('  2. 使用 shared schema.extend() 扩展业务字段');
    console.log('  3. 如果是只读页面，请在白名单中登记或添加 // 只读 注释');
    process.exit(1);
  }

  console.log('useCrud schema 检查通过！');
  if (emptySchemaCount > 0) {
    console.log(`（注：${emptySchemaCount} 个空 schema 调用已在白名单/只读页面子集中放行）`);
  }
  process.exit(0);
}

main();
