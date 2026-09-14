#!/usr/bin/env node
/**
 * Controller Query DTO 覆盖率检查脚本（增强版）
 *
 * 目标（rules.md MUST #5）：
 * - 任何包含分页/筛选/排序参数的列表接口必须使用 @Query() QueryXxxDto 整体接入
 * - 禁止在 controller 层手写 @Query('page') / parseInt 等参数解析与默认值
 *
 * 增强后的覆盖范围：
 * 1. 原有检查：根路径列表接口 @Get() + findAll（保持严格）
 * 2. 新增扫描：全量 @Query('xxx') 手写参数（默认警告，特殊场景提升为错误）
 * 3. 支持 allowlist（白名单机制）
 *
 * 输出：
 * - errors：阻断提交/CI（exit 1）
 * - warnings：不阻断（exit 0），但需要在合理时间内收敛
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const MODULES_DIR = path.join(__dirname, '../apps/server/src/modules');

// ============ Allowlist 配置 ============
// 允许手写 @Query 的方法名单（格式：'文件路径:方法名' 或仅 '方法名'）
// 原因：这些是合理例外（非列表场景、辅助计算端点、简单查询等）
const ALLOWLIST = [
  // inventory: 单产品库存查询（by-product 模式，类似详情而非列表）
  'inventory.controller.ts:findByProduct',

  // production-plans: 计算辅助端点（不涉及分页/列表）
  'production-plans.controller.ts:calculateMaterialsQuery',

  // upload proxy-download: 文件下载场景
  'upload.controller.ts:proxyDownload',
  'upload.controller.ts:proxyUpload',

  // BOM expand: 树形结构展开场景
  'boms.controller.ts:expand',
  'boms.controller.ts:expandMultiLevel',

  // tasks: 系统任务内部接口
  'tasks.controller.ts:refreshForecastCache',

  // employees: 下拉选择器（无分页，简单筛选）
  'employees.controller.ts:findAllForSelection',

  // production-plans: 待排产计划查询（辅助查询，无分页）
  'production-plans.controller.ts:getPendingStorePlans',
];

// ============ 分页关键词（命中则提升为错误） ============
const PAGINATION_KEYWORDS = ['page', 'pageSize', 'sortBy', 'sortOrder', 'limit', 'offset'];

const errors = [];
const warnings = [];
let checkedFiles = 0;
let checkedListMethods = 0;
let foundHandwrittenQueries = 0;

const ALLOWED_METHOD_NAME = 'findAll';
const WRITE_QUERY_DECORATOR = 'Query';
const LIST_ROUTE_DECORATOR = 'Get';
const SWAGGER_APIQUERY_DECORATOR = 'ApiQuery';

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
  // @Get() / @ApiQuery(...) / @Query('page')
  const expr = decorator.expression;
  if (ts.isCallExpression(expr)) {
    if (ts.isIdentifier(expr.expression)) return expr.expression.text;
    return expr.expression.getText(sourceFile);
  }
  if (ts.isIdentifier(expr)) return expr.text;
  return expr.getText(sourceFile);
}

function isRootGetDecorator(decorator, sourceFile) {
  const expr = decorator.expression;

  // 支持 @Get（无括号）
  if (ts.isIdentifier(expr) && expr.text === LIST_ROUTE_DECORATOR) return true;

  if (!ts.isCallExpression(expr)) return false;
  if (!ts.isIdentifier(expr.expression) || expr.expression.text !== LIST_ROUTE_DECORATOR)
    return false;

  // @Get() 或 @Get('') 认为是根路径
  if (expr.arguments.length === 0) return true;
  const firstArg = expr.arguments[0];
  if (ts.isStringLiteral(firstArg) && firstArg.text.trim() === '') return true;

  // @Get('xxx') 非根路径
  return false;
}

function getQueryDecoratorArg(decorator) {
  const expr = decorator.expression;
  if (!ts.isCallExpression(expr)) return { kind: 'unknown' };
  if (expr.arguments.length === 0) return { kind: 'object' }; // @Query()
  const firstArg = expr.arguments[0];
  if (ts.isStringLiteral(firstArg)) return { kind: 'field', name: firstArg.text };
  return { kind: 'unknown' };
}

function isLikelyQueryDtoType(typeText) {
  // 形如 QueryXxxDto
  return /^Query\w+Dto$/.test(typeText);
}

function isInAllowlist(filePath, methodName) {
  const fileName = path.basename(filePath);
  const relativePath = path.relative(process.cwd(), filePath);

  // 精确匹配：相对路径 + 方法名
  if (ALLOWLIST.includes(`${relativePath}:${methodName}`)) return true;
  // 仅方法名匹配
  if (ALLOWLIST.includes(methodName)) return true;
  // 文件名 + 方法名
  if (ALLOWLIST.includes(`${fileName}:${methodName}`)) return true;

  return false;
}

function collectPropertyAccessUsages(sourceFile, bodyNode, identifierName) {
  let used = false;
  function visit(n) {
    if (ts.isPropertyAccessExpression(n)) {
      if (ts.isIdentifier(n.expression) && n.expression.text === identifierName) {
        used = true;
        return;
      }
    }
    ts.forEachChild(n, visit);
  }
  visit(bodyNode);
  return used;
}

function checkHandwrittenQueryParam(filePath, sourceFile, node, methodName) {
  const decorators = getDecorators(node);
  const line = getLineNumber(sourceFile, node);
  const relativePath = path.relative(process.cwd(), filePath);

  // 检查是否有 @Query('xxx') 手写参数
  let handwrittenParams = [];

  for (const param of node.parameters) {
    const pDecs = getDecorators(param);
    for (const d of pDecs) {
      const decName = getDecoratorCallName(d, sourceFile);
      if (decName !== WRITE_QUERY_DECORATOR) continue;

      const argInfo = getQueryDecoratorArg(d);
      if (argInfo.kind === 'field') {
        handwrittenParams.push(argInfo.name);
      }
    }
  }

  if (handwrittenParams.length === 0) return;

  foundHandwrittenQueries++;

  // 检查是否在白名单中
  if (isInAllowlist(filePath, methodName)) {
    return; // 白名单内的不报错
  }

  // 判断是否提升为错误
  const hasApiQuery = decorators.some(
    (d) => getDecoratorCallName(d, sourceFile) === SWAGGER_APIQUERY_DECORATOR
  );

  const hasPaginationKeyword = handwrittenParams.some((p) =>
    PAGINATION_KEYWORDS.some((kw) => p.toLowerCase().includes(kw.toLowerCase()))
  );

  // 有 @ApiQuery 声明 或 使用分页参数 → 提升为错误
  if (hasApiQuery || hasPaginationKeyword) {
    errors.push({
      file: relativePath,
      line,
      message: `方法 ${methodName}() 使用了 @Query('${handwrittenParams.join("', '")}') 手写参数，应整体接入 Query DTO`,
    });
  } else {
    warnings.push({
      file: relativePath,
      line,
      message: `方法 ${methodName}() 使用了 @Query('${handwrittenParams.join("', '")}') 手写参数，建议补充 Query DTO（无分页/筛选可视为合理例外）`,
    });
  }
}

function checkControllerFile(filePath) {
  const sourceFile = parseFile(filePath);
  if (!sourceFile) return;

  const relativePath = path.relative(process.cwd(), filePath);

  function visit(node) {
    if (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
      const methodName = node.name.text;

      // ============ 原有检查：@Get() + findAll（保持严格） ============
      if (methodName === ALLOWED_METHOD_NAME) {
        const decorators = getDecorators(node);
        const hasRootGet = decorators.some((d) => isRootGetDecorator(d, sourceFile));

        if (hasRootGet) {
          checkedListMethods++;

          // 检查方法参数：@Query() 整体 DTO vs @Query('xxx') 单字段
          let hasQueryObjectParam = false;
          let queryObjectParamName = null;
          let queryObjectParamType = null;
          const illegalFieldQueries = [];

          for (const param of node.parameters) {
            const pDecs = getDecorators(param);
            for (const d of pDecs) {
              const decName = getDecoratorCallName(d, sourceFile);
              if (decName !== WRITE_QUERY_DECORATOR) continue;

              const argInfo = getQueryDecoratorArg(d);
              if (argInfo.kind === 'object') {
                hasQueryObjectParam = true;
                if (ts.isIdentifier(param.name)) {
                  queryObjectParamName = param.name.text;
                }
                if (param.type) {
                  queryObjectParamType = param.type.getText(sourceFile);
                }
              } else if (argInfo.kind === 'field') {
                illegalFieldQueries.push(argInfo.name);
              }
            }
          }

          const line = getLineNumber(sourceFile, node);

          const hasApiQuery = decorators.some(
            (d) => getDecoratorCallName(d, sourceFile) === SWAGGER_APIQUERY_DECORATOR
          );

          const hasAnyQueryUsage =
            hasQueryObjectParam || illegalFieldQueries.length > 0 || hasApiQuery;

          if (hasAnyQueryUsage) {
            if (illegalFieldQueries.length > 0) {
              errors.push({
                file: relativePath,
                line,
                message: `列表接口应整体接入 Query DTO，禁止在 controller 中使用 @Query('...')：${illegalFieldQueries.join(
                  ', '
                )}`,
              });
            }

            if (!hasQueryObjectParam) {
              errors.push({
                file: relativePath,
                line,
                message: `列表接口包含 query 参数时必须使用 @Query() QueryXxxDto 整体接入（未找到 @Query() 参数）`,
              });
            } else {
              if (!queryObjectParamType) {
                errors.push({
                  file: relativePath,
                  line,
                  message: `@Query() 参数必须显式标注类型（应为 QueryXxxDto）`,
                });
              } else if (!isLikelyQueryDtoType(queryObjectParamType)) {
                errors.push({
                  file: relativePath,
                  line,
                  message: `@Query() 参数类型疑似不规范："${queryObjectParamType}"（期望形如 QueryXxxDto）`,
                });
              }
            }

            // 冗余 Swagger @ApiQuery（警告）
            if (hasApiQuery && hasQueryObjectParam) {
              warnings.push({
                file: relativePath,
                line,
                message: `检测到 @ApiQuery 声明，但列表接口已使用 Query DTO，可能存在冗余 Swagger 注解`,
              });
            }
          }

          // Controller 层解构 query（警告）
          if (node.body && queryObjectParamName) {
            const used = collectPropertyAccessUsages(sourceFile, node.body, queryObjectParamName);
            if (used) {
              warnings.push({
                file: relativePath,
                line,
                message: `检测到在 controller 中直接访问 ${queryObjectParamName}.xxx（建议将解构下沉到 service 内部）`,
              });
            }
          }
        }
      }

      // ============ 新增检查：全量 @Query('xxx') 手写参数扫描 ============
      checkHandwrittenQueryParam(filePath, sourceFile, node, methodName);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  checkedFiles++;
}

function main() {
  console.log('检查 Controller Query DTO 覆盖率...\n');

  const controllerFiles = findControllerFiles(MODULES_DIR);
  if (controllerFiles.length === 0) {
    console.log('未找到 controller 文件');
    process.exit(0);
  }

  for (const file of controllerFiles) {
    checkControllerFile(file);
  }

  console.log(
    `已检查 ${checkedFiles} 个 controller 文件，命中 ${checkedListMethods} 个列表接口（@Get() + findAll）`
  );
  console.log(`发现 ${foundHandwrittenQueries} 个手写 @Query 参数方法\n`);

  const separator = '='.repeat(50);

  if (errors.length > 0) {
    console.log('错误（必须修复）:');
    console.log(separator);
    for (const e of errors) {
      console.log(`  ${e.file}:${e.line}`);
      console.log(`    ${e.message}`);
    }
    console.log('');
  }

  if (warnings.length > 0) {
    console.log('警告（建议修复）:');
    console.log(separator);
    for (const w of warnings) {
      console.log(`  ${w.file}:${w.line}`);
      console.log(`    ${w.message}`);
    }
    console.log('');
  }

  if (errors.length > 0) {
    console.log(`检查失败：发现 ${errors.length} 处问题。`);
    console.log('');
    console.log('修复建议：');
    console.log('  1. 列表接口必须使用 @Query() QueryXxxDto 整体接入');
    console.log("  2. 禁止在 controller 中使用 @Query('field') 手写参数解析");
    process.exit(1);
  }

  console.log('Controller Query DTO 覆盖率检查通过！');
  if (warnings.length > 0) {
    console.log(`（含 ${warnings.length} 个警告，建议在后续迭代中收敛）`);
  }
  process.exit(0);
}

main();
