import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cliDir = fileURLToPath(new URL('../../../', import.meta.url));

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(
  args: string[],
  input?: string,
  extraEnv: NodeJS.ProcessEnv = {}
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts', ...args], {
      cwd: cliDir,
      env: { ...process.env, NO_COLOR: '1', ...extraEnv },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(input);
  });
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function startServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>
): Promise<{ server: http.Server; baseUrl: string }> {
  const server = http.createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      sendJson(res, 500, { message: error instanceof Error ? error.message : String(error) });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
}

function datasetResponse(page: number) {
  const items =
    page === 1
      ? [
          { keyword: '企业AI', fee: 10 },
          { keyword: '钉钉', fee: 20 },
        ]
      : [{ keyword: '数字员工', fee: 30, message_consult: 2 }];
  return {
    dataset: {
      id: 'report.keyword.offline',
      label: '关键词离线报表',
      parameters: [],
    },
    fields:
      page === 1
        ? [
            {
              key: 'keyword',
              label: '关键词',
              group: '对象与关联',
              valueType: 'string',
              isCore: true,
            },
          ]
        : [
            {
              key: 'message_consult',
              label: '私信咨询数',
              group: '转化',
              valueType: 'number',
              isCore: false,
            },
          ],
    items,
    total: 3,
    totalMode: 'exact',
    hasMore: page === 1,
    page,
    pageSize: 2,
    totalPages: 2,
    aggregation: { fee: 60 },
    metadata: { data_caliber: 0 },
    requestId: `request-${page}`,
    fetchedAt: `2026-08-30T00:00:0${page}.000Z`,
  };
}

test('小红书 help 暴露动态目录、描述和任意数据集查询命令', async () => {
  const result = await runCli(['xiaohongshu', '--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /datasets/);
  assert.match(result.stdout, /describe-dataset/);
  assert.match(result.stdout, /query-dataset/);
});

test('目录、描述与单页查询按动态 dataset id 调用服务端契约', async (t) => {
  const requests: Array<{ method?: string; url?: string; body?: Record<string, unknown> }> = [];
  const catalog = {
    datasets: [{ id: 'future.dataset', queryable: true }],
    scopes: ['report_service'],
    connected: true,
    updatedAt: '2026-08-30T00:00:00.000Z',
  };
  const { server, baseUrl } = await startServer(async (req, res) => {
    const body = req.method === 'POST' ? await readJsonBody(req) : undefined;
    requests.push({ method: req.method, url: req.url, body });
    if (req.url?.startsWith('/api/v1/xiaohongshu/datasets/future.dataset/query')) {
      sendJson(res, 200, { ...datasetResponse(1), dataset: { id: 'future.dataset' } });
      return;
    }
    if (req.url?.startsWith('/api/v1/xiaohongshu/datasets/future.dataset')) {
      sendJson(res, 200, { id: 'future.dataset', parameters: [{ name: 'advertiserId' }] });
      return;
    }
    if (req.url?.startsWith('/api/v1/xiaohongshu/datasets')) {
      sendJson(res, 200, catalog);
      return;
    }
    sendJson(res, 404, { message: 'not found' });
  });
  t.after(() => closeServer(server));
  const env = { AZEROTH_TOKEN: 'test-token', AZEROTH_API_URL: baseUrl };

  const datasets = await runCli(
    ['xiaohongshu', 'datasets', '--advertiser-id', 'adv-1'],
    undefined,
    env
  );
  assert.equal(datasets.status, 0, datasets.stderr);
  assert.deepEqual(JSON.parse(datasets.stdout), catalog);

  const describe = await runCli(
    ['xiaohongshu', 'describe-dataset', 'future.dataset', '--advertiser-id', 'adv-1'],
    undefined,
    env
  );
  assert.equal(describe.status, 0, describe.stderr);
  assert.equal(JSON.parse(describe.stdout).id, 'future.dataset');

  const queryInput = {
    advertiserId: 'adv-1',
    dataCaliber: 0,
    page: 2,
    pageSize: 25,
    params: { future: true },
  };
  const query = await runCli(
    ['xiaohongshu', 'query-dataset', 'future.dataset', '--json', '-'],
    JSON.stringify(queryInput),
    env
  );
  assert.equal(query.status, 0, query.stderr);
  assert.equal(JSON.parse(query.stdout).dataset.id, 'future.dataset');
  assert.equal(requests.at(-1)?.method, 'POST');
  assert.deepEqual(requests.at(-1)?.body, queryInput);
  assert.match(requests[0]?.url ?? '', /advertiserId=adv-1/);
});

test('全量查询输出纯 NDJSON，并把内容摘要、字段、汇总和 requestId 写入 sidecar', async (t) => {
  const bodies: Record<string, unknown>[] = [];
  const { server, baseUrl } = await startServer(async (req, res) => {
    const body = await readJsonBody(req);
    bodies.push(body);
    sendJson(res, 200, datasetResponse(Number(body.page)));
  });
  t.after(() => closeServer(server));
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'azeroth-xhs-all-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const outputFile = path.join(tempDir, '关键词.ndjson');
  const inputFile = path.join(tempDir, '查询参数.json');
  fs.writeFileSync(
    inputFile,
    JSON.stringify({ advertiserId: 'adv-1', page: 1, pageSize: 2 }),
    'utf8'
  );

  const result = await runCli(
    [
      'xiaohongshu',
      'query-dataset',
      'report.keyword.offline',
      '--json',
      inputFile,
      '--all',
      '--output',
      outputFile,
    ],
    undefined,
    { AZEROTH_TOKEN: 'test-token', AZEROTH_API_URL: baseUrl }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.deepEqual(
    fs
      .readFileSync(outputFile, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line).keyword),
    ['企业AI', '钉钉', '数字员工']
  );
  assert.deepEqual(
    bodies.map((body) => body.page),
    [1, 2]
  );
  const ndjson = fs.readFileSync(outputFile, 'utf8');
  const metadata = JSON.parse(fs.readFileSync(`${outputFile}.metadata.json`, 'utf8'));
  assert.equal(metadata.schemaVersion, 2);
  assert.equal(metadata.status, 'complete');
  assert.equal(metadata.totalItems, 3);
  assert.deepEqual(metadata.ndjson, {
    algorithm: 'sha256',
    bytes: Buffer.byteLength(ndjson),
    lines: 3,
    sha256: createHash('sha256').update(ndjson).digest('hex'),
  });
  assert.deepEqual(
    metadata.pages.map((page: { requestId: string }) => page.requestId),
    ['request-1', 'request-2']
  );
  assert.deepEqual(
    metadata.fields.map((field: { key: string }) => field.key),
    ['keyword', 'message_consult']
  );
});

test('分页失败后校验查询、页序与 NDJSON 前缀，截断未提交尾部再安全续传', async (t) => {
  let failSecondPage = true;
  const { server, baseUrl } = await startServer(async (req, res) => {
    const body = await readJsonBody(req);
    const page = Number(body.page);
    if (page === 2 && failSecondPage) {
      sendJson(res, 400, { message: 'page 2 rejected for test' });
      return;
    }
    sendJson(res, 200, datasetResponse(page));
  });
  t.after(() => closeServer(server));
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'azeroth-xhs-resume-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const outputFile = path.join(tempDir, '关键词.ndjson');
  const inputFile = path.join(tempDir, '查询参数.json');
  fs.writeFileSync(
    inputFile,
    JSON.stringify({ advertiserId: 'adv-1', page: 1, pageSize: 2 }),
    'utf8'
  );
  const baseArgs = [
    'xiaohongshu',
    'query-dataset',
    'report.keyword.offline',
    '--json',
    inputFile,
    '--all',
    '--output',
    outputFile,
  ];
  const env = { AZEROTH_TOKEN: 'test-token', AZEROTH_API_URL: baseUrl };

  const failed = await runCli(baseArgs, undefined, env);
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /Resume with: .*query-dataset report\.keyword\.offline/);
  assert.match(failed.stderr, /--resume-from-page 2/);
  assert.equal(fs.readFileSync(outputFile, 'utf8').trim().split('\n').length, 2);
  const failedMetadata = JSON.parse(fs.readFileSync(`${outputFile}.metadata.json`, 'utf8'));
  assert.equal(failedMetadata.status, 'failed');
  assert.deepEqual(
    failedMetadata.pages.map((page: { page: number }) => page.page),
    [1]
  );

  const skippedPage = await runCli([...baseArgs, '--resume-from-page', '3'], undefined, env);
  assert.notEqual(skippedPage.status, 0);
  assert.match(skippedPage.stderr, /Invalid resume page 3/);

  const mismatchedInputFile = path.join(tempDir, '口径不匹配.json');
  fs.writeFileSync(
    mismatchedInputFile,
    JSON.stringify({ advertiserId: 'adv-1', dataCaliber: 1, page: 1, pageSize: 2 }),
    'utf8'
  );
  const mismatchedArgs = [...baseArgs, '--resume-from-page', '2'];
  mismatchedArgs[mismatchedArgs.indexOf(inputFile)] = mismatchedInputFile;
  const mismatched = await runCli(mismatchedArgs, undefined, env);
  assert.notEqual(mismatched.status, 0);
  assert.match(mismatched.stderr, /Resume query does not match metadata sidecar/);
  assert.equal(fs.readFileSync(outputFile, 'utf8').trim().split('\n').length, 2);

  const originalNdjson = fs.readFileSync(outputFile, 'utf8');
  fs.writeFileSync(outputFile, originalNdjson.replace('企业AI', '企业XX'), 'utf8');
  const tampered = await runCli([...baseArgs, '--resume-from-page', '2'], undefined, env);
  assert.notEqual(tampered.status, 0);
  assert.match(tampered.stderr, /Partial NDJSON does not match metadata checkpoint/);
  fs.writeFileSync(outputFile, originalNdjson, 'utf8');

  fs.appendFileSync(outputFile, '{"keyword":"未提交尾行"}\n', 'utf8');
  failSecondPage = false;
  const resumed = await runCli([...baseArgs, '--resume-from-page', '2'], undefined, env);
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.match(resumed.stderr, /Discarded \d+ uncheckpointed NDJSON bytes/);
  const resumedLines = fs.readFileSync(outputFile, 'utf8').trim().split('\n');
  assert.equal(resumedLines.length, 3);
  assert.deepEqual(
    resumedLines.map((line) => JSON.parse(line).keyword),
    ['企业AI', '钉钉', '数字员工']
  );
  const metadata = JSON.parse(fs.readFileSync(`${outputFile}.metadata.json`, 'utf8'));
  assert.equal(metadata.schemaVersion, 2);
  assert.equal(metadata.status, 'complete');
  assert.equal(metadata.totalItems, 3);
  assert.equal(metadata.ndjson.lines, 3);
  assert.equal(metadata.query.dataCaliber, 0);
  assert.deepEqual(
    metadata.pages.map((page: { page: number }) => page.page),
    [1, 2]
  );
});

test('全量模式拒绝 stdin、缺失输出文件及 NDJSON/sidecar 路径冲突', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'azeroth-xhs-contract-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const inputFile = path.join(tempDir, '查询参数.json');
  const outputFile = path.join(tempDir, '数据.ndjson');
  const input = JSON.stringify({ advertiserId: 'adv-1', page: 1, pageSize: 2 });
  fs.writeFileSync(inputFile, input, 'utf8');
  const env = {
    AZEROTH_TOKEN: 'test-token',
    AZEROTH_API_URL: 'http://127.0.0.1:9',
    AZEROTH_HTTP_TIMEOUT_MS: '50',
  };

  const stdinResult = await runCli(
    [
      'xiaohongshu',
      'query-dataset',
      'report.keyword.offline',
      '--json',
      '-',
      '--all',
      '--output',
      outputFile,
    ],
    input,
    env
  );
  assert.notEqual(stdinResult.status, 0);
  assert.match(stdinResult.stderr, /--all requires --json <file>/);

  const noOutput = await runCli(
    ['xiaohongshu', 'query-dataset', 'report.keyword.offline', '--json', inputFile, '--all'],
    undefined,
    env
  );
  assert.notEqual(noOutput.status, 0);
  assert.match(noOutput.stderr, /--all requires --output <ndjson>/);

  const pathConflict = await runCli(
    [
      'xiaohongshu',
      'query-dataset',
      'report.keyword.offline',
      '--json',
      inputFile,
      '--all',
      '--output',
      outputFile,
      '--metadata-output',
      outputFile,
    ],
    undefined,
    env
  );
  assert.notEqual(pathConflict.status, 0);
  assert.match(pathConflict.stderr, /--output and --metadata-output must be different files/);
  assert.doesNotMatch(pathConflict.stderr, /ECONNREFUSED/);
});

test('响应页码不匹配时停止导出，并仅保留已提交页检查点', async (t) => {
  const { server, baseUrl } = await startServer(async (req, res) => {
    await readJsonBody(req);
    sendJson(res, 200, datasetResponse(1));
  });
  t.after(() => closeServer(server));
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'azeroth-xhs-page-mismatch-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const inputFile = path.join(tempDir, '查询参数.json');
  const outputFile = path.join(tempDir, '关键词.ndjson');
  fs.writeFileSync(
    inputFile,
    JSON.stringify({ advertiserId: 'adv-1', page: 1, pageSize: 2 }),
    'utf8'
  );

  const result = await runCli(
    [
      'xiaohongshu',
      'query-dataset',
      'report.keyword.offline',
      '--json',
      inputFile,
      '--all',
      '--output',
      outputFile,
    ],
    undefined,
    { AZEROTH_TOKEN: 'test-token', AZEROTH_API_URL: baseUrl }
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Paginated response page mismatch/);
  assert.match(result.stderr, /--resume-from-page 2/);
  assert.equal(fs.readFileSync(outputFile, 'utf8').trim().split('\n').length, 2);
  const metadata = JSON.parse(fs.readFileSync(`${outputFile}.metadata.json`, 'utf8'));
  assert.equal(metadata.status, 'failed');
  assert.deepEqual(
    metadata.pages.map((page: { page: number }) => page.page),
    [1]
  );
  assert.equal(metadata.ndjson.lines, 2);
});

test('非法数据集标识在发起 HTTP 前被拒绝', async () => {
  const result = await runCli(
    ['xiaohongshu', 'query-dataset', '../connection', '--json', '-'],
    JSON.stringify({ advertiserId: 'adv-1' }),
    {
      AZEROTH_TOKEN: 'test-token',
      AZEROTH_API_URL: 'http://127.0.0.1:9',
      AZEROTH_HTTP_TIMEOUT_MS: '50',
    }
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid dataset id/);
  assert.doesNotMatch(result.stderr, /Request failed|ECONNREFUSED/);
});
