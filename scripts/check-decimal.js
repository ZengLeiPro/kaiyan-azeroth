#!/usr/bin/env node
/**
 * Decimal 精度字段转换检查脚本
 *
 * 检查前端提交和读取数据时是否正确处理 Decimal 字段：
 * 1. 扫描 shared 包识别 DecimalNumber 类型的字段
 * 2. 检查前端 types.ts 中的 toXxxPayload 函数 - 验证 String() 转换
 * 3. 检查前端 types.ts 中的 toXxxProfile/toXxxFormData 函数 - 验证 Number() 转换
 *
 * 使用方式：node scripts/check-decimal.js
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const SHARED_TYPES_DIR = path.join(__dirname, '../packages/shared/src/types');
const WEB_SRC_DIR = path.join(__dirname, '../apps/web/src/pages');

// 收集所有被定义为 DecimalNumber 的字段名
const decimalFieldNames = new Set();

// 按类型名称索引的 Decimal 字段（用于精确匹配）
const decimalFieldsByType = new Map();

// 忽略的字段 (即使是 DecimalNumber 也不强制转换的特例，如果有)
const IGNORED_FIELDS = new Set([]);

/**
 * 检查源码中某个 AST 节点所在行是否包含 @decimal-ignore 注释
 * 用于标注误报：字段名虽然与某个 Decimal 字段同名，但在当前上下文中实际不是 Decimal 类型
 */
function hasDecimalIgnoreComment(sourceFile, node) {
  const text = sourceFile.getFullText();
  const pos = node.getStart(sourceFile);
  const end = node.getEnd();
  // 查找该节点所在行的末尾（包括尾部注释）
  const lineEnd = text.indexOf('\n', end);
  const lineText = text.substring(pos, lineEnd === -1 ? text.length : lineEnd);
  return lineText.includes('@decimal-ignore');
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
 * 阶段 1: 扫描 Shared Types 收集 Decimal 字段
 */
function collectDecimalFields() {
  console.log('正在扫描 Shared Types 识别 Decimal 字段...');

  function scanDir(dir) {
    if (!fs.existsSync(dir)) return;
    const items = fs.readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        scanDir(fullPath);
      } else if (item.isFile() && item.name.endsWith('.ts')) {
        extractDecimalFields(fullPath);
      }
    }
  }

  function extractDecimalFields(filePath) {
    const sourceFile = parseFile(filePath);
    if (!sourceFile) return;

    function visit(node) {
      if (ts.isPropertySignature(node) && node.type) {
        // 检查类型是否为 DecimalNumber
        // 1. 直接引用: quantity: DecimalNumber
        // 2. 联合类型: quantity?: DecimalNumber | null
        if (isDecimalType(node.type)) {
          if (ts.isIdentifier(node.name)) {
            const fieldName = node.name.text;
            decimalFieldNames.add(fieldName);
          }
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  scanDir(SHARED_TYPES_DIR);
  console.log(
    `已识别 ${decimalFieldNames.size} 个 Decimal 字段名称:`,
    Array.from(decimalFieldNames).join(', '),
    '\n'
  );
}

function isDecimalType(typeNode) {
  if (ts.isTypeReferenceNode(typeNode)) {
    return typeNode.typeName.getText() === 'DecimalNumber';
  }
  if (ts.isUnionTypeNode(typeNode)) {
    return typeNode.types.some((t) => isDecimalType(t));
  }
  return false;
}

/**
 * 阶段 2: 检查前端 Payload 转换
 */
function checkFrontendConversions() {
  console.log('正在检查前端 Payload 转换...');
  let errorCount = 0;
  let warningCount = 0;
  const warnings = [];

  function scanDir(dir) {
    if (!fs.existsSync(dir)) return;
    const items = fs.readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        scanDir(fullPath);
      } else if (item.isFile() && item.name === 'types.ts') {
        checkFile(fullPath);
      }
    }
  }

  function checkFile(filePath) {
    const sourceFile = parseFile(filePath);
    if (!sourceFile) return;
    const relativePath = path.relative(process.cwd(), filePath);

    function visit(node) {
      // 寻找 export function toXxxPayload(...)
      if (
        ts.isFunctionDeclaration(node) &&
        node.name &&
        node.name.text.startsWith('to') &&
        node.name.text.endsWith('Payload')
      ) {
        checkPayloadFunction(node, relativePath, sourceFile);
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  function checkPayloadFunction(node, filePath, sourceFile) {
    // 寻找返回的对象字面量（支持直接返回和间接返回）
    let returnObject = null;
    let returnIdentifier = null;

    function findReturn(n) {
      if (ts.isReturnStatement(n) && n.expression) {
        if (ts.isObjectLiteralExpression(n.expression)) {
          returnObject = n.expression;
        } else if (ts.isIdentifier(n.expression)) {
          // 间接返回: const payload = { ... }; return payload;
          returnIdentifier = n.expression.text;
        }
      }
      // 不递归进嵌套函数/箭头函数（避免误匹配 .map() 等回调中的 return）
      if (!ts.isFunctionDeclaration(n) && !ts.isArrowFunction(n) && !ts.isFunctionExpression(n)) {
        ts.forEachChild(n, findReturn);
      }
    }

    if (node.body) {
      findReturn(node.body);
    }

    // 间接返回：查找变量声明中的对象字面量
    if (!returnObject && returnIdentifier && node.body) {
      function findVarDecl(n) {
        if (ts.isVariableStatement(n)) {
          for (const decl of n.declarationList.declarations) {
            if (
              ts.isIdentifier(decl.name) &&
              decl.name.text === returnIdentifier &&
              decl.initializer
            ) {
              // 直接对象字面量: const payload = { ... }
              if (ts.isObjectLiteralExpression(decl.initializer)) {
                returnObject = decl.initializer;
              }
              // 类型断言: const payload = { ... } as ICreateXxx
              if (
                ts.isAsExpression(decl.initializer) &&
                ts.isObjectLiteralExpression(decl.initializer.expression)
              ) {
                returnObject = decl.initializer.expression;
              }
            }
          }
        }
        // 递归进嵌套块（if/else/for）但不进嵌套函数
        if (!ts.isFunctionDeclaration(n) && !ts.isArrowFunction(n) && !ts.isFunctionExpression(n)) {
          ts.forEachChild(n, findVarDecl);
        }
      }
      ts.forEachChild(node.body, findVarDecl);
    }

    if (!returnObject) return;

    returnObject.properties.forEach((prop) => {
      if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
        const fieldName = prop.name.text;

        // 如果是已知的 Decimal 字段
        if (decimalFieldNames.has(fieldName) && !IGNORED_FIELDS.has(fieldName)) {
          // 跳过带有 @decimal-ignore 注释的字段（用于标注误报：同名但非 Decimal 的字段）
          if (hasDecimalIgnoreComment(sourceFile, prop)) {
            return;
          }
          // 检查赋值表达式是否使用了 String() 转换
          if (!hasStringConversion(prop.initializer)) {
            warnings.push({
              file: filePath,
              func: node.name.text,
              field: fieldName,
            });
            warningCount++;
          }
        }
      }
    });
  }

  function hasStringConversion(expr) {
    // 检查 String(xxx) 调用
    if (
      ts.isCallExpression(expr) &&
      ts.isIdentifier(expr.expression) &&
      expr.expression.text === 'String'
    ) {
      return true;
    }

    // 检查模板字符串: `${form.xxx}`（隐式转换为 string）
    if (ts.isTemplateExpression(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
      return true;
    }

    // 检查条件表达式: cond ? String(a) : b
    if (ts.isConditionalExpression(expr)) {
      return hasStringConversion(expr.whenTrue) || hasStringConversion(expr.whenFalse);
    }

    // 检查逻辑表达式: cond && String(a) 或 value ?? String(a)
    if (ts.isBinaryExpression(expr)) {
      const op = expr.operatorToken.kind;
      if (
        op === ts.SyntaxKind.AmpersandAmpersandToken ||
        op === ts.SyntaxKind.BarBarToken ||
        op === ts.SyntaxKind.QuestionQuestionToken
      ) {
        return hasStringConversion(expr.left) || hasStringConversion(expr.right);
      }
    }

    // 检查是否有 toString() 调用
    if (
      ts.isCallExpression(expr) &&
      ts.isPropertyAccessExpression(expr.expression) &&
      expr.expression.name.text === 'toString'
    ) {
      return true;
    }

    // 检查括号表达式: (String(xxx))
    if (ts.isParenthesizedExpression(expr)) {
      return hasStringConversion(expr.expression);
    }

    return false;
  }

  scanDir(WEB_SRC_DIR);

  console.log(`\n检查完成`);
  if (warningCount > 0) {
    const separator = '='.repeat(50);
    console.log('错误（必须修复）:');
    console.log(separator);
    for (const w of warnings) {
      console.log(`  ${w.file} -> ${w.func}:`);
      console.log(`    字段 '${w.field}' 可能是 Decimal 类型，但未发现 String() 转换`);
    }
    console.log('');
    console.log(`检查失败：发现 ${warningCount} 处问题。`);
    console.log('');
    console.log('修复建议：');
    console.log('  Decimal 精度字段提交时必须使用 String() 转换。');
    console.log('  如为误报（字段名同名但非 Decimal），添加 @decimal-ignore 注释。');
    process.exit(1);
  } else {
    console.log('未发现明显的 Decimal 转换遗漏。');
  }
}

/**
 * 阶段 3: 检查前端读取 Decimal 字段（启发式检查，警告模式）
 *
 * 检查 toXxxProfile 和 toXxxFormData 函数中是否使用 Number() 转换 Decimal 字段
 * 这是启发式检查，可能存在误报，因此不阻断 CI
 */
function checkFrontendReadConversions() {
  console.log('正在检查前端读取 Decimal 字段...');
  const readWarnings = [];

  function scanDir(dir) {
    if (!fs.existsSync(dir)) return;
    const items = fs.readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        scanDir(fullPath);
      } else if (item.isFile() && item.name === 'types.ts') {
        checkFile(fullPath);
      }
    }
  }

  function checkFile(filePath) {
    const sourceFile = parseFile(filePath);
    if (!sourceFile) return;
    const relativePath = path.relative(process.cwd(), filePath);

    // 如果文件本身或它引用的 shared schema 已经使用 z.coerce.number / z.preprocess
    // 进行自动类型转换，则 toFormData 中的字段无需再用 Number() 包一层。
    // useCrud 在 submit 时会调用 schema.safeParse(formData)，coerce/preprocess 会把 string 转为 number。
    if (fileHasSchemaCoerce(filePath, sourceFile.getFullText())) {
      return;
    }

    function visit(node) {
      // 寻找 export function toXxxProfile(...) 或 toXxxFormData(...)
      if (
        ts.isFunctionDeclaration(node) &&
        node.name &&
        /^to\w+(Profile|FormData)$/.test(node.name.text)
      ) {
        checkReadFunction(node, relativePath, sourceFile);
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  /**
   * 检查 types.ts 文件本身或它 import 的 shared schema 文件是否使用了
   * z.coerce.number() / z.preprocess() 实现自动类型转换。
   *
   * 如果是，toFormData 中的 Decimal 字段即使存为 string 也会在 schema.safeParse
   * 阶段被自动 coerce 为 number，因此无需在赋值处显式 Number() 转换。
   *
   * 这是粗粒度判断（命中即跳过整个文件的读取检查），可能漏报真实的字段级错配，
   * 但能消除常见的误报噪音。如需更精准的字段级判断，可改为按字段分析 zod 链。
   */
  function fileHasSchemaCoerce(filePath, sourceText) {
    if (/z\.coerce\.number\s*\(|z\.preprocess\s*\(/.test(sourceText)) {
      return true;
    }
    // 追溯 import 的 shared schema 文件
    const sharedSchemaDir = path.join(__dirname, '../packages/shared/src/schemas');
    const importRegex = /from\s+['"]@ky-azeroth\/shared\/schemas(?:\/([^'"\s]+))?['"]/g;
    for (const match of sourceText.matchAll(importRegex)) {
      const schemaPath = match[1];
      const candidates = schemaPath
        ? [path.join(sharedSchemaDir, `${schemaPath}.ts`)]
        : fs
            .readdirSync(sharedSchemaDir)
            .filter((f) => f.endsWith('.ts'))
            .map((f) => path.join(sharedSchemaDir, f));
      for (const candidate of candidates) {
        if (!fs.existsSync(candidate)) continue;
        const sharedSrc = fs.readFileSync(candidate, 'utf-8');
        if (/z\.coerce\.number\s*\(|z\.preprocess\s*\(/.test(sharedSrc)) {
          return true;
        }
      }
    }
    return false;
  }

  function checkReadFunction(node, filePath, sourceFile) {
    const funcName = node.name.text;
    const funcBody = node.body;
    if (!funcBody) return;

    // 获取函数返回类型（如果是 IXxxResponse 类型）
    let responseTypeName = null;
    if (node.type && ts.isTypeReferenceNode(node.type)) {
      responseTypeName = node.type.typeName.getText();
    }

    // 查找函数体中使用的 Decimal 字段（不带 Number() 转换的）
    const missingConversions = findMissingNumberConversions(funcBody, responseTypeName, sourceFile);

    if (missingConversions.length > 0) {
      readWarnings.push({
        file: filePath,
        function: funcName,
        missingFields: missingConversions,
      });
    }
  }

  function findMissingNumberConversions(funcBody, responseTypeName, sourceFile) {
    const missing = [];
    const processedFields = new Set();

    function visit(n, parent) {
      // 查找对象字面量中的属性赋值
      if (ts.isObjectLiteralExpression(n)) {
        n.properties.forEach((prop) => {
          if (
            ts.isPropertyAssignment(prop) &&
            ts.isIdentifier(prop.name) &&
            decimalFieldNames.has(prop.name.text) &&
            !IGNORED_FIELDS.has(prop.name.text) &&
            !processedFields.has(prop.name.text)
          ) {
            processedFields.add(prop.name.text);

            // 检查是否使用了 Number() 转换，或者有 @decimal-ignore 注释
            if (
              !hasNumberConversion(prop.initializer) &&
              !hasDecimalIgnoreComment(sourceFile, prop)
            ) {
              missing.push(prop.name.text);
            }
          }
        });
      }
      ts.forEachChild(n, visit);
    }

    visit(funcBody);
    return missing;
  }

  function hasNumberConversion(expr) {
    // 检查 Number(xxx) 调用
    if (ts.isCallExpression(expr)) {
      const callee = expr.expression;
      if (ts.isIdentifier(callee) && callee.text === 'Number') {
        return true;
      }
      // 检查 parseFloat(xxx) / parseInt(xxx)
      if (ts.isIdentifier(callee) && (callee.text === 'parseFloat' || callee.text === 'parseInt')) {
        return true;
      }
    }

    // 检查条件表达式: cond ? Number(a) : b
    if (ts.isConditionalExpression(expr)) {
      return hasNumberConversion(expr.whenTrue) || hasNumberConversion(expr.whenFalse);
    }

    // 检查逻辑表达式: value || defaultValue, value ?? defaultValue
    if (ts.isBinaryExpression(expr)) {
      const op = expr.operatorToken.kind;
      if (
        op === ts.SyntaxKind.BarBarToken ||
        op === ts.SyntaxKind.QuestionQuestionToken ||
        op === ts.SyntaxKind.AmpersandAmpersandToken
      ) {
        return hasNumberConversion(expr.left) || hasNumberConversion(expr.right);
      }
    }

    // 检查括号表达式: (Number(xxx))
    if (ts.isParenthesizedExpression(expr)) {
      return hasNumberConversion(expr.expression);
    }

    return false;
  }

  scanDir(WEB_SRC_DIR);

  // 输出读取检查结果
  if (readWarnings.length > 0) {
    console.log('\n⚠️  发现潜在的 Decimal 读取未转换:');
    readWarnings.forEach(({ file, function: func, missingFields }) => {
      console.log(`\n  ${file} - ${func}()`);
      missingFields.forEach((field) => {
        console.log(`    - 字段 "${field}" 可能需要 Number() 转换`);
      });
    });
    console.log('\n提示: 这是启发式检查，可能存在误报。请人工复核。');
  } else {
    console.log('未发现明显的 Decimal 读取问题。');
  }
}

function main() {
  collectDecimalFields();
  checkFrontendConversions();
  console.log(''); // 空行分隔
  checkFrontendReadConversions();
}

main();
process.exit(0);
