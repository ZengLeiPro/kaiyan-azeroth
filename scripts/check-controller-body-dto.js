#!/usr/bin/env node
/**
 * Controller Body DTO 规范检查脚本
 *
 * 目标：
 * - 禁止 @Body('field') 字段级 Body（必须使用 @Body() Dto）
 * - 禁止 @Body() XxxDto[] / string[] / string 等数组/原始类型 Body（必须使用 BatchXxxDto 包装 items）
 * - 要求 @Body() 参数显式标注 *Dto 类型（保证 runtime metatype 为 class，进入全局 Pipe）
 *
 * 使用方式：node scripts/check-controller-body-dto.js
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const MODULES_DIR = path.join(__dirname, '../apps/server/src/modules');

// ============ Allowlist 配置 ============
// 允许保留非 DTO/字段级 Body 的方法（极少数例外）
// 格式：'文件名:方法名' 或 '相对路径:方法名' 或仅 '方法名'
const ALLOWLIST = [];

const errors = [];
let checkedFiles = 0;
let checkedMethods = 0;
let checkedBodyParams = 0;

function parseFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf-8');
  return ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
}

function getLineNumber(sourceFile, node) {
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return line + 1;
}

function findControllerFiles(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      files.push(...findControllerFiles(fullPath));
    } else if (item.isFile() && item.name.endsWith('.controller.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

function getDecorators(node) {
  if (!ts.canHaveDecorators(node)) return [];
  return ts.getDecorators(node) || [];
}

function getDecoratorCallName(decorator, sourceFile) {
  // @Body() / @Body('ids')
  const expr = decorator.expression;
  if (ts.isCallExpression(expr)) {
    if (ts.isIdentifier(expr.expression)) return expr.expression.text;
    return expr.expression.getText(sourceFile);
  }
  if (ts.isIdentifier(expr)) return expr.text;
  return expr.getText(sourceFile);
}

function getBodyDecoratorArgInfo(decorator) {
  const expr = decorator.expression;
  if (!ts.isCallExpression(expr)) return { kind: 'object' }; // @Body
  if (expr.arguments.length === 0) return { kind: 'object' }; // @Body()
  const firstArg = expr.arguments[0];
  if (ts.isStringLiteral(firstArg)) return { kind: 'field', name: firstArg.text };
  return { kind: 'unknown' };
}

function isInAllowlist(filePath, methodName) {
  const fileName = path.basename(filePath);
  const relativePath = path.relative(process.cwd(), filePath);
  if (ALLOWLIST.includes(`${relativePath}:${methodName}`)) return true;
  if (ALLOWLIST.includes(`${fileName}:${methodName}`)) return true;
  if (ALLOWLIST.includes(methodName)) return true;
  return false;
}

function isArrayTypeNode(typeNode, sourceFile) {
  if (!typeNode) return false;
  if (ts.isArrayTypeNode(typeNode)) return true; // T[]
  if (
    ts.isTypeReferenceNode(typeNode) &&
    typeNode.typeName &&
    typeNode.typeName.getText(sourceFile) === 'Array' &&
    Array.isArray(typeNode.typeArguments) &&
    typeNode.typeArguments.length === 1
  ) {
    return true; // Array<T>
  }
  return false;
}

function isPrimitiveTypeNode(typeNode) {
  if (!typeNode) return false;
  if (ts.isUnionTypeNode(typeNode) || ts.isIntersectionTypeNode(typeNode)) return true;
  return (
    typeNode.kind === ts.SyntaxKind.StringKeyword ||
    typeNode.kind === ts.SyntaxKind.NumberKeyword ||
    typeNode.kind === ts.SyntaxKind.BooleanKeyword ||
    typeNode.kind === ts.SyntaxKind.AnyKeyword ||
    typeNode.kind === ts.SyntaxKind.UnknownKeyword ||
    typeNode.kind === ts.SyntaxKind.ObjectKeyword ||
    typeNode.kind === ts.SyntaxKind.NullKeyword ||
    typeNode.kind === ts.SyntaxKind.UndefinedKeyword
  );
}

function isLikelyDtoType(typeNode, sourceFile) {
  if (!typeNode) return false;
  if (!ts.isTypeReferenceNode(typeNode)) return false;

  // 禁止泛型包装：Pick<Dto,...> / Partial<Dto> 等（这些不是 class metatype）
  if (Array.isArray(typeNode.typeArguments) && typeNode.typeArguments.length > 0) return false;

  const typeText = typeNode.getText(sourceFile).trim();
  return /Dto$/.test(typeText);
}

function checkControllerFile(filePath) {
  const sourceFile = parseFile(filePath);
  if (!sourceFile) return;

  const relativePath = path.relative(process.cwd(), filePath);

  function visit(node) {
    if (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
      const methodName = node.name.text;
      checkedMethods++;

      if (isInAllowlist(filePath, methodName)) {
        return;
      }

      for (const param of node.parameters) {
        const pDecs = getDecorators(param);
        for (const d of pDecs) {
          const decName = getDecoratorCallName(d, sourceFile);
          if (decName !== 'Body') continue;

          checkedBodyParams++;

          const line = getLineNumber(sourceFile, node);
          const argInfo = getBodyDecoratorArgInfo(d);

          if (argInfo.kind === 'field') {
            errors.push({
              file: relativePath,
              line,
              message: `方法 ${methodName}() 使用了 @Body('${argInfo.name}') 字段级 Body，必须改为 @Body() Dto`,
            });
            continue;
          }

          if (!param.type) {
            errors.push({
              file: relativePath,
              line,
              message: `方法 ${methodName}() 的 @Body() 参数必须显式标注 *Dto 类型（禁止省略类型）`,
            });
            continue;
          }

          if (isArrayTypeNode(param.type, sourceFile)) {
            errors.push({
              file: relativePath,
              line,
              message: `方法 ${methodName}() 使用了数组 Body（${param.type.getText(
                sourceFile
              )}），必须改为 BatchXxxDto（形如 { items: XxxDto[] }）`,
            });
            continue;
          }

          if (isPrimitiveTypeNode(param.type)) {
            errors.push({
              file: relativePath,
              line,
              message: `方法 ${methodName}() 的 @Body() 参数类型为原始类型/联合类型（${param.type.getText(
                sourceFile
              )}），必须使用 *Dto`,
            });
            continue;
          }

          if (!isLikelyDtoType(param.type, sourceFile)) {
            errors.push({
              file: relativePath,
              line,
              message: `方法 ${methodName}() 的 @Body() 参数类型疑似不是 DTO（${param.type.getText(
                sourceFile
              )}），必须使用 *Dto`,
            });
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  checkedFiles++;
}

function main() {
  console.log('检查 Controller Body DTO 规范...\n');

  const controllerFiles = findControllerFiles(MODULES_DIR);
  if (controllerFiles.length === 0) {
    console.log('未找到 controller 文件');
    process.exit(0);
  }

  for (const file of controllerFiles) {
    checkControllerFile(file);
  }

  console.log(
    `已检查 ${checkedFiles} 个 controller 文件，扫描 ${checkedMethods} 个方法，命中 ${checkedBodyParams} 个 @Body 参数\n`
  );

  if (errors.length > 0) {
    const separator = '='.repeat(50);
    console.log('错误（必须修复）:');
    console.log(separator);
    for (const e of errors) {
      console.log(`  ${e.file}:${e.line}`);
      console.log(`    ${e.message}`);
    }
    console.log('');
    console.log(`检查失败：发现 ${errors.length} 处问题。`);
    console.log('');
    console.log('修复建议：');
    console.log("  1. 使用 @Body() XxxDto 替代 @Body('field') 字段级 Body");
    console.log('  2. 数组 Body 必须使用 BatchXxxDto 包装');
    console.log('  3. @Body() 参数必须显式标注 *Dto 类型');
    process.exit(1);
  }

  console.log('Controller Body DTO 规范检查通过！');
  process.exit(0);
}

main();
