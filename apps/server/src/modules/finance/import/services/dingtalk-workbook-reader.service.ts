import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
// eslint-disable-next-line no-restricted-imports -- spawn 比 exec 安全（不走 shell），且 dws CLI 是外部独立进程
import { spawn } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';

import {
  BoundedChildOutput,
  sanitizeChildOutput,
} from '../../../../common/utils/bounded-child-output';

/**
 * 钉钉在线电子表格读取器
 *
 * 通过 spawn 本机 `dws` CLI 调用钉钉 OpenAPI 读取在线电子表格（axls）数据。
 *
 * ⚠ 部署/运行前置条件：
 *  - server 进程所在机器必须安装 dws CLI（`npm install -g dingtalk-workspace-cli`）
 *  - server 启动前 source 工作区 .dws/env.sh，把 DWS_CONFIG_DIR/DWS_KEYCHAIN_DIR/DWS_DISABLE_KEYCHAIN
 *    注入到进程环境，确保 spawn 出来的 dws 子进程能找到正确工作区的 token
 *  - 生产 FC 容器没装 dws —— **import 接口只在本地/管理机调用**，生产 commit 阶段不走 dws（从 batch.previewJson 反序列化重放）
 *
 * 一次性迁移完成后，本服务实际不会再被频繁调用。
 */

interface DwsSheetListItem {
  sheetId: string;
  name: string;
}

interface DwsSheetListResponse {
  sheets: DwsSheetListItem[];
  success: boolean;
}

interface DwsRangeReadResponse {
  displayValues: string[][];
  formulas?: string[][];
  success: boolean;
}

interface DwsErrorEnvelope {
  error?: {
    category?: string;
    code?: number;
    message?: string;
  };
}

const DWS_BIN = process.env.DWS_BIN ?? 'dws';
const SPAWN_TIMEOUT_MS = 60_000;
const DEFAULT_ROWS_PER_BATCH = 25;
const RANGE_READ_MAX_ATTEMPTS = 3;

@Injectable()
export class DingtalkWorkbookReaderService {
  private readonly logger = new Logger(DingtalkWorkbookReaderService.name);

  /** 列出 workbook 内所有 sheets */
  async listSheets(workbookId: string): Promise<DwsSheetListItem[]> {
    const result = await this.spawnDws<DwsSheetListResponse>([
      'sheet',
      'list',
      '--node',
      workbookId,
      '--format',
      'json',
    ]);
    return result.sheets ?? [];
  }

  /**
   * 读 sheet 的指定范围
   *
   * range 格式：'A1:N100'（钉钉 API 偶发 HSF 超时，读取会自动重试）
   */
  async readRange(workbookId: string, sheetId: string, range: string): Promise<string[][]> {
    return this.readRangeWithRetry(workbookId, sheetId, range);
  }

  private async readRangeOnce(
    workbookId: string,
    sheetId: string,
    range: string
  ): Promise<string[][]> {
    const result = await this.spawnDws<DwsRangeReadResponse>([
      'sheet',
      'range',
      'read',
      '--node',
      workbookId,
      '--sheet-id',
      sheetId,
      '--range',
      range,
      '--format',
      'json',
    ]);
    return result.displayValues ?? [];
  }

  private async readRangeWithRetry(
    workbookId: string,
    sheetId: string,
    range: string
  ): Promise<string[][]> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= RANGE_READ_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.readRangeOnce(workbookId, sheetId, range);
      } catch (error) {
        lastError = error;
        if (attempt >= RANGE_READ_MAX_ATTEMPTS || !isRetryableDwsError(error)) {
          throw error;
        }
        const delayMs = getRetryDelayMs(attempt);
        this.logger.warn(
          `dws range read ${range} 第 ${attempt} 次失败，${delayMs}ms 后重试：${getErrorText(
            error
          )}`
        );
        if (delayMs > 0) await sleep(delayMs);
      }
    }
    throw lastError;
  }

  /**
   * 分批读 sheet，自动按 rowsPerBatch 切分，避免单次 HSF 超时
   *
   * @param totalRows 期望读取的总行数（含表头，可超过实际行数，多余行返回空）
   * @param colsRange 列范围，如 'A:N'（不含行号；rowsPerBatch 会拼接行号）
   * @param rowsPerBatch 每批读多少行（默认 25，钉钉 API 即使 25 行也可能偶发超时）
   * @returns 拼接后的所有行（去掉重复表头）
   */
  async readRangeBatched(
    workbookId: string,
    sheetId: string,
    colsRange: string,
    totalRows: number,
    rowsPerBatch = DEFAULT_ROWS_PER_BATCH
  ): Promise<string[][]> {
    // colsRange 形如 'A:N' → 拆出列字母
    const m = colsRange.match(/^([A-Z]+):([A-Z]+)$/);
    if (!m) {
      throw new InternalServerErrorException(`非法 colsRange: ${colsRange}，应形如 A:N`);
    }
    const [, startCol, endCol] = m;
    const allRows: string[][] = [];
    for (let start = 1; start <= totalRows; start += rowsPerBatch) {
      const end = Math.min(start + rowsPerBatch - 1, totalRows);
      const range = `${startCol}${start}:${endCol}${end}`;
      const batch = await this.readRange(workbookId, sheetId, range);
      // 跳过尾部空行（dws 返回的 displayValues 长度可能 = 行数，但行内全空字符串）
      const nonEmpty = batch.filter((row) => row.some((cell) => cell && cell.trim().length > 0));
      allRows.push(...nonEmpty);
      // 如果这批拿到的非空行少于 batchSize 的一半，说明已读到 sheet 末尾，提前结束
      if (nonEmpty.length < rowsPerBatch / 2 && nonEmpty.length < batch.length) {
        break;
      }
    }
    return allRows;
  }

  /** 内部：调 dws CLI 子进程并解析 JSON 输出 */
  private spawnDws<T>(args: string[]): Promise<T> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const child = spawn(DWS_BIN, args, {
        env: { ...process.env },
      });

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          child.kill('SIGKILL');
          reject(
            new InternalServerErrorException(
              `dws 调用超时（${SPAWN_TIMEOUT_MS / 1000}s）：${args.join(' ')}`
            )
          );
        }
      }, SPAWN_TIMEOUT_MS);

      const stdoutCollector = new BoundedChildOutput(8 * 1024 * 1024);
      const stderrCollector = new BoundedChildOutput(64 * 1024);
      const rejectOutputLimit = (streamName: 'stdout' | 'stderr') => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill('SIGKILL');
        reject(new InternalServerErrorException(`dws ${streamName} 超过安全上限`));
      };
      child.stdout.on('data', (chunk) => {
        if (!stdoutCollector.append(chunk as Buffer)) rejectOutputLimit('stdout');
      });
      child.stderr.on('data', (chunk) => {
        if (!stderrCollector.append(chunk as Buffer)) rejectOutputLimit('stderr');
      });

      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(
            new InternalServerErrorException(
              `找不到 dws CLI（DWS_BIN=${DWS_BIN}）。请确认本机已安装 dingtalk-workspace-cli。`
            )
          );
          return;
        }
        reject(error);
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const stdout = stdoutCollector.text();
        const stderr = stderrCollector.text();
        if (code !== 0) {
          const safeError = sanitizeChildOutput(stderr || stdout);
          this.logger.error(`dws 子进程退出码 ${code}，output=${safeError}`);
          reject(
            new InternalServerErrorException(
              `dws 调用失败（exit ${code}）：${safeError || 'no output'}`
            )
          );
          return;
        }
        try {
          const parsed = JSON.parse(stdout) as T & DwsErrorEnvelope;
          if (parsed.error) {
            const msg = sanitizeChildOutput(parsed.error.message ?? JSON.stringify(parsed.error));
            reject(new InternalServerErrorException(`dws 返回业务错误：${msg}`));
            return;
          }
          resolve(parsed);
        } catch (error) {
          reject(
            new InternalServerErrorException(
              `dws 输出无效 JSON：${sanitizeChildOutput(String(error))}; stdout=${sanitizeChildOutput(stdout)}`
            )
          );
        }
      });
    });
  }
}

function getErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRetryableDwsError(error: unknown): boolean {
  return /HSFTimeOutException|timeout|ETIMEDOUT|ECONNRESET|EAI_AGAIN/i.test(getErrorText(error));
}

function getRetryDelayMs(attempt: number): number {
  const configured = Number(process.env.DWS_RANGE_RETRY_DELAY_MS ?? 300);
  if (!Number.isFinite(configured) || configured <= 0) return 0;
  return configured * attempt;
}
