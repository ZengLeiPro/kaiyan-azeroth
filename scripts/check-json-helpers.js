#!/usr/bin/env node
/**
 * Prisma JSON 字段写入规范检查脚本
 *
 * 规则（rules.md MUST #5）：
 * - 写入 Prisma JSON 字段必须使用 apps/server/src/common/utils/json-type-helpers.ts 的封装函数
 * - 禁止在业务代码中直接通过 cast 写入 Prisma JSON（例如 as Prisma.JsonObject / as Prisma.InputJsonValue）
 *
 * 当前仓库 helper：
 * - toJsonValue
 * - toJsonAttachments
 *
 * 检查范围：
 * - 解析 apps/server/prisma/schema.prisma，提取所有 Json 字段（model.field）
 * - 扫描 apps/server/src/ 下所有 *.service.ts 内 prisma 写入（create/update/upsert/updateMany/createMany）
 * - 仅分析 data: { ... } 为对象字面量的场景（启发式）
 *
 * 输出：
 * - errors：阻断提交/CI（exit 1）
 * - warnings：不阻断（exit 0）
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const PRISMA_SCHEMA_PATH = path.join(__dirname, '../apps/server/prisma/schema.prisma');
const SERVER_SRC_DIR = path.join(__dirname, '../apps/server/src');

const ALLOWED_HELPERS = new Set(['toJsonValue', 'toJsonAttachments']);
const PRISMA_NULL_LITERALS = new Set(['JsonNull', 'DbNull', 'AnyNull']);

const WRITE_METHODS = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert']);

const errors = [];
const warnings = [];
let checkedFiles = 0;
let checkedWrites = 0;

function parseFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf-8');
  return ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
}

function getLineNumber(sourceFile, node) {
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return line + 1;
}

function findServiceFiles(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      files.push(...findServiceFiles(fullPath));
    } else if (item.isFile() && item.name.endsWith('.service.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

function lowerFirst(s) {
  return s.length === 0 ? s : s.charAt(0).toLowerCase() + s.slice(1);
}

function extractJsonFieldsFromPrismaSchema(schemaPath) {
  const delegateToFields = new Map(); // delegateName -> Set<field>

  if (!fs.existsSync(schemaPath)) return delegateToFields;
  const lines = fs.readFileSync(schemaPath, 'utf-8').split('\n');

  let currentModel = null;

  for (const line of lines) {
    const modelMatch = line.match(/^model\s+(\w+)\s*\{/);
    if (modelMatch) {
      currentModel = modelMatch[1];
      continue;
    }

    if (currentModel && line.match(/^\s*}\s*$/)) {
      currentModel = null;
      continue;
    }

    if (!currentModel) continue;

    // fieldName Json / fieldName Json? / fieldName Json @...
    const jsonMatch = line.match(/^\s*(\w+)\s+Json(\?|\s|@|$)/);
    if (jsonMatch) {
      const fieldName = jsonMatch[1];
      const delegateName = lowerFirst(currentModel);
      if (!delegateToFields.has(delegateName)) delegateToFields.set(delegateName, new Set());
      delegateToFields.get(delegateName).add(fieldName);
    }
  }

  return delegateToFields;
}

function getPropertyNameText(nameNode) {
  if (ts.isIdentifier(nameNode)) return nameNode.text;
  if (ts.isStringLiteral(nameNode)) return nameNode.text;
  return null;
}

function getObjectLiteralProperty(obj, propName) {
  for (const p of obj.properties) {
    if (!ts.isPropertyAssignment(p)) continue;
    const name = getPropertyNameText(p.name);
    if (name === propName) return p;
  }
  return null;
}

function isPrismaNullLiteral(expr) {
  // Prisma.JsonNull / Prisma.DbNull / Prisma.AnyNull
  if (!ts.isPropertyAccessExpression(expr)) return false;
  if (!ts.isIdentifier(expr.expression) || expr.expression.text !== 'Prisma') return false;
  return PRISMA_NULL_LITERALS.has(expr.name.text);
}

function isAllowedJsonInitializer(expr) {
  // 去掉括号包装
  if (ts.isParenthesizedExpression(expr)) {
    return isAllowedJsonInitializer(expr.expression);
  }

  // helper 调用
  if (ts.isCallExpression(expr)) {
    const callee = expr.expression;
    if (ts.isIdentifier(callee) && ALLOWED_HELPERS.has(callee.text)) return true;
    return false;
  }

  // Prisma.JsonNull / Prisma.DbNull / Prisma.AnyNull（允许）
  if (isPrismaNullLiteral(expr)) return true;

  // 允许 undefined / null 直接出现（用于三元/合并表达式中）
  if (expr.kind === ts.SyntaxKind.UndefinedKeyword || expr.kind === ts.SyntaxKind.NullKeyword)
    return true;
  // TypeScript AST 中 undefined 是 Identifier 而非 UndefinedKeyword
  if (ts.isIdentifier(expr) && expr.text === 'undefined') return true;

  // 允许 (helper(...) ?? Prisma.JsonNull) / (cond ? helper(...) : undefined) 等组合
  if (ts.isConditionalExpression(expr)) {
    return isAllowedJsonInitializer(expr.whenTrue) && isAllowedJsonInitializer(expr.whenFalse);
  }

  if (ts.isBinaryExpression(expr)) {
    const op = expr.operatorToken.kind;
    // ?? 或 ||
    if (op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken) {
      return isAllowedJsonInitializer(expr.left) && isAllowedJsonInitializer(expr.right);
    }
  }

  return false;
}

function detectCastWarning(expr) {
  // (x as Prisma.JsonObject) / (x as Prisma.InputJsonValue)
  if (ts.isAsExpression(expr) || ts.isTypeAssertionExpression(expr)) {
    const typeNode = expr.type;
    const typeText = typeNode.getText();
    if (typeText.includes('Prisma.Json') || typeText.includes('Prisma.InputJson')) {
      return typeText;
    }
  }
  // 在 ?? / ?: 中递归查找
  if (ts.isConditionalExpression(expr)) {
    return detectCastWarning(expr.whenTrue) || detectCastWarning(expr.whenFalse);
  }
  if (ts.isBinaryExpression(expr)) {
    return detectCastWarning(expr.left) || detectCastWarning(expr.right);
  }
  return null;
}

function getPrismaWriteCallInfo(callExpr) {
  // 形如 this.prisma.store.create({ ... })
  // callExpr.expression 是 PropertyAccessExpression：(...).create
  const expr = callExpr.expression;
  if (!ts.isPropertyAccessExpression(expr)) return null;

  const methodName = expr.name.text;
  if (!WRITE_METHODS.has(methodName)) return null;

  const delegateExpr = expr.expression;
  if (!ts.isPropertyAccessExpression(delegateExpr)) return null;

  const delegateName = delegateExpr.name.text;
  return { delegateName, methodName };
}

function checkServiceFile(filePath, delegateToFields) {
  const sourceFile = parseFile(filePath);
  if (!sourceFile) return;

  const relativePath = path.relative(process.cwd(), filePath);

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const info = getPrismaWriteCallInfo(node);
      if (info && delegateToFields.has(info.delegateName)) {
        checkedWrites++;
        const jsonFields = delegateToFields.get(info.delegateName);

        // 只处理第一个参数是对象字面量的情况
        if (node.arguments.length > 0 && ts.isObjectLiteralExpression(node.arguments[0])) {
          const arg0 = node.arguments[0];
          const dataProp = getObjectLiteralProperty(arg0, 'data');
          if (dataProp && ts.isObjectLiteralExpression(dataProp.initializer)) {
            const dataObj = dataProp.initializer;

            for (const p of dataObj.properties) {
              if (!ts.isPropertyAssignment(p)) continue;
              const fieldName = getPropertyNameText(p.name);
              if (!fieldName) continue;
              if (!jsonFields.has(fieldName)) continue;

              const castType = detectCastWarning(p.initializer);
              if (castType) {
                warnings.push({
                  file: relativePath,
                  line: getLineNumber(sourceFile, p),
                  message: `JSON 字段 '${info.delegateName}.${fieldName}' 使用了类型断言（${castType}），建议改为 json-type-helpers.ts 的封装函数`,
                });
              }

              if (!isAllowedJsonInitializer(p.initializer)) {
                errors.push({
                  file: relativePath,
                  line: getLineNumber(sourceFile, p),
                  message: `JSON 字段 '${info.delegateName}.${fieldName}' 写入未使用封装函数（允许：toJsonValue/toJsonAttachments 或 Prisma.JsonNull），请改为 json-type-helpers.ts`,
                });
              }
            }
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
  console.log('检查 Prisma JSON 字段写入是否使用封装函数...\n');

  const delegateToFields = extractJsonFieldsFromPrismaSchema(PRISMA_SCHEMA_PATH);
  const jsonFieldCount = Array.from(delegateToFields.values()).reduce((acc, s) => acc + s.size, 0);
  console.log(
    `已识别 ${jsonFieldCount} 个 JSON 字段（按 delegate 汇总：${delegateToFields.size} 个）\n`
  );

  const serviceFiles = findServiceFiles(SERVER_SRC_DIR);
  if (serviceFiles.length === 0) {
    console.log('未找到 service 文件');
    process.exit(0);
  }

  for (const f of serviceFiles) {
    checkServiceFile(f, delegateToFields);
  }

  console.log(
    `已检查 ${checkedFiles} 个 service 文件，扫描到 ${checkedWrites} 个 prisma 写入调用\n`
  );

  if (errors.length > 0) {
    console.log('错误（必须修复）:');
    console.log('================');
    for (const e of errors) {
      console.log(`  ${e.file}:${e.line}`);
      console.log(`    - ${e.message}`);
    }
    console.log('');
  }

  if (warnings.length > 0) {
    console.log('警告（建议修复）:');
    console.log('================');
    for (const w of warnings) {
      console.log(`  ${w.file}:${w.line}`);
      console.log(`    - ${w.message}`);
    }
    console.log('');
  }

  if (errors.length > 0) {
    console.error(`检查失败：发现 ${errors.length} 个错误。`);
    process.exit(1);
  }

  console.log('JSON 字段写入检查通过！');
  process.exit(0);
}

main();
