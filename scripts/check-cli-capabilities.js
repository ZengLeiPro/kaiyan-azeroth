#!/usr/bin/env node
/**
 * 校验 azeroth CLI Agent capabilities：
 * - capabilities 命令必须可执行并输出完整 JSON
 * - 每条能力必须声明 operations / guards
 * - role-permission guard 必须有 system/roles permission
 * - permission 必须存在于 shared MODULES / MODULE_PERMISSION_ACTIONS
 * - 禁止重复 command；禁止已知幽灵命令回归
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..');
const SERVER_MODULES_DIR = path.join(ROOT, 'apps/server/src/modules');

/**
 * system/roles 中存在、但当前明确不暴露给 Agent CLI 的菜单。
 *
 * 这些菜单通常属于前端看板、站点级配置、或尚无 Agent 调用场景的聚合视图。
 * 如果未来补了 CLI 命令，应从这里移除，让反向覆盖检查强制绑定 capability。
 */
const MENU_COVERAGE_ALLOWLIST = new Map([
  ['analytics.overview', '看板聚合接口，暂未暴露 Agent CLI'],
  ['analytics.crm', '看板聚合接口，暂未暴露 Agent CLI'],
  ['analytics.projects', '看板聚合接口，暂未暴露 Agent CLI'],
  ['analytics.organization', '看板聚合接口，暂未暴露 Agent CLI'],
  ['analytics.xiaohongshu', '小红书聚光只读聚合页面，暂未暴露 Agent CLI'],
  ['ops.cloud_renewal', '续费日历看板，暂未暴露 Agent CLI'],
  ['system.filter_schemes', '筛选方案为站点级表单配置，暂未暴露 Agent CLI'],
]);

function run(command, args, cwd = ROOT) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) {
    console.error(result.stdout || '');
    console.error(result.stderr || '');
    throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}`);
  }
  return result.stdout;
}

function parseJsonOutput(stdout) {
  const start = stdout.indexOf('[');
  if (start < 0) throw new Error('capabilities output does not contain JSON array');
  return JSON.parse(stdout.slice(start));
}

function walk(dir) {
  const result = [];
  if (!fs.existsSync(dir)) return result;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(full));
    else if (entry.isFile() && full.endsWith('.controller.ts')) result.push(full);
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

function parsePermissionObject(arg, constants) {
  if (!arg || !ts.isObjectLiteralExpression(arg)) return null;
  const fields = objectPropertyMap(arg);
  const moduleName = fields.get('module')
    ? staticStringValue(fields.get('module'), constants)
    : null;
  const menuName = fields.get('menu') ? staticStringValue(fields.get('menu'), constants) : null;
  const actionName = fields.get('action')
    ? staticStringValue(fields.get('action'), constants)
    : null;
  return { moduleName, menuName, actionName };
}

function collectControllerPermissions(filePath) {
  const sourceFile = sourceFileOf(filePath);
  const constants = collectStringConstants(sourceFile);
  const permissions = [];

  function inspectDecorators(node) {
    const decorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined;
    if (!decorators) return;

    for (const decorator of decorators) {
      const call = decoratorCallExpression(decorator);
      if (!call) continue;
      const name = requirePermissionName(call.expression);
      const [arg] = call.arguments;

      if (name === 'RequirePermission') {
        const permission = parsePermissionObject(arg, constants);
        if (!permission) continue;
        permissions.push({
          ...permission,
          line: lineOf(sourceFile, decorator),
        });
      }

      if (name === 'RequireAnyPermission') {
        if (!arg || !ts.isArrayLiteralExpression(arg)) continue;
        for (const element of arg.elements) {
          const permission = parsePermissionObject(element, constants);
          if (!permission) continue;
          permissions.push({
            ...permission,
            line: lineOf(sourceFile, element),
          });
        }
      }
    }
  }

  function visit(node) {
    inspectDecorators(node);
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return permissions;
}

console.log('正在检查 CLI Agent capabilities 与 system/roles 权限矩阵一致性...');

run(
  path.join(ROOT, 'packages/shared/node_modules/.bin/tsc'),
  [],
  path.join(ROOT, 'packages/shared')
);
const stdout = run(
  path.join(ROOT, 'apps/cli/node_modules/.bin/tsx'),
  ['src/index.ts', 'capabilities'],
  path.join(ROOT, 'apps/cli')
);
const capabilities = parseJsonOutput(stdout);
const shared = require('../packages/shared/dist');
const modules = shared.MODULES;
const modulePermissionActions = shared.MODULE_PERMISSION_ACTIONS;

const errors = [];
const seen = new Set();
const capabilityPermissions = new Set();
const forbiddenGhostCommands = new Set(['work-calendars']);

for (const cap of capabilities) {
  if (!cap || typeof cap !== 'object') {
    errors.push('存在非对象 capability 条目');
    continue;
  }
  if (typeof cap.command !== 'string' || cap.command.length === 0) {
    errors.push(`capability 缺少 command: ${JSON.stringify(cap)}`);
    continue;
  }
  if (seen.has(cap.command)) errors.push(`重复 command: ${cap.command}`);
  seen.add(cap.command);
  if (forbiddenGhostCommands.has(cap.command)) {
    errors.push(`发现已知幽灵命令 ${cap.command}，应由 holidays 子命令承载`);
  }
  if (!Array.isArray(cap.operations) || cap.operations.length === 0) {
    errors.push(`${cap.command}: operations 不能为空`);
  }
  if (!Array.isArray(cap.guards) || cap.guards.length === 0) {
    errors.push(`${cap.command}: guards 不能为空`);
  }
  if (!Array.isArray(cap.operationDetails)) {
    errors.push(`${cap.command}: operationDetails 必须是数组`);
  } else {
    const declaredOperations = [...new Set(cap.operations || [])].sort();
    const detailedOperations = cap.operationDetails
      .map((detail) => detail?.operation)
      .filter((operation) => typeof operation === 'string')
      .sort();
    if (JSON.stringify(declaredOperations) !== JSON.stringify(detailedOperations)) {
      errors.push(
        `${cap.command}: operationDetails 与 operations 不精确一致 declared=${declaredOperations.join(',')} detailed=${detailedOperations.join(',')}`
      );
    }
    for (const detail of cap.operationDetails) {
      if (!Array.isArray(detail?.guards) || detail.guards.length === 0) {
        errors.push(`${cap.command}.${detail?.operation}: guards 不能为空`);
      }
      if (!Array.isArray(detail?.permissions)) {
        errors.push(`${cap.command}.${detail?.operation}: permissions 必须是数组`);
      }
      const confirmations = ['none', 'dry-run', 'yes', 'preview-then-yes', 'conditional'];
      if (!confirmations.includes(detail?.confirmation)) {
        errors.push(
          `${cap.command}.${detail?.operation}: confirmation 非法 ${detail?.confirmation}`
        );
      }
      if (detail?.confirmation === 'conditional') {
        const policy = detail?.conditionalPolicy;
        const cases = policy?.cases;
        if (
          typeof policy?.selector !== 'string' ||
          policy.selector.length === 0 ||
          !cases ||
          typeof cases !== 'object' ||
          Object.keys(cases).length === 0 ||
          policy?.dryRunConfirmation !== 'none'
        ) {
          errors.push(
            `${cap.command}.${detail?.operation}: conditional confirmation 必须声明 selector/cases/dryRunConfirmation=none`
          );
        } else {
          for (const [value, variant] of Object.entries(cases)) {
            if (!['low', 'medium', 'high', 'admin'].includes(variant?.risk)) {
              errors.push(
                `${cap.command}.${detail?.operation}.${value}: conditional risk 非法 ${variant?.risk}`
              );
            }
            if (!confirmations.slice(0, -1).includes(variant?.confirmation)) {
              errors.push(
                `${cap.command}.${detail?.operation}.${value}: conditional confirmation 非法 ${variant?.confirmation}`
              );
            }
          }
        }
      } else if (detail?.conditionalPolicy !== undefined) {
        errors.push(
          `${cap.command}.${detail?.operation}: 仅 confirmation=conditional 可声明 conditionalPolicy`
        );
      }
      if (detail?.guards?.includes('role-permission') && detail.permissions?.length === 0) {
        errors.push(
          `${cap.command}.${detail?.operation}: role-permission guard 必须声明 permissions`
        );
      }
    }
  }
  if (
    cap.guards?.includes('role-permission') &&
    (!Array.isArray(cap.permissions) || cap.permissions.length === 0)
  ) {
    errors.push(`${cap.command}: role-permission guard 必须声明 permissions`);
  }
  const allDeclaredPermissions = new Set([
    ...(cap.permissions || []),
    ...(cap.operationDetails || []).flatMap((detail) => detail?.permissions || []),
  ]);
  for (const perm of allDeclaredPermissions) {
    capabilityPermissions.add(String(perm));
    const parts = String(perm).split('.');
    if (parts.length !== 3) {
      errors.push(`${cap.command}: permission 格式错误 ${perm}`);
      continue;
    }
    const [moduleKey, menuKey, action] = parts;
    if (!modules[moduleKey]?.menus?.[menuKey]) {
      errors.push(`${cap.command}: permission ${perm} 未登记到 MODULES`);
      continue;
    }
    if (!modulePermissionActions[moduleKey]?.[menuKey]?.includes(action)) {
      errors.push(
        `${cap.command}: action ${action} 不属于 ${moduleKey}.${menuKey} 的 MODULE_PERMISSION_ACTIONS`
      );
    }
  }
}

let coveredMenuCount = 0;
for (const [moduleKey, moduleConfig] of Object.entries(modules)) {
  for (const menuKey of Object.keys(moduleConfig.menus || {})) {
    const menuPermissionPrefix = `${moduleKey}.${menuKey}.`;
    const hasCapability = [...capabilityPermissions].some((permission) =>
      permission.startsWith(menuPermissionPrefix)
    );
    const menuKeyFull = `${moduleKey}.${menuKey}`;
    if (hasCapability) {
      coveredMenuCount += 1;
      continue;
    }
    if (!MENU_COVERAGE_ALLOWLIST.has(menuKeyFull)) {
      errors.push(
        `MODULES 菜单 ${menuKeyFull} 没有任何 CLI capability permission 覆盖；如确实不暴露给 Agent，请加入 MENU_COVERAGE_ALLOWLIST 并说明原因`
      );
    }
  }
}

let checkedControllerPermissions = 0;
for (const file of walk(SERVER_MODULES_DIR)) {
  for (const permission of collectControllerPermissions(file)) {
    checkedControllerPermissions += 1;
    const { moduleName, menuName, actionName, line } = permission;
    if (!moduleName || !menuName || !actionName) {
      errors.push(
        `${path.relative(ROOT, file)}:${line}: 无法静态解析 @RequirePermission/@RequireAnyPermission，请使用字符串字面量或 const 字符串`
      );
      continue;
    }
    const permissionKey = `${moduleName}.${menuName}.${actionName}`;
    if (!capabilityPermissions.has(permissionKey)) {
      const menuKeyFull = `${moduleName}.${menuName}`;
      if (MENU_COVERAGE_ALLOWLIST.has(menuKeyFull)) continue;
      errors.push(
        `${path.relative(ROOT, file)}:${line}: 后端权限 ${permissionKey} 未被任何 CLI capability permissions 声明`
      );
    }
  }
}

const requiredCommands = [
  'auth',
  'approvals',
  'finance',
  'activities',
  'system-params',
  'web-events',
  'seo-search-queries',
  'seo-page-insights',
  'seo-traffic-snapshots',
  'seo-sync-runs',
];
for (const command of requiredCommands) {
  if (!seen.has(command)) errors.push(`缺少必要 Agent capability: ${command}`);
}

if (errors.length > 0) {
  console.error('CLI capabilities 检查失败：');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(
  `CLI capabilities 检查通过，共 ${capabilities.length} 条能力，覆盖 ${coveredMenuCount} 个 system/roles 菜单，扫描后端权限 ${checkedControllerPermissions} 条。`
);
