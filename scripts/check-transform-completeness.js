#!/usr/bin/env node
/**
 * 转换函数字段完整性检查脚本
 *
 * 检查前端 types.ts 中的 toXxxProfile 转换函数是否包含了对应 IXxxResponse 接口的所有字段。
 *
 * 检查逻辑：
 * 1. 扫描 packages/shared/src/types/ 目录，收集所有 IXxxResponse 接口的字段定义
 * 2. 扫描 apps/web/src/pages/**\/types.ts 文件
 * 3. 找到 export function toXxxProfile(data: IXxxResponse): XxxProfile 形式的函数
 * 4. 分析函数的返回对象，检查是否包含 IXxxResponse 的所有字段
 * 5. 报告可能遗漏的字段
 *
 * 特殊处理：
 * - { ...data } 展开运算符 - 认为包含了所有字段
 * - { ...data, extraField: xxx } - 同上
 * - return data; - 认为包含了所有字段
 * - 显式列出的字段 - 逐个检查
 *
 * 使用方式：node scripts/check-transform-completeness.js
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const SHARED_TYPES_DIR = path.join(__dirname, '../packages/shared/src/types');
const PAGES_DIR = path.join(__dirname, '../apps/web/src/pages');

// 存储 IXxxResponse 接口定义
// Map<InterfaceName, { filePath: string, properties: Map<string, { optional: boolean, hasNull: boolean }> }>
const responseInterfaces = new Map();

// 检查结果
const warnings = [];
let checkedFunctions = 0;
let checkedFiles = 0;

/**
 * 解析 TypeScript 文件获取 AST
 */
function parseFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf-8');
  return ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
}

// ==================== 1. 收集 IXxxResponse 接口定义 ====================

/**
 * 预加载所有 IXxxResponse 接口定义
 */
function loadResponseInterfaces() {
  console.log('正在加载 IXxxResponse 接口定义...');

  function scanDir(dir) {
    if (!fs.existsSync(dir)) return;
    const items = fs.readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        scanDir(fullPath);
      } else if (item.isFile() && item.name.endsWith('.ts')) {
        extractResponseInterfaces(fullPath);
      }
    }
  }

  function extractResponseInterfaces(filePath) {
    const sourceFile = parseFile(filePath);
    if (!sourceFile) return;

    // 先收集所有接口，用于处理继承
    const allInterfaces = new Map();

    function collectInterfaces(node) {
      if (ts.isInterfaceDeclaration(node)) {
        const interfaceName = node.name.text;
        allInterfaces.set(interfaceName, node);
      }
      ts.forEachChild(node, collectInterfaces);
    }

    collectInterfaces(sourceFile);

    // 获取接口的所有属性（包括继承的）
    function getInterfaceProperties(interfaceNode, visited = new Set()) {
      const properties = new Map();

      if (visited.has(interfaceNode.name.text)) {
        return properties; // 避免循环继承
      }
      visited.add(interfaceNode.name.text);

      // 处理继承
      if (interfaceNode.heritageClauses) {
        for (const clause of interfaceNode.heritageClauses) {
          if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
            for (const type of clause.types) {
              const parentName = type.expression.getText(sourceFile);
              const parentInterface = allInterfaces.get(parentName);
              if (parentInterface) {
                const parentProps = getInterfaceProperties(parentInterface, visited);
                parentProps.forEach((value, key) => properties.set(key, value));
              }
            }
          }
        }
      }

      // 自身属性
      interfaceNode.members.forEach((member) => {
        if (ts.isPropertySignature(member) && ts.isIdentifier(member.name)) {
          const fieldName = member.name.text;
          const hasQuestion = !!member.questionToken;
          const hasNull = member.type ? isNullableType(member.type) : false;
          properties.set(fieldName, { optional: hasQuestion, hasNull });
        }
      });

      return properties;
    }

    // 只保存 IXxxResponse 接口
    for (const [name, node] of allInterfaces) {
      if (name.endsWith('Response') && name.startsWith('I')) {
        const properties = getInterfaceProperties(node);
        responseInterfaces.set(name, {
          filePath: path.relative(process.cwd(), filePath),
          properties,
        });
      }
    }
  }

  scanDir(SHARED_TYPES_DIR);
  console.log(`已加载 ${responseInterfaces.size} 个 IXxxResponse 接口定义\n`);
}

/**
 * 检查类型是否包含 null
 */
function isNullableType(typeNode) {
  if (ts.isUnionTypeNode(typeNode)) {
    return typeNode.types.some(
      (t) =>
        t.kind === ts.SyntaxKind.NullKeyword ||
        (ts.isLiteralTypeNode(t) && t.literal.kind === ts.SyntaxKind.NullKeyword)
    );
  }
  return typeNode.kind === ts.SyntaxKind.NullKeyword;
}

// ==================== 2. 检查 toXxxProfile 函数 ====================

/**
 * 递归查找所有 types.ts 文件
 */
function findTypesFiles(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;

  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      files.push(...findTypesFiles(fullPath));
    } else if (item.isFile() && item.name === 'types.ts') {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * 检查单个 types.ts 文件中的 toXxxProfile 函数
 */
function checkTypesFile(filePath) {
  const sourceFile = parseFile(filePath);
  if (!sourceFile) return;

  const relativePath = path.relative(process.cwd(), filePath);
  const fileWarnings = [];
  let foundFunctions = 0;

  function visit(node) {
    // 查找 export function toXxxProfile(data: IXxxResponse): XxxProfile
    if (ts.isFunctionDeclaration(node) && node.name) {
      const funcName = node.name.text;

      // 匹配 toXxxProfile 模式
      if (funcName.startsWith('to') && funcName.endsWith('Profile')) {
        foundFunctions++;
        checkedFunctions++;

        // 获取参数类型
        const params = node.parameters;
        if (params.length === 0) return;

        const firstParam = params[0];
        if (!firstParam.type) return;

        // 获取参数类型名称
        let paramTypeName = '';
        if (ts.isTypeReferenceNode(firstParam.type)) {
          paramTypeName = firstParam.type.typeName.getText(sourceFile);
        }

        // 只检查参数类型是 IXxxResponse 的函数
        if (!paramTypeName.endsWith('Response') || !paramTypeName.startsWith('I')) {
          return;
        }

        // 查找对应的接口定义
        const interfaceDef = responseInterfaces.get(paramTypeName);
        if (!interfaceDef) {
          // 找不到接口定义，跳过
          return;
        }

        // 分析函数体
        if (!node.body) return;

        // 获取函数参数名（用于识别 ...paramName 展开运算符）
        const paramNames = params.map((p) => p.name.getText(sourceFile));

        const returnAnalysis = analyzeReturnStatement(node.body, sourceFile, paramNames);

        if (returnAnalysis.hasSpreadData) {
          // 使用了 ...data 展开运算符，认为包含了所有字段
          return;
        }

        if (returnAnalysis.returnsDataDirectly) {
          // 直接 return data; 认为包含了所有字段
          return;
        }

        if (returnAnalysis.delegatesToOtherFunction) {
          // 委托给其他函数，无法分析，跳过检查
          return;
        }

        // 检查显式列出的字段
        const returnedFields = returnAnalysis.explicitFields;
        const missingFields = [];

        for (const [fieldName, fieldInfo] of interfaceDef.properties) {
          // 跳过可选字段和可为 null 的字段（这些通常可以省略）
          if (fieldInfo.optional || fieldInfo.hasNull) {
            continue;
          }

          if (!returnedFields.has(fieldName)) {
            missingFields.push(fieldName);
          }
        }

        if (missingFields.length > 0) {
          fileWarnings.push({
            funcName,
            paramType: paramTypeName,
            missingFields,
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  if (foundFunctions > 0) {
    checkedFiles++;
  }

  if (fileWarnings.length > 0) {
    warnings.push({
      file: relativePath,
      issues: fileWarnings,
    });
  }
}

/**
 * 分析函数体中的 return 语句
 */
function analyzeReturnStatement(body, sourceFile, paramNames = []) {
  const result = {
    hasSpreadData: false,
    returnsDataDirectly: false,
    delegatesToOtherFunction: false,
    explicitFields: new Set(),
  };

  function visit(node) {
    if (ts.isReturnStatement(node) && node.expression) {
      const expr = node.expression;

      // return data; - 直接返回参数
      if (ts.isIdentifier(expr)) {
        const name = expr.text;
        if (
          name === 'data' ||
          name === 'entity' ||
          name === 'response' ||
          paramNames.includes(name)
        ) {
          result.returnsDataDirectly = true;
          return;
        }
      }

      // return toOtherFunction(data); - 委托给其他函数
      if (ts.isCallExpression(expr)) {
        // 委托给其他函数，无法分析，跳过检查
        result.delegatesToOtherFunction = true;
        return;
      }

      // return { ... }; - 对象字面量
      if (ts.isObjectLiteralExpression(expr)) {
        for (const prop of expr.properties) {
          // { ...data } 展开运算符
          if (ts.isSpreadAssignment(prop)) {
            const spreadExpr = prop.expression;
            if (ts.isIdentifier(spreadExpr)) {
              const name = spreadExpr.text;
              if (
                name === 'data' ||
                name === 'entity' ||
                name === 'response' ||
                paramNames.includes(name)
              ) {
                result.hasSpreadData = true;
              }
            }
          }

          // 显式字段 { fieldName: xxx } 或 { fieldName }
          if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
            result.explicitFields.add(prop.name.text);
          }

          // 简写属性 { fieldName }
          if (ts.isShorthandPropertyAssignment(prop)) {
            result.explicitFields.add(prop.name.text);
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(body);
  return result;
}

// ==================== 3. 主函数 ====================

function main() {
  console.log('检查转换函数字段映射完整性...\n');

  // 加载 IXxxResponse 接口定义
  loadResponseInterfaces();

  // 查找并检查所有 types.ts 文件
  const typesFiles = findTypesFiles(PAGES_DIR);

  for (const file of typesFiles) {
    checkTypesFile(file);
  }

  // 输出结果
  console.log(`已检查 ${checkedFiles} 个 types.ts 文件，发现 ${checkedFunctions} 个转换函数\n`);

  if (warnings.length > 0) {
    const separator = '='.repeat(50);
    console.log('错误（必须修复）:');
    console.log(separator);
    for (const { file, issues } of warnings) {
      for (const issue of issues) {
        console.log(`  ${file}`);
        console.log(
          `    ${issue.funcName} 函数可能缺少以下字段: ${issue.missingFields.join(', ')}（参数类型: ${issue.paramType}）`
        );
      }
    }
    console.log('');
    console.log(`检查失败：发现 ${warnings.length} 处问题。`);
    console.log('');
    console.log('修复建议：');
    console.log(
      '  确保 toXxxProfile 函数包含 IXxxResponse 的所有必填字段，或使用 { ...data } 展开运算符。'
    );
    process.exit(1);
  }

  console.log('转换函数字段完整性检查通过！');
  process.exit(0);
}

main();
