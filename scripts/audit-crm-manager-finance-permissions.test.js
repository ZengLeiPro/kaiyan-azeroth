const assert = require('node:assert/strict');
const test = require('node:test');

const { evaluateSnapshot } = require('./audit-crm-manager-finance-permissions');

test('CRM_MANAGER 无财务权限时通过', () => {
  assert.equal(
    evaluateSnapshot({ permissions: [{ module: 'crm', view: true }], users: [] }).status,
    'clean'
  );
});

test('任一有效财务动作都报告为异常', () => {
  const result = evaluateSnapshot({
    permissions: [
      {
        module: 'finance',
        menu: 'payroll',
        view: true,
        create: false,
        edit: false,
        delete: false,
        export: false,
        approve: false,
      },
    ],
    users: [{ employee: { id: 'employee-1', name: '测试员工' } }],
  });
  assert.equal(result.status, 'unexpected-finance-permissions');
  assert.equal(result.financePermissions.length, 1);
  assert.deepEqual(result.members, [{ id: 'employee-1', name: '测试员工' }]);
});

test('角色不存在时明确报告', () => {
  assert.equal(evaluateSnapshot(null).status, 'role-missing');
});
