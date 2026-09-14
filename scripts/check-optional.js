#!/usr/bin/env node
/**
 * Shared Schema 与 Interface 可选性一致性检查脚本
 *
 * 检查 @ky-azeroth/shared 包中的 Zod Schema 与 TypeScript Interface 是否一致：
 * 1. createXxxSchema 必须与 ICreateXxx 匹配
 * 2. 检查字段的可选性 (optional/nullable) 是否一致
 *
 * 使用方式：node scripts/check-optional.js
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const SHARED_DIR = path.join(__dirname, '../packages/shared/src');
const SCHEMAS_DIR = path.join(SHARED_DIR, 'schemas');
const TYPES_DIR = path.join(SHARED_DIR, 'types');

// 存储 Schema 定义: Map<SchemaName, Map<FieldName, boolean>>  (true = optional/nullable)
const schemas = new Map();
// 存储 Interface 定义: Map<InterfaceName, Map<FieldName, boolean>>
const interfaces = new Map();

/**
 * 解析 Typescript 文件获取 AST
 */
function parseFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf-8');
  return ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
}

// ==================== 1. 解析 Schemas ====================

function collectSchemas() {
  console.log('正在扫描 Zod Schemas...');

  function scanDir(dir) {
    if (!fs.existsSync(dir)) return;
    const items = fs.readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        scanDir(fullPath);
      } else if (item.isFile() && item.name.endsWith('.ts')) {
        extractSchemas(fullPath);
      }
    }
  }

  function extractSchemas(filePath) {
    const sourceFile = parseFile(filePath);
    if (!sourceFile) return;

    function visit(node) {
      // export const createXxxSchema = z.object({ ... })
      if (
        ts.isVariableStatement(node) &&
        node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        node.declarationList.declarations.forEach((decl) => {
          if (ts.isIdentifier(decl.name) && decl.initializer) {
            const schemaName = decl.name.text;
            // 简单匹配 z.object({...}) 或 .extend({...})
            // 这是一个启发式解析，不处理复杂的 refine/transform
            const fields = new Map();
            parseZodObject(decl.initializer, fields);
            if (fields.size > 0) {
              schemas.set(schemaName, fields);
            }
          }
        });
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  scanDir(SCHEMAS_DIR);
  console.log(`已识别 ${schemas.size} 个 Schema 定义\n`);
}

function parseZodObject(node, fields) {
  // 递归查找 ObjectLiteralExpression
  // 模式 1: z.object({ ... })
  // 模式 2: schema.extend({ ... })

  if (ts.isCallExpression(node)) {
    // 检查是否是 .optional(), .nullable() 等链式调用，我们要找的是参数中的 ObjectLiteral
    const args = node.arguments;
    if (args.length > 0 && ts.isObjectLiteralExpression(args[0])) {
      // 假设第一个参数是对象定义的或者是 extend 的对象
      // 需要判断函数名
      if (ts.isPropertyAccessExpression(node.expression)) {
        const methodName = node.expression.name.text;
        if (methodName === 'object' || methodName === 'extend') {
          extractObjectFields(args[0], fields);
          return;
        }
      }
    }
    // 递归处理链式调用 schema.extend(...).refine(...)
    parseZodObject(node.expression, fields);
  }
}

function extractObjectFields(objLiteral, fields) {
  objLiteral.properties.forEach((prop) => {
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
      const fieldName = prop.name.text;
      const isOptional = checkZodOptionality(prop.initializer);
      fields.set(fieldName, isOptional);
    }
  });
}

function checkZodOptionality(node) {
  // 检查链式调用中是否有 optional(), nullable(), nullish() 或 default()
  // 注意：default() 使字段在输入时变为可选
  if (ts.isCallExpression(node)) {
    if (ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if (
        method === 'optional' ||
        method === 'nullable' ||
        method === 'nullish' ||
        method === 'default'
      ) {
        return true;
      }
      // 递归检查调用链的前一部分
      return checkZodOptionality(node.expression.expression);
    }
    // 处理 .unwrap() 等情况
    if (ts.isCallExpression(node.expression)) {
      return checkZodOptionality(node.expression);
    }
  }

  // 处理引用: 已知的 nullable/optional 辅助变量
  if (ts.isIdentifier(node)) {
    if (
      node.text === 'optionalDateString' ||
      node.text === 'nullableNumberField' ||
      node.text === 'nullableStringField'
    )
      return true;
  }

  return false;
}

// ==================== 2. 解析 Interfaces ====================

function collectInterfaces() {
  console.log('正在扫描 TypeScript Interfaces...');

  function scanDir(dir) {
    if (!fs.existsSync(dir)) return;
    const items = fs.readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        scanDir(fullPath);
      } else if (item.isFile() && item.name.endsWith('.ts')) {
        extractInterfaces(fullPath);
      }
    }
  }

  function extractInterfaces(filePath) {
    const sourceFile = parseFile(filePath);
    if (!sourceFile) return;

    function visit(node) {
      if (ts.isInterfaceDeclaration(node)) {
        const interfaceName = node.name.text;
        const fields = new Map();

        node.members.forEach((member) => {
          if (ts.isPropertySignature(member) && ts.isIdentifier(member.name)) {
            const fieldName = member.name.text;
            // 检查是否有 ? 修饰符 或 类型包含 null
            const hasQuestion = !!member.questionToken;
            const hasNull = member.type ? isNullableType(member.type) : false;
            fields.set(fieldName, hasQuestion || hasNull);
          }
        });

        interfaces.set(interfaceName, fields);
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  scanDir(TYPES_DIR);
  console.log(`已识别 ${interfaces.size} 个 Interface 定义\n`);
}

function isNullableType(typeNode) {
  if (ts.isUnionTypeNode(typeNode)) {
    return typeNode.types.some(
      (t) =>
        t.kind === ts.SyntaxKind.NullKeyword ||
        t.kind === ts.SyntaxKind.UndefinedKeyword ||
        (ts.isLiteralTypeNode(t) && t.literal.kind === ts.SyntaxKind.NullKeyword)
    );
  }
  return (
    typeNode.kind === ts.SyntaxKind.NullKeyword || typeNode.kind === ts.SyntaxKind.UndefinedKeyword
  );
}

// ==================== 3. 对比检查 ====================

function compare() {
  const errors = [];

  // 遍历所有 createXxxSchema
  for (const [schemaName, schemaFields] of schemas) {
    if (!schemaName.startsWith('create')) continue;

    // 推导对应的 Interface 名称: createProductSchema -> ICreateProduct
    // 假设命名规范：createXxxSchema -> ICreateXxx
    // 去掉 suffix 'Schema', capitalize, prefix 'I'
    const baseName = schemaName.replace(/Schema$/, '');
    const interfaceName = 'I' + baseName.charAt(0).toUpperCase() + baseName.slice(1);

    const interfaceFields = interfaces.get(interfaceName);

    if (!interfaceFields) {
      continue;
    }

    // 对比字段
    for (const [field, isSchemaOptional] of schemaFields) {
      const isInterfaceOptional = interfaceFields.get(field);

      if (isInterfaceOptional === undefined) {
        // Interface 缺失该字段 (这由 check-dto-implements 检查，这里主要关注存在的字段)
        continue;
      }

      if (isSchemaOptional !== isInterfaceOptional) {
        // 允许 Schema 必填但 Interface 可选 (前端校验严格，后端接口宽松? 不，反过来才行)
        // 风险: Schema Optional (允许空), Interface Required (TS 认为必有值) -> TS 欺骗
        // 风险: Schema Required (必填), Interface Optional (TS 允许空) -> 运行时校验失败

        // 我们主要关注: Interface 说是必填，但 Schema 其实是可选 -> 安全
        // 风险点: Interface 说是可选，但 Schema 是必填 -> 运行时错误

        if (isInterfaceOptional && !isSchemaOptional) {
          errors.push({
            schema: schemaName,
            iface: interfaceName,
            field,
          });
        }

        // 反向: Interface 必填，Schema 可选 -> TS 过于严格，通常安全但累赘
        if (!isInterfaceOptional && isSchemaOptional) {
          // 不报告
        }
      }
    }
  }

  console.log(`已检查 ${schemas.size} 个 Schema 与 ${interfaces.size} 个 Interface\n`);

  if (errors.length > 0) {
    const separator = '='.repeat(50);
    console.log('错误（必须修复）:');
    console.log(separator);
    for (const e of errors) {
      console.log(`  ${e.schema} vs ${e.iface}`);
      console.log(
        `    字段 '${e.field}' 在 Interface 中是可选的，但在 Schema 中是必填的，可能导致前端 TS 通过但提交时被 Zod 拦截`
      );
    }
    console.log('');
    console.log(`检查失败：发现 ${errors.length} 处问题。`);
    console.log('');
    console.log('修复建议：');
    console.log('  确保 Schema 与 Interface 的字段可选性一致。');
    process.exit(1);
  }

  console.log('Schema/Interface 可选性一致性检查通过！');
}

function main() {
  console.log('检查 Schema/Interface 可选性一致性...\n');

  collectSchemas();
  collectInterfaces();
  compare();
}

main();
process.exit(0);
