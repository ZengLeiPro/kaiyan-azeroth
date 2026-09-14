const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { validateWebRoutes } = require('./check-web-route-authorization');

test('实际 App.tsx 的所有业务路由均有可静态验证的授权语义', () => {
  const appPath = path.resolve(__dirname, '../apps/web/src/App.tsx');
  assert.deepEqual(validateWebRoutes(fs.readFileSync(appPath, 'utf8'), appPath), []);
});

test('AST 门禁不把内层或注释中的 PermissionRoute 误当为路由根守卫', () => {
  const source = `
    const note = '<PermissionRoute module="crm" menu="customers">';
    <Routes>
      <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
        <Route path="crm/customers" element={<Suspense><PermissionRoute module="crm" menu="customers"><Page /></PermissionRoute></Suspense>} />
      </Route>
    </Routes>
  `;
  assert.match(validateWebRoutes(source)[0], /crm\/customers.*必须显式使用/);
});

test('PermissionRoute 必须带可静态校验的权限数据', () => {
  const source = `
    <Routes>
      <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
        <Route path="crm/customers" element={<PermissionRoute module="crm"><Page /></PermissionRoute>} />
      </Route>
    </Routes>
  `;
  assert.match(validateWebRoutes(source)[0], /缺少可静态验证/);
});
