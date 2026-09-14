#!/usr/bin/env node
/**
 * Shared 包导入一致性检查脚本
 *
 * 检查前端 types.ts 文件是否正确使用 shared 包：
 * 1. 必须从 @ky-azeroth/shared 导入类型
 * 2. Profile 类型必须使用 extends（而非 = 别名）
 * 3. 必须包含转换函数 toXxxProfile 和 toXxxFormData
 * 4. [v1.1] Profile 命名与返回类型一致性
 * 5. [v1.1] 禁止 I* 前缀的 UI-only 接口导出
 * 6. [v1.1] 禁止 as XxxProfile 强转
 * 7. [v1.1] 禁止 Profile extends Omit<...> 改写 shared 结构
 *
 * 使用方式：node scripts/check-shared-imports.js
 * 环境变量：STRICT=1 时将新增检测项升级为错误（默认仅警告）
 */

const fs = require('fs');
const path = require('path');

const PAGES_DIR = path.join(__dirname, '../apps/web/src/pages');
const SHARED_TYPES_DIR = path.join(__dirname, '../packages/shared/src/types');

// STRICT 模式：将新增检测项升级为错误
const STRICT_MODE = process.env.STRICT === '1';

// 需要排除的目录（非业务页面）
const EXCLUDE_DIRS = ['components', 'hooks', 'lib', 'utils'];

// 新增检测项的 allowlist（暂时放行的例外，需逐步收敛）
// 格式：相对于 apps/web/src/pages 的路径
const ALLOWLIST_V1 = {
  // 允许导出 I* 命名的文件（UI-only 类型暂未重命名）
  exportIPrefix: [
    // 当前无例外 - 所有 I* 导出已修复
  ],
  // 允许 as XxxProfile 强转的文件（待重构）
  asProfileCast: [
    // 当前无例外 - 所有 as 强转已修复
  ],
  // 允许 Profile extends Omit<...> 的文件（待重构）
  profileOmit: [
    // 当前无例外 - 所有 Omit 已改为 UI 扩展字段
  ],
  // 允许 toXxxProfile 返回类型不叫 XxxProfile 的文件（待重命名）
  profileNaming: [
    // 当前无例外 - 如需例外，请注明原因并尽快收敛
  ],
};

// 检查结果
const errors = [];
const warnings = [];
let checkedFiles = 0;

/**
 * 递归查找 shared types 下所有 .ts 文件
 */
function findSharedTypeFiles(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;

  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      files.push(...findSharedTypeFiles(fullPath));
    } else if (item.isFile() && item.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * 加载 shared 中已定义的 I*Response 类型（interface 或 type）
 */
function loadSharedResponseTypes() {
  const responseNames = new Set();
  const files = findSharedTypeFiles(SHARED_TYPES_DIR);

  const exportResponsePattern = /export\s+(?:interface|type)\s+(I[A-Z]\w*Response)\b/g;
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    let match;
    while ((match = exportResponsePattern.exec(content)) !== null) {
      responseNames.add(match[1]);
    }
  }

  return responseNames;
}

const SHARED_RESPONSE_TYPES = loadSharedResponseTypes();

/**
 * 递归查找所有 types.ts 文件
 */
function findTypesFiles(dir) {
  const files = [];

  if (!fs.existsSync(dir)) {
    return files;
  }

  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dir, item.name);

    if (item.isDirectory() && !EXCLUDE_DIRS.includes(item.name)) {
      files.push(...findTypesFiles(fullPath));
    } else if (item.isFile() && item.name === 'types.ts') {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * 获取文件相对于 pages 目录的路径（用于 allowlist 匹配）
 */
function getRelativeToPages(filePath) {
  return path.relative(PAGES_DIR, filePath);
}

/**
 * 检查是否在 allowlist 中
 */
function isInAllowlist(category, filePath) {
  const relPath = getRelativeToPages(filePath);
  return ALLOWLIST_V1[category]?.includes(relPath) ?? false;
}

/**
 * 根据行号查找代码行
 */
function getLineNumber(content, index) {
  return content.substring(0, index).split('\n').length;
}

/**
 * 检查单个 types.ts 文件
 */
function checkTypesFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const relativePath = path.relative(process.cwd(), filePath);
  const fileErrors = [];
  const fileWarnings = [];
  const v1Warnings = []; // 新增检测项（v1.1）的警告

  // 检查是否定义了 Profile 类型（用于判断是否为业务页面）
  const hasProfileType = /(?:interface|type)\s+\w+Profile/.test(content);

  // 检查是否有 toXxxProfile 转换函数
  const toProfileMatch = content.match(/function\s+(to\w+Profile)\s*\(/);
  const hasToProfile = !!toProfileMatch || /const\s+to\w+Profile\s*=/.test(content);

  // 检查 1: 是否从 @ky-azeroth/shared 导入（错误级别）
  // 如果页面定义了 Profile 类型，则必须从 shared 导入
  const hasSharedImport =
    content.includes("from '@ky-azeroth/shared") || content.includes('from "@ky-azeroth/shared');
  if (!hasSharedImport && hasProfileType) {
    fileErrors.push('必须从 @ky-azeroth/shared 导入类型（Profile 类型必须继承 shared 接口）');
  } else if (!hasSharedImport && !hasProfileType) {
    // 没有 Profile 类型的页面可能是报表/查询页面，仅警告
    fileWarnings.push('未导入 @ky-azeroth/shared 类型（如果是报表/查询页面可忽略此警告）');
  }

  // 检查 2: Profile 类型是否使用 extends（而非 = 别名）（错误级别）
  // 增强检查：捕获所有弱绑定模式
  // 模式1: type XxxProfile = IXxx (Profile 类型指向任何 I 开头的 shared 类型)
  // 模式2: type Xxx = IXxxResponse (任何类型别名指向 Response 类型)
  const weakBindingPatterns = [
    { pattern: /export\s+type\s+(\w+Profile)\s*=\s*(I\w+)/g, desc: 'Profile 类型' },
    { pattern: /export\s+type\s+(\w+)\s*=\s*(I\w+Response)/g, desc: '展示类型' },
  ];

  for (const { pattern, desc } of weakBindingPatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const typeName = match[1];
      const sharedType = match[2];
      // 检查是否是简单别名（没有 & 或 Omit 等操作）
      const afterMatch = content.slice(
        match.index + match[0].length,
        match.index + match[0].length + 50
      );
      if (!afterMatch.trim().startsWith('&') && !afterMatch.trim().startsWith('|')) {
        fileErrors.push(
          `${desc} "${typeName}" 使用弱绑定 "= ${sharedType}"，必须改为 "interface ${typeName} extends ${sharedType} {}"`
        );
      }
    }
  }

  // 检查 3: 是否有 toXxxProfile 转换函数（错误级别，仅当有 Profile 类型时）
  if (!hasToProfile && hasProfileType) {
    fileErrors.push('缺少 toXxxProfile 转换函数（业务页面必须提供）');
  }

  // 检查 4: 是否有 toXxxFormData 转换函数（警告级别）
  const hasToFormData =
    /function\s+to\w+FormData/.test(content) || /const\s+to\w+FormData\s*=/.test(content);
  const hasNoFormDataNeeded = /@no-formdata-needed/.test(content);
  if (!hasToFormData && hasProfileType && !hasNoFormDataNeeded) {
    fileWarnings.push('建议添加 toXxxFormData 转换函数');
  }

  // 检查 5: 是否有 toXxxPayload 转换函数（警告级别）
  const hasToPayload =
    /function\s+to\w+Payload/.test(content) || /const\s+to\w+Payload\s*=/.test(content);
  const hasNoPayload = /@no-payload/.test(content);
  if (!hasToPayload && hasToFormData && !hasNoPayload) {
    // 只有在有 FormData 但没有 Payload 时才警告（除非有 @no-payload 注释）
    fileWarnings.push('建议添加 toXxxPayload 转换函数');
  }

  // ========== v1.1 新增检测项（默认警告，STRICT=1 时升级为错误）==========

  // 检查 6: 前端 types.ts 导出 I* 命名的接口（UI-only 应改用非 I 前缀）
  const iInterfacePattern = /export\s+interface\s+(I[A-Z]\w+)/g;
  let iMatch;
  while ((iMatch = iInterfacePattern.exec(content)) !== null) {
    const interfaceName = iMatch[1];
    // 排除从 shared 重导出的情况（通过检查是否有相同名称的 import）
    const isReExport = new RegExp(
      `import[^}]*\\b${interfaceName}\\b[^}]*from\\s+['"]@ky-azeroth/shared`
    ).test(content);
    if (!isReExport && !isInAllowlist('exportIPrefix', filePath)) {
      const lineNum = getLineNumber(content, iMatch.index);
      v1Warnings.push({
        line: lineNum,
        message: `导出 I* 命名接口 "${interfaceName}"`,
        suggestion: `UI-only 类型应改为非 I 前缀，如 "${interfaceName.substring(1)}UI" 或 "${interfaceName.substring(1)}Form"`,
      });
    }
  }

  // 检查 7: as XxxProfile 强转（应移除，让类型自然匹配）
  const asProfilePattern = /\bas\s+(\w+Profile)\b/g;
  let asMatch;
  while ((asMatch = asProfilePattern.exec(content)) !== null) {
    if (!isInAllowlist('asProfileCast', filePath)) {
      const lineNum = getLineNumber(content, asMatch.index);
      const profileName = asMatch[1];
      v1Warnings.push({
        line: lineNum,
        message: `使用 "as ${profileName}" 强转`,
        suggestion: '移除强转，让转换函数的返回对象自然匹配 Profile 类型结构',
      });
    }
  }

  // 检查 8: Profile extends Omit<...>（不应改写 shared 字段结构）
  const omitProfilePattern = /export\s+interface\s+(\w+Profile)\s+extends\s+Omit<([^,>]+)/g;
  let omitMatch;
  while ((omitMatch = omitProfilePattern.exec(content)) !== null) {
    if (!isInAllowlist('profileOmit', filePath)) {
      const lineNum = getLineNumber(content, omitMatch.index);
      const profileName = omitMatch[1];
      const baseType = omitMatch[2].trim();
      v1Warnings.push({
        line: lineNum,
        message: `Profile "${profileName}" 使用 Omit<${baseType}, ...> 改写 shared 字段`,
        suggestion: `保留 shared 字段不变，如需不同类型的 UI 字段，新增 "ui${profileName.replace('Profile', '')}Type" 等扩展字段`,
      });
    }
  }

  // 检查 8.5: 如果 shared 已存在 I*Response，则 Profile 必须继承 I*Response（避免强绑定退化到基础实体）
  // 例：ISupplier -> ISupplierResponse（即便是 type alias 也应显式使用 Response 名称）
  const profileExtendsPattern = /export\s+interface\s+(\w+Profile)\s+extends\s+(I[A-Z]\w+)\b/g;
  let extendsMatch;
  while ((extendsMatch = profileExtendsPattern.exec(content)) !== null) {
    const profileName = extendsMatch[1];
    const baseType = extendsMatch[2];
    if (baseType.endsWith('Response')) continue;

    const expectedResponse = `${baseType}Response`;
    if (SHARED_RESPONSE_TYPES.has(expectedResponse)) {
      const lineNum = getLineNumber(content, extendsMatch.index);
      v1Warnings.push({
        line: lineNum,
        message: `Profile "${profileName}" 继承 "${baseType}"，但 shared 已存在 "${expectedResponse}"`,
        suggestion: `改为 "export interface ${profileName} extends ${expectedResponse} { ... }" 并从 shared 导入 ${expectedResponse}`,
      });
    }
  }

  // 检查 9: toXxxProfile 返回类型不叫 XxxProfile（命名不规范）
  if (toProfileMatch) {
    const funcName = toProfileMatch[1]; // e.g., "toFixedAssetProfile"
    const expectedProfileName = funcName.replace(/^to/, ''); // e.g., "FixedAssetProfile"

    // 查找函数返回类型
    const funcReturnPattern = new RegExp(
      `function\\s+${funcName}\\s*\\([^)]*\\)\\s*:\\s*(\\w+)`,
      'm'
    );
    const returnMatch = content.match(funcReturnPattern);

    if (returnMatch) {
      const actualReturn = returnMatch[1];
      if (actualReturn !== expectedProfileName && !isInAllowlist('profileNaming', filePath)) {
        const lineNum = getLineNumber(content, returnMatch.index);
        v1Warnings.push({
          line: lineNum,
          message: `函数 "${funcName}" 返回类型 "${actualReturn}" 不符合命名规范`,
          suggestion: `将展示类型重命名为 "${expectedProfileName}" 并让其 extends 对应的 shared Response 接口`,
        });
      }
    }
  }

  // 检查 10: 存在 toXxxProfile 但缺少 export interface XxxProfile
  if (toProfileMatch) {
    const funcName = toProfileMatch[1];
    const expectedProfileName = funcName.replace(/^to/, '');
    const hasExportedProfile = new RegExp(`export\\s+interface\\s+${expectedProfileName}\\b`).test(
      content
    );

    if (!hasExportedProfile && !isInAllowlist('profileNaming', filePath)) {
      v1Warnings.push({
        line: getLineNumber(content, toProfileMatch.index),
        message: `存在 "${funcName}" 但缺少 "export interface ${expectedProfileName}"`,
        suggestion: `定义 "export interface ${expectedProfileName} extends I*Response { ... }" 并更新函数返回类型`,
      });
    }
  }

  return { filePath: relativePath, errors: fileErrors, warnings: fileWarnings, v1Warnings };
}

/**
 * 主函数
 */
function main() {
  console.log('检查前端 Shared 包导入一致性...\n');

  if (STRICT_MODE) {
    console.log('[ STRICT 模式已启用：v1.1 检测项将升级为错误 ]\n');
  }

  const typesFiles = findTypesFiles(PAGES_DIR);

  if (typesFiles.length === 0) {
    console.log('未找到 types.ts 文件');
    process.exit(0);
  }

  // v1.1 新增：跟踪新检测项
  const v1WarningsAll = [];

  for (const file of typesFiles) {
    const result = checkTypesFile(file);
    checkedFiles++;

    if (result.errors.length > 0) {
      errors.push({ file: result.filePath, messages: result.errors });
    }
    if (result.warnings.length > 0) {
      warnings.push({ file: result.filePath, messages: result.warnings });
    }
    // v1.1 新增检测项
    if (result.v1Warnings && result.v1Warnings.length > 0) {
      v1WarningsAll.push({ file: result.filePath, items: result.v1Warnings });
    }
  }

  // 输出结果
  console.log(`已检查 ${checkedFiles} 个 types.ts 文件\n`);

  if (errors.length > 0) {
    console.log('错误（必须修复）:');
    console.log('================');
    for (const { file, messages } of errors) {
      console.log(`\n  ${file}:`);
      for (const msg of messages) {
        console.log(`    - ${msg}`);
      }
    }
    console.log('');
  }

  // v1.1 新增检测项输出
  if (v1WarningsAll.length > 0) {
    const label = STRICT_MODE ? '错误（v1.1 规范强制）' : '警告（v1.1 规范建议）';
    const separator = STRICT_MODE ? '========================' : '========================';
    console.log(`${label}:`);
    console.log(separator);
    for (const { file, items } of v1WarningsAll) {
      console.log(`\n  ${file}:`);
      for (const item of items) {
        console.log(`    L${item.line}: ${item.message}`);
        console.log(`         -> 建议: ${item.suggestion}`);
      }
    }
    console.log('');

    // STRICT 模式下，v1.1 警告升级为错误
    if (STRICT_MODE) {
      errors.push(
        ...v1WarningsAll.map((w) => ({ file: w.file, messages: w.items.map((i) => i.message) }))
      );
    }
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

  // 统计信息
  const v1Count = v1WarningsAll.reduce((sum, w) => sum + w.items.length, 0);
  if (v1Count > 0) {
    console.log(
      `v1.1 检测项: 发现 ${v1Count} 个问题（${v1WarningsAll.length} 个文件）${STRICT_MODE ? ' [将阻断提交]' : ' [仅警告]'}`
    );
  }

  // 只有错误才导致失败
  if (errors.length > 0) {
    console.log(`\n发现 ${errors.length} 个文件存在错误，请修复后再提交。`);
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.log(`发现 ${warnings.length} 个文件存在警告，建议修复。`);
  }

  console.log('\nShared 包导入检查通过！');
  process.exit(0);
}

main();
