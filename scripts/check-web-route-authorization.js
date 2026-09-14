#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const APP_PATH = path.resolve(__dirname, '../apps/web/src/App.tsx');
const PUBLIC_ROUTES = new Set(['/login', '/403', '*']);
const AUTHENTICATED_ONLY_ROUTES = new Set([
  '<index>',
  'dashboard',
  'profile',
  'notifications',
  'ui-demo',
]);
const REDIRECT_ROUTES = new Set([
  'finance/payroll-import',
  'finance/personal-ledger',
  'finance/pnl',
]);

function jsxTagName(name) {
  return ts.isIdentifier(name) ? name.text : name.getText();
}

function findAttribute(opening, name) {
  return opening.attributes.properties.find(
    (property) => ts.isJsxAttribute(property) && property.name.text === name
  );
}

function stringAttribute(opening, name) {
  const attribute = findAttribute(opening, name);
  if (!attribute?.initializer || !ts.isStringLiteral(attribute.initializer)) return null;
  return attribute.initializer.text;
}

function elementTag(opening) {
  const attribute = findAttribute(opening, 'element');
  if (
    !attribute?.initializer ||
    !ts.isJsxExpression(attribute.initializer) ||
    !attribute.initializer.expression
  ) {
    return null;
  }
  const expression = attribute.initializer.expression;
  if (ts.isJsxElement(expression)) return jsxTagName(expression.openingElement.tagName);
  if (ts.isJsxSelfClosingElement(expression)) return jsxTagName(expression.tagName);
  return null;
}

function elementOpening(opening) {
  const attribute = findAttribute(opening, 'element');
  if (
    !attribute?.initializer ||
    !ts.isJsxExpression(attribute.initializer) ||
    !attribute.initializer.expression
  ) {
    return null;
  }
  const expression = attribute.initializer.expression;
  if (ts.isJsxElement(expression)) return expression.openingElement;
  if (ts.isJsxSelfClosingElement(expression)) return expression;
  return null;
}

function validateWebRoutes(source, fileName = 'App.tsx') {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const errors = [];

  function visit(node, insidePrivateRoot = false) {
    let privateScope = insidePrivateRoot;
    if (
      (ts.isJsxElement(node) && jsxTagName(node.openingElement.tagName) === 'Route') ||
      (ts.isJsxSelfClosingElement(node) && jsxTagName(node.tagName) === 'Route')
    ) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const pathValue = stringAttribute(opening, 'path');
      const isIndex = Boolean(findAttribute(opening, 'index'));
      const route = isIndex ? '<index>' : pathValue;
      const tag = elementTag(opening);
      const line = sourceFile.getLineAndCharacterOfPosition(opening.getStart(sourceFile)).line + 1;

      if (route === '/') {
        if (tag !== 'PrivateRoute')
          errors.push(`${fileName}:${line} 根路由必须由 PrivateRoute 保护`);
        privateScope = tag === 'PrivateRoute';
      } else if (route && PUBLIC_ROUTES.has(route)) {
        if (insidePrivateRoot)
          errors.push(`${fileName}:${line} 公开路由 ${route} 不得嵌入私有路由`);
      } else if (route) {
        if (!insidePrivateRoot) {
          errors.push(`${fileName}:${line} 路由 ${route} 未嵌入 PrivateRoute`);
        } else if (tag === 'PermissionRoute') {
          const guard = elementOpening(opening);
          const moduleName = guard && stringAttribute(guard, 'module');
          const menuName = guard && stringAttribute(guard, 'menu');
          const anyOf = guard && findAttribute(guard, 'anyOf');
          if (!moduleName || (!menuName && !anyOf)) {
            errors.push(
              `${fileName}:${line} 路由 ${route} 的 PermissionRoute 缺少可静态验证的 module/menu 或 anyOf`
            );
          }
        } else if (tag === 'RoleRoute') {
          const guard = elementOpening(opening);
          if (!guard || !findAttribute(guard, 'requiredRoles')) {
            errors.push(`${fileName}:${line} 路由 ${route} 的 RoleRoute 缺少 requiredRoles`);
          }
        } else if (tag === 'Navigate') {
          if (!REDIRECT_ROUTES.has(route)) {
            errors.push(`${fileName}:${line} 路由 ${route} 未登记为受保护重定向`);
          }
        } else if (!AUTHENTICATED_ONLY_ROUTES.has(route)) {
          errors.push(`${fileName}:${line} 路由 ${route} 必须显式使用 PermissionRoute/RoleRoute`);
        }
      }
    }

    node.forEachChild((child) => visit(child, privateScope));
  }

  visit(sourceFile);
  return errors;
}

function main() {
  const errors = validateWebRoutes(fs.readFileSync(APP_PATH, 'utf8'), APP_PATH);
  if (errors.length > 0) {
    console.error(`Web 路由授权门禁失败:\n- ${errors.join('\n- ')}`);
    process.exitCode = 1;
    return;
  }
  console.log('Web 路由授权门禁通过');
}

module.exports = {
  AUTHENTICATED_ONLY_ROUTES,
  PUBLIC_ROUTES,
  REDIRECT_ROUTES,
  validateWebRoutes,
};

if (require.main === module) main();
