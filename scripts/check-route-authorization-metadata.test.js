const assert = require('node:assert/strict');
const test = require('node:test');

const { scanControllerSource } = require('./check-route-authorization-metadata');

test('缺少授权元数据的路由 fail-closed', () => {
  const missing = scanControllerSource(`
    @Controller('demo')
    class DemoController {
      @Get() list() {}
    }
  `);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].methodName, 'list');
});

test('识别方法和类级显式授权元数据', () => {
  const source = `
    @Controller('self')
    class SelfController {
      @Get() @AllowAnyAuthenticatedUser() self() {}
      @Post() @RequirePermission({ module: 'x', menu: 'y', action: 'create' }) create() {}
      @Get('public') @Public() publicRoute() {}
    }
    @Controller('admin') @RequirePermission({ module: 'system', menu: 'system_config', action: 'edit' })
    class AdminController { @Get() list() {} }
    @Controller('analytics') @RequireAnyPermission([])
    class AnalyticsController { @Get() list() {} }
  `;
  assert.deepEqual(scanControllerSource(source), []);
});
