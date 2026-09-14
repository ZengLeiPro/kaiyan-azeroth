import { createHash, type Hash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { isDeepStrictEqual } from 'node:util';

import type {
  IXiaohongshuDatasetDefinition,
  IXiaohongshuDatasetField,
  IXiaohongshuDatasetQueryResponse,
  XiaohongshuDatasetQueryInput,
  XiaohongshuReportRawPayload,
} from '@ky-azeroth/shared';

import { request } from '../client.js';
import { fatal } from '../utils.js';
import { runAllPages } from './all-pages.js';

interface XiaohongshuDatasetExportPage {
  page: number;
  pageSize: number;
  itemCount: number;
  total: number;
  totalMode: 'exact' | 'estimated';
  hasMore: boolean;
  totalPages: number;
  aggregation: XiaohongshuReportRawPayload | null;
  metadata: XiaohongshuReportRawPayload | null;
  requestId: string | null;
  fetchedAt: string;
}

interface XiaohongshuNdjsonCheckpoint {
  algorithm: 'sha256';
  bytes: number;
  lines: number;
  sha256: string;
}

interface XiaohongshuDatasetExportMetadata {
  schemaVersion: 2;
  datasetId: string;
  dataset: IXiaohongshuDatasetDefinition | null;
  query: XiaohongshuDatasetQueryInput;
  output: string | null;
  status: 'running' | 'complete' | 'failed';
  startedAt: string;
  updatedAt: string;
  snapshotAt: string | null;
  fields: IXiaohongshuDatasetField[];
  pages: XiaohongshuDatasetExportPage[];
  totalItems: number;
  ndjson: XiaohongshuNdjsonCheckpoint;
}

interface ResumeState {
  metadata: XiaohongshuDatasetExportMetadata;
  hash: Hash;
  bytes: number;
  lines: number;
}

export interface RunXiaohongshuDatasetAllPagesParams {
  datasetId: string;
  input: XiaohongshuDatasetQueryInput;
  jsonSource: string;
  pageSize: number;
  output?: string;
  metadataOutput?: string;
  resumeFromPage?: number;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function writeMetadata(file: string | undefined, metadata: XiaohongshuDatasetExportMetadata): void {
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(metadata, null, 2) + '\n', 'utf8');
  fs.renameSync(temp, file);
}

function ndjsonCheckpoint(hash: Hash, bytes: number, lines: number): XiaohongshuNdjsonCheckpoint {
  return {
    algorithm: 'sha256',
    bytes,
    lines,
    sha256: hash.copy().digest('hex'),
  };
}

async function validateNdjsonCheckpoint(
  file: string,
  expected: XiaohongshuNdjsonCheckpoint
): Promise<Hash> {
  const stat = fs.lstatSync(file);
  if (!stat.isFile()) {
    fatal(`Invalid partial NDJSON: ${file}`, 'Resume requires a regular file, not a symlink');
  }
  if (stat.size < expected.bytes) {
    fatal('Partial NDJSON is shorter than its metadata checkpoint', {
      file,
      expectedBytes: expected.bytes,
      actualBytes: stat.size,
    });
  }

  const hash = createHash('sha256');
  let bytes = 0;
  let lines = 0;
  let lastByte: number | null = null;

  if (expected.bytes > 0) {
    const input = fs.createReadStream(file, { start: 0, end: expected.bytes - 1 });
    input.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hash.update(buffer);
      bytes += buffer.length;
      lastByte = buffer.at(-1) ?? lastByte;
    });
    const reader = createInterface({ input, crlfDelay: Infinity });
    try {
      for await (const line of reader) {
        if (line.trim().length === 0) {
          fatal('Invalid partial NDJSON', { file, line: lines + 1, reason: 'blank line' });
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          fatal('Invalid partial NDJSON', { file, line: lines + 1, reason: 'invalid JSON' });
        }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          fatal('Invalid partial NDJSON', {
            file,
            line: lines + 1,
            reason: 'each line must be a JSON object',
          });
        }
        lines++;
      }
    } finally {
      reader.close();
    }
  }

  const actualSha256 = hash.copy().digest('hex');
  if (
    bytes !== expected.bytes ||
    lines !== expected.lines ||
    actualSha256 !== expected.sha256 ||
    (expected.bytes > 0 && lastByte !== 0x0a)
  ) {
    fatal('Partial NDJSON does not match metadata checkpoint', {
      file,
      expected,
      actual: { bytes, lines, sha256: actualSha256, endsWithNewline: lastByte === 0x0a },
    });
  }

  if (stat.size > expected.bytes) {
    fs.truncateSync(file, expected.bytes);
    process.stderr.write(
      `[azeroth] Discarded ${stat.size - expected.bytes} uncheckpointed NDJSON bytes before resume\n`
    );
  }
  return hash;
}

async function readResumeMetadata(
  file: string | undefined,
  datasetId: string,
  expectedQuery: XiaohongshuDatasetQueryInput,
  output: string | undefined,
  resumeFromPage: number | undefined
): Promise<ResumeState | null> {
  if (!resumeFromPage || resumeFromPage <= 1) return null;
  if (!output) fatal('--resume-from-page requires --output for a safe append');
  if (!fs.existsSync(output)) {
    fatal(`Partial NDJSON not found: ${output}`, 'Resume requires the existing partial output');
  }
  if (!file || !fs.existsSync(file)) {
    fatal('Metadata sidecar not found', 'Resume requires the sidecar from the failed export');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    fatal(`Invalid metadata sidecar ${file}`, 'Expected valid JSON from a previous export');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    fatal(`Invalid metadata sidecar ${file}`, 'Expected a JSON object');
  }
  const metadata = parsed as XiaohongshuDatasetExportMetadata;
  if (
    metadata.schemaVersion !== 2 ||
    !Array.isArray(metadata.pages) ||
    metadata.datasetId !== datasetId ||
    !metadata.output ||
    path.resolve(metadata.output) !== path.resolve(output)
  ) {
    fatal(`Metadata sidecar does not match this export`, {
      file,
      expectedSchemaVersion: 2,
      actualSchemaVersion: metadata.schemaVersion,
      expectedDatasetId: datasetId,
      actualDatasetId: metadata.datasetId,
      expectedOutput: path.resolve(output),
      actualOutput: metadata.output ? path.resolve(metadata.output) : null,
    });
  }
  if (!isDeepStrictEqual(metadata.query, expectedQuery)) {
    fatal('Resume query does not match metadata sidecar', {
      file,
      expectedQuery,
      actualQuery: metadata.query,
    });
  }
  if (metadata.status === 'complete') {
    fatal('Metadata sidecar is already complete', 'Start a new export instead of appending');
  }

  const pageNumbers = metadata.pages.map((page) => page.page);
  const pagesAreContinuous = metadata.pages.every(
    (page, index) =>
      page.page === index + 1 &&
      Number.isSafeInteger(page.itemCount) &&
      page.itemCount >= 0 &&
      Number.isSafeInteger(page.pageSize) &&
      page.pageSize > 0
  );
  const expectedPage = metadata.pages.length + 1;
  const pageItemCount = metadata.pages.reduce((sum, page) => sum + page.itemCount, 0);
  const checkpoint = metadata.ndjson;
  const validCheckpoint =
    checkpoint?.algorithm === 'sha256' &&
    Number.isSafeInteger(checkpoint.bytes) &&
    checkpoint.bytes >= 0 &&
    Number.isSafeInteger(checkpoint.lines) &&
    checkpoint.lines >= 0 &&
    /^[a-f0-9]{64}$/.test(checkpoint.sha256);
  if (
    !pagesAreContinuous ||
    metadata.totalItems !== pageItemCount ||
    !validCheckpoint ||
    checkpoint.lines !== metadata.totalItems
  ) {
    fatal('Metadata sidecar checkpoint is inconsistent', {
      file,
      pageNumbers,
      metadataTotalItems: metadata.totalItems,
      pageItemCount,
      checkpoint,
    });
  }
  if (resumeFromPage !== expectedPage) {
    fatal(`Invalid resume page ${resumeFromPage}`, {
      expectedPage,
      completedPages: pageNumbers,
    });
  }
  if (metadata.pages.at(-1)?.hasMore === false) {
    fatal('Metadata sidecar already contains a terminal page', {
      completedPages: pageNumbers,
      hint: 'Restart the export so it can write a complete checkpoint',
    });
  }

  const hash = await validateNdjsonCheckpoint(output, checkpoint);
  return {
    metadata,
    hash,
    bytes: checkpoint.bytes,
    lines: checkpoint.lines,
  };
}

function mergeFields(
  current: IXiaohongshuDatasetField[],
  incoming: IXiaohongshuDatasetField[]
): IXiaohongshuDatasetField[] {
  const byKey = new Map(current.map((field) => [field.key, field]));
  for (const field of incoming) {
    const previous = byKey.get(field.key);
    byKey.set(field.key, previous ? { ...field, isCore: previous.isCore || field.isCore } : field);
  }
  return [...byKey.values()].sort(
    (a, b) =>
      Number(b.isCore) - Number(a.isCore) ||
      a.group.localeCompare(b.group) ||
      a.key.localeCompare(b.key)
  );
}

function resumeCommand(
  datasetId: string,
  jsonSource: string,
  pageSize: number,
  page: number,
  output: string | undefined,
  metadataOutput: string | undefined
): string {
  return [
    'azeroth xiaohongshu query-dataset',
    shellQuote(datasetId),
    '--json',
    shellQuote(jsonSource),
    '--all',
    '--page-size',
    String(pageSize),
    '--resume-from-page',
    String(page),
    ...(output ? ['--output', shellQuote(output)] : []),
    ...(metadataOutput ? ['--metadata-output', shellQuote(metadataOutput)] : []),
  ].join(' ');
}

/** 全量导出一个小红书数据集：items 写 NDJSON，页面契约与汇总写 metadata sidecar。 */
export async function runXiaohongshuDatasetAllPages(
  params: RunXiaohongshuDatasetAllPagesParams
): Promise<void> {
  const {
    datasetId,
    input,
    jsonSource,
    pageSize,
    output,
    metadataOutput = output ? `${output}.metadata.json` : undefined,
    resumeFromPage,
  } = params;
  if (output && metadataOutput && path.resolve(output) === path.resolve(metadataOutput)) {
    fatal('--output and --metadata-output must be different files');
  }

  const apiPath = `/xiaohongshu/datasets/${encodeURIComponent(datasetId)}/query`;
  const expectedQuery = { ...input, page: 1, pageSize };
  const existing = await readResumeMetadata(
    metadataOutput,
    datasetId,
    expectedQuery,
    output,
    resumeFromPage
  );
  const now = new Date().toISOString();
  const hash = existing?.hash ?? createHash('sha256');
  let ndjsonBytes = existing?.bytes ?? 0;
  let ndjsonLines = existing?.lines ?? 0;
  const metadata: XiaohongshuDatasetExportMetadata = existing?.metadata ?? {
    schemaVersion: 2,
    datasetId,
    dataset: null,
    query: expectedQuery,
    output: output ?? null,
    status: 'running',
    startedAt: now,
    updatedAt: now,
    snapshotAt: null,
    fields: [],
    pages: [],
    totalItems: 0,
    ndjson: ndjsonCheckpoint(hash, ndjsonBytes, ndjsonLines),
  };
  metadata.status = 'running';
  metadata.updatedAt = now;
  metadata.snapshotAt = null;
  metadata.query = expectedQuery;
  metadata.output = output ?? null;
  writeMetadata(metadataOutput, metadata);
  if (metadataOutput) process.stderr.write(`[azeroth] Metadata → ${metadataOutput}\n`);

  try {
    const result = await runAllPages<XiaohongshuReportRawPayload>({
      pageSize,
      output,
      resumeFromPage,
      entityName: `xiaohongshu dataset ${datasetId}`,
      requestPage: (page, size) =>
        request<IXiaohongshuDatasetQueryResponse>('POST', apiPath, {
          ...input,
          page,
          pageSize: size,
        }),
      resumeCommand: (page) =>
        resumeCommand(datasetId, jsonSource, pageSize, page, output, metadataOutput),
      onItemWritten: (_item, line) => {
        hash.update(line);
        ndjsonBytes += Buffer.byteLength(line);
        ndjsonLines++;
      },
      onPage: (response) => {
        const page = response as IXiaohongshuDatasetQueryResponse;
        const pages = metadata.pages
          .filter((item) => item.page !== page.page)
          .concat({
            page: page.page,
            pageSize: page.pageSize,
            itemCount: page.items.length,
            total: page.total,
            totalMode: page.totalMode,
            hasMore: page.hasMore,
            totalPages: page.totalPages,
            aggregation: page.aggregation ?? null,
            metadata: page.metadata ?? null,
            requestId: page.requestId ?? null,
            fetchedAt: page.fetchedAt,
          })
          .sort((a, b) => a.page - b.page);
        const totalItems = pages.reduce((sum, item) => sum + item.itemCount, 0);
        if (totalItems !== ndjsonLines) {
          fatal('NDJSON line count diverged from page checkpoints', {
            totalItems,
            ndjsonLines,
          });
        }

        const previousMode = metadata.pages[0]?.totalMode;
        if (previousMode && previousMode !== page.totalMode) {
          fatal('Dataset totalMode changed during export', {
            previousMode,
            currentMode: page.totalMode,
            page: page.page,
          });
        }
        const previousExactTotal = metadata.pages.find((item) => item.totalMode === 'exact')?.total;
        if (
          page.totalMode === 'exact' &&
          previousExactTotal !== undefined &&
          previousExactTotal !== page.total
        ) {
          fatal('Exact dataset total changed during export', {
            previousTotal: previousExactTotal,
            currentTotal: page.total,
            page: page.page,
          });
        }
        if (page.totalMode === 'exact' && !page.hasMore && totalItems !== page.total) {
          fatal('Exact dataset total does not match exported item count', {
            expectedTotal: page.total,
            exportedItems: totalItems,
          });
        }

        const updatedAt = new Date().toISOString();
        const nextMetadata: XiaohongshuDatasetExportMetadata = {
          ...metadata,
          dataset: page.dataset,
          fields: mergeFields(metadata.fields, page.fields),
          pages,
          totalItems,
          updatedAt,
          ndjson: ndjsonCheckpoint(hash, ndjsonBytes, ndjsonLines),
        };
        writeMetadata(metadataOutput, nextMetadata);
        Object.assign(metadata, nextMetadata);
      },
    });
    const completeMetadata: XiaohongshuDatasetExportMetadata = {
      ...metadata,
      status: 'complete',
      snapshotAt: result.snapshotAt,
      updatedAt: result.snapshotAt,
      totalItems: metadata.pages.reduce((sum, item) => sum + item.itemCount, 0),
      ndjson: ndjsonCheckpoint(hash, ndjsonBytes, ndjsonLines),
    };
    writeMetadata(metadataOutput, completeMetadata);
    Object.assign(metadata, completeMetadata);
  } catch (error) {
    const failedMetadata: XiaohongshuDatasetExportMetadata = {
      ...metadata,
      status: 'failed',
      updatedAt: new Date().toISOString(),
    };
    writeMetadata(metadataOutput, failedMetadata);
    Object.assign(metadata, failedMetadata);
    throw error;
  }
}
