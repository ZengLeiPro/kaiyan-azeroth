#!/usr/bin/env node
/**
 * FinanceImportBatch response 的窄范围 SSOT 门禁。
 * 只检查该实体，避免把全仓历史 response interface / 双断言一次性纳入。
 * 测试可通过 FINANCE_IMPORT_BATCH_SSOT_ROOT 指向 fixture。
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.env.FINANCE_IMPORT_BATCH_SSOT_ROOT
  ? path.resolve(process.env.FINANCE_IMPORT_BATCH_SSOT_ROOT)
  : path.resolve(__dirname, '..');

const PATHS = {
  schema: 'packages/shared/src/schemas/finance-import.ts',
  legacyType: 'packages/shared/src/types/finance-import-batch.ts',
  controller: 'apps/server/src/modules/finance/import/finance-import.controller.ts',
  service: 'apps/server/src/modules/finance/import/services/finance-import.service.ts',
  mapper: 'apps/server/src/modules/finance/import/services/finance-import-batch.mapper.ts',
};

const RESPONSE_FIELDS = [
  'id',
  'source',
  'workbookId',
  'sheetNames',
  'totalRows',
  'successRows',
  'skippedRows',
  'failedRows',
  'personalRows',
  'status',
  'previewJson',
  'summaryJson',
  'errorReportJson',
  'reconciliationJson',
  'createdAt',
  'creatorEmployeeId',
  'updatedAt',
  'updaterEmployeeId',
  'deletedAt',
  'version',
];

const errors = [];

/** 剥离注释和字符串，避免注释或 marker 字符串伪装成源码契约。 */
function codeOnly(content) {
  let result = '';
  let index = 0;
  let state = 'code';
  let quote = '';
  while (index < content.length) {
    const char = content[index];
    const next = content[index + 1];
    if (state === 'code') {
      if (char === '/' && next === '/') {
        state = 'line-comment';
        result += '  ';
        index += 2;
        continue;
      }
      if (char === '/' && next === '*') {
        state = 'block-comment';
        result += '  ';
        index += 2;
        continue;
      }
      if (char === "'" || char === '"' || char === '`') {
        state = 'string';
        quote = char;
        result += ' ';
        index += 1;
        continue;
      }
      result += char;
      index += 1;
      continue;
    }
    if (state === 'line-comment') {
      if (char === '\n') {
        state = 'code';
        result += '\n';
      } else {
        result += ' ';
      }
      index += 1;
      continue;
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        state = 'code';
        result += '  ';
        index += 2;
      } else {
        result += char === '\n' ? '\n' : ' ';
        index += 1;
      }
      continue;
    }
    if (char === '\\') {
      result += '  ';
      index += 2;
    } else if (char === quote) {
      state = 'code';
      result += ' ';
      index += 1;
    } else {
      result += char === '\n' ? '\n' : ' ';
      index += 1;
    }
  }
  return result;
}

function read(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) {
    errors.push(`${relativePath}: 门禁所需文件不存在`);
    return null;
  }
  const content = fs.readFileSync(absolutePath, 'utf8');
  return { content, code: codeOnly(content) };
}

/** 提取指定 z.object({...}) 的顶层字段，专门用于阻断 response 字段增删漂移。 */
function extractZodObjectFields(code, declarationName) {
  const declaration = new RegExp(
    `(?:export\\s+)?const\\s+${declarationName}\\s*=\\s*z\\.object\\s*\\(\\s*\\{`,
    'm'
  );
  const match = declaration.exec(code);
  if (!match) return null;

  const openingBrace = code.indexOf('{', match.index);
  const fields = [];
  let curlyDepth = 1;
  let parenDepth = 0;
  let bracketDepth = 0;
  let index = openingBrace + 1;

  while (index < code.length && curlyDepth > 0) {
    const char = code[index];
    if (char === '{') curlyDepth += 1;
    else if (char === '}') curlyDepth -= 1;
    else if (char === '(') parenDepth += 1;
    else if (char === ')') parenDepth -= 1;
    else if (char === '[') bracketDepth += 1;
    else if (char === ']') bracketDepth -= 1;

    if (curlyDepth === 1 && parenDepth === 0 && bracketDepth === 0 && /[A-Za-z_$]/.test(char)) {
      const identifier = /^[A-Za-z_$][\w$]*/.exec(code.slice(index))?.[0];
      if (identifier) {
        let cursor = index + identifier.length;
        while (/\s/.test(code[cursor] ?? '')) cursor += 1;
        if (code[cursor] === ':') fields.push(identifier);
        index += identifier.length;
        continue;
      }
    }
    index += 1;
  }

  return fields;
}

function findHandWrittenInterface(infos) {
  return infos.some(
    (info) => info && /\binterface\s+(?:I)?FinanceImportBatch(?:Response)?\b/.test(info.code)
  );
}

function checkSchema(info) {
  if (!info) return;
  if (
    !/export\s+type\s+FinanceImportBatchResponse\s*=\s*z\.infer\s*<\s*typeof\s+financeImportBatchResponseSchema\s*>\s*;/.test(
      info.code
    )
  ) {
    errors.push(
      `${PATHS.schema}: FinanceImportBatchResponse 必须直接由 z.infer<typeof financeImportBatchResponseSchema> 导出`
    );
  }

  const actualFields = extractZodObjectFields(info.code, 'financeImportBatchResponseSchema');
  if (!actualFields) {
    errors.push(`${PATHS.schema}: 找不到 financeImportBatchResponseSchema 的 z.object 契约`);
  } else if (actualFields.join(',') !== RESPONSE_FIELDS.join(',')) {
    errors.push(
      `${PATHS.schema}: response schema 字段漂移；期望 [${RESPONSE_FIELDS.join(', ')}]，实际 [${actualFields.join(', ')}]`
    );
  }
}

function checkLegacyType(info) {
  if (!info) return;
  if (!/export\s+type\s+IFinanceImportBatch\s*=\s*FinanceImportBatchResponse\s*;/.test(info.code)) {
    errors.push(`${PATHS.legacyType}: 旧名称只能是 FinanceImportBatchResponse 的兼容 type alias`);
  }
}

function checkController(info) {
  if (!info) return;
  if (/\bas\s+unknown\s+as\b/.test(info.code)) {
    errors.push(`${PATHS.controller}: 禁止使用 as unknown as 双断言掩盖 response 漂移`);
  }
  if (!/Promise\s*<\s*FinanceImportBatchResponse\s*>/.test(info.code)) {
    errors.push(`${PATHS.controller}: 详情返回类型必须使用 FinanceImportBatchResponse`);
  }
  if (!/Promise\s*<\s*PaginatedResponse\s*<\s*FinanceImportBatchResponse\s*>\s*>/.test(info.code)) {
    errors.push(`${PATHS.controller}: 列表返回类型必须使用 FinanceImportBatchResponse`);
  }
}

function checkMapperAndService(mapper, service) {
  if (mapper) {
    if (!/financeImportBatchResponseSchema\s*\.\s*parse\s*\(/.test(mapper.code)) {
      errors.push(`${PATHS.mapper}: mapper 必须由 financeImportBatchResponseSchema.parse 收口`);
    }
    for (const field of RESPONSE_FIELDS) {
      if (!new RegExp(`\\b${field}\\s*:`).test(mapper.code)) {
        errors.push(`${PATHS.mapper}: mapper 缺少 ${field} 显式映射`);
      }
    }
    for (const field of ['createdAt', 'updatedAt']) {
      if (
        !new RegExp(`\\b${field}\\s*:\\s*row\\.${field}\\.toISOString\\s*\\(`).test(mapper.code)
      ) {
        errors.push(`${PATHS.mapper}: ${field} 必须显式序列化为 ISO 字符串`);
      }
    }
    if (!/\bdeletedAt\s*:\s*row\.deletedAt\?\.toISOString\s*\(\)\s*\?\?\s*null/.test(mapper.code)) {
      errors.push(`${PATHS.mapper}: deletedAt 必须显式序列化为 ISO 字符串或 null`);
    }
  }
  if (service) {
    if (!/items\s*:\s*rows\.map\s*\(\s*mapFinanceImportBatchResponse\s*\)/.test(service.code)) {
      errors.push(`${PATHS.service}: list 必须统一经过 mapFinanceImportBatchResponse`);
    }
    if (!/return\s+mapFinanceImportBatchResponse\s*\(\s*row\s*\)\s*;/.test(service.code)) {
      errors.push(`${PATHS.service}: get 必须统一经过 mapFinanceImportBatchResponse`);
    }
  }
}

const schema = read(PATHS.schema);
const legacyType = read(PATHS.legacyType);
const controller = read(PATHS.controller);
const service = read(PATHS.service);
const mapper = read(PATHS.mapper);

if (findHandWrittenInterface([schema, legacyType, controller, service, mapper])) {
  errors.push('FinanceImportBatch: 禁止为同实体手写 response interface');
}
checkSchema(schema);
checkLegacyType(legacyType);
checkController(controller);
checkMapperAndService(mapper, service);

if (errors.length > 0) {
  console.error('FinanceImportBatch SSOT 门禁失败：');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log('FinanceImportBatch SSOT 门禁通过（schema → z.infer → mapper → controller）。');
