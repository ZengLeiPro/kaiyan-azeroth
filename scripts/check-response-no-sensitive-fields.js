#!/usr/bin/env node
/**
 * Response 类型/Schema 敏感字段检查脚本
 *
 * 目标（CLAUDE.md MUST #11.3）：
 * - API 响应中禁止返回密码哈希等敏感字段
 * - 扫描 shared types 中 IXxxResponse 接口和 shared schemas 中 xxxResponseSchema 定义
 *
 * 敏感字段黑名单：
 * - password, passwordHash, hashedPassword, secret, apiKey, apiSecret
 *
 * 豁免列表：
 * - LoginResponse / RefreshTokenResponse 中的 accessToken / refreshToken（认证业务必需）
 *
 * 检测范围：
 * - packages/shared/src/types/ 下所有 .ts 文件
 * - packages/shared/src/schemas/ 下所有 .ts 文件
 *
 * 输出：
 * - errors：阻断提交/CI（exit 1）
 */

const fs = require('fs');
const path = require('path');

const TYPES_DIR = path.join(__dirname, '../packages/shared/src/types');
const SCHEMAS_DIR = path.join(__dirname, '../packages/shared/src/schemas');

// 敏感字段黑名单（小写匹配）
const SENSITIVE_FIELDS = [
  'password',
  'passwordhash',
  'hashedpassword',
  'secret',
  'apikey',
  'apisecret',
];

// 豁免：这些接口/schema 名称中的 accessToken/refreshToken 不报错
const EXEMPT_CONTEXTS = [
  'LoginResponse',
  'RefreshTokenResponse',
  'loginResponse',
  'refreshTokenResponse',
];
const EXEMPT_FIELDS = ['accesstoken', 'refreshtoken'];

const errors = [];
let checkedFiles = 0;

function findFiles(dir, extensions) {
  const files = [];
  if (!fs.existsSync(dir)) return files;

  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      if (item.name === 'node_modules') continue;
      files.push(...findFiles(fullPath, extensions));
    } else if (item.isFile()) {
      const ext = path.extname(item.name);
      if (extensions.includes(ext)) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

/**
 * 检查 types 文件中的 IXxxResponse 接口
 */
function checkTypesFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const relPath = path.relative(process.cwd(), filePath);

  // 查找 IXxxResponse 接口块
  let insideResponseInterface = false;
  let interfaceName = '';
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 检测 Response 接口开始
    const interfaceMatch = trimmed.match(/^(?:export\s+)?interface\s+(I?\w*Response\w*)\b/);
    if (interfaceMatch) {
      insideResponseInterface = true;
      interfaceName = interfaceMatch[1];
      braceDepth = 0;
    }

    if (insideResponseInterface) {
      // 统计花括号深度
      for (const ch of line) {
        if (ch === '{') braceDepth++;
        if (ch === '}') braceDepth--;
      }

      // 检查当前行是否包含敏感字段声明
      // 匹配模式：fieldName: type 或 fieldName?: type
      const fieldMatch = trimmed.match(/^(\w+)\s*[?]?\s*:/);
      if (fieldMatch) {
        const fieldName = fieldMatch[1];
        const fieldNameLower = fieldName.toLowerCase();

        // 检查是否在豁免上下文中
        const isExemptContext = EXEMPT_CONTEXTS.some((ctx) => interfaceName.includes(ctx));
        const isExemptField = EXEMPT_FIELDS.includes(fieldNameLower);

        if (isExemptContext && isExemptField) {
          // 豁免：认证业务必需的 token 字段
          continue;
        }

        if (SENSITIVE_FIELDS.includes(fieldNameLower)) {
          errors.push({
            file: relPath,
            line: i + 1,
            message: `Response 接口 "${interfaceName}" 中包含敏感字段 "${fieldName}"`,
          });
        }
      }

      // 接口结束
      if (braceDepth <= 0 && line.includes('}')) {
        insideResponseInterface = false;
        interfaceName = '';
      }
    }
  }

  checkedFiles++;
}

/**
 * 检查 schemas 文件中的 xxxResponseSchema 定义
 */
function checkSchemasFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const relPath = path.relative(process.cwd(), filePath);

  // 查找 responseSchema 定义块
  let insideResponseSchema = false;
  let schemaName = '';
  let parenDepth = 0;
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 检测 Response Schema 开始
    const schemaMatch = trimmed.match(/(?:const|export\s+const)\s+(\w*[Rr]esponse\w*Schema)\b/);
    if (schemaMatch) {
      insideResponseSchema = true;
      schemaName = schemaMatch[1];
      parenDepth = 0;
      braceDepth = 0;
    }

    if (insideResponseSchema) {
      for (const ch of line) {
        if (ch === '(') parenDepth++;
        if (ch === ')') parenDepth--;
        if (ch === '{') braceDepth++;
        if (ch === '}') braceDepth--;
      }

      // 检查是否声明了敏感字段
      // 匹配模式：fieldName: z.string() 等 Zod schema 字段定义
      const fieldMatch = trimmed.match(/^(\w+)\s*:/);
      if (fieldMatch) {
        const fieldName = fieldMatch[1];
        const fieldNameLower = fieldName.toLowerCase();

        // 检查是否在豁免上下文中
        const isExemptContext = EXEMPT_CONTEXTS.some((ctx) =>
          schemaName.toLowerCase().includes(ctx.toLowerCase())
        );
        const isExemptField = EXEMPT_FIELDS.includes(fieldNameLower);

        if (isExemptContext && isExemptField) {
          continue;
        }

        if (SENSITIVE_FIELDS.includes(fieldNameLower)) {
          errors.push({
            file: relPath,
            line: i + 1,
            message: `Response Schema "${schemaName}" 中包含敏感字段 "${fieldName}"`,
          });
        }
      }

      // Schema 定义结束（回到顶层）
      if (
        parenDepth <= 0 &&
        braceDepth <= 0 &&
        i > 0 &&
        (trimmed.endsWith(';') || trimmed.endsWith(')'))
      ) {
        insideResponseSchema = false;
        schemaName = '';
      }
    }
  }

  checkedFiles++;
}

function main() {
  console.log('检查 Response 类型/Schema 敏感字段...\n');

  const typeFiles = findFiles(TYPES_DIR, ['.ts']);
  const schemaFiles = findFiles(SCHEMAS_DIR, ['.ts']);

  if (typeFiles.length === 0 && schemaFiles.length === 0) {
    console.log('未找到需要检查的文件');
    process.exit(0);
  }

  for (const file of typeFiles) {
    checkTypesFile(file);
  }

  for (const file of schemaFiles) {
    checkSchemasFile(file);
  }

  console.log(`已检查 ${checkedFiles} 个文件\n`);

  if (errors.length > 0) {
    const separator = '='.repeat(50);
    console.log('错误（必须修复）:');
    console.log(separator);
    for (const e of errors) {
      console.log(`  ${e.file}:${e.line}`);
      console.log(`    ${e.message}`);
    }
    console.log('');
    console.log(`检查失败：发现 ${errors.length} 处问题。`);
    console.log('');
    console.log('修复建议：');
    console.log(
      '  从 Response 接口/Schema 中移除敏感字段（password/passwordHash/secret/apiKey 等）'
    );
    console.log(
      '  如需返回 token，仅允许在 LoginResponse/RefreshTokenResponse 中使用 accessToken/refreshToken'
    );
    console.log('  参考规范：CLAUDE.md 第 11.3 节');
    process.exit(1);
  }

  console.log('Response 类型/Schema 敏感字段检查通过！');
  process.exit(0);
}

main();
