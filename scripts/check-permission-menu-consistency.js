#!/usr/bin/env node
/**
 * 权限菜单一致性检查
 *
 * 目标：后端所有 @RequirePermission({ module, menu, action }) 声明的 module/menu
 * 必须存在于 shared 的 MODULES 权限菜单树中，避免 system/roles 页面无法配置
 * 某个接口实际需要的权限。
 *
 * 如某接口不应进入 system/roles（例如当前用户私域偏好、受保护管理端点 运维动作），
 * 不应继续使用 @RequirePermission 指向虚拟菜单；应改用登录态隔离、业务内校验或
 * @RequireFreshJwt() 等更贴合语义的保护方式。
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const MODULES_PATH = path.join(ROOT, 'packages/shared/src/constants/modules.ts');
const SERVER_MODULES_DIR = path.join(ROOT, 'apps/server/src/modules');

function walk(dir) {
  const result = [];
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(full));
    else if (entry.isFile() && full.endsWith('.ts')) result.push(full);
  }
  return result;
}

function sourceFileOf(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  return ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function stringLiteralValue(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function propertyNameText(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))
    return name.text;
  return null;
}

function objectPropertyMap(objectLiteral) {
  const map = new Map();
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const name = propertyNameText(property.name);
    if (!name) continue;
    map.set(name, property.initializer);
  }
  return map;
}

function collectStringConstants(sourceFile) {
  const constants = new Map();

  function visit(node) {
    if (ts.isVariableStatement(node)) {
      const isConst = (node.declarationList.flags & ts.NodeFlags.Const) !== 0;
      if (isConst) {
        for (const declaration of node.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
          const value = stringLiteralValue(declaration.initializer);
          if (value !== null) constants.set(declaration.name.text, value);
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return constants;
}

function staticStringValue(node, constants) {
  const literal = stringLiteralValue(node);
  if (literal !== null) return literal;
  if (ts.isIdentifier(node) && constants.has(node.text)) return constants.get(node.text);
  return null;
}

function findModulesInitializer(sourceFile) {
  let initializer = null;

  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'MODULES' &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      initializer = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return initializer;
}

function arrayLiteralValues(node, constants) {
  if (ts.isIdentifier(node) && constants.has(node.text)) {
    return constants.get(node.text);
  }
  if (!ts.isArrayLiteralExpression(node)) return null;
  const values = [];
  for (const element of node.elements) {
    const value = stringLiteralValue(element);
    if (value === null) return null;
    values.push(value);
  }
  return values;
}

function collectArrayConstants(sourceFile) {
  const constants = new Map();

  function visit(node) {
    if (ts.isVariableStatement(node)) {
      const isConst = (node.declarationList.flags & ts.NodeFlags.Const) !== 0;
      if (isConst) {
        for (const declaration of node.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
          const initializer = ts.isSatisfiesExpression(declaration.initializer)
            ? declaration.initializer.expression
            : declaration.initializer;
          const expression = ts.isAsExpression(initializer) ? initializer.expression : initializer;
          const values = arrayLiteralValues(expression, constants);
          if (values) constants.set(declaration.name.text, values);
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return constants;
}

function unwrapExpression(node) {
  let current = node;
  while (ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) {
    current = current.expression;
  }
  return current;
}

function collectPermissionActionConfig(sourceFile) {
  const constants = collectArrayConstants(sourceFile);
  const moduleActions = new Map();
  const menuOverrides = new Map();

  function collectObjectLiteralConst(constName, targetMap) {
    function visit(node) {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === constName &&
        node.initializer
      ) {
        const initializer = unwrapExpression(node.initializer);
        if (!ts.isObjectLiteralExpression(initializer)) return;
        for (const property of initializer.properties) {
          if (!ts.isPropertyAssignment(property)) continue;
          const name = propertyNameText(property.name);
          if (!name) continue;
          const actions = arrayLiteralValues(unwrapExpression(property.initializer), constants);
          if (actions) targetMap.set(name, actions);
        }
        return;
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }

  collectObjectLiteralConst('moduleActions', moduleActions);
  collectObjectLiteralConst('menuActionOverrides', menuOverrides);
  return { moduleActions, menuOverrides };
}

function collectMenus() {
  const sourceFile = sourceFileOf(MODULES_PATH);
  const modulesInitializer = findModulesInitializer(sourceFile);
  if (!modulesInitializer) {
    throw new Error('无法在 packages/shared/src/constants/modules.ts 中找到 MODULES 对象');
  }

  const { moduleActions, menuOverrides } = collectPermissionActionConfig(sourceFile);
  const menus = new Set();
  const actionMap = new Map();
  for (const moduleProperty of modulesInitializer.properties) {
    if (!ts.isPropertyAssignment(moduleProperty)) continue;
    const moduleName = propertyNameText(moduleProperty.name);
    if (!moduleName || !ts.isObjectLiteralExpression(moduleProperty.initializer)) continue;

    const moduleFields = objectPropertyMap(moduleProperty.initializer);
    const menusNode = moduleFields.get('menus');
    if (!menusNode || !ts.isObjectLiteralExpression(menusNode)) continue;

    for (const menuProperty of menusNode.properties) {
      if (!ts.isPropertyAssignment(menuProperty)) continue;
      const menuName = propertyNameText(menuProperty.name);
      if (menuName) {
        const key = `${moduleName}/${menuName}`;
        menus.add(key);
        actionMap.set(
          key,
          menuOverrides.get(`${moduleName}.${menuName}`) ??
            moduleActions.get(moduleName) ?? ['view']
        );
      }
    }
  }

  return { menus, actionMap };
}

function decoratorCallExpression(node) {
  if (!ts.isDecorator(node)) return null;
  const expression = node.expression;
  if (ts.isCallExpression(expression)) return expression;
  return null;
}

function requirePermissionName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return null;
}

function collectRequirePermissions(filePath) {
  const sourceFile = sourceFileOf(filePath);
  const permissions = [];
  const constants = collectStringConstants(sourceFile);

  function inspectDecorators(node) {
    const decorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined;
    if (!decorators) return;

    for (const decorator of decorators) {
      const call = decoratorCallExpression(decorator);
      if (!call || requirePermissionName(call.expression) !== 'RequirePermission') continue;
      const [arg] = call.arguments;
      if (!arg || !ts.isObjectLiteralExpression(arg)) continue;

      const fields = objectPropertyMap(arg);
      const moduleName = fields.get('module')
        ? staticStringValue(fields.get('module'), constants)
        : null;
      const menuName = fields.get('menu') ? staticStringValue(fields.get('menu'), constants) : null;
      const actionName = fields.get('action')
        ? staticStringValue(fields.get('action'), constants)
        : null;
      permissions.push({
        moduleName,
        menuName,
        actionName,
        line: lineOf(sourceFile, decorator),
      });
    }
  }

  function visit(node) {
    inspectDecorators(node);
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return permissions;
}

const { menus: knownMenus, actionMap: knownActions } = collectMenus();
const errors = [];
let checked = 0;

for (const file of walk(SERVER_MODULES_DIR)) {
  for (const permission of collectRequirePermissions(file)) {
    checked += 1;
    const { moduleName, menuName, actionName, line } = permission;
    if (!moduleName || !menuName || !actionName) {
      errors.push({
        file: path.relative(ROOT, file),
        line,
        permission: '无法静态解析 module/menu/action（必须使用字符串字面量）',
      });
      continue;
    }

    const key = `${moduleName}/${menuName}`;
    if (!knownMenus.has(key)) {
      errors.push({
        file: path.relative(ROOT, file),
        line,
        permission: `${key}/${actionName}`,
      });
      continue;
    }

    const allowedActions = knownActions.get(key) ?? [];
    if (!allowedActions.includes(actionName)) {
      errors.push({
        file: path.relative(ROOT, file),
        line,
        permission: `${key}/${actionName}（action 未登记，可用：${allowedActions.join(', ') || '无'}）`,
      });
    }
  }
}

console.log('正在检查后端 @RequirePermission 与 shared MODULES 权限菜单树一致性...\n');
console.log(`已扫描权限声明：${checked} 条`);
console.log(`已登记菜单：${knownMenus.size} 个\n`);

if (errors.length > 0) {
  console.log(
    '错误（必须修复）：以下权限点未登记到 packages/shared/src/constants/modules.ts 的 MODULES 中'
  );
  console.log('================');
  for (const err of errors) {
    console.log(`  - ${err.file}:${err.line} -> ${err.permission}`);
  }
  console.log('\n修复建议：');
  console.log('  1. 如果该权限应由 system/roles 配置：补充 MODULES 对应 module/menu。');
  console.log(
    '  2. 如果该接口不应进入 system/roles：不要使用 @RequirePermission 指向虚拟菜单，改用更贴合语义的保护方式。'
  );
  process.exit(1);
}

console.log('权限菜单一致性通过！所有 @RequirePermission 的 module/menu/action 均已登记。');
