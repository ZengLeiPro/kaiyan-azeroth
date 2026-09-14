#!/usr/bin/env node
/**
 * 乐观锁（version）静态门禁。
 *
 * 通用 Service 继续检查 update/P2025/Conflict/increment；Payment/Invoice/Customer 额外使用
 * TypeScript AST 做不可豁免的严格检查：单条 DTO + 固定 CAS、批量逐行 CAS、Customer
 * 生命周期/回收站/Web/CLI 透传，以及审批业务状态 version 推进与审计字段。
 * 测试可通过 OPTIMISTIC_LOCK_ROOT 指向 fixture。
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const REPO_ROOT = process.env.OPTIMISTIC_LOCK_ROOT
  ? path.resolve(process.env.OPTIMISTIC_LOCK_ROOT)
  : path.resolve(__dirname, '..');
const MODULES_DIR = path.join(REPO_ROOT, 'apps/server/src/modules');

const STRICT_TARGETS = [
  {
    label: 'Payment',
    model: 'payment',
    module: 'payments',
    servicePath: 'apps/server/src/modules/payments/payments.service.ts',
    controllerPath: 'apps/server/src/modules/payments/payments.controller.ts',
    schemaPath: 'packages/shared/src/schemas/payment.ts',
    updateSchema: 'updatePaymentSchema',
    batchVersionSchema: 'paymentBatchVersionSchema',
    batchShape: 'paymentVersionedBatchShape',
    batchFactory: 'createVersionedPaymentBatchSchema',
    batchSchemas: [
      'batchTransferPaymentSchema',
      'batchUpdatePaymentSchema',
      'batchRemovePaymentSchema',
    ],
    batchMethods: [
      ['batchTransfer', 'BatchTransferPaymentInput'],
      ['batchUpdate', 'BatchUpdatePaymentInput'],
      ['batchRemove', 'BatchRemovePaymentInput'],
    ],
    batchDtos: [
      ['batchTransfer', 'BatchTransferPaymentDto'],
      ['batchUpdate', 'BatchUpdatePaymentDto'],
      ['batchRemove', 'BatchRemovePaymentDto'],
    ],
    whereHelper: 'buildPaymentBatchCasWhere',
    countHelper: 'assertPaymentBatchCasCount',
    scopeHelper: 'applyCustomerCollabViaCustomerScope',
    aggregateCall: 'recalcSaleOrderPaymentSummary',
  },
  {
    label: 'Invoice',
    model: 'invoice',
    module: 'invoices',
    servicePath: 'apps/server/src/modules/invoices/invoices.service.ts',
    controllerPath: 'apps/server/src/modules/invoices/invoices.controller.ts',
    schemaPath: 'packages/shared/src/schemas/invoice.ts',
    updateSchema: 'updateInvoiceSchema',
    batchVersionSchema: 'invoiceBatchVersionSchema',
    batchShape: 'invoiceVersionedBatchShape',
    batchFactory: 'createVersionedInvoiceBatchSchema',
    batchSchemas: [
      'batchTransferInvoiceSchema',
      'batchUpdateInvoiceSchema',
      'batchRemoveInvoiceSchema',
    ],
    batchMethods: [
      ['batchTransfer', 'BatchTransferInvoiceInput'],
      ['batchUpdate', 'BatchUpdateInvoiceInput'],
      ['batchRemove', 'BatchRemoveInvoiceInput'],
    ],
    batchDtos: [
      ['batchTransfer', 'BatchTransferInvoiceDto'],
      ['batchUpdate', 'BatchUpdateInvoiceDto'],
      ['batchRemove', 'BatchRemoveInvoiceDto'],
    ],
    whereHelper: 'buildInvoiceBatchCasWhere',
    countHelper: 'assertInvoiceBatchCasCount',
    scopeHelper: 'applyCustomerCollabViaCustomerScope',
    aggregateCall: 'recalcSaleOrderInvoicedSummary',
  },
];

const CUSTOMER_TARGET = {
  servicePath: 'apps/server/src/modules/customers/customers.service.ts',
  controllerPath: 'apps/server/src/modules/customers/customers.controller.ts',
  lifecyclePath: 'apps/server/src/modules/customers/customer-lifecycle.ts',
  schemaPath: 'packages/shared/src/schemas/customer.ts',
  webTypesPath: 'apps/web/src/pages/system/trash/types.ts',
  webTrashPath: 'apps/web/src/pages/system/trash/TrashPage.tsx',
  cliCrudPath: 'apps/cli/src/commands/crud.ts',
  cliCustomersPath: 'apps/cli/src/commands/customers.ts',
  cliUtilsPath: 'apps/cli/src/utils.ts',
  actionSchemas: [
    'restoreCustomerSchema',
    'permanentRemoveCustomerSchema',
    'claimCustomerSchema',
    'updateLeadProgressSchema',
  ],
  batchSchemas: [
    'batchTransferCustomerSchema',
    'batchUpdateCustomerSchema',
    'batchCollaboratorsCustomerSchema',
    'batchRemoveCustomerSchema',
  ],
  batchMethods: [
    ['batchTransfer', 'BatchTransferCustomerInput'],
    ['batchUpdate', 'BatchUpdateCustomerInput'],
    ['batchAddCollaborators', 'BatchCollaboratorsCustomerInput'],
    ['batchRemoveCollaborators', 'BatchCollaboratorsCustomerInput'],
    ['batchRemove', 'BatchRemoveCustomerInput'],
  ],
  batchControllerDtos: [
    ['batchTransfer', 'BatchTransferCustomerDto'],
    ['batchUpdate', 'BatchUpdateCustomerDto'],
    ['batchAddCollaborators', 'BatchCollaboratorsCustomerDto'],
    ['batchRemoveCollaborators', 'BatchCollaboratorsCustomerDto'],
    ['batchRemove', 'BatchRemoveCustomerDto'],
  ],
  dtoFiles: [
    [
      'apps/server/src/modules/customers/dto/restore-customer.dto.ts',
      'RestoreCustomerDto',
      'restoreCustomerSchema',
    ],
    [
      'apps/server/src/modules/customers/dto/permanent-remove-customer.dto.ts',
      'PermanentRemoveCustomerDto',
      'permanentRemoveCustomerSchema',
    ],
    [
      'apps/server/src/modules/customers/dto/claim-customer.dto.ts',
      'ClaimCustomerDto',
      'claimCustomerSchema',
    ],
    [
      'apps/server/src/modules/customers/dto/update-lead-progress.dto.ts',
      'UpdateLeadProgressDto',
      'updateLeadProgressSchema',
    ],
    [
      'apps/server/src/modules/customers/dto/batch-transfer-customer.dto.ts',
      'BatchTransferCustomerDto',
      'batchTransferCustomerSchema',
    ],
    [
      'apps/server/src/modules/customers/dto/batch-update-customer.dto.ts',
      'BatchUpdateCustomerDto',
      'batchUpdateCustomerSchema',
    ],
    [
      'apps/server/src/modules/customers/dto/batch-collaborators-customer.dto.ts',
      'BatchCollaboratorsCustomerDto',
      'batchCollaboratorsCustomerSchema',
    ],
    [
      'apps/server/src/modules/customers/dto/batch-remove-customer.dto.ts',
      'BatchRemoveCustomerDto',
      'batchRemoveCustomerSchema',
    ],
  ],
};

const PROJECT_MUTATION_SCHEMAS = [
  ['packages/shared/src/schemas/project.ts', ['updateProjectSchema', 'linkSaleOrderSchema']],
  [
    'packages/shared/src/schemas/project-ticket.ts',
    ['updateProjectTicketSchema', 'transitionProjectTicketSchema', 'reassignProjectTicketSchema'],
  ],
  ['packages/shared/src/schemas/effort-record.ts', ['updateEffortRecordSchema']],
];

const PROJECT_DELETE_TARGETS = [
  {
    label: 'Project',
    model: 'project',
    servicePath: 'apps/server/src/modules/projects/projects.service.ts',
    controllerPath: 'apps/server/src/modules/projects/projects.controller.ts',
  },
  {
    label: 'ProjectTicket',
    model: 'projectTicket',
    servicePath: 'apps/server/src/modules/project-tickets/project-tickets.service.ts',
    controllerPath: 'apps/server/src/modules/project-tickets/project-tickets.controller.ts',
  },
  {
    label: 'EffortRecord',
    model: 'effortRecord',
    servicePath: 'apps/server/src/modules/effort-records/effort-records.service.ts',
    controllerPath: 'apps/server/src/modules/effort-records/effort-records.controller.ts',
  },
];

const errors = [];
let checkedFiles = 0;
let skippedFiles = 0;

function addError(file, message) {
  errors.push({ file: path.relative(REPO_ROOT, file), message });
}

/**
 * 用 TS scanner 剥离注释并保留所有字符位置，避免字符串里的 //、模板文本或注释排列
 * 干扰源码门禁；AST 仍从原文构建，显式 @no-optimistic-lock 注释也仍可单独识别。
 */
function stripSourceComments(content) {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    content
  );
  let cursor = 0;
  let stripped = '';
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (
      token !== ts.SyntaxKind.SingleLineCommentTrivia &&
      token !== ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      continue;
    }
    const start = scanner.getTokenPos();
    const end = scanner.getTextPos();
    stripped += content.slice(cursor, start);
    stripped += content.slice(start, end).replace(/[^\r\n]/g, ' ');
    cursor = end;
  }
  return stripped + content.slice(cursor);
}

function readSource(relativePath) {
  const file = path.join(REPO_ROOT, relativePath);
  if (!fs.existsSync(file)) {
    addError(file, '严格乐观锁门禁所需文件不存在');
    return null;
  }
  const content = fs.readFileSync(file, 'utf8');
  const code = stripSourceComments(content);
  const scriptKind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, scriptKind);
  return { file, content, code, source };
}

function nodeCode(info, node) {
  if (!node) return '';
  return info.code.slice(node.getStart(info.source), node.end);
}

function walk(node, visitor) {
  visitor(node);
  ts.forEachChild(node, (child) => walk(child, visitor));
}

function findFirst(node, predicate) {
  let found;
  walk(node, (candidate) => {
    if (found === undefined && predicate(candidate)) found = candidate;
  });
  return found;
}

function findAll(node, predicate) {
  const found = [];
  walk(node, (candidate) => {
    if (predicate(candidate)) found.push(candidate);
  });
  return found;
}

function nodeName(node, source) {
  if (!node || !node.name) return undefined;
  return node.name.getText(source);
}

function callName(call) {
  if (!ts.isCallExpression(call)) return undefined;
  if (ts.isIdentifier(call.expression)) return call.expression.text;
  if (ts.isPropertyAccessExpression(call.expression)) return call.expression.name.text;
  return undefined;
}

function isNamedCall(node, name) {
  return ts.isCallExpression(node) && callName(node) === name;
}

function hasNamedCall(node, name) {
  return Boolean(findFirst(node, (candidate) => isNamedCall(candidate, name)));
}

function findVariable(source, name) {
  return findFirst(
    source,
    (node) =>
      ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name
  );
}

function findFunction(source, name) {
  return findFirst(
    source,
    (node) =>
      (ts.isFunctionDeclaration(node) && node.name?.text === name) ||
      (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name)
  );
}

function findMethod(source, name) {
  return findFirst(
    source,
    (node) => ts.isMethodDeclaration(node) && nodeName(node, source) === name
  );
}

function unwrapObject(expression) {
  let current = expression;
  while (
    current &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isSatisfiesExpression(current))
  ) {
    current = current.expression;
  }
  return current && ts.isObjectLiteralExpression(current) ? current : null;
}

function getProperty(object, name, source) {
  if (!object) return undefined;
  return object.properties.find(
    (property) =>
      (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
      nodeName(property, source) === name
  );
}

function propertyInitializer(property) {
  if (!property) return undefined;
  if (ts.isPropertyAssignment(property)) return property.initializer;
  if (ts.isShorthandPropertyAssignment(property)) return property.name;
  return undefined;
}

function hasSpreadCall(object, name, argumentText, source) {
  return object.properties.some((property) => {
    if (!ts.isSpreadAssignment(property) || !ts.isCallExpression(property.expression)) return false;
    const call = property.expression;
    return (
      callName(call) === name &&
      call.arguments.length === 1 &&
      call.arguments[0].getText(source) === argumentText
    );
  });
}

function isNumericLiteral(expression, expected) {
  return ts.isNumericLiteral(expression) && Number(expression.text) === expected;
}

function isVersionIncrement(expression, source) {
  const object = unwrapObject(expression);
  const increment = getProperty(object, 'increment', source);
  return Boolean(increment && isNumericLiteral(propertyInitializer(increment), 1));
}

function objectHasVersionIncrement(object, source) {
  const version = getProperty(object, 'version', source);
  return Boolean(version && isVersionIncrement(propertyInitializer(version), source));
}

function hasMinOne(node) {
  return Boolean(
    findFirst(node, (candidate) => {
      if (!ts.isCallExpression(candidate)) return false;
      const name = callName(candidate);
      return (name === 'min' || name === 'gte') && isNumericLiteral(candidate.arguments[0], 1);
    })
  );
}

function checkRequiredVersionInitializer(info, initializer, label) {
  if (!initializer) {
    addError(info.file, `${label} 无法定位`);
    return;
  }
  if (hasNamedCall(initializer, 'optional')) {
    addError(info.file, `${label} 不得 optional`);
  }
  if (!hasNamedCall(initializer, 'int') || !hasMinOne(initializer)) {
    addError(info.file, `${label} 必须是必填整数且 >= 1`);
  }
}

function checkSchemas(target) {
  const info = readSource(target.schemaPath);
  if (!info) return;
  if (info.content.includes('@no-optimistic-lock')) {
    addError(info.file, 'Payment/Invoice 严格乐观锁文件禁止整文件豁免');
  }

  const updateDecl = findVariable(info.source, target.updateSchema);
  const updateVersion = updateDecl?.initializer
    ? findFirst(
        updateDecl.initializer,
        (node) => ts.isPropertyAssignment(node) && nodeName(node, info.source) === 'version'
      )
    : undefined;
  checkRequiredVersionInitializer(
    info,
    updateVersion && propertyInitializer(updateVersion),
    `${target.updateSchema}.version`
  );

  const batchVersionDecl = findVariable(info.source, target.batchVersionSchema);
  checkRequiredVersionInitializer(
    info,
    batchVersionDecl?.initializer,
    `${target.batchVersionSchema}`
  );

  const shapeDecl = findVariable(info.source, target.batchShape);
  const shape = unwrapObject(shapeDecl?.initializer);
  const idsProperty = getProperty(shape, 'ids', info.source);
  const versionsProperty = getProperty(shape, 'versions', info.source);
  if (!idsProperty || !versionsProperty) {
    addError(info.file, `${target.batchShape} 必须同时声明必填 ids 与 versions`);
  } else {
    const versionsText = nodeCode(info, propertyInitializer(versionsProperty));
    if (!versionsText.includes(target.batchVersionSchema)) {
      addError(info.file, `${target.batchShape}.versions 必须复用 ${target.batchVersionSchema}`);
    }
    if (hasNamedCall(propertyInitializer(versionsProperty), 'optional')) {
      addError(info.file, `${target.batchShape}.versions 不得 optional`);
    }
  }

  const factory = findFunction(info.source, target.batchFactory);
  if (!factory) {
    addError(info.file, `无法定位批量版本工厂 ${target.batchFactory}`);
  } else {
    for (const requiredCall of ['strict', 'superRefine']) {
      if (!hasNamedCall(factory, requiredCall)) {
        addError(info.file, `${target.batchFactory} 必须调用 .${requiredCall}()`);
      }
    }
    const factoryText = nodeCode(info, factory);
    for (const marker of ['idSet.size', 'Object.keys', 'missingIds', 'extraIds', 'addIssue']) {
      if (!factoryText.includes(marker)) {
        addError(info.file, `${target.batchFactory} 缺少 ids/versions 精确对应校验：${marker}`);
      }
    }
  }

  for (const schemaName of target.batchSchemas) {
    const declaration = findVariable(info.source, schemaName);
    const initializer = declaration?.initializer;
    if (
      !initializer ||
      !ts.isCallExpression(initializer) ||
      !ts.isIdentifier(initializer.expression) ||
      initializer.expression.text !== target.batchFactory
    ) {
      addError(
        info.file,
        `${schemaName} 必须直接通过 ${target.batchFactory} 定义，禁止漏掉逐行 CAS DTO`
      );
    }
  }
}

function checkProjectMutationSchemas() {
  for (const [schemaPath, schemaNames] of PROJECT_MUTATION_SCHEMAS) {
    const info = readSource(schemaPath);
    if (!info) continue;
    for (const schemaName of schemaNames) {
      const declaration = findVariable(info.source, schemaName);
      const version = declaration?.initializer
        ? findFirst(
            declaration.initializer,
            (node) => ts.isPropertyAssignment(node) && nodeName(node, info.source) === 'version'
          )
        : undefined;
      checkRequiredVersionInitializer(
        info,
        version && propertyInitializer(version),
        `${schemaName}.version`
      );
    }
  }
}

function checkProjectDeleteVersions() {
  for (const target of PROJECT_DELETE_TARGETS) {
    const service = readSource(target.servicePath);
    const controller = readSource(target.controllerPath);
    if (!service || !controller) continue;

    const serviceMethod = findMethod(service.source, 'remove');
    const requestVersion = serviceMethod?.parameters.find(
      (parameter) => parameter.name.getText(service.source) === 'requestVersion'
    );
    if (
      !serviceMethod ||
      !requestVersion ||
      requestVersion.questionToken ||
      requestVersion.type?.kind !== ts.SyntaxKind.NumberKeyword
    ) {
      addError(service.file, `${target.label}.remove 必须接收必填 requestVersion:number`);
    } else {
      const writes = mutationCalls(serviceMethod, target.model, 'update', service.source);
      const hasCasWrite = writes.some((write) => {
        const { where, data } = mutationArgs(write, service.source);
        return (
          propertyText(where, 'version', service.source) === 'requestVersion' &&
          Boolean(data && objectHasVersionIncrement(data, service.source))
        );
      });
      if (!hasCasWrite) {
        addError(
          service.file,
          `${target.label}.remove 必须固定 version:requestVersion 并递增 version`
        );
      }
    }

    const controllerMethod = findMethod(controller.source, 'remove');
    const controllerText = controllerMethod ? nodeCode(controller, controllerMethod) : '';
    if (
      !controllerMethod ||
      !controllerText.includes('MutationVersionQueryDto') ||
      !controllerText.includes('query.version')
    ) {
      addError(
        controller.file,
        `${target.label}.remove Controller 必须通过 MutationVersionQueryDto 透传 query.version`
      );
    }
  }
}

function mutationCalls(method, model, operation, source) {
  return findAll(method, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
    if (node.expression.name.text !== operation) return false;
    const receiver = node.expression.expression.getText(source);
    return receiver.endsWith(`.${model}`) || receiver === model;
  });
}

function mutationArgs(call, source) {
  const args = unwrapObject(call.arguments[0]);
  const whereExpression = propertyInitializer(getProperty(args, 'where', source));
  const dataExpression = propertyInitializer(getProperty(args, 'data', source));
  const where = unwrapObject(whereExpression);
  const data = unwrapObject(dataExpression);
  return { args, whereExpression, dataExpression, where, data };
}

function resolveObjectExpression(scope, expression) {
  const direct = unwrapObject(expression);
  if (direct) return direct;
  if (!expression || !ts.isIdentifier(expression)) return null;
  return unwrapObject(findVariable(scope, expression.text)?.initializer);
}

function propertyText(object, name, source) {
  return propertyInitializer(getProperty(object, name, source))
    ?.getText(source)
    .replace(/\s/g, '');
}

function hasObjectProperties(object, names, source) {
  return names.every((name) => Boolean(getProperty(object, name, source)));
}

function findServiceCall(node, serviceName, methodName, source) {
  return findFirst(node, (candidate) => {
    if (!ts.isCallExpression(candidate) || !ts.isPropertyAccessExpression(candidate.expression)) {
      return false;
    }
    return (
      candidate.expression.name.text === methodName &&
      candidate.expression.expression.getText(source).endsWith(`.${serviceName}`)
    );
  });
}

function hasResultCountConflictGuard(scope, write, source) {
  const resultName = assignedIdentifierName(write);
  if (!resultName) return false;
  return Boolean(
    findFirst(scope, (node) => {
      if (!ts.isIfStatement(node) || node.pos <= write.end) return false;
      const condition = node.expression;
      if (!ts.isBinaryExpression(condition)) return false;
      const left = condition.left;
      const checksCount =
        ts.isPropertyAccessExpression(left) &&
        ts.isIdentifier(left.expression) &&
        left.expression.text === resultName &&
        left.name.text === 'count' &&
        condition.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken;
      return (
        checksCount &&
        Boolean(
          findFirst(
            node.thenStatement,
            (candidate) =>
              ts.isNewExpression(candidate) &&
              candidate.expression.getText(source) === 'ConflictException'
          )
        )
      );
    })
  );
}

function methodHasP2025AndConflict(method) {
  let p2025 = false;
  let conflict = false;
  walk(method, (node) => {
    if (ts.isStringLiteralLike(node) && node.text === 'P2025') p2025 = true;
    if (ts.isNewExpression(node) && node.expression.getText() === 'ConflictException') {
      conflict = true;
    }
  });
  return p2025 && conflict;
}

function hasThrownConflict(node, source) {
  return Boolean(
    findFirst(
      node,
      (candidate) =>
        ts.isThrowStatement(candidate) &&
        candidate.expression &&
        ts.isNewExpression(candidate.expression) &&
        candidate.expression.expression.getText(source) === 'ConflictException'
    )
  );
}

/** P2025 必须来自 catch 变量的 error.code 比较，且对应分支真实 throw 409。 */
function hasP2025ConflictCatch(method, source) {
  return Boolean(
    findFirst(method, (node) => {
      if (!ts.isCatchClause(node) || !node.variableDeclaration) return false;
      const errorName = node.variableDeclaration.name.getText(source);
      return Boolean(
        findFirst(node.block, (candidate) => {
          if (!ts.isIfStatement(candidate) || !hasThrownConflict(candidate.thenStatement, source)) {
            return false;
          }
          return Boolean(
            findFirst(candidate.expression, (condition) => {
              if (!ts.isBinaryExpression(condition)) return false;
              const operator = condition.operatorToken.kind;
              if (
                operator !== ts.SyntaxKind.EqualsEqualsEqualsToken &&
                operator !== ts.SyntaxKind.EqualsEqualsToken
              ) {
                return false;
              }
              const left = condition.left.getText(source).replace(/\s/g, '');
              const right = condition.right.getText(source).replace(/\s/g, '');
              return (
                (left === `${errorName}.code` &&
                  ts.isStringLiteralLike(condition.right) &&
                  condition.right.text === 'P2025') ||
                (right === `${errorName}.code` &&
                  ts.isStringLiteralLike(condition.left) &&
                  condition.left.text === 'P2025')
              );
            })
          );
        })
      );
    })
  );
}

function hasVersionMismatchConflictGuard(method, leftText, rightText, source) {
  return Boolean(
    findFirst(method, (node) => {
      if (!ts.isIfStatement(node) || !hasThrownConflict(node.thenStatement, source)) return false;
      return Boolean(
        findFirst(node.expression, (condition) => {
          if (!ts.isBinaryExpression(condition)) return false;
          const operator = condition.operatorToken.kind;
          if (
            operator !== ts.SyntaxKind.ExclamationEqualsEqualsToken &&
            operator !== ts.SyntaxKind.ExclamationEqualsToken
          ) {
            return false;
          }
          const left = condition.left.getText(source).replace(/\s/g, '');
          const right = condition.right.getText(source).replace(/\s/g, '');
          return (
            (left === leftText && right === rightText) || (left === rightText && right === leftText)
          );
        })
      );
    })
  );
}

function checkSingleMethod(info, target, methodName) {
  const method = findMethod(info.source, methodName);
  if (!method) {
    addError(info.file, `无法定位 ${methodName} 方法，单条 CAS 未被覆盖`);
    return;
  }

  if (methodName === 'remove') {
    const requestVersion = method.parameters.find(
      (parameter) => parameter.name.getText(info.source) === 'requestVersion'
    );
    if (
      !requestVersion ||
      requestVersion.questionToken ||
      requestVersion.type?.kind !== ts.SyntaxKind.NumberKeyword
    ) {
      addError(info.file, 'remove.requestVersion 必须为必填 number');
    }
  }

  const calls = mutationCalls(method, target.model, 'update', info.source);
  const compliant = calls.some((call) => {
    const mutation = mutationArgs(call, info.source);
    const where = mutation.where;
    let data = mutation.data;
    if (!data && mutation.dataExpression && ts.isIdentifier(mutation.dataExpression)) {
      data = unwrapObject(findVariable(method, mutation.dataExpression.text)?.initializer);
    }
    if (!where || !data) return false;
    if (where.properties.some((property) => ts.isSpreadAssignment(property))) return false;
    const names = where.properties
      .filter(
        (property) =>
          ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)
      )
      .map((property) => nodeName(property, info.source))
      .sort();
    if (names.join(',') !== 'id,version') return false;
    const version = getProperty(where, 'version', info.source);
    if (propertyInitializer(version)?.getText(info.source) !== 'requestVersion') return false;
    return objectHasVersionIncrement(data, info.source);
  });

  if (!compliant) {
    addError(
      info.file,
      `${methodName} 必须使用固定 where:{id, version:requestVersion} 且 data.version increment，禁止条件展开`
    );
  }
  if (!methodHasP2025AndConflict(method)) {
    addError(info.file, `${methodName} 必须把 P2025 转换为 ConflictException`);
  }
}

function checkBatchWhereHelper(info, target) {
  const method = findMethod(info.source, target.whereHelper);
  if (!method) {
    addError(info.file, `无法定位批量 CAS where helper ${target.whereHelper}`);
    return;
  }
  const whereDecl = findFirst(
    method,
    (node) =>
      ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'where'
  );
  const where = unwrapObject(whereDecl?.initializer);
  const deletedAt = getProperty(where, 'deletedAt', info.source);
  const andProperty = getProperty(where, 'AND', info.source);
  const orProperty = andProperty
    ? findFirst(
        propertyInitializer(andProperty),
        (node) => ts.isPropertyAssignment(node) && nodeName(node, info.source) === 'OR'
      )
    : undefined;
  if (
    !deletedAt ||
    propertyInitializer(deletedAt)?.kind !== ts.SyntaxKind.NullKeyword ||
    !andProperty ||
    !orProperty
  ) {
    addError(
      info.file,
      `${target.whereHelper} 必须以 AND 包裹逐行 CAS OR，防止 scope helper 覆盖，并固定 deletedAt:null`
    );
    return;
  }

  const orInitializer = propertyInitializer(orProperty);
  const mapCall = findFirst(orInitializer, (node) => isNamedCall(node, 'map'));
  const callback = mapCall?.arguments[0];
  const pair = callback
    ? findFirst(callback, (node) => ts.isObjectLiteralExpression(node))
    : undefined;
  const id = getProperty(pair, 'id', info.source);
  const version = getProperty(pair, 'version', info.source);
  const flowStatus = getProperty(pair, 'flowStatus', info.source);
  const normalizedVersion = propertyInitializer(version)?.getText(info.source).replace(/\s/g, '');
  if (
    propertyInitializer(id)?.getText(info.source) !== 'row.id' ||
    normalizedVersion !== 'versions[row.id]' ||
    propertyInitializer(flowStatus)?.getText(info.source) !== 'row.flowStatus'
  ) {
    addError(
      info.file,
      `${target.whereHelper} 的每个 OR 分支必须绑定 id + expectedVersion + flowStatus`
    );
  }

  const scopeCall = findFirst(
    method,
    (node) =>
      isNamedCall(node, target.scopeHelper) && node.arguments[0]?.getText(info.source) === 'where'
  );
  if (!scopeCall) {
    addError(info.file, `${target.whereHelper} 必须在最终 where 上重新施加数据 scope`);
  }
}

function checkCountHelper(info, target) {
  const method = findMethod(info.source, target.countHelper);
  if (!method) {
    addError(info.file, `无法定位批量 CAS count helper ${target.countHelper}`);
    return;
  }
  const mismatch = findFirst(
    method,
    (node) =>
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken &&
      node.left.getText(info.source) === 'actual' &&
      node.right.getText(info.source) === 'expected'
  );
  const conflict = findFirst(
    method,
    (node) =>
      ts.isNewExpression(node) && node.expression.getText(info.source) === 'ConflictException'
  );
  if (!mismatch || !conflict) {
    addError(info.file, `${target.countHelper} 必须在 count 不符时抛 ConflictException`);
  }
}

function transactionCallbacks(method) {
  const callbacks = [];
  walk(method, (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === '$transaction'
    ) {
      const callback = node.arguments[0];
      if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
        callbacks.push(callback);
      }
    }
  });
  return callbacks;
}

function methodCallsName(method, name) {
  return Boolean(findFirst(method, (node) => isNamedCall(node, name)));
}

function assignedIdentifierName(call) {
  let current = call.parent;
  while (current && !ts.isVariableDeclaration(current)) {
    if (ts.isStatement(current) || ts.isMethodDeclaration(current)) return undefined;
    current = current.parent;
  }
  return current && ts.isIdentifier(current.name) ? current.name.text : undefined;
}

function findCountGuardForWrite(callback, countHelper, write, source) {
  const resultName = assignedIdentifierName(write);
  if (!resultName) return undefined;

  return findFirst(callback, (node) => {
    if (!isNamedCall(node, countHelper) || node.pos <= write.end || node.arguments.length !== 2) {
      return false;
    }
    const actual = node.arguments[0];
    const expected = node.arguments[1];
    return (
      ts.isPropertyAccessExpression(actual) &&
      ts.isIdentifier(actual.expression) &&
      actual.expression.text === resultName &&
      actual.name.text === 'count' &&
      ts.isPropertyAccessExpression(expected) &&
      ts.isIdentifier(expected.expression) &&
      expected.name.text === 'length'
    );
  });
}

function checkBatchMethod(info, target, methodName, inputType) {
  const method = findMethod(info.source, methodName);
  if (!method) {
    addError(info.file, `缺少 ${methodName}，批量写入口未纳入 CAS`);
    return;
  }
  const firstType = method.parameters[0]?.type?.getText(info.source);
  if (firstType !== inputType) {
    addError(info.file, `${methodName} 必须接收严格 DTO input ${inputType}`);
  }
  if (!nodeCode(info, method).includes('versions')) {
    addError(info.file, `${methodName} 必须消费客户端逐行 versions`);
  }

  const callback = transactionCallbacks(method).find(
    (candidate) => mutationCalls(candidate, target.model, 'updateMany', info.source).length > 0
  );
  if (!callback) {
    addError(info.file, `${methodName} 主写必须位于事务内并使用 ${target.model}.updateMany`);
    return;
  }

  const writes = mutationCalls(callback, target.model, 'updateMany', info.source);
  const compliantWrite = writes.find((call) => {
    const args = unwrapObject(call.arguments[0]);
    const whereExpression = propertyInitializer(getProperty(args, 'where', info.source));
    const data = unwrapObject(propertyInitializer(getProperty(args, 'data', info.source)));
    return (
      whereExpression &&
      methodCallsName(whereExpression, target.whereHelper) &&
      data &&
      objectHasVersionIncrement(data, info.source)
    );
  });
  if (!compliantWrite) {
    addError(
      info.file,
      `${methodName} 必须以 ${target.whereHelper} 做最终 CAS，并递增业务行 version`
    );
  }
  const countGuard = compliantWrite
    ? findCountGuardForWrite(callback, target.countHelper, compliantWrite, info.source)
    : undefined;
  if (!countGuard) {
    addError(
      info.file,
      `${methodName} 必须在主写后以其真实 result.count 与目标行集合 length 做 count guard`
    );
  }

  if (methodName === 'batchRemove' && !methodCallsName(callback, target.aggregateCall)) {
    addError(info.file, `${methodName} 的聚合重算必须与 CAS 主写处于同一事务`);
  }

  if (target.model === 'invoice' && methodName === 'batchRemove') {
    const invoiceWrite = compliantWrite;
    const guard = countGuard;
    const paymentWrite = mutationCalls(callback, 'payment', 'updateMany', info.source)[0];
    const paymentReferenceClear = findFirst(callback, (node) =>
      isNamedCall(node, 'clearActivePaymentInvoiceReferences')
    );
    const paymentReferenceEffect = paymentWrite ?? paymentReferenceClear;
    if (
      !invoiceWrite ||
      !guard ||
      !paymentReferenceEffect ||
      !(invoiceWrite.pos < guard.pos && guard.pos < paymentReferenceEffect.pos)
    ) {
      addError(
        info.file,
        'Invoice batchRemove 必须先通过发票 CAS/count guard，再清 payment 反向引用'
      );
    }
  }
}

function checkControllerDtos(target) {
  const info = readSource(target.controllerPath);
  if (!info) return;
  if (info.code.includes('BatchIdsDto')) {
    addError(info.file, 'Payment/Invoice 批量删除禁止继续使用仅 ids 的 BatchIdsDto');
  }
  for (const [methodName, dtoType] of target.batchDtos) {
    const method = findMethod(info.source, methodName);
    const firstType = method?.parameters[0]?.type?.getText(info.source);
    if (firstType !== dtoType) {
      addError(info.file, `${methodName} controller body 必须使用 ${dtoType}`);
    }
  }
}

function checkStrictService(target) {
  const info = readSource(target.servicePath);
  if (!info) return;
  if (info.content.includes('@no-optimistic-lock')) {
    addError(info.file, 'Payment/Invoice 严格乐观锁 Service 禁止整文件豁免');
  }
  checkSingleMethod(info, target, 'update');
  checkSingleMethod(info, target, 'remove');
  checkBatchWhereHelper(info, target);
  checkCountHelper(info, target);
  for (const [methodName, inputType] of target.batchMethods) {
    checkBatchMethod(info, target, methodName, inputType);
  }
}

function findTypedBodyParameter(method, typeName, source) {
  return method?.parameters.find(
    (parameter) =>
      parameter.type?.getText(source) === typeName && parameter.getText(source).includes('@Body()')
  );
}

function checkCustomerSchemas() {
  const info = readSource(CUSTOMER_TARGET.schemaPath);
  if (!info) return;
  if (info.content.includes('@no-optimistic-lock')) {
    addError(info.file, 'Customer 严格乐观锁 schema 禁止整文件豁免');
  }

  const versionDecl = findVariable(info.source, 'customerVersionSchema');
  checkRequiredVersionInitializer(info, versionDecl?.initializer, 'customerVersionSchema');

  for (const schemaName of [
    ...CUSTOMER_TARGET.actionSchemas,
    'customerResponseSchema',
    'updateCustomerSchema',
  ]) {
    const declaration = findVariable(info.source, schemaName);
    const versionProperty = declaration?.initializer
      ? findFirst(
          declaration.initializer,
          (node) => ts.isPropertyAssignment(node) && nodeName(node, info.source) === 'version'
        )
      : undefined;
    if (
      !versionProperty ||
      propertyText({ properties: [versionProperty] }, 'version', info.source) !==
        'customerVersionSchema'
    ) {
      addError(info.file, `${schemaName} 必须声明必填 customerVersionSchema`);
    }
  }

  const shapeDecl = findVariable(info.source, 'customerVersionedBatchShape');
  const shape = unwrapObject(shapeDecl?.initializer);
  if (!hasObjectProperties(shape, ['ids', 'versions'], info.source)) {
    addError(info.file, 'customerVersionedBatchShape 必须同时声明 ids 与 versions');
  } else if (!propertyText(shape, 'versions', info.source)?.includes('customerVersionSchema')) {
    addError(info.file, 'customerVersionedBatchShape.versions 必须复用 customerVersionSchema');
  }

  const factory = findFunction(info.source, 'createVersionedCustomerBatchSchema');
  for (const marker of ['strict', 'superRefine']) {
    if (!factory || !hasNamedCall(factory, marker)) {
      addError(info.file, `createVersionedCustomerBatchSchema 必须调用 .${marker}()`);
    }
  }
  for (const schemaName of CUSTOMER_TARGET.batchSchemas) {
    const declaration = findVariable(info.source, schemaName);
    const call = declaration?.initializer
      ? findFirst(declaration.initializer, (node) =>
          isNamedCall(node, 'createVersionedCustomerBatchSchema')
        )
      : undefined;
    if (!call) {
      addError(info.file, `${schemaName} 必须通过 createVersionedCustomerBatchSchema 定义`);
    }
  }
}

function checkCustomerDtosAndController() {
  for (const [relativePath, className, schemaName] of CUSTOMER_TARGET.dtoFiles) {
    const info = readSource(relativePath);
    if (!info) continue;
    const declaration = findFirst(
      info.source,
      (node) => ts.isClassDeclaration(node) && node.name?.text === className
    );
    const schemaCall = declaration
      ? findFirst(
          declaration,
          (node) =>
            isNamedCall(node, 'createZodDto') &&
            node.arguments[0]?.getText(info.source) === schemaName
        )
      : undefined;
    if (!schemaCall) {
      addError(info.file, `${className} 必须直接复用 ${schemaName}`);
    }
  }

  const info = readSource(CUSTOMER_TARGET.controllerPath);
  if (!info) return;
  const entries = [
    ['restore', 'RestoreCustomerDto', 1],
    ['permanentRemove', 'PermanentRemoveCustomerDto', 1],
    ['claim', 'ClaimCustomerDto', 1],
    ['updateLeadProgress', 'UpdateLeadProgressDto', 1],
    ...CUSTOMER_TARGET.batchControllerDtos.map(([method, dto]) => [method, dto, 0]),
  ];
  for (const [methodName, dtoType, serviceArgIndex] of entries) {
    const method = findMethod(info.source, methodName);
    if (!findTypedBodyParameter(method, dtoType, info.source)) {
      addError(info.file, `${methodName} controller 必须使用 @Body() ${dtoType}`);
      continue;
    }
    const serviceCall = findServiceCall(method, 'customersService', methodName, info.source);
    if (!serviceCall || serviceCall.arguments[serviceArgIndex]?.getText(info.source) !== 'dto') {
      addError(info.file, `${methodName} controller 必须把 dto 原样透传给 service`);
    }
  }
}

function checkCustomerPendingAndBatchHelpers(info) {
  const lockMethod = findMethod(info.source, 'lockCustomerManualWriteTargets');
  const targetLock = lockMethod
    ? findFirst(lockMethod, (node) => isNamedCall(node, 'lockApprovalChangeRequestTarget'))
    : undefined;
  const pendingRead = lockMethod
    ? findFirst(
        lockMethod,
        (node) =>
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 'findFirst' &&
          node.expression.expression.getText(info.source).endsWith('.approvalChangeRequest')
      )
    : undefined;
  const pendingConflict = lockMethod
    ? findFirst(
        lockMethod,
        (node) =>
          ts.isNewExpression(node) && node.expression.getText(info.source) === 'ConflictException'
      )
    : undefined;
  const pendingWhere = pendingRead ? mutationArgs(pendingRead, info.source).where : undefined;
  const pendingIdsParameter = lockMethod?.parameters[2];
  if (
    !targetLock ||
    !pendingRead ||
    !pendingConflict ||
    !(targetLock.pos < pendingRead.pos) ||
    pendingIdsParameter?.name.getText(info.source) !== 'pendingCustomerIds' ||
    pendingIdsParameter.initializer?.getText(info.source) !== 'customerIds' ||
    propertyText(pendingWhere, 'targetId', info.source) !== '{in:pendingIds}'
  ) {
    addError(
      info.file,
      'Customer pending 审批必须在固定全量目标锁后仅查询显式可见候选并以 ConflictException/409 阻断'
    );
  }

  const whereHelper = findMethod(info.source, 'buildCustomerBatchCasWhere');
  const whereDecl = whereHelper
    ? findFirst(
        whereHelper,
        (node) =>
          ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'where'
      )
    : undefined;
  const where = unwrapObject(whereDecl?.initializer);
  const scopeCall = whereHelper
    ? findFirst(
        whereHelper,
        (node) =>
          isNamedCall(node, 'applyCustomerCollabSelfScope') &&
          node.arguments[0]?.getText(info.source) === 'where'
      )
    : undefined;
  if (
    !hasObjectProperties(where, ['id', 'version', 'deletedAt'], info.source) ||
    propertyText(where, 'deletedAt', info.source) !== 'null' ||
    !scopeCall
  ) {
    addError(
      info.file,
      'buildCustomerBatchCasWhere 必须固定 id+version+deletedAt:null 并重施 scope'
    );
  }

  const countHelper = findMethod(info.source, 'assertCustomerBatchCasCount');
  const countMismatch = countHelper
    ? findFirst(
        countHelper,
        (node) =>
          ts.isBinaryExpression(node) &&
          node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken &&
          node.left.getText(info.source) === 'actual' &&
          node.right.getText(info.source) === '1'
      )
    : undefined;
  const countConflict = countHelper
    ? findFirst(
        countHelper,
        (node) =>
          ts.isNewExpression(node) && node.expression.getText(info.source) === 'ConflictException'
      )
    : undefined;
  if (!countMismatch || !countConflict) {
    addError(info.file, 'assertCustomerBatchCasCount 必须在逐行 count !== 1 时抛 409');
  }

  const loader = findMethod(info.source, 'loadLockedCustomerBatchTargets');
  if (!loader || loader.parameters[2]?.name.getText(info.source) !== 'versions') {
    addError(info.file, 'loadLockedCustomerBatchTargets 必须显式接收调用方 versions');
    return;
  }
  const findManyCalls = mutationCalls(loader, 'customer', 'findMany', info.source);
  const lock = findFirst(loader, (node) => isNamedCall(node, 'lockCustomerManualWriteTargets'));
  const initialScope = findFirst(
    loader,
    (node) =>
      isNamedCall(node, 'applyCustomerCollabSelfScope') &&
      node.arguments[0]?.getText(info.source) === 'initialScopeWhere'
  );
  const lockedRead = findManyCalls.find((call) => {
    if (!lock || call.pos <= lock.end) return false;
    const whereObject = unwrapObject(
      propertyInitializer(getProperty(unwrapObject(call.arguments[0]), 'where', info.source))
    );
    return (
      whereObject &&
      hasObjectProperties(whereObject, ['id'], info.source) &&
      !getProperty(whereObject, 'deletedAt', info.source)
    );
  });
  const versionCheck = findFirst(loader, (node) =>
    isNamedCall(node, 'requireCustomerBatchVersion')
  );
  const lockedScope = findFirst(
    loader,
    (node) =>
      isNamedCall(node, 'applyCustomerCollabSelfScope') &&
      node.arguments[0]?.getText(info.source) === 'lockedScopeWhere'
  );
  const pendingIdsArgument = lock?.arguments[2];
  const locksInitialCandidates =
    pendingIdsArgument &&
    ts.isArrayLiteralExpression(pendingIdsArgument) &&
    pendingIdsArgument.elements.length === 1 &&
    ts.isSpreadElement(pendingIdsArgument.elements[0]) &&
    pendingIdsArgument.elements[0].expression.getText(info.source) === 'initialCandidateIds';
  if (
    !initialScope ||
    !lock ||
    !locksInitialCandidates ||
    !lockedRead ||
    !versionCheck ||
    !lockedScope ||
    !(
      initialScope.pos < lock.pos &&
      lock.pos < lockedRead.pos &&
      lockedRead.pos < versionCheck.pos &&
      versionCheck.pos < lockedScope.pos
    )
  ) {
    addError(
      info.file,
      'Customer batch 必须按“初始 scope→固定锁序→无 scope 全量快照/version/软删核对→scope 复验”执行'
    );
  }
}

function exactMutationCalls(node, receiver, operation, source) {
  return findAll(node, (candidate) => {
    if (!ts.isCallExpression(candidate) || !ts.isPropertyAccessExpression(candidate.expression)) {
      return false;
    }
    return (
      candidate.expression.name.text === operation &&
      candidate.expression.expression.getText(source) === receiver
    );
  });
}

function isThisMethodCall(node, methodName, source) {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === methodName &&
    node.expression.expression.getText(source) === 'this'
  );
}

function findCustomerTransactionWrites(method, operation, source) {
  const entries = [];
  for (const callback of transactionCallbacks(method)) {
    const txName = callback.parameters[0]?.name.getText(source);
    if (!txName) continue;
    for (const write of exactMutationCalls(callback, `${txName}.customer`, operation, source)) {
      entries.push({ callback, txName, write });
    }
  }
  return entries;
}

function findExactScopeCall(scope, whereExpression, source) {
  const whereText = whereExpression?.getText(source);
  if (!whereText) return undefined;
  return findFirst(
    scope,
    (node) =>
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'applyCustomerCollabSelfScope' &&
      node.arguments[0]?.getText(source) === whereText &&
      node.arguments[1]?.getText(source) === 'chargerScope' &&
      node.arguments[2]?.getText(source) === 'currentEmployeeId'
  );
}

function checkCustomerOrdinaryScopedCas(info, methodName, versionText, inputType) {
  const method = findMethod(info.source, methodName);
  if (!method || (inputType && method.parameters[1]?.type?.getText(info.source) !== inputType)) {
    addError(info.file, `${methodName} 普通写入口签名无法定位`);
    return;
  }
  if (methodName === 'update') {
    const requestVersion = findVariable(method, 'requestVersion');
    if (requestVersion?.initializer?.getText(info.source) !== 'dto.version') {
      addError(info.file, 'Customer update 必须从 dto.version 绑定 requestVersion');
    }
  } else {
    const requestVersion = method.parameters.find(
      (parameter) => parameter.name.getText(info.source) === 'requestVersion'
    );
    if (
      !requestVersion ||
      requestVersion.questionToken ||
      requestVersion.type?.kind !== ts.SyntaxKind.NumberKeyword
    ) {
      addError(info.file, 'Customer remove.requestVersion 必须为必填 number');
    }
  }

  const writes = findCustomerTransactionWrites(method, 'update', info.source);
  const entry = writes.length === 1 ? writes[0] : undefined;
  const mutation = entry ? mutationArgs(entry.write, info.source) : {};
  const where = entry ? resolveObjectExpression(method, mutation.whereExpression) : undefined;
  const data = entry ? resolveObjectExpression(method, mutation.dataExpression) : undefined;
  const lock = entry
    ? findFirst(
        entry.callback,
        (node) =>
          isThisMethodCall(node, 'lockCustomerManualWriteTargets', info.source) &&
          node.arguments[0]?.getText(info.source) === entry.txName
      )
    : undefined;
  const scopeCall = entry
    ? findExactScopeCall(entry.callback, mutation.whereExpression, info.source)
    : undefined;
  const compliant =
    entry &&
    lock &&
    scopeCall &&
    lock.pos < scopeCall.pos &&
    scopeCall.pos < entry.write.pos &&
    hasObjectProperties(where, ['id', 'version', 'deletedAt'], info.source) &&
    propertyText(where, 'id', info.source) === 'id' &&
    propertyText(where, 'version', info.source) === versionText &&
    propertyText(where, 'deletedAt', info.source) === 'null' &&
    objectHasVersionIncrement(data, info.source) &&
    hasP2025ConflictCatch(method, info.source);
  if (!compliant) {
    addError(
      info.file,
      `Customer ${methodName} 必须在目标锁后对 id+调用方 version+deletedAt:null 重施 scope，执行唯一最终 CAS/+1，并把 P2025 转 409`
    );
  }
}

function checkCustomerSubmitLeadStageCas(info) {
  const method = findMethod(info.source, 'submitLeadStageChangeRequest');
  if (
    !method ||
    method.parameters[1]?.type?.getText(info.source) !== 'SubmitLeadStageChangeInput'
  ) {
    addError(info.file, 'submitLeadStageChangeRequest 必须接收版本化 input');
    return;
  }
  const submitCalls = exactMutationCalls(
    method,
    'this.businessApprovalService',
    'submitChangeApproval',
    info.source
  );
  const submit = submitCalls.length === 1 ? submitCalls[0] : undefined;
  const config = submit ? resolveObjectExpression(method, submit.arguments[0]) : undefined;
  const validateProperty = getProperty(config, 'validateInTransaction', info.source);
  const validate = propertyInitializer(validateProperty);
  const txName =
    validate && (ts.isArrowFunction(validate) || ts.isFunctionExpression(validate))
      ? validate.parameters[0]?.name.getText(info.source)
      : undefined;
  const reads =
    validate && txName
      ? exactMutationCalls(validate, `${txName}.customer`, 'findFirst', info.source)
      : [];
  const read = reads.length === 1 ? reads[0] : undefined;
  const mutation = read ? mutationArgs(read, info.source) : {};
  const where = validate ? resolveObjectExpression(validate, mutation.whereExpression) : undefined;
  const scopeCall = validate
    ? findExactScopeCall(validate, mutation.whereExpression, info.source)
    : undefined;

  if (
    !hasVersionMismatchConflictGuard(method, 'dto.version', 'existing.version', info.source) ||
    !submit ||
    submit.arguments[1]?.getText(info.source) !== 'currentUser' ||
    propertyText(config, 'baseVersion', info.source) !== 'dto.version' ||
    !validate ||
    !read ||
    !scopeCall ||
    !(scopeCall.pos < read.pos) ||
    !hasObjectProperties(where, ['id', 'version', 'deletedAt', 'leadStage'], info.source) ||
    propertyText(where, 'id', info.source) !== 'id' ||
    propertyText(where, 'version', info.source) !== 'dto.version' ||
    propertyText(where, 'deletedAt', info.source) !== 'null' ||
    propertyText(where, 'leadStage', info.source) !== 'existing.leadStage' ||
    !hasThrownConflict(validate, info.source)
  ) {
    addError(
      info.file,
      'submitLeadStageChangeRequest 必须用 dto.version 预检并绑定真实 submitChangeApproval/baseVersion/锁内 scope CAS'
    );
  }
}

function checkCustomerCorrectLeadStageCas(info) {
  const method = findMethod(info.source, 'correctLeadStage');
  if (!method || method.parameters[1]?.type?.getText(info.source) !== 'CorrectLeadStageInput') {
    addError(info.file, 'correctLeadStage 必须接收版本化 input');
    return;
  }
  const writes = findCustomerTransactionWrites(method, 'update', info.source);
  const entry = writes.length === 1 ? writes[0] : undefined;
  const mutation = entry ? mutationArgs(entry.write, info.source) : {};
  const where = entry ? resolveObjectExpression(method, mutation.whereExpression) : undefined;
  const data = entry ? resolveObjectExpression(method, mutation.dataExpression) : undefined;
  const lock = entry
    ? findFirst(
        entry.callback,
        (node) =>
          isThisMethodCall(node, 'lockCustomerManualWriteTargets', info.source) &&
          node.arguments[0]?.getText(info.source) === entry.txName
      )
    : undefined;
  if (
    !hasVersionMismatchConflictGuard(method, 'dto.version', 'existing.version', info.source) ||
    !entry ||
    !lock ||
    !(lock.pos < entry.write.pos) ||
    !hasObjectProperties(where, ['id', 'version', 'deletedAt'], info.source) ||
    propertyText(where, 'id', info.source) !== 'id' ||
    propertyText(where, 'version', info.source) !== 'dto.version' ||
    propertyText(where, 'deletedAt', info.source) !== 'null' ||
    !objectHasVersionIncrement(data, info.source) ||
    !hasP2025ConflictCatch(method, info.source)
  ) {
    addError(
      info.file,
      'correctLeadStage 必须预检 dto.version，并在目标锁后执行唯一 id+dto.version CAS/+1/P2025→409'
    );
  }
}

function checkCustomerSingleWrites(info) {
  checkCustomerOrdinaryScopedCas(info, 'update', 'requestVersion', 'UpdateCustomerDto');
  checkCustomerOrdinaryScopedCas(info, 'remove', 'requestVersion');
  checkCustomerSubmitLeadStageCas(info);
  checkCustomerCorrectLeadStageCas(info);
  const restore = findMethod(info.source, 'restore');
  if (!restore || restore.parameters[1]?.type?.getText(info.source) !== 'RestoreCustomerInput') {
    addError(info.file, 'restore 必须接收 RestoreCustomerInput');
  } else {
    const callback = transactionCallbacks(restore)[0];
    const write = callback
      ? mutationCalls(callback, 'customer', 'updateMany', info.source)[0]
      : undefined;
    const lock = callback
      ? findFirst(callback, (node) => isNamedCall(node, 'lockCustomerManualWriteTargets'))
      : undefined;
    const mutation = write ? mutationArgs(write, info.source) : {};
    const where = resolveObjectExpression(restore, mutation.whereExpression);
    const data = resolveObjectExpression(restore, mutation.dataExpression);
    const lifecycleCalls = callback
      ? exactMutationCalls(callback, 'this.customerLifecycle', 'recompute', info.source)
      : [];
    const lifecycle = lifecycleCalls.length === 1 ? lifecycleCalls[0] : undefined;
    const lifecycleOptions = lifecycle ? unwrapObject(lifecycle.arguments[1]) : undefined;
    const versioning = resolveObjectExpression(
      restore,
      propertyInitializer(getProperty(lifecycleOptions, 'versioning', info.source))
    );
    if (
      !callback ||
      !write ||
      !lock ||
      !(lock.pos < write.pos) ||
      !hasObjectProperties(where, ['id', 'version', 'deletedAt'], info.source) ||
      propertyText(where, 'version', info.source) !== 'dto.version' ||
      !objectHasVersionIncrement(data, info.source) ||
      !hasResultCountConflictGuard(callback, write, info.source) ||
      !lifecycle ||
      lifecycle.arguments[0]?.getText(info.source) !== 'id' ||
      lifecycle.arguments[2]?.getText(info.source) !==
        callback.parameters[0]?.name.getText(info.source) ||
      lifecycle.pos <= write.end ||
      propertyText(versioning, 'mode', info.source) !== "'preserve'" ||
      propertyText(versioning, 'expectedVersion', info.source) !== 'dto.version+1'
    ) {
      addError(
        info.file,
        'restore 必须在锁内以调用方 dto.version CAS、count 409，并以 preserve-version 同事务重算'
      );
    }
  }

  const permanent = findMethod(info.source, 'permanentRemove');
  if (
    !permanent ||
    permanent.parameters[1]?.type?.getText(info.source) !== 'PermanentRemoveCustomerInput'
  ) {
    addError(info.file, 'permanentRemove 必须接收 PermanentRemoveCustomerInput');
  } else {
    const callback = transactionCallbacks(permanent)[0];
    const write = callback
      ? mutationCalls(callback, 'customer', 'delete', info.source)[0]
      : undefined;
    const lock = callback
      ? findFirst(callback, (node) => isNamedCall(node, 'lockCustomerManualWriteTargets'))
      : undefined;
    const where = write
      ? resolveObjectExpression(permanent, mutationArgs(write, info.source).whereExpression)
      : undefined;
    if (
      !write ||
      !lock ||
      !(lock.pos < write.pos) ||
      !hasObjectProperties(where, ['id', 'version', 'deletedAt'], info.source) ||
      propertyText(where, 'version', info.source) !== 'dto.version' ||
      !methodHasP2025AndConflict(permanent)
    ) {
      addError(info.file, 'permanentRemove 最终 DELETE 必须在锁内绑定调用方 dto.version CAS');
    }
  }

  const claim = findMethod(info.source, 'claim');
  if (!claim || claim.parameters[1]?.type?.getText(info.source) !== 'ClaimCustomerInput') {
    addError(info.file, 'claim 必须接收 ClaimCustomerInput');
  } else {
    const callback = transactionCallbacks(claim)[0];
    const write = callback
      ? mutationCalls(callback, 'customer', 'updateMany', info.source)[0]
      : undefined;
    const lock = callback
      ? findFirst(callback, (node) => isNamedCall(node, 'lockCustomerManualWriteTargets'))
      : undefined;
    const postLockRead = callback
      ? findFirst(
          callback,
          (node) =>
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === 'findUnique' &&
            node.expression.expression.getText(info.source).endsWith('.customer')
        )
      : undefined;
    const mutation = write ? mutationArgs(write, info.source) : {};
    const where = resolveObjectExpression(claim, mutation.whereExpression);
    const data = resolveObjectExpression(claim, mutation.dataExpression);
    if (
      !write ||
      !lock ||
      !postLockRead ||
      !(lock.pos < postLockRead.pos && postLockRead.pos < write.pos) ||
      !hasObjectProperties(where, ['id', 'version', 'deletedAt', 'chargerId'], info.source) ||
      propertyText(where, 'version', info.source) !== 'dto.version' ||
      !objectHasVersionIncrement(data, info.source) ||
      !hasResultCountConflictGuard(callback, write, info.source)
    ) {
      addError(
        info.file,
        'claim 必须区分锁前存在性，并在锁后以 dto.version+公海状态 CAS/count 409'
      );
    }
  }

  const updateLead = findMethod(info.source, 'updateLeadProgress');
  const leadCall = updateLead
    ? findFirst(updateLead, (node) => isNamedCall(node, 'applyLeadProgressState'))
    : undefined;
  const leadArgs = leadCall ? unwrapObject(leadCall.arguments[0]) : undefined;
  if (
    !updateLead ||
    updateLead.parameters[1]?.type?.getText(info.source) !== 'UpdateLeadProgressInput' ||
    propertyText(leadArgs, 'expectedVersion', info.source) !== 'dto.version'
  ) {
    addError(info.file, 'updateLeadProgress 必须把 dto.version 结构化透传给统一 Leads CAS');
  }

  const leadPrimitive = findMethod(info.source, 'applyLeadProgressState');
  const leadCallback = leadPrimitive ? transactionCallbacks(leadPrimitive)[0] : undefined;
  const leadWrite = leadCallback
    ? mutationCalls(leadCallback, 'customer', 'update', info.source)[0]
    : undefined;
  const leadLock = leadCallback
    ? findFirst(leadCallback, (node) => isNamedCall(node, 'lockCustomerManualWriteTargets'))
    : undefined;
  const leadMutation = leadWrite ? mutationArgs(leadWrite, info.source) : {};
  const leadWhere = resolveObjectExpression(leadPrimitive, leadMutation.whereExpression);
  const leadData = resolveObjectExpression(leadPrimitive, leadMutation.dataExpression);
  if (
    !leadWrite ||
    !leadLock ||
    !(leadLock.pos < leadWrite.pos) ||
    !hasObjectProperties(leadWhere, ['id', 'version', 'deletedAt'], info.source) ||
    propertyText(leadWhere, 'version', info.source) !== 'args.expectedVersion' ||
    !objectHasVersionIncrement(leadData, info.source) ||
    !hasP2025ConflictCatch(leadPrimitive, info.source)
  ) {
    addError(info.file, 'applyLeadProgressState 必须在锁内以 expectedVersion 做最终 CAS 并 +1');
  }
}

function checkCustomerBatchMethods(info) {
  for (const [methodName, inputType] of CUSTOMER_TARGET.batchMethods) {
    const method = findMethod(info.source, methodName);
    if (!method || method.parameters[0]?.type?.getText(info.source) !== inputType) {
      addError(info.file, `${methodName} 必须接收 ${inputType}`);
      continue;
    }
    const callback = transactionCallbacks(method)[0];
    const loader = callback
      ? findFirst(callback, (node) => isNamedCall(node, 'loadLockedCustomerBatchTargets'))
      : undefined;
    const write = callback
      ? mutationCalls(callback, 'customer', 'updateMany', info.source)[0]
      : undefined;
    const mutation = write ? mutationArgs(write, info.source) : {};
    const data = resolveObjectExpression(method, mutation.dataExpression);
    const whereCall = mutation.whereExpression;
    const resultName = write ? assignedIdentifierName(write) : undefined;
    const countGuard = callback
      ? findFirst(
          callback,
          (node) =>
            isNamedCall(node, 'assertCustomerBatchCasCount') &&
            node.pos > (write?.end ?? 0) &&
            resultName &&
            node.arguments[0]?.getText(info.source) === `${resultName}.count`
        )
      : undefined;
    if (
      !loader ||
      loader.arguments[2]?.getText(info.source) !== 'versions' ||
      !write ||
      !(loader.pos < write.pos) ||
      !whereCall ||
      !methodCallsName(whereCall, 'buildCustomerBatchCasWhere') ||
      !objectHasVersionIncrement(data, info.source) ||
      !countGuard
    ) {
      addError(
        info.file,
        `${methodName} 必须消费 versions，经锁后全量快照后逐行最终 CAS/count guard/+1`
      );
    }
  }
}

function checkCustomerService() {
  const info = readSource(CUSTOMER_TARGET.servicePath);
  if (!info) return;
  if (info.content.includes('@no-optimistic-lock')) {
    addError(info.file, 'Customer 严格乐观锁 Service 禁止整文件豁免');
  }
  checkCustomerPendingAndBatchHelpers(info);
  checkCustomerSingleWrites(info);
  checkCustomerBatchMethods(info);
}

function checkCustomerLifecycle() {
  const info = readSource(CUSTOMER_TARGET.lifecyclePath);
  if (!info) return;
  const entry = findFunction(info.source, 'recomputeCustomerLifecycle');
  const locked = findFunction(info.source, 'recomputeLockedCustomer');
  const rowLock = entry
    ? findFirst(
        entry,
        (node) => ts.isPropertyAccessExpression(node) && node.name.text === '$queryRaw'
      )
    : undefined;
  const lockedCall = entry
    ? findFirst(entry, (node) => isNamedCall(node, 'recomputeLockedCustomer'))
    : undefined;
  if (!rowLock || !lockedCall || !(rowLock.pos < lockedCall.pos)) {
    addError(info.file, 'Customer lifecycle 必须先按序 FOR UPDATE，再进入锁后读算写');
  }

  const customerRead = locked
    ? mutationCalls(locked, 'customer', 'findFirst', info.source)[0]
    : undefined;
  const readArgs = customerRead ? unwrapObject(customerRead.arguments[0]) : undefined;
  const select = unwrapObject(propertyInitializer(getProperty(readArgs, 'select', info.source)));
  const requiredFields = [
    'version',
    'contactStatus',
    'dealStatus',
    'lastKeepRecordTime',
    'lastKeepRecordContent',
    'leadStage',
    'leadProgressStatus',
    'leadProgressUpdatedAt',
    'leadAppointmentAt',
    'leadProgressReason',
    'updaterEmployeeId',
  ];
  if (!customerRead || !hasObjectProperties(select, requiredFields, info.source)) {
    addError(info.file, 'Customer lifecycle 锁后查询必须读取 version 与全部派生字段');
  }

  const write = locked
    ? mutationCalls(locked, 'customer', 'updateMany', info.source)[0]
    : undefined;
  const mutation = write ? mutationArgs(write, info.source) : {};
  const where = resolveObjectExpression(locked, mutation.whereExpression);
  const versionIncrement = locked
    ? findFirst(
        locked,
        (node) =>
          ts.isBinaryExpression(node) &&
          node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          node.left.getText(info.source).replace(/\s/g, '') === 'data.version' &&
          isVersionIncrement(node.right, info.source)
      )
    : undefined;
  const noChangeReturn = locked
    ? findFirst(
        locked,
        (node) =>
          ts.isIfStatement(node) &&
          node.expression.getText(info.source).replace(/\s/g, '') === '!changed' &&
          Boolean(findFirst(node.thenStatement, (child) => ts.isReturnStatement(child)))
      )
    : undefined;
  const safeAudit = locked
    ? findFirst(
        locked,
        (node) =>
          ts.isBinaryExpression(node) &&
          node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          node.left.getText(info.source).replace(/\s/g, '') === 'data.updaterEmployeeId' &&
          node.right.getText(info.source).replace(/\s/g, '') === 'options.actor.employeeId??null'
      )
    : undefined;
  if (
    !write ||
    !hasObjectProperties(where, ['id', 'version', 'deletedAt'], info.source) ||
    propertyText(where, 'version', info.source) !== 'customer.version' ||
    !versionIncrement ||
    !noChangeReturn ||
    noChangeReturn.pos > write.pos ||
    !safeAudit ||
    !hasResultCountConflictGuard(locked, write, info.source)
  ) {
    addError(
      info.file,
      'Customer lifecycle 必须仅在真实变化时安全审计，以 id+version CAS/count 409 且默认只 +1'
    );
  }
  const actorIdAudit = locked
    ? findFirst(
        locked,
        (node) =>
          ts.isPropertyAccessExpression(node) &&
          node.getText(info.source).replace(/\s/g, '') === 'options.actor.id'
      )
    : undefined;
  if (actorIdAudit) {
    addError(info.file, 'Customer lifecycle 禁止把 actor.id 猜成 Employee FK');
  }
}

function checkCustomerWebAndCli() {
  const typesInfo = readSource(CUSTOMER_TARGET.webTypesPath);
  if (typesInfo) {
    const trashInterface = findFirst(
      typesInfo.source,
      (node) => ts.isInterfaceDeclaration(node) && node.name.text === 'TrashItem'
    );
    const versionMember = trashInterface?.members.find(
      (member) => nodeName(member, typesInfo.source) === 'version'
    );
    const mapper = findFunction(typesInfo.source, 'customerToTrashItem');
    const returned = mapper
      ? findFirst(
          mapper,
          (node) => ts.isReturnStatement(node) && Boolean(unwrapObject(node.expression))
        )
      : undefined;
    const mapped = returned ? unwrapObject(returned.expression) : undefined;
    if (!versionMember || propertyText(mapped, 'version', typesInfo.source) !== 'data.version') {
      addError(typesInfo.file, 'Web TrashItem/customerToTrashItem 必须保留 Customer 真实 version');
    }
  }

  const trashInfo = readSource(CUSTOMER_TARGET.webTrashPath);
  if (trashInfo) {
    const restore = findVariable(trashInfo.source, 'handleRestore');
    const restoreCall = restore
      ? mutationCalls(restore, 'api', 'post', trashInfo.source)[0]
      : undefined;
    const restoreBody = restoreCall ? unwrapObject(restoreCall.arguments[1]) : undefined;
    const permanent = findVariable(trashInfo.source, 'handlePermanentDelete');
    const deleteCall = permanent
      ? mutationCalls(permanent, 'api', 'delete', trashInfo.source)[0]
      : undefined;
    const deleteConfig = deleteCall ? unwrapObject(deleteCall.arguments[1]) : undefined;
    const deleteBody = resolveObjectExpression(
      permanent,
      propertyInitializer(getProperty(deleteConfig, 'data', trashInfo.source))
    );
    if (propertyText(restoreBody, 'version', trashInfo.source) !== 'selectedItem.version') {
      addError(trashInfo.file, 'Web Customer restore 必须 POST selectedItem.version body');
    }
    if (propertyText(deleteBody, 'version', trashInfo.source) !== 'selectedItem.version') {
      addError(trashInfo.file, 'Web Customer permanent delete 必须 DELETE data.version body');
    }
  }

  const utilsInfo = readSource(CUSTOMER_TARGET.cliUtilsPath);
  if (utilsInfo) {
    const encoder = findFunction(utilsInfo.source, 'encodeUuidPathId');
    const safeParse = encoder
      ? findFirst(encoder, (node) => isNamedCall(node, 'safeParse'))
      : undefined;
    const encode = encoder
      ? findFirst(encoder, (node) => isNamedCall(node, 'encodeURIComponent'))
      : undefined;
    if (!safeParse || !encode || !(safeParse.pos < encode.pos)) {
      addError(utilsInfo.file, 'CLI path id 必须先 UUID.safeParse，再 encodeURIComponent');
    }
  }

  const crudInfo = readSource(CUSTOMER_TARGET.cliCrudPath);
  if (crudInfo) {
    const resolver = findVariable(crudInfo.source, 'resolveEntityPath');
    if (!resolver || !hasNamedCall(resolver, 'encodeUuidPathId')) {
      addError(crudInfo.file, '通用 CRUD 路径必须统一经过 encodeUuidPathId');
    }
    const restoreAction = findFirst(
      crudInfo.source,
      (node) =>
        isNamedCall(node, 'action') &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.getText(crudInfo.source) === 'restoreCmd'
    );
    const callback = restoreAction?.arguments[0];
    const requestCall = callback
      ? findFirst(callback, (node) => isNamedCall(node, 'request'))
      : undefined;
    const requiredVersion = findFirst(
      crudInfo.source,
      (node) =>
        isNamedCall(node, 'requiredOption') &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.getText(crudInfo.source) === 'restoreCmd' &&
        node.arguments[0]?.getText(crudInfo.source).includes('--version')
    );
    if (
      !restoreAction ||
      !requiredVersion ||
      !requestCall ||
      requestCall.arguments[2]?.getText(crudInfo.source) !== 'body'
    ) {
      addError(crudInfo.file, 'CLI customers restore 必须 --version 并作为 body 发送');
    }
  }

  const customersInfo = readSource(CUSTOMER_TARGET.cliCustomersPath);
  if (customersInfo) {
    const pathHelper = findFunction(customersInfo.source, 'customerPath');
    const permanentAction = findFirst(
      customersInfo.source,
      (node) =>
        isNamedCall(node, 'action') &&
        node.getText(customersInfo.source).includes("'permanent-delete <id>'")
    );
    const callback = permanentAction?.arguments[0];
    const bodyDecl = callback
      ? findFirst(
          callback,
          (node) =>
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.name.text === 'body'
        )
      : undefined;
    const body = unwrapObject(bodyDecl?.initializer);
    const requestCall = callback
      ? findFirst(callback, (node) => isNamedCall(node, 'request'))
      : undefined;
    const requiredVersion = permanentAction
      ? findFirst(
          permanentAction,
          (node) =>
            isNamedCall(node, 'requiredOption') &&
            node.arguments[0]?.getText(customersInfo.source).includes('--version')
        )
      : undefined;
    if (!pathHelper || !hasNamedCall(pathHelper, 'encodeUuidPathId')) {
      addError(customersInfo.file, 'Customer 专用 CLI path 必须统一经过 encodeUuidPathId');
    }
    if (
      !permanentAction ||
      !requiredVersion ||
      propertyText(body, 'version', customersInfo.source) !==
        'parseCustomerVersion(opts.version)' ||
      requestCall?.arguments[2]?.getText(customersInfo.source) !== 'body'
    ) {
      addError(customersInfo.file, 'CLI permanent-delete 必须 --version 并作为 DELETE body 发送');
    }
  }
}

function checkCustomerOptimisticLock() {
  checkCustomerSchemas();
  checkCustomerDtosAndController();
  checkCustomerService();
  checkCustomerLifecycle();
  checkCustomerWebAndCli();
}

function flowStatusWrites(node, source) {
  const writes = [];
  walk(node, (candidate) => {
    if (!ts.isCallExpression(candidate)) return;
    const args = unwrapObject(candidate.arguments[0]);
    const data = unwrapObject(propertyInitializer(getProperty(args, 'data', source)));
    if (data && getProperty(data, 'flowStatus', source)) writes.push(data);
  });
  return writes;
}

function hasExplicitCurrentEmployeeAudit(data, source) {
  const updater = getProperty(data, 'updaterEmployeeId', source);
  const text = propertyInitializer(updater)?.getText(source).replace(/\s/g, '');
  return text === 'currentUser.employeeId??null';
}

function checkFlowWrite(info, data, context) {
  if (!objectHasVersionIncrement(data, info.source)) {
    addError(info.file, `${context} 的 flowStatus 写入缺少 version:{increment:1}`);
  }
  if (
    !hasSpreadCall(data, 'auditUpdate', 'currentUser', info.source) &&
    !hasExplicitCurrentEmployeeAudit(data, info.source)
  ) {
    addError(
      info.file,
      `${context} 的 flowStatus 写入缺少 auditUpdate(currentUser) 或显式 currentUser.employeeId 审计`
    );
  }
}

function checkSubmitBusinessApprovalCasOrder(info, method) {
  const claimCalls = findAll(method, (node) => {
    if (!isNamedCall(node, 'updateMany')) return false;
    const args = unwrapObject(node.arguments[0]);
    const data = unwrapObject(propertyInitializer(getProperty(args, 'data', info.source)));
    return Boolean(data && getProperty(data, 'flowStatus', info.source));
  });
  if (claimCalls.length !== 1) {
    addError(info.file, 'submitBusinessApproval 必须且只能有一个 updateMany 业务 CAS 抢占');
    return;
  }

  const claim = claimCalls[0];
  const mutation = mutationArgs(claim, info.source);
  const version = getProperty(mutation.where, 'version', info.source);
  const flowStatus = getProperty(mutation.where, 'flowStatus', info.source);
  const versionText = propertyInitializer(version)?.getText(info.source).replace(/\s/g, '');
  const flowStatusText = propertyInitializer(flowStatus)?.getText(info.source).replace(/\s/g, '');
  if (versionText !== 'record.version' || flowStatusText !== 'record.flowStatus??null') {
    addError(
      info.file,
      'submitBusinessApproval 的 updateMany where 必须绑定 record.version 与 record.flowStatus'
    );
  }

  const resultName = assignedIdentifierName(claim);
  const guard = resultName
    ? findFirst(method, (node) => {
        if (!ts.isIfStatement(node) || !ts.isBinaryExpression(node.expression)) return false;
        const condition = node.expression;
        const left = condition.left;
        return (
          condition.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken &&
          ts.isPropertyAccessExpression(left) &&
          ts.isIdentifier(left.expression) &&
          left.expression.text === resultName &&
          left.name.text === 'count' &&
          isNumericLiteral(condition.right, 1) &&
          Boolean(
            findFirst(
              node.thenStatement,
              (candidate) =>
                ts.isNewExpression(candidate) &&
                candidate.expression.getText(info.source) === 'ConflictException'
            )
          )
        );
      })
    : undefined;
  if (!guard) {
    addError(
      info.file,
      'submitBusinessApproval 必须以真实 CAS result.count !== 1 抛 ConflictException'
    );
  }

  const createInstance = findFirst(method, (node) => isNamedCall(node, 'createApprovalInstance'));
  if (!createInstance || !guard || !(claim.end < guard.pos && guard.end < createInstance.pos)) {
    addError(
      info.file,
      'submitBusinessApproval 只能在业务 CAS 与 count guard 成功之后创建审批实例'
    );
  }
}

function checkApprovalStatusVersions() {
  const businessInfo = readSource('apps/server/src/modules/approvals/business-approval.service.ts');
  if (businessInfo) {
    if (businessInfo.content.includes('@no-optimistic-lock')) {
      addError(businessInfo.file, '审批业务状态版本门禁禁止整文件豁免');
    }
    const method = findMethod(businessInfo.source, 'submitBusinessApproval');
    const writes = method ? flowStatusWrites(method, businessInfo.source) : [];
    if (writes.length !== 1) {
      addError(businessInfo.file, 'submitBusinessApproval 必须且只能有一个业务 flowStatus 写入');
    }
    writes.forEach((data) => checkFlowWrite(businessInfo, data, 'submitBusinessApproval'));
    if (method) checkSubmitBusinessApprovalCasOrder(businessInfo, method);
  }

  const approvalsInfo = readSource(
    'apps/server/src/modules/approvals/approval-business-effect.dispatcher.ts'
  );
  if (!approvalsInfo) return;
  if (approvalsInfo.content.includes('@no-optimistic-lock')) {
    addError(approvalsInfo.file, '审批业务状态版本门禁禁止整文件豁免');
  }
  const expectedCases = [
    'sale_order_activate',
    'invoice_approve',
    'payment_approve',
    'payment_refund_approve',
    'visit_approve',
    'project_launch',
  ];
  for (const methodName of ['dispatchResult', 'dispatchWithdraw']) {
    const method = findMethod(approvalsInfo.source, methodName);
    if (!method) {
      addError(approvalsInfo.file, `无法定位 ${methodName}`);
      continue;
    }
    for (const eventType of expectedCases) {
      const clause = findFirst(
        method,
        (node) =>
          ts.isCaseClause(node) &&
          ts.isStringLiteral(node.expression) &&
          node.expression.text === eventType
      );
      const writes = clause ? flowStatusWrites(clause, approvalsInfo.source) : [];
      if (writes.length !== 1) {
        addError(
          approvalsInfo.file,
          `${methodName} case ${eventType} 必须且只能有一个业务 flowStatus 写入`
        );
      }
      writes.forEach((data) =>
        checkFlowWrite(approvalsInfo, data, `${methodName} case ${eventType}`)
      );
    }
  }
}

function findServiceFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) files.push(...findServiceFiles(full));
    else if (item.isFile() && item.name.endsWith('.service.ts')) files.push(full);
  }
  return files;
}

function checkGenericServices() {
  const strictPaths = new Set(
    [...STRICT_TARGETS.map((target) => target.servicePath), CUSTOMER_TARGET.servicePath].map(
      (relativePath) => path.normalize(path.join(REPO_ROOT, relativePath))
    )
  );
  for (const file of findServiceFiles(MODULES_DIR)) {
    if (strictPaths.has(path.normalize(file))) continue;
    const content = fs.readFileSync(file, 'utf8');
    const code = stripSourceComments(content);
    const source = ts.createSourceFile(
      file,
      content,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    if (content.includes('@no-optimistic-lock')) {
      skippedFiles++;
      continue;
    }
    const method = findMethod(source, 'update');
    if (!method) {
      skippedFiles++;
      continue;
    }
    checkedFiles++;
    const text = code.slice(method.getStart(source), method.end);
    if (!text.includes('version')) addError(file, 'update 方法缺少 version 校验');
    if (!text.includes('P2025')) addError(file, 'update 方法缺少 P2025 错误捕获');
    if (!text.includes('ConflictException')) addError(file, 'update 方法缺少 ConflictException');
    const hasIncrement = Boolean(
      findFirst(method, (node) => {
        if (!ts.isObjectLiteralExpression(node)) return false;
        return objectHasVersionIncrement(node, source);
      })
    );
    if (!hasIncrement) addError(file, 'update 方法缺少 version:{increment:1}');
  }
}

function main() {
  console.log('检查 Service 乐观锁实现情况（AST strict mode）...\n');

  for (const target of STRICT_TARGETS) {
    checkSchemas(target);
    checkStrictService(target);
    checkControllerDtos(target);
  }
  checkCustomerOptimisticLock();
  checkApprovalStatusVersions();
  checkProjectMutationSchemas();
  checkProjectDeleteVersions();
  checkGenericServices();

  checkedFiles += STRICT_TARGETS.length;
  console.log(
    `已检查 ${checkedFiles} 个 Service 文件（跳过 ${skippedFiles} 个无 update 方法/显式豁免文件）\n`
  );

  if (errors.length > 0) {
    console.log('错误（必须修复）：');
    console.log('='.repeat(64));
    for (const error of errors) {
      console.log(`  ${error.file}`);
      console.log(`    ${error.message}`);
    }
    console.log(`\n检查失败：发现 ${errors.length} 处问题。`);
    process.exit(1);
  }

  console.log('Service 乐观锁检查通过！');
}

main();
