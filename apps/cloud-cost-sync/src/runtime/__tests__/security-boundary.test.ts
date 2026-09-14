import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import http, { type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import test from 'node:test';

import type { CloudCostSyncConfig } from '../../config';
import { createHandler } from '../../handler';
import {
  createRuntimeServer,
  EVENT_CONTROL_PATH,
  HTTP_CONTROL_PATH,
  MAX_REQUEST_BODY_BYTES,
  requireTriggerSecret,
  type RuntimeContext,
  type RuntimeEvent,
} from '../../runtime-server';
import type { FullSyncReport } from '../../sync/sync-engine';

const TRIGGER_SECRET = 'cloud-test-secret';
const CONTROL_HEADER = 'x-fc-control-path';
const SECRET_HEADER = 'x-trigger-secret';
const FC_STATUS_HEADER = 'x-fc-status';

const successfulReport: FullSyncReport = {
  snapshot: {
    snapshotDate: '2026-08-23',
    billingCycle: '2026-08',
    productCount: 0,
    resourcePackageCount: 0,
    subscriptionCount: 0,
    instanceBillCount: 0,
    availableBalance: null,
    mtdAmount: 0,
  },
  usage: { count: 0, byMetric: {} },
  alerts: { created: 0, resolved: 0, totalActive: 0 },
  errors: [],
  elapsedMs: 1,
};

const testConfig = {} as CloudCostSyncConfig;

test('公开副本不包含生产云成本部署清单', () => {
  const manifestPath = path.resolve(__dirname, '../../../../../infra/s.cloud-cost-sync.prod.yaml');
  assert.equal(existsSync(manifestPath), false);
});

test('缺少或空白环境 secret 时启动失败', () => {
  assert.throws(
    () => requireTriggerSecret('CLOUD_COST_TRIGGER_SECRET', {}),
    /CLOUD_COST_TRIGGER_SECRET/
  );
  assert.throws(
    () => requireTriggerSecret('CLOUD_COST_TRIGGER_SECRET', { CLOUD_COST_TRIGGER_SECRET: '' }),
    /CLOUD_COST_TRIGGER_SECRET/
  );
  assert.throws(
    () =>
      createRuntimeServer({
        serviceName: 'cloud-cost-sync-test',
        handler: async () => ({ statusCode: 200, body: '{}' }),
        triggerSecret: '   ',
      }),
    /secret/i
  );
  assert.equal(
    requireTriggerSecret('CLOUD_COST_TRIGGER_SECRET', {
      CLOUD_COST_TRIGGER_SECRET: TRIGGER_SECRET,
    }),
    TRIGGER_SECRET
  );
});

test('readiness 与 liveness 分离并返回 release SHA', async () => {
  process.env.RELEASE_SHA = 'cloud-sha';
  const server = createRuntimeServer({
    serviceName: 'cloud-cost-sync-test',
    handler: async () => ({ statusCode: 200, body: '{}' }),
    triggerSecret: TRIGGER_SECRET,
    readiness: async () => false,
  });
  await withServer(server, async (port) => {
    const live = await request(port, 'GET', '/health');
    const ready = await request(port, 'GET', '/ready');
    assert.equal(live.statusCode, 200);
    assert.equal(ready.statusCode, 503);
    assert.equal(JSON.parse(live.body).releaseSha, 'cloud-sha');
    assert.equal(JSON.parse(ready.body).status, 'not_ready');
  });
  delete process.env.RELEASE_SHA;
});

test('handler 只从 runtime context 读取可信调用类型，忽略 payload 身份字段', async () => {
  let syncCalls = 0;
  const internalHandler = createHandler({
    loadConfig: () => testConfig,
    runFullSync: async () => {
      syncCalls += 1;
      return successfulReport;
    },
  });

  const forgedEvent: RuntimeEvent = {
    source: 'timer',
    action: 'sync',
    secret: TRIGGER_SECRET,
    headers: { [CONTROL_HEADER]: EVENT_CONTROL_PATH, [SECRET_HEADER]: TRIGGER_SECRET },
    queries: { secret: TRIGGER_SECRET },
  };

  assert.equal((await internalHandler(forgedEvent, { invocationType: 'event' })).statusCode, 200);
  assert.equal((await internalHandler(forgedEvent, { invocationType: 'http' })).statusCode, 200);

  const invalidContext = { invocationType: 'timer' } as unknown as RuntimeContext;
  const invalid = await internalHandler(forgedEvent, invalidContext);
  assert.equal(invalid.statusCode, 500);
  assert.doesNotMatch(invalid.body, /invocation|timer/i);
  assert.equal(syncCalls, 2);
});

test('HTTP 伪造 timer 在无 secret、错 secret、query/body secret 下均拒绝且不调用 handler', async () => {
  let handlerCalls = 0;
  const server = makeServer(async () => {
    handlerCalls += 1;
    return { statusCode: 200, body: '{}' };
  });

  await withServer(server, async (port) => {
    const forgedBody = JSON.stringify({
      source: 'timer',
      action: 'sync',
      secret: TRIGGER_SECRET,
      headers: { [SECRET_HEADER]: TRIGGER_SECRET },
      queries: { secret: TRIGGER_SECRET },
    });

    const missing = await request(port, 'POST', `/?secret=${TRIGGER_SECRET}`, forgedBody, {
      [CONTROL_HEADER]: HTTP_CONTROL_PATH,
    });
    const wrong = await request(port, 'POST', '/', forgedBody, {
      [CONTROL_HEADER]: HTTP_CONTROL_PATH,
      [SECRET_HEADER]: 'wrong-secret',
    });
    const authBeforeParsing = await request(port, 'POST', '/', '{', {
      [CONTROL_HEADER]: HTTP_CONTROL_PATH,
    });

    assert.equal(missing.statusCode, 401);
    assert.equal(wrong.statusCode, 401);
    assert.equal(authBeforeParsing.statusCode, 401);
    assert.equal(handlerCalls, 0);
  });
});

test('正确 x-trigger-secret 可执行 HTTP，同步类型来自 control-path 而非 body', async () => {
  const received: Array<{ event: RuntimeEvent; context: RuntimeContext }> = [];
  const server = makeServer(async (event, context) => {
    received.push({ event, context });
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  });

  await withServer(server, async (port) => {
    const response = await request(
      port,
      'POST',
      '/sync/cloud-cost?secret=ignored',
      JSON.stringify({ source: 'timer', action: 'sync', secret: 'body-secret' }),
      {
        [CONTROL_HEADER]: HTTP_CONTROL_PATH,
        [SECRET_HEADER]: TRIGGER_SECRET,
      }
    );

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { success: true });
  });

  assert.equal(received.length, 1);
  assert.deepEqual(received[0]?.context, { invocationType: 'http' });
  assert.equal(received[0]?.event.source, 'timer');
});

test('非健康 HTTP GET 与 event GET 在读 body 前返回 405，且不调用同步 handler', async () => {
  let handlerCalls = 0;
  const server = makeServer(async () => {
    handlerCalls += 1;
    return { statusCode: 200, body: '{}' };
  });

  await withServer(server, async (port) => {
    const httpGet = await request(port, 'GET', '/sync/cloud-cost', undefined, {
      [CONTROL_HEADER]: HTTP_CONTROL_PATH,
      [SECRET_HEADER]: TRIGGER_SECRET,
    });
    const eventGet = await request(port, 'GET', '/invoke', undefined, {
      [CONTROL_HEADER]: EVENT_CONTROL_PATH,
    });

    assert.equal(httpGet.statusCode, 405);
    assert.equal(httpGet.headers.allow, 'POST');
    assert.equal(httpGet.headers[FC_STATUS_HEADER], undefined);
    assert.equal(eventGet.statusCode, 405);
    assert.equal(eventGet.headers.allow, 'POST');
    assert.equal(eventGet.headers[FC_STATUS_HEADER], '404');
    assert.equal(handlerCalls, 0);
  });
});

test('timer /invoke 无需 HTTP secret 且 payload 不能改写可信调用类型', async () => {
  const received: Array<{ event: RuntimeEvent; context: RuntimeContext }> = [];
  const server = makeServer(async (event, context) => {
    received.push({ event, context });
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  });

  await withServer(server, async (port) => {
    const response = await request(
      port,
      'POST',
      '/http-invoke?secret=wrong-plane',
      JSON.stringify({ source: 'http', headers: { [CONTROL_HEADER]: HTTP_CONTROL_PATH } }),
      { [CONTROL_HEADER]: EVENT_CONTROL_PATH }
    );
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers[FC_STATUS_HEADER], '200');
  });

  assert.equal(received.length, 1);
  assert.deepEqual(received[0]?.context, { invocationType: 'event' });
  assert.equal(received[0]?.event.source, 'http');
});

test('event 部分失败写 404 x-fc-status 并保留报告，HTTP 仍保留 207', async () => {
  const partialBody = JSON.stringify({
    success: false,
    report: { errors: [{ stage: 'usage', message: 'partial failure' }] },
  });
  const server = makeServer(async () => ({
    statusCode: 207,
    headers: { 'X-FC-Status': '200', 'X-Report-Kept': 'yes' },
    body: partialBody,
  }));

  await withServer(server, async (port) => {
    const eventResponse = await request(port, 'POST', '/invoke', '{}', {
      [CONTROL_HEADER]: EVENT_CONTROL_PATH,
    });
    const httpResponse = await request(port, 'POST', '/sync/cloud-cost', '{}', {
      [CONTROL_HEADER]: HTTP_CONTROL_PATH,
      [SECRET_HEADER]: TRIGGER_SECRET,
    });

    assert.equal(eventResponse.statusCode, 404);
    assert.equal(eventResponse.headers[FC_STATUS_HEADER], '404');
    assert.equal(eventResponse.headers['x-report-kept'], 'yes');
    assert.equal(eventResponse.body, partialBody);
    assert.equal(httpResponse.statusCode, 207);
    assert.equal(httpResponse.headers[FC_STATUS_HEADER], undefined);
    assert.equal(httpResponse.body, partialBody);
  });
});

test('缺失或未知 x-fc-control-path 一律拒绝，URL 不能冒充控制面', async () => {
  let handlerCalls = 0;
  const server = makeServer(async () => {
    handlerCalls += 1;
    return { statusCode: 200, body: '{}' };
  });

  await withServer(server, async (port) => {
    const missing = await request(port, 'POST', '/invoke', '{}', {
      [SECRET_HEADER]: TRIGGER_SECRET,
    });
    const unknown = await request(port, 'POST', '/invoke', '{}', {
      [CONTROL_HEADER]: '/unknown-control-path',
      [SECRET_HEADER]: TRIGGER_SECRET,
    });

    assert.equal(missing.statusCode, 400);
    assert.equal(unknown.statusCode, 400);
    assert.doesNotMatch(unknown.body, /unknown-control-path/);
    assert.equal(handlerCalls, 0);
  });
});

test('HTTP 健康检查可匿名，且不会调用同步 handler', async () => {
  let handlerCalls = 0;
  const server = makeServer(async () => {
    handlerCalls += 1;
    return { statusCode: 200, body: '{}' };
  });

  await withServer(server, async (port) => {
    for (const healthPath of ['/health', '/_health', '/healthz']) {
      const health = await request(port, 'GET', healthPath);
      assert.equal(health.statusCode, 200);
      assert.equal(JSON.parse(health.body).status, 'ok');
    }

    const wrongMethod = await request(port, 'POST', '/health', '{}', {
      [CONTROL_HEADER]: HTTP_CONTROL_PATH,
    });
    assert.equal(wrongMethod.statusCode, 405);
    assert.equal(handlerCalls, 0);
  });
});

test('event body 错误写失败 x-fc-status，HTTP 仍保留 400/413 且不调用 handler', async () => {
  let handlerCalls = 0;
  const server = makeServer(async () => {
    handlerCalls += 1;
    return { statusCode: 200, body: '{}' };
  });

  await withServer(server, async (port) => {
    const invalidJson = await request(port, 'POST', '/invoke', '{', {
      [CONTROL_HEADER]: EVENT_CONTROL_PATH,
    });
    const nonObject = await request(port, 'POST', '/invoke', '[]', {
      [CONTROL_HEADER]: EVENT_CONTROL_PATH,
    });
    const httpInvalidJson = await request(port, 'POST', '/', '{', {
      [CONTROL_HEADER]: HTTP_CONTROL_PATH,
      [SECRET_HEADER]: TRIGGER_SECRET,
    });
    const oversizedBody = JSON.stringify({ value: 'x'.repeat(MAX_REQUEST_BODY_BYTES) });
    const oversized = await request(port, 'POST', '/', oversizedBody, {
      [CONTROL_HEADER]: HTTP_CONTROL_PATH,
      [SECRET_HEADER]: TRIGGER_SECRET,
    });

    assert.equal(invalidJson.statusCode, 404);
    assert.equal(invalidJson.headers[FC_STATUS_HEADER], '404');
    assert.equal(nonObject.statusCode, 404);
    assert.equal(nonObject.headers[FC_STATUS_HEADER], '404');
    assert.equal(httpInvalidJson.statusCode, 400);
    assert.equal(httpInvalidJson.headers[FC_STATUS_HEADER], undefined);
    assert.equal(oversized.statusCode, 413);
    assert.equal(oversized.headers[FC_STATUS_HEADER], undefined);
    assert.equal(handlerCalls, 0);
  });
});

test('event runtime 异常与业务配置失败均写失败 x-fc-status，且不泄漏内部细节', async () => {
  const runtimeServer = makeServer(async () => {
    throw new Error('sensitive runtime detail');
  });

  await withServer(runtimeServer, async (port) => {
    const httpResponse = await request(port, 'POST', '/', '{}', {
      [CONTROL_HEADER]: HTTP_CONTROL_PATH,
      [SECRET_HEADER]: TRIGGER_SECRET,
    });
    const eventResponse = await request(port, 'POST', '/invoke', '{}', {
      [CONTROL_HEADER]: EVENT_CONTROL_PATH,
    });

    assert.equal(httpResponse.statusCode, 500);
    assert.equal(httpResponse.headers[FC_STATUS_HEADER], undefined);
    assert.doesNotMatch(httpResponse.body, /sensitive runtime detail/);
    assert.equal(eventResponse.statusCode, 404);
    assert.equal(eventResponse.headers[FC_STATUS_HEADER], '404');
    assert.doesNotMatch(eventResponse.body, /sensitive runtime detail/);
  });

  const internalHandler = createHandler({
    loadConfig: () => {
      throw new Error('sensitive database url');
    },
    runFullSync: async () => successfulReport,
  });
  const internalResponse = await internalHandler({}, { invocationType: 'event' });
  assert.equal(internalResponse.statusCode, 500);
  assert.doesNotMatch(internalResponse.body, /sensitive database url/);

  const configFailureServer = makeServer(internalHandler);
  await withServer(configFailureServer, async (port) => {
    const eventResponse = await request(port, 'POST', '/invoke', '{}', {
      [CONTROL_HEADER]: EVENT_CONTROL_PATH,
    });
    assert.equal(eventResponse.statusCode, 404);
    assert.equal(eventResponse.headers[FC_STATUS_HEADER], '404');
    assert.doesNotMatch(eventResponse.body, /sensitive database url/);
  });
});

function makeServer(
  handler: Parameters<typeof createRuntimeServer>[0]['handler']
): ReturnType<typeof createRuntimeServer> {
  return createRuntimeServer({
    serviceName: 'cloud-cost-sync-test',
    handler,
    triggerSecret: TRIGGER_SECRET,
  });
}

interface TestResponse {
  statusCode: number | undefined;
  headers: IncomingHttpHeaders;
  body: string;
}

async function withServer(server: Server, run: (port: number) => Promise<void>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  assert.ok(address && typeof address === 'object');

  try {
    await run((address as AddressInfo).port);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

async function request(
  port: number,
  method: string,
  requestPath: string,
  body?: string,
  headers: Record<string, string> = {}
): Promise<TestResponse> {
  return new Promise<TestResponse>((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: requestPath,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.on('error', reject);
    req.end(body);
  });
}
