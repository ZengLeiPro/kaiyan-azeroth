#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const SERVER_SRC = path.join(ROOT, 'apps/server/src');
const ROUTE_DECORATORS = new Set([
  'Get',
  'Post',
  'Put',
  'Patch',
  'Delete',
  'Head',
  'Options',
  'All',
  'Sse',
]);
const AUTHORIZATION_DECORATORS = new Set([
  'Public',
  'RequirePermission',
  'RequireAnyPermission',
  'AllowAnyAuthenticatedUser',
]);

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.controller.ts')) files.push(fullPath);
  }
  return files;
}

function decoratorName(decorator) {
  let expression = decorator.expression;
  if (ts.isCallExpression(expression)) expression = expression.expression;
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return null;
}

function decoratorNames(node) {
  if (!ts.canHaveDecorators(node)) return new Set();
  return new Set((ts.getDecorators(node) ?? []).map(decoratorName).filter(Boolean));
}

function hasAny(names, expected) {
  return [...names].some((name) => expected.has(name));
}

function scanControllerSource(sourceText, fileName = 'controller.ts') {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const missing = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isClassDeclaration(statement)) continue;
    const classDecorators = decoratorNames(statement);
    if (!classDecorators.has('Controller')) continue;
    const classAuthorized = hasAny(classDecorators, AUTHORIZATION_DECORATORS);

    for (const member of statement.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      const methodDecorators = decoratorNames(member);
      if (!hasAny(methodDecorators, ROUTE_DECORATORS)) continue;
      if (classAuthorized || hasAny(methodDecorators, AUTHORIZATION_DECORATORS)) continue;
      const name = member.name?.getText(sourceFile) ?? '<anonymous>';
      const line = sourceFile.getLineAndCharacterOfPosition(member.getStart(sourceFile)).line + 1;
      missing.push({
        fileName,
        className: statement.name?.text ?? '<anonymous>',
        methodName: name,
        line,
      });
    }
  }
  return missing;
}

function main() {
  const missing = walk(SERVER_SRC).flatMap((filePath) =>
    scanControllerSource(fs.readFileSync(filePath, 'utf8'), path.relative(ROOT, filePath))
  );
  if (missing.length > 0) {
    console.error('以下业务路由没有显式授权元数据：');
    for (const item of missing) {
      console.error(`- ${item.fileName}:${item.line} ${item.className}.${item.methodName}`);
    }
    console.error(
      '必须添加 @RequirePermission/@RequireAnyPermission，或用 @AllowAnyAuthenticatedUser 明示已登录自服务；匿名路由必须显式 @Public。@RequireFreshJwt 不能单独作为授权元数据。'
    );
    process.exit(1);
  }
  console.log('路由授权元数据检查通过：所有 Controller route 均显式声明授权语义。');
}

module.exports = { scanControllerSource };

if (require.main === module) main();
