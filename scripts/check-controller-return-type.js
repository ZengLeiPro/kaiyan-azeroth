#!/usr/bin/env node
/**
 * 控制器返回类型检查脚本
 *
 * 检查 NestJS Controller 方法是否显式声明精确的返回类型。
 *
 * 规则：
 * 1. 所有带 @Get/@Post/@Put/@Delete/@Patch 装饰器的方法必须有返回类型注解
 * 2. 返回类型应为 Promise<XxxDto> 或 XxxDto（具体类型）
 * 3. 禁止返回 Promise<any> 或无类型声明
 * 4. 禁止使用宽泛类型：unknown、object、Record<string, unknown>、Record<string, any>
 *
 * 允许的类型：
 * - 具体 DTO 类型：Promise<CustomerResponseDto>
 * - 具体结构类型：Promise<{ id: string }>、Promise<{ data: CustomerResponseDto[]; total: number }>
 * - void：Promise<void>、void
 *
 * 使用方式：node scripts/check-controller-return-type.js
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const SERVER_MODULES_DIR = path.join(__dirname, '../apps/server/src/modules');

// 是否严格模式：环境变量 STRICT=1 时阻断
const STRICT = process.env.STRICT === '1';

// ============ Allowlist 配置 ============
// 允许使用宽泛返回类型的场景（格式：'相对文件路径:ClassName.methodName'）
// 例如：'apps/server/src/modules/upload/upload.controller.ts:UploadController.proxyDownload'
const ALLOWLIST = [
  // getStats 根据 groupBy 参数返回不同类型的统计结果，无法用单一返回类型表达
  'apps/server/src/modules/effort-records/effort-records.controller.ts:EffortRecordsController.getStats',
  // linkSaleOrder 返回 serializeEntity() 结果（内部含 join 数据），类型由 service 层控制
  'apps/server/src/modules/projects/projects.controller.ts:ProjectsController.linkSaleOrder',
];

const errors = [];
let checkedFiles = 0;

/**
 * 获取节点装饰器（兼容 TypeScript 4.x 和 5.x）
 * TS 5.x 中 node.decorators 始终为 undefined，需使用 ts.getDecorators()
 */
function getDecorators(node) {
  if (ts.canHaveDecorators && ts.getDecorators) {
    if (!ts.canHaveDecorators(node)) return [];
    return ts.getDecorators(node) || [];
  }
  // TS 4.x fallback
  return node.decorators || [];
}

/**
 * 检查是否在白名单中
 */
function isInAllowlist(filePath, className, methodName) {
  const relativePath = path.relative(process.cwd(), filePath);
  const key = `${relativePath}:${className}.${methodName}`;
  return ALLOWLIST.includes(key);
}

/**
 * 解析 TypeScript 文件
 */
function parseFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf-8');
  return ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
}

/**
 * 检查是否是 HTTP 装饰器
 */
function isHttpDecorator(decorator) {
  const httpMethods = ['Get', 'Post', 'Put', 'Delete', 'Patch'];
  const expr = decorator.expression;

  if (ts.isCallExpression(expr)) {
    const decoratorName = expr.expression.getText();
    return httpMethods.includes(decoratorName);
  }

  if (ts.isIdentifier(expr)) {
    return httpMethods.includes(expr.text);
  }

  return false;
}

/**
 * 宽泛类型检测规则
 *
 * 递归遍历类型节点树，检测是否包含宽泛类型关键字。
 * - unknown：如 Promise<unknown>、{ data: unknown[] }
 * - object：如 Promise<object>、Promise<object[]>
 * - Record<string, unknown> / Record<string, any>
 * - any：如 Promise<any>（保留原有检测）
 */
const VAGUE_TYPE_PATTERNS = [
  {
    // unknown 关键字（匹配 TypeScript AST 中的 SyntaxKind.UnknownKeyword）
    test: (node) => node.kind === ts.SyntaxKind.UnknownKeyword,
    message: (returnTypeText) => `返回类型包含 'unknown': ${returnTypeText}`,
  },
  {
    // object 关键字（匹配 TypeScript AST 中的 SyntaxKind.ObjectKeyword）
    test: (node) => node.kind === ts.SyntaxKind.ObjectKeyword,
    message: (returnTypeText) => `返回类型包含 'object': ${returnTypeText}`,
  },
  {
    // any 关键字（匹配 TypeScript AST 中的 SyntaxKind.AnyKeyword）
    test: (node) => node.kind === ts.SyntaxKind.AnyKeyword,
    message: (returnTypeText) => `返回类型包含 'any': ${returnTypeText}`,
  },
  {
    // Record<string, unknown> 或 Record<string, any>
    test: (node) => {
      if (!ts.isTypeReferenceNode(node)) return false;
      const typeName = node.typeName.getText();
      if (typeName !== 'Record') return false;
      const typeArgs = node.typeArguments;
      if (!typeArgs || typeArgs.length !== 2) return false;
      const secondArg = typeArgs[1];
      return (
        secondArg.kind === ts.SyntaxKind.UnknownKeyword ||
        secondArg.kind === ts.SyntaxKind.AnyKeyword
      );
    },
    message: (returnTypeText) => `返回类型包含宽泛 Record 类型: ${returnTypeText}`,
  },
];

/**
 * 递归遍历类型节点，检测宽泛类型
 * 返回第一个匹配的错误消息，或 null
 */
function findVagueType(typeNode, returnTypeText) {
  // 先用专用规则检测 Record<string, unknown/any>（优先于通用关键字检测）
  const recordPattern = VAGUE_TYPE_PATTERNS[3];
  if (recordPattern.test(typeNode)) {
    return recordPattern.message(returnTypeText);
  }

  // 再检测基础关键字（unknown / object / any）
  for (let i = 0; i < 3; i++) {
    const pattern = VAGUE_TYPE_PATTERNS[i];
    if (pattern.test(typeNode)) {
      // 对于 Record<string, unknown> 的内部 unknown，已在上层 Record 检测中处理
      // 这里跳过 TypeReferenceNode 子节点中的关键字，避免重复报错
      return pattern.message(returnTypeText);
    }
  }

  // 递归检查子节点（forEachChild 返回非 undefined 值时短路）
  const found = ts.forEachChild(typeNode, (child) => {
    return findVagueType(child, returnTypeText) || undefined;
  });

  return found || null;
}

/**
 * 检查方法返回类型
 */
function checkMethodReturnType(method, className, filePath) {
  // 检查是否有 HTTP 装饰器
  const methodDecorators = getDecorators(method);
  if (methodDecorators.length === 0) return;

  const hasHttpDecorator = methodDecorators.some((dec) => isHttpDecorator(dec));
  if (!hasHttpDecorator) return;

  const methodName = method.name.getText();

  // 检查白名单
  if (isInAllowlist(filePath, className, methodName)) return;

  // 检查是否有返回类型注解
  if (!method.type) {
    errors.push({
      file: path.relative(process.cwd(), filePath),
      class: className,
      method: methodName,
      issue: '缺少返回类型注解',
    });
    return;
  }

  // 获取返回类型文本
  const returnTypeText = method.type.getText();

  // 递归检测宽泛类型
  const vagueMessage = findVagueType(method.type, returnTypeText);
  if (vagueMessage) {
    errors.push({
      file: path.relative(process.cwd(), filePath),
      class: className,
      method: methodName,
      issue: vagueMessage,
    });
  }
}

/**
 * 扫描 Controller 文件
 */
function scanControllerFile(filePath) {
  const sourceFile = parseFile(filePath);
  if (!sourceFile) return;

  checkedFiles++;

  function visitNode(node) {
    // 查找 @Controller() 装饰的类
    if (ts.isClassDeclaration(node)) {
      const classDecorators = getDecorators(node);
      const hasControllerDecorator = classDecorators.some((dec) => {
        const expr = dec.expression;
        if (ts.isCallExpression(expr)) {
          return expr.expression.getText() === 'Controller';
        }
        return false;
      });

      if (hasControllerDecorator && node.name) {
        const className = node.name.text;

        // 检查类中的所有方法
        node.members.forEach((member) => {
          if (ts.isMethodDeclaration(member)) {
            checkMethodReturnType(member, className, filePath);
          }
        });
      }
    }

    ts.forEachChild(node, visitNode);
  }

  visitNode(sourceFile);
}

/**
 * 递归扫描目录
 */
function scanDirectory(dir) {
  if (!fs.existsSync(dir)) return;
  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      scanDirectory(fullPath);
    } else if (item.isFile() && item.name.endsWith('.controller.ts')) {
      scanControllerFile(fullPath);
    }
  }
}

/**
 * 主函数
 */
function main() {
  console.log('正在检查 Controller 返回类型...\n');

  scanDirectory(SERVER_MODULES_DIR);

  console.log(`已检查 ${checkedFiles} 个 Controller 文件\n`);

  if (errors.length > 0) {
    const separator = '='.repeat(50);
    console.log('错误（必须修复）:');
    console.log(separator);
    errors.forEach(({ file, class: cls, method, issue }) => {
      console.log(`  ${file}`);
      console.log(`    ${cls}.${method}(): ${issue}`);
    });
    console.log('');
    console.log(`检查失败：发现 ${errors.length} 处问题。`);
    console.log('');
    console.log('修复建议：');
    console.log('  1. 为 Controller 方法添加明确的返回类型注解');
    console.log('     示例：async findOne(@Param("id") id: string): Promise<CustomerResponseDto>');
    console.log('  2. 禁止使用宽泛类型（unknown / object / Record<string, unknown> / any）');
    console.log('     替换为具体的 DTO 类型或精确的结构类型');
    console.log('  3. 列表接口推荐：Promise<{ data: XxxResponseDto[]; meta: PaginationMeta }>');
    console.log(
      '  4. 如需添加到白名单，在 scripts/check-controller-return-type.js 的 ALLOWLIST 中添加'
    );

    // STRICT 模式或 CI 环境下阻断
    if (STRICT) {
      process.exit(1);
    } else {
      console.log('\n  提示：使用 STRICT=1 环境变量可开启严格模式。');
    }
  } else {
    console.log('Controller 返回类型检查通过！');
  }
}

main();
