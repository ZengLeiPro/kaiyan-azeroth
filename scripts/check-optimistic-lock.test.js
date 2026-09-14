const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const REPO_ROOT = path.resolve(__dirname, '..');
const GATE = path.join(__dirname, 'check-optimistic-lock.js');
const FIXTURE_FILES = [
  'apps/server/src/modules/payments/payments.service.ts',
  'apps/server/src/modules/payments/payments.controller.ts',
  'apps/server/src/modules/invoices/invoices.service.ts',
  'apps/server/src/modules/invoices/invoices.controller.ts',
  'apps/server/src/modules/approvals/business-approval.service.ts',
  'apps/server/src/modules/approvals/approval-business-effect.dispatcher.ts',
  'apps/server/src/modules/approvals/approvals.service.ts',
  'packages/shared/src/schemas/payment.ts',
  'packages/shared/src/schemas/invoice.ts',
  'packages/shared/src/schemas/customer.ts',
  'packages/shared/src/schemas/project.ts',
  'packages/shared/src/schemas/project-ticket.ts',
  'packages/shared/src/schemas/effort-record.ts',
  'apps/server/src/modules/projects/projects.service.ts',
  'apps/server/src/modules/projects/projects.controller.ts',
  'apps/server/src/modules/project-tickets/project-tickets.service.ts',
  'apps/server/src/modules/project-tickets/project-tickets.controller.ts',
  'apps/server/src/modules/effort-records/effort-records.service.ts',
  'apps/server/src/modules/effort-records/effort-records.controller.ts',
  'apps/server/src/modules/customers/customers.service.ts',
  'apps/server/src/modules/customers/customers.controller.ts',
  'apps/server/src/modules/customers/customer-lifecycle.ts',
  'apps/server/src/modules/customers/dto/restore-customer.dto.ts',
  'apps/server/src/modules/customers/dto/permanent-remove-customer.dto.ts',
  'apps/server/src/modules/customers/dto/claim-customer.dto.ts',
  'apps/server/src/modules/customers/dto/update-lead-progress.dto.ts',
  'apps/server/src/modules/customers/dto/batch-transfer-customer.dto.ts',
  'apps/server/src/modules/customers/dto/batch-update-customer.dto.ts',
  'apps/server/src/modules/customers/dto/batch-collaborators-customer.dto.ts',
  'apps/server/src/modules/customers/dto/batch-remove-customer.dto.ts',
  'apps/web/src/pages/system/trash/types.ts',
  'apps/web/src/pages/system/trash/TrashPage.tsx',
  'apps/cli/src/commands/crud.ts',
  'apps/cli/src/commands/customers.ts',
  'apps/cli/src/utils.ts',
];

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'optimistic-lock-fixture-'));
  for (const relativePath of FIXTURE_FILES) {
    const source = path.join(REPO_ROOT, relativePath);
    const destination = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
  return root;
}

function mutate(root, relativePath, transform) {
  const file = path.join(root, relativePath);
  const before = fs.readFileSync(file, 'utf8');
  const after = transform(before);
  assert.notEqual(after, before, `fixture mutation did not change ${relativePath}`);
  fs.writeFileSync(file, after);
}

function mutateMethod(root, relativePath, methodName, transform) {
  mutate(root, relativePath, (content) => {
    const starts = [
      content.indexOf(`  async ${methodName}(`),
      content.indexOf(`  private async ${methodName}(`),
    ].filter((index) => index >= 0);
    const start = starts.length > 0 ? Math.min(...starts) : -1;
    assert.notEqual(start, -1, `method ${methodName} not found`);
    const nextAsync = content.indexOf('\n  async ', start + 10);
    const nextPrivate = content.indexOf('\n  private ', start + 10);
    const candidates = [nextAsync, nextPrivate].filter((index) => index >= 0);
    const end = candidates.length > 0 ? Math.min(...candidates) : content.length;
    return content.slice(0, start) + transform(content.slice(start, end)) + content.slice(end);
  });
}

function runGate(root) {
  return spawnSync(process.execPath, [GATE], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, OPTIMISTIC_LOCK_ROOT: root },
  });
}

function withFixture(assertion) {
  const root = createFixture();
  try {
    assertion(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('valid fixture passes the optimistic-lock AST gate', () => {
  withFixture((root) => {
    const result = runGate(root);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /Service 乐观锁检查通过/);
  });
});

test('counterexample: optional update version is rejected', () => {
  withFixture((root) => {
    mutate(root, 'packages/shared/src/schemas/payment.ts', (content) =>
      content.replace(
        ".min(1, '乐观锁版本号必须大于等于 1'),",
        ".min(1, '乐观锁版本号必须大于等于 1').optional(),"
      )
    );
    const result = runGate(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /updatePaymentSchema\.version 不得 optional/);
  });
});

test('counterexample: project mutation version is required', () => {
  withFixture((root) => {
    mutate(root, 'packages/shared/src/schemas/project.ts', (content) =>
      content.replace(
        'version: z.number().int().min(1),',
        'version: z.number().int().min(1).optional(),'
      )
    );
    const result = runGate(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /updateProjectSchema\.version 不得 optional/);
  });
});

test('counterexample: project delete must forward query version', () => {
  withFixture((root) => {
    mutate(root, 'apps/server/src/modules/projects/projects.controller.ts', (content) =>
      content.replace(
        'return this.projectsService.remove(id, query.version, user);',
        'return this.projectsService.remove(id, 1, user);'
      )
    );
    const result = runGate(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /Project\.remove Controller.*query\.version/);
  });
});

test('counterexample: conditional version spread cannot masquerade as single-row CAS', () => {
  withFixture((root) => {
    mutateMethod(root, 'apps/server/src/modules/payments/payments.service.ts', 'update', (method) =>
      method.replace(
        'where: { id, version: requestVersion },',
        'where: { id, ...(requestVersion !== undefined ? { version: requestVersion } : {}) },'
      )
    );
    const result = runGate(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /update 必须使用固定 where/);
  });
});

test('counterexample: missing business version increment is rejected', () => {
  withFixture((root) => {
    mutateMethod(
      root,
      'apps/server/src/modules/approvals/business-approval.service.ts',
      'submitBusinessApproval',
      (method) => method.replace('          version: { increment: 1 },\n', '')
    );
    const result = runGate(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /submitBusinessApproval.*缺少 version/);
  });
});

test('counterexample: a dummy approval CAS count check is rejected', () => {
  withFixture((root) => {
    mutateMethod(
      root,
      'apps/server/src/modules/approvals/business-approval.service.ts',
      'submitBusinessApproval',
      (method) => method.replace('if (claimed.count !== 1)', 'if (1 !== 1)')
    );
    const result = runGate(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /真实 CAS result\.count !== 1/);
  });
});

test('counterexample: approval instance creation before business CAS is rejected', () => {
  withFixture((root) => {
    mutateMethod(
      root,
      'apps/server/src/modules/approvals/business-approval.service.ts',
      'submitBusinessApproval',
      (method) =>
        method
          .replace(
            'const created = await this.approvalsService.createApprovalInstance(',
            'const created = await this.approvalsService.createApprovalInstanceAfterClaim('
          )
          .replace(
            '      const claimed = await delegate.updateMany({',
            '      await this.approvalsService.createApprovalInstance(tx, {} as never, currentUser);\n\n      const claimed = await delegate.updateMany({'
          )
    );
    const result = runGate(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /只能在业务 CAS 与 count guard 成功之后创建审批实例/);
  });
});

test('counterexample: omitting a batch write entrance is rejected', () => {
  withFixture((root) => {
    mutate(root, 'apps/server/src/modules/invoices/invoices.service.ts', (content) =>
      content.replace('  async batchRemove(', '  async batchRemoveWithoutCas(')
    );
    const result = runGate(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /缺少 batchRemove/);
  });
});

test('counterexample: dummy constant count helper call cannot masquerade as a CAS guard', () => {
  withFixture((root) => {
    mutateMethod(
      root,
      'apps/server/src/modules/payments/payments.service.ts',
      'batchUpdate',
      (method) =>
        method.replace(
          'this.assertPaymentBatchCasCount(result.count, editableRows.length);',
          'this.assertPaymentBatchCasCount(1, 1);'
        )
    );
    const result = runGate(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /真实 result\.count 与目标行集合 length/);
  });
});

test('counterexample: strict targets cannot bypass checks with a file exemption', () => {
  withFixture((root) => {
    mutate(
      root,
      'apps/server/src/modules/payments/payments.service.ts',
      (content) => `// @no-optimistic-lock: fixture bypass\n${content}`
    );
    const result = runGate(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /严格乐观锁 Service 禁止整文件豁免/);
  });
});

test('Customer mutation: 普通 update 的真实锁后 scope CAS 不可用注释/常量/伪方法名冒充', () => {
  withFixture((root) => {
    mutateMethod(
      root,
      'apps/server/src/modules/customers/customers.service.ts',
      'update',
      (method) =>
        method.replace(
          '        applyCustomerCollabSelfScope(where, chargerScope, currentEmployeeId);',
          "        const scopeMarker = 'applyCustomerCollabSelfScope(where, chargerScope, currentEmployeeId)';\n        // applyCustomerCollabSelfScope(where, chargerScope, currentEmployeeId);\n        this.applyCustomerCollabSelfScopeUnchecked(where, chargerScope, currentEmployeeId);\n        void scopeMarker;"
        )
    );
    const result = runGate(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /Customer update 必须在目标锁后/);
  });
});

test('Customer mutation: 普通 remove 的调用方 version CAS 不可用常量文本冒充', () => {
  withFixture((root) => {
    mutateMethod(
      root,
      'apps/server/src/modules/customers/customers.service.ts',
      'remove',
      (method) =>
        method
          .replace(
            '        const where: Prisma.CustomerWhereUniqueInput = {',
            "        const casMarker = 'version: requestVersion';\n        const where: Prisma.CustomerWhereUniqueInput = {"
          )
          .replace('          version: requestVersion,', '          version: existing.version,')
    );
    const result = runGate(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /Customer remove 必须在目标锁后/);
  });
});

test('Customer mutation: submit Leads 必须命中真实审批方法并绑定 dto.version CAS', () => {
  for (const transform of [
    (method) =>
      method.replace(
        '    return this.businessApprovalService.submitChangeApproval(',
        "    const submitMethodMarker = 'submitChangeApproval';\n    // this.businessApprovalService.submitChangeApproval(...)\n    void submitMethodMarker;\n    return this.businessApprovalService.submitChangeApprovalUnchecked("
      ),
    (method) =>
      method.replace(
        '        baseVersion: dto.version,',
        '        baseVersion: 1, // dto.version / submitChangeApproval'
      ),
  ]) {
    withFixture((root) => {
      mutateMethod(
        root,
        'apps/server/src/modules/customers/customers.service.ts',
        'submitLeadStageChangeRequest',
        transform
      );
      const result = runGate(root);
      assert.notEqual(result.status, 0);
      assert.match(result.stdout, /submitLeadStageChangeRequest 必须用 dto\.version/);
    });
  }
});

test('Customer mutation: correct Leads 的真实 dto.version CAS/P2025→409 不可用注释常量冒充', () => {
  withFixture((root) => {
    mutateMethod(
      root,
      'apps/server/src/modules/customers/customers.service.ts',
      'correctLeadStage',
      (method) =>
        method
          .replace(
            '      await this.prisma.$transaction(async (tx) => {',
            "      const casMarker = 'where: { id, version: dto.version, deletedAt: null } P2025 ConflictException';\n      // tx.customer.update({ where: { id, version: dto.version, deletedAt: null } });\n      void casMarker;\n      await this.prisma.$transaction(async (tx) => {"
          )
          .replace(
            '          where: { id, version: dto.version, deletedAt: null },',
            '          where: { id, version: existing.version, deletedAt: null },'
          )
    );
    const result = runGate(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /correctLeadStage 必须预检 dto\.version/);
  });
});

test('Customer mutation: restore DTO version 入口不可删除', () => {
  withFixture((root) => {
    mutate(root, 'packages/shared/src/schemas/customer.ts', (content) =>
      content.replace(
        'export const restoreCustomerSchema = z.object({ version: customerVersionSchema }).strict();',
        'export const restoreCustomerSchema = z.object({}).strict();'
      )
    );
    const result = runGate(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /restoreCustomerSchema 必须声明必填 customerVersionSchema/);
  });
});

test('Customer mutation: restore/permanent/claim 任一最终调用方 CAS 不可删除', () => {
  const scenarios = [
    {
      method: 'restore',
      mutate: (method) =>
        method.replace(
          '        version: dto.version,\n        deletedAt: { not: null },',
          '        deletedAt: { not: null },'
        ),
      error: /restore 必须在锁内以调用方 dto\.version CAS/,
    },
    {
      method: 'permanentRemove',
      mutate: (method) =>
        method.replace(
          'where: { id, version: dto.version, deletedAt: { not: null } },',
          'where: { id, version: customer.version, deletedAt: { not: null } },'
        ),
      error: /permanentRemove 最终 DELETE 必须在锁内绑定调用方 dto\.version CAS/,
    },
    {
      method: 'claim',
      mutate: (method) =>
        method.replace(
          '          version: dto.version,\n          deletedAt: null,',
          '          deletedAt: null,'
        ),
      error: /claim 必须区分锁前存在性/,
    },
  ];

  for (const scenario of scenarios) {
    withFixture((root) => {
      mutateMethod(
        root,
        'apps/server/src/modules/customers/customers.service.ts',
        scenario.method,
        scenario.mutate
      );
      const result = runGate(root);
      assert.notEqual(result.status, 0, scenario.method);
      assert.match(result.stdout, scenario.error);
    });
  }
});

test('Customer mutation: Leads dto.version 透传或 primitive CAS 不可删除', () => {
  for (const scenario of [
    {
      method: 'updateLeadProgress',
      transform: (method) => method.replace('      expectedVersion: dto.version,', ''),
      error: /updateLeadProgress 必须把 dto\.version 结构化透传/,
    },
    {
      method: 'applyLeadProgressState',
      transform: (method) =>
        method.replace(
          'where: { id: args.id, version: args.expectedVersion, deletedAt: null },',
          'where: { id: args.id, deletedAt: null },'
        ),
      error: /applyLeadProgressState 必须在锁内以 expectedVersion 做最终 CAS/,
    },
  ]) {
    withFixture((root) => {
      mutateMethod(
        root,
        'apps/server/src/modules/customers/customers.service.ts',
        scenario.method,
        scenario.transform
      );
      const result = runGate(root);
      assert.notEqual(result.status, 0, scenario.method);
      assert.match(result.stdout, scenario.error);
    });
  }
});

test('Customer mutation: 五类 batch 任一入口缺少 version increment 都失败', () => {
  for (const methodName of [
    'batchTransfer',
    'batchUpdate',
    'batchAddCollaborators',
    'batchRemoveCollaborators',
    'batchRemove',
  ]) {
    withFixture((root) => {
      mutateMethod(
        root,
        'apps/server/src/modules/customers/customers.service.ts',
        methodName,
        (method) => method.replace('            version: { increment: 1 },\n', '')
      );
      const result = runGate(root);
      assert.notEqual(result.status, 0, methodName);
      assert.match(result.stdout, new RegExp(`${methodName} 必须消费 versions`));
    });
  }
});

test('Customer mutation: batch 锁序/全量快照与 lifecycle 默认 CAS 不可旁路', () => {
  withFixture((root) => {
    mutateMethod(
      root,
      'apps/server/src/modules/customers/customers.service.ts',
      'loadLockedCustomerBatchTargets',
      (method) =>
        method.replace(
          `const sortedIds = await this.lockCustomerManualWriteTargets(tx, requestedIds, [
      ...initialCandidateIds,
    ]);`,
          'const sortedIds = requestedIds.sort();'
        )
    );
    const result = runGate(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /初始 scope→固定锁序→无 scope 全量快照/);
  });

  withFixture((root) => {
    mutateMethod(
      root,
      'apps/server/src/modules/customers/customers.service.ts',
      'loadLockedCustomerBatchTargets',
      (method) => method.replace('      ...initialCandidateIds,', '      requestedIds,')
    );
    const result = runGate(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /初始 scope→固定锁序→无 scope 全量快照/);
  });

  withFixture((root) => {
    mutate(root, 'apps/server/src/modules/customers/customer-lifecycle.ts', (content) =>
      content.replace('  if (!options.versioning) data.version = { increment: 1 };\n', '')
    );
    const result = runGate(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /Customer lifecycle 必须仅在真实变化时安全审计/);
  });
});

test('Customer mutation: Controller/Web/CLI 任一 version 透传入口不可删除', () => {
  const scenarios = [
    {
      file: 'apps/server/src/modules/customers/customers.controller.ts',
      transform: (content) =>
        content.replace('@Body() dto: RestoreCustomerDto,', 'dto: RestoreCustomerDto,'),
      error: /restore controller 必须使用 @Body\(\) RestoreCustomerDto/,
    },
    {
      file: 'apps/web/src/pages/system/trash/types.ts',
      transform: (content) => content.replace('    version: data.version,\n', ''),
      error: /Web TrashItem\/customerToTrashItem 必须保留 Customer 真实 version/,
    },
    {
      file: 'apps/web/src/pages/system/trash/TrashPage.tsx',
      transform: (content) =>
        content.replace(
          'await api.post(selectedItem.restoreEndpoint, { version: selectedItem.version });',
          'await api.post(selectedItem.restoreEndpoint);'
        ),
      error: /Web Customer restore 必须 POST selectedItem.version body/,
    },
    {
      file: 'apps/cli/src/commands/crud.ts',
      transform: (content) =>
        content.replace('      restoreCmd.requiredOption(', '      restoreCmd.option('),
      error: /CLI customers restore 必须 --version 并作为 body 发送/,
    },
    {
      file: 'apps/cli/src/commands/customers.ts',
      transform: (content) =>
        content.replace(
          ".requiredOption('--version <n>', '回收站中的客户当前 version（必填，调用方 CAS）')",
          ".option('--version <n>', '回收站中的客户当前 version')"
        ),
      error: /CLI permanent-delete 必须 --version 并作为 DELETE body 发送/,
    },
  ];

  for (const scenario of scenarios) {
    withFixture((root) => {
      mutate(root, scenario.file, scenario.transform);
      const result = runGate(root);
      assert.notEqual(result.status, 0, scenario.file);
      assert.match(result.stdout, scenario.error);
    });
  }
});
