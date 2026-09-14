#!/usr/bin/env node
/**
 * Query DTO 验证规范检查脚本
 *
 * 检查后端 Query DTO 是否正确使用 nestjs-zod + Shared Schema：
 * 1. 必须使用 createZodDto(queryXxxSchema) 模式
 * 2. 必须从 @ky-azeroth/shared/schemas 导入 Schema
 * 3. 禁止使用 class-validator 装饰器
 *
 * 使用方式：node scripts/check-query-dto.js
 */

const fs = require('fs');
const path = require('path');

const SERVER_DIR = path.join(__dirname, '../apps/server/src');

// class-validator 装饰器列表
const CLASS_VALIDATOR_DECORATORS = [
  '@IsString',
  '@IsNumber',
  '@IsInt',
  '@IsBoolean',
  '@IsOptional',
  '@IsNotEmpty',
  '@IsUUID',
  '@IsEmail',
  '@IsDate',
  '@IsArray',
  '@IsEnum',
  '@IsIn',
  '@Min',
  '@Max',
  '@MinLength',
  '@MaxLength',
  '@Matches',
  '@ValidateNested',
  '@Type',
];

// 检查结果
const errors = [];
const passed = [];
let checkedFiles = 0;

/**
 * 递归查找所有 Query DTO 文件
 */
function findQueryDtoFiles(dir) {
  const files = [];

  if (!fs.existsSync(dir)) {
    return files;
  }

  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dir, item.name);

    if (item.isDirectory()) {
      files.push(...findQueryDtoFiles(fullPath));
    } else if (item.isFile()) {
      // 匹配 query-*.dto.ts 或 *-query.dto.ts 或 *.query.dto.ts
      if (/query.*\.dto\.ts$|.*query\.dto\.ts$/i.test(item.name)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

/**
 * 检查单个 Query DTO 文件
 */
function checkQueryDtoFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const relativePath = path.relative(process.cwd(), filePath);
  const fileErrors = [];

  // 检查 1: 是否使用了 createZodDto
  const hasCreateZodDto = content.includes('createZodDto');
  const hasZodDtoImport =
    content.includes("from 'nestjs-zod'") || content.includes('from "nestjs-zod"');

  // 检查 2: 是否从 @ky-azeroth/shared/schemas 导入
  const hasSharedSchemaImport =
    content.includes("from '@ky-azeroth/shared/schemas") ||
    content.includes('from "@ky-azeroth/shared/schemas');

  // 检查 3: 是否使用了 class-validator 装饰器
  const usedDecorators = [];
  for (const decorator of CLASS_VALIDATOR_DECORATORS) {
    // 使用正则匹配装饰器（避免匹配注释中的内容）
    const decoratorPattern = new RegExp(`^\\s*${decorator.replace('@', '@')}\\s*\\(`, 'm');
    if (decoratorPattern.test(content)) {
      usedDecorators.push(decorator);
    }
  }

  // 检查 4: 是否从 class-validator 导入
  const hasClassValidatorImport =
    content.includes("from 'class-validator'") || content.includes('from "class-validator"');

  // 生成错误信息
  if (!hasCreateZodDto || !hasZodDtoImport) {
    fileErrors.push('必须使用 createZodDto() 创建 Query DTO，请参考 query-products.dto.ts');
  }

  if (!hasSharedSchemaImport && hasCreateZodDto) {
    fileErrors.push("必须从 '@ky-azeroth/shared/schemas' 导入 Query Schema");
  }

  if (usedDecorators.length > 0) {
    fileErrors.push(`禁止使用 class-validator 装饰器: ${usedDecorators.join(', ')}`);
  }

  if (hasClassValidatorImport) {
    fileErrors.push("禁止从 'class-validator' 导入，请改用 Zod Schema 验证");
  }

  return { filePath: relativePath, errors: fileErrors };
}

/**
 * 主函数
 */
function main() {
  console.log('检查 Query DTO 验证规范...\n');

  const queryDtoFiles = findQueryDtoFiles(SERVER_DIR);

  if (queryDtoFiles.length === 0) {
    console.log('未找到 Query DTO 文件');
    process.exit(0);
  }

  for (const file of queryDtoFiles) {
    const result = checkQueryDtoFile(file);
    checkedFiles++;

    if (result.errors.length > 0) {
      errors.push({ file: result.filePath, messages: result.errors });
    } else {
      passed.push(result.filePath);
    }
  }

  // 输出结果
  console.log(`已检查 ${checkedFiles} 个 Query DTO 文件\n`);

  if (passed.length > 0) {
    console.log(`通过检查: ${passed.length} 个文件`);
  }

  if (errors.length > 0) {
    console.log('\n错误（必须修复）:');
    console.log('================');
    for (const { file, messages } of errors) {
      console.log(`\n  ${file}:`);
      for (const msg of messages) {
        console.log(`    - ${msg}`);
      }
    }
    console.log('');
    console.log(`发现 ${errors.length} 个文件存在错误，请修复后再提交。`);
    console.log('\n修复方法:');
    console.log('  1. 在 @ky-azeroth/shared/schemas 中创建 queryXxxSchema');
    console.log(
      '  2. 将 DTO 改为: export class XxxQueryDto extends createZodDto(queryXxxSchema) {}'
    );
    console.log('  3. 删除 class-validator 装饰器和导入\n');
    process.exit(1);
  }

  console.log('\nQuery DTO 验证规范检查通过！');
  process.exit(0);
}

main();
