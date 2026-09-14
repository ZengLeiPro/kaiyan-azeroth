#!/usr/bin/env node
/**
 * 后端 DTO 一致性检查脚本（支持 class-validator + nestjs-zod 双栈）
 *
 * 检查后端 DTO 文件是否符合规范：
 *
 * **新规范（推荐，nestjs-zod）**：
 * - Create/Update/Response DTO 使用 `createZodDto(xxxSchema)`
 * - Schema 必须来自 `@ky-azeroth/shared/schemas`
 *
 * **旧规范（兼容，class-validator）**：
 * - create-*.dto.ts 必须 implements ICreateXxx
 * - *-response.dto.ts 必须 implements IXxxResponse
 * - 必须从 @ky-azeroth/shared 导入类型
 * - DTO 类必须包含接口定义的所有属性（包括可选属性）
 *
 * 使用方式：node scripts/check-dto-implements.js
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const MODULES_DIR = path.join(__dirname, '../apps/server/src/modules');
const SHARED_TYPES_DIR = path.join(__dirname, '../packages/shared/src/types');

// 需要排除的目录
const EXCLUDE_DIRS = ['common', 'health', 'internal'];

// 检查结果
const fatalErrors = []; // 阻断性错误（缺少 implements）
const fieldErrors = []; // 字段缺失错误（暂时仅警告，未来可改为阻断）
const warnings = [];
let checkedFiles = 0;

// 缓存 Shared Interfaces 定义
// Map<InterfaceName, { filePath: string, properties: Set<string> }>
const sharedInterfaces = new Map();

/**
 * 解析 Typescript 文件获取 AST
 */
function parseFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf-8');
  return ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
}

/**
 * 预加载所有 Shared Interfaces 定义
 */
function loadSharedInterfaces() {
  console.log('正在加载 Shared Interfaces 定义...');

  function scanDir(dir) {
    if (!fs.existsSync(dir)) return;
    const items = fs.readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        scanDir(fullPath);
      } else if (item.isFile() && item.name.endsWith('.ts')) {
        extractInterfacesFromFile(fullPath);
      }
    }
  }

  function extractInterfacesFromFile(filePath) {
    const sourceFile = parseFile(filePath);
    if (!sourceFile) return;

    function visit(node) {
      if (ts.isInterfaceDeclaration(node)) {
        const interfaceName = node.name.text;
        const properties = new Set();

        node.members.forEach((member) => {
          if (ts.isPropertySignature(member) && ts.isIdentifier(member.name)) {
            properties.add(member.name.text);
          }
        });

        sharedInterfaces.set(interfaceName, {
          filePath: path.relative(process.cwd(), filePath),
          properties,
        });
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  scanDir(SHARED_TYPES_DIR);
  console.log(`已加载 ${sharedInterfaces.size} 个接口定义\n`);
}

/**
 * 递归查找所有 DTO 文件
 */
function findDtoFiles(dir) {
  const files = [];

  if (!fs.existsSync(dir)) {
    return files;
  }

  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dir, item.name);

    if (item.isDirectory()) {
      if (EXCLUDE_DIRS.includes(item.name)) {
        continue;
      }
      files.push(...findDtoFiles(fullPath));
    } else if (item.isFile() && item.name.endsWith('.dto.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * 检查单个 DTO 文件
 */
function checkDtoFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const relativePath = path.relative(process.cwd(), filePath);
  const fileName = path.basename(filePath);
  const fileFatalErrors = [];
  const fileFieldErrors = [];
  const fileWarnings = [];

  const sourceFile = parseFile(filePath);
  if (!sourceFile) {
    fileFatalErrors.push('无法解析文件');
    return {
      filePath: relativePath,
      fatalErrors: fileFatalErrors,
      fieldErrors: fileFieldErrors,
      warnings: fileWarnings,
    };
  }

  // 检查 1: 是否从 @ky-azeroth/shared 导入
  const hasSharedImport =
    content.includes("from '@ky-azeroth/shared") || content.includes('from "@ky-azeroth/shared');

  // 检查 2: 是否使用了 any 类型
  if (content.match(/:\s*any\b/)) {
    fileWarnings.push(`发现 any 类型使用`);
  }

  // 检查 3: 是否使用 @ts-ignore
  if (content.includes('@ts-ignore')) {
    fileFatalErrors.push('禁止使用 @ts-ignore，请使用 @ts-expect-error 并说明原因');
  }

  // 检查 4: 接口实现完整性
  let checkedClass = false;

  // 收集文件内定义的类，用于处理继承
  const localClasses = new Map();
  function collectClasses(node) {
    if (ts.isClassDeclaration(node) && node.name) {
      localClasses.set(node.name.text, node);
    }
    ts.forEachChild(node, collectClasses);
  }
  collectClasses(sourceFile);

  // NestJS mapped type 函数列表
  const mappedTypeFunctions = ['PartialType', 'OmitType', 'PickType', 'IntersectionType'];

  // 追踪是否使用了跨文件的 mapped type 继承
  let usesCrossFileMappedType = false;

  function getClassProperties(node) {
    const props = new Set();
    // 自身属性
    node.members.forEach((member) => {
      if (ts.isPropertyDeclaration(member) && ts.isIdentifier(member.name)) {
        props.add(member.name.text);
      }
    });

    // 继承属性 (支持同一文件内的继承和 NestJS mapped types)
    if (node.heritageClauses) {
      node.heritageClauses.forEach((clause) => {
        if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
          clause.types.forEach((type) => {
            let parentName = '';
            let omittedKeys = [];
            let pickedKeys = [];
            let isMappedType = false;

            // 检查是否是 NestJS mapped type 函数调用 (如 PartialType(BaseClass))
            if (ts.isCallExpression(type.expression)) {
              const funcExpr = type.expression.expression;
              const funcName = funcExpr ? funcExpr.getText() : '';

              if (mappedTypeFunctions.includes(funcName) && type.expression.arguments.length > 0) {
                isMappedType = true;
                // 获取第一个参数作为父类名
                parentName = type.expression.arguments[0].getText();

                // 对于 OmitType，获取要排除的键
                if (funcName === 'OmitType' && type.expression.arguments.length > 1) {
                  const keysArg = type.expression.arguments[1];
                  if (ts.isArrayLiteralExpression(keysArg)) {
                    keysArg.elements.forEach((elem) => {
                      if (ts.isStringLiteral(elem)) {
                        omittedKeys.push(elem.text);
                      }
                    });
                  }
                }

                // 对于 PickType，获取要选取的键
                if (funcName === 'PickType' && type.expression.arguments.length > 1) {
                  const keysArg = type.expression.arguments[1];
                  if (ts.isArrayLiteralExpression(keysArg)) {
                    keysArg.elements.forEach((elem) => {
                      if (ts.isStringLiteral(elem)) {
                        pickedKeys.push(elem.text);
                      }
                    });
                  }
                }

                // 对于 IntersectionType，可能有多个参数，递归处理
                if (funcName === 'IntersectionType') {
                  type.expression.arguments.forEach((arg) => {
                    const argName = arg.getText();
                    if (localClasses.has(argName)) {
                      const parentProps = getClassProperties(localClasses.get(argName));
                      parentProps.forEach((p) => props.add(p));
                    }
                  });
                  return; // IntersectionType 已处理完毕
                }
              }
            } else {
              // 普通继承: extends BaseClass
              parentName = type.expression.getText();
            }

            // 如果找到了父类名，获取其属性
            if (parentName && localClasses.has(parentName)) {
              const parentProps = getClassProperties(localClasses.get(parentName));

              if (pickedKeys.length > 0) {
                // PickType: 只添加选取的键
                pickedKeys.forEach((key) => {
                  if (parentProps.has(key)) {
                    props.add(key);
                  }
                });
              } else {
                // PartialType 或 OmitType 或普通继承
                parentProps.forEach((p) => {
                  if (!omittedKeys.includes(p)) {
                    props.add(p);
                  }
                });
              }
            } else if (parentName && isMappedType) {
              // 父类来自其他文件且使用了 mapped type (如 PartialType)
              // 无法获取父类属性，标记跳过字段完整性检查
              // 因为 TypeScript 编译器已经会检查类型是否正确实现接口
              usesCrossFileMappedType = true;
            }
          });
        }
      });
    }
    return props;
  }

  function visit(node) {
    if (ts.isClassDeclaration(node)) {
      const className = node.name?.text;
      if (!className) return;

      let implementsCorrectInterface = false;

      // 检查 4a: 检查是否使用了 createZodDto 继承
      if (node.heritageClauses) {
        node.heritageClauses.forEach((clause) => {
          if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
            clause.types.forEach((type) => {
              if (ts.isCallExpression(type.expression)) {
                const funcName = type.expression.expression.getText();
                if (funcName === 'createZodDto') {
                  // 如果使用了 createZodDto，认为已经通过校验（因为 Zod Schema 本身会保证一致性）
                  checkedClass = true;
                  implementsCorrectInterface = true;
                }
              }
            });
          }
        });
      }

      // 检查 4b: 查找 implements 子句 (传统方式)
      if (!implementsCorrectInterface && node.heritageClauses) {
        node.heritageClauses.forEach((clause) => {
          if (clause.token === ts.SyntaxKind.ImplementsKeyword) {
            clause.types.forEach((type) => {
              const interfaceName = type.expression.getText();

              // 验证 implements 命名规范
              // 只有当类名也符合 CreateXxxDto 格式时才强制
              if (
                fileName.startsWith('create-') &&
                className.startsWith('Create') &&
                !interfaceName.startsWith('ICreate')
              ) {
                fileFatalErrors.push(
                  `Create DTO 应该实现 ICreateXxx 接口，当前实现: ${interfaceName}`
                );
              }
              // 只有当类名也符合 XxxResponseDto 格式时才强制
              if (
                fileName.endsWith('-response.dto.ts') &&
                className.endsWith('ResponseDto') &&
                !interfaceName.endsWith('Response') &&
                !interfaceName.endsWith('Item') &&
                !interfaceName.endsWith('ListItem')
              ) {
                fileFatalErrors.push(
                  `Response DTO 应该实现 IXxxResponse/Item/ListItem 接口，当前实现: ${interfaceName}`
                );
              }

              // 检查字段完整性
              if (sharedInterfaces.has(interfaceName)) {
                checkedClass = true;
                implementsCorrectInterface = true;
                // 重置跨文件 mapped type 标志
                usesCrossFileMappedType = false;
                const interfaceDef = sharedInterfaces.get(interfaceName);
                const classProperties = getClassProperties(node);

                // 如果使用了跨文件的 mapped type (如 PartialType(ExternalClass))
                // 跳过字段完整性检查，因为 TypeScript 编译器已经会验证
                if (usesCrossFileMappedType) {
                  return;
                }

                // 找出缺失的字段
                const missingFields = [];
                interfaceDef.properties.forEach((prop) => {
                  if (!classProperties.has(prop)) {
                    missingFields.push(prop);
                  }
                });

                if (missingFields.length > 0) {
                  fileFieldErrors.push(
                    `类 ${className} 实现了 ${interfaceName}，但缺失以下字段: ${missingFields.join(', ')}`
                  );
                }
              }
            });
          }
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  // 针对特定文件类型的额外检查（已迁移到 nestjs-zod，不再需要此兜底检查）
  // 如果 AST 已经检查过（implements 或 createZodDto），则跳过
  if (fileName.startsWith('create-') && !checkedClass) {
    // 兜底检查：确保至少有 shared 导入或 createZodDto
    const hasCreateZodDto = content.includes('createZodDto');
    const hasImplements = /class\s+\w+Dto\s+(extends\s+\S+\s+)?implements\s+ICreate\w+/.test(
      content
    );

    if (!hasSharedImport && !hasCreateZodDto) {
      fileFatalErrors.push(
        '缺少 @ky-azeroth/shared 导入，create DTO 必须使用 shared types/schemas'
      );
    } else if (!hasImplements && !hasCreateZodDto) {
      fileFatalErrors.push('create DTO 必须 implements ICreateXxx 接口或使用 createZodDto(schema)');
    }
  }

  return {
    filePath: relativePath,
    fatalErrors: fileFatalErrors,
    fieldErrors: fileFieldErrors,
    warnings: fileWarnings,
  };
}

/**
 * 主函数
 */
function main() {
  console.log('检查后端 DTO implements 一致性 (Enhanced)...\n');

  try {
    loadSharedInterfaces();
  } catch (e) {
    console.error('加载 Shared Interfaces 失败:', e);
    process.exit(1);
  }

  const dtoFiles = findDtoFiles(MODULES_DIR);

  if (dtoFiles.length === 0) {
    console.log('未找到 DTO 文件');
    process.exit(0);
  }

  for (const file of dtoFiles) {
    const result = checkDtoFile(file);
    checkedFiles++;

    if (result.fatalErrors.length > 0) {
      fatalErrors.push({ file: result.filePath, messages: result.fatalErrors });
    }
    if (result.fieldErrors.length > 0) {
      fieldErrors.push({ file: result.filePath, messages: result.fieldErrors });
    }
    if (result.warnings.length > 0) {
      warnings.push({ file: result.filePath, messages: result.warnings });
    }
  }

  // 输出结果
  console.log(`已检查 ${checkedFiles} 个 DTO 文件\n`);

  if (fatalErrors.length > 0) {
    console.log('错误（必须修复）:');
    console.log('================');
    for (const { file, messages } of fatalErrors) {
      console.log(`\n  ${file}:`);
      for (const msg of messages) {
        console.log(`    - ${msg}`);
      }
    }
    console.log('');
  }

  if (fieldErrors.length > 0) {
    console.log('字段缺失（建议修复，未来将转为错误）:');
    console.log('==================================');
    for (const { file, messages } of fieldErrors) {
      console.log(`\n  ${file}:`);
      for (const msg of messages) {
        console.log(`    - ${msg}`);
      }
    }
    console.log('');
  }

  if (warnings.length > 0) {
    console.log('警告（建议修复）:');
    console.log('================');
    for (const { file, messages } of warnings) {
      console.log(`\n  ${file}:`);
      for (const msg of messages) {
        console.log(`    - ${msg}`);
      }
    }
    console.log('');
  }

  // 只有 fatal errors 导致失败
  if (fatalErrors.length > 0) {
    console.log(`发现 ${fatalErrors.length} 个文件存在严重错误，请修复后再提交。`);
    process.exit(1);
  }

  if (fieldErrors.length > 0) {
    console.log(`发现 ${fieldErrors.length} 个文件存在字段缺失，请尽快修复。`);
  }

  console.log('DTO implements 检查通过！');
  process.exit(0);
}

main();
