#!/usr/bin/env node
/**
 * Query Schema 分页基础检查脚本
 *
 * 目标（rules.md SHOULD）：
 * - 所有 queryXxxSchema 必须基于 paginationSchema 或 selectionPaginationSchema 构建
 * - 禁止 queryXxxSchema 直接使用 z.object() 而不继承分页参数
 *
 * 允许的例外：
 * - 不需要分页的查询（如汇总/历史查询），可用 @no-pagination 注释标注
 *
 * 检测范围：
 * - packages/shared/src/schemas 下所有 .ts 文件
 *
 * 使用方式：node scripts/check-query-schema-pagination.js
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const SCHEMAS_DIR = path.join(__dirname, '../packages/shared/src/schemas');

const errors = [];
let checkedSchemas = 0;

// 合法的基础 schema 名称
const VALID_BASES = new Set(['paginationSchema', 'selectionPaginationSchema']);

/**
 * 解析 TypeScript 文件获取 AST
 */
function parseFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf-8');
  return ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
}

/**
 * 检查节点前面是否有 @no-pagination 注释
 */
function hasNoPaginationComment(sourceFile, node) {
  const text = sourceFile.getFullText();
  const fullStart = node.getFullStart();
  const start = node.getStart(sourceFile);
  // 前导注释在 fullStart 与 start 之间（TypeScript AST leading trivia）
  const leadingTrivia = text.substring(fullStart, start);
  // 同时检查前面 200 字符（跨节点的注释）
  const extraContext = text.substring(Math.max(0, fullStart - 200), start);
  return leadingTrivia.includes('@no-pagination') || extraContext.includes('@no-pagination');
}

/**
 * 检查变量初始化器是否基于 paginationSchema.extend() 或 selectionPaginationSchema.extend()
 */
function isBasedOnPaginationSchema(initializer) {
  if (!initializer) return false;

  // 模式 1: paginationSchema.extend({...})
  if (
    ts.isCallExpression(initializer) &&
    ts.isPropertyAccessExpression(initializer.expression) &&
    initializer.expression.name.text === 'extend'
  ) {
    const obj = initializer.expression.expression;
    if (ts.isIdentifier(obj) && VALID_BASES.has(obj.text)) {
      return true;
    }
  }

  // 模式 2: paginationSchema.merge(...)
  if (
    ts.isCallExpression(initializer) &&
    ts.isPropertyAccessExpression(initializer.expression) &&
    initializer.expression.name.text === 'merge'
  ) {
    const obj = initializer.expression.expression;
    if (ts.isIdentifier(obj) && VALID_BASES.has(obj.text)) {
      return true;
    }
  }

  // 模式 3: 链式调用 paginationSchema.extend({...}).refine(...)
  if (ts.isCallExpression(initializer)) {
    return isBasedOnPaginationSchema(initializer.expression);
  }

  // 模式 4: 属性访问链中间节点
  if (ts.isPropertyAccessExpression(initializer)) {
    return isBasedOnPaginationSchema(initializer.expression);
  }

  return false;
}

function checkFile(filePath) {
  const sourceFile = parseFile(filePath);
  if (!sourceFile) return;
  const relativePath = path.relative(process.cwd(), filePath);

  function visit(node) {
    // 匹配 export const queryXxxSchema = ...
    if (ts.isVariableStatement(node) && node.declarationList.declarations.length > 0) {
      for (const decl of node.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          /^query\w+Schema$/.test(decl.name.text) &&
          decl.initializer
        ) {
          checkedSchemas++;
          const schemaName = decl.name.text;

          // 检查是否有 @no-pagination 豁免注释
          if (hasNoPaginationComment(sourceFile, node)) {
            return;
          }

          // 检查是否基于 paginationSchema
          if (!isBasedOnPaginationSchema(decl.initializer)) {
            errors.push({
              file: relativePath,
              schema: schemaName,
              line: sourceFile.getLineAndCharacterOfPosition(decl.getStart(sourceFile)).line + 1,
            });
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

function findFiles(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;

  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      files.push(...findFiles(fullPath));
    } else if (item.isFile() && item.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

function main() {
  console.log('检查 Query Schema 分页基础...\n');

  const files = findFiles(SCHEMAS_DIR);

  if (files.length === 0) {
    console.log('未找到需要检查的 schema 文件');
    process.exit(0);
  }

  for (const file of files) {
    checkFile(file);
  }

  console.log(`已检查 ${checkedSchemas} 个 queryXxxSchema 定义\n`);

  if (errors.length > 0) {
    const separator = '='.repeat(50);
    console.log('错误（必须修复）:');
    console.log(separator);
    for (const e of errors) {
      console.log(`  ${e.file}:${e.line}`);
      console.log(
        `    ${e.schema} 未使用 paginationSchema.extend() 或 selectionPaginationSchema.extend()`
      );
    }
    console.log('');
    console.log(`检查失败：发现 ${errors.length} 处问题。`);
    console.log('');
    console.log('修复建议：');
    console.log('  正确: export const queryXxxSchema = paginationSchema.extend({ ... })');
    console.log('  豁免: 在 schema 前添加 // @no-pagination 注释（适用于汇总/不分页查询）');
    process.exit(1);
  }

  console.log('Query Schema 分页基础检查通过！');
  process.exit(0);
}

main();
