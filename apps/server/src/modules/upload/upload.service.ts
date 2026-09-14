import type { IUploadResult } from '@ky-azeroth/shared/types';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import * as crypto from 'crypto';
import type * as fs from 'fs';
import * as mime from 'mime-types';
import * as path from 'path';

import { PrismaService } from '../../common/prisma/prisma.service';
import { lockUploadAsset, sortUploadAssetLockIdentities } from './upload-asset-lock.helper';
import {
  type AnchoredUploadDirectory,
  type AnchoredUploadFile,
  errorCode,
  type FileIdentity,
  type ManagedUploadPath,
  sameIdentity,
  UploadPathSecurity,
} from './upload-path-security';

interface UploadedFile {
  originalname: string;
  buffer: Buffer;
  size: number;
  mimetype: string;
}

export interface RegisteredAttachmentCandidate {
  id: string;
  url: string;
  name?: string;
  mimeType?: string;
}

export interface OpenedRegisteredFileAsset {
  handle: import('fs/promises').FileHandle;
  originalName: string;
  size: number;
  mimeType: string;
  storageKey: string;
}

type UploadScope = 'single' | 'batch';
type UploadAttemptStage =
  | 'prepared'
  | 'directory-ready'
  | 'file-opened'
  | 'file-written'
  | 'database-create-started'
  | 'completed'
  | 'failed';

interface PreparedFileCandidate extends ManagedUploadPath {
  filename: string;
  url: string;
  result: IUploadResult;
}

interface UploadAttempt {
  index: number;
  assetId: string;
  ownerEmployeeId: string;
  file: UploadedFile;
  candidates: PreparedFileCandidate[];
  selectedCandidate?: PreparedFileCandidate;
  parentDirectory?: AnchoredUploadDirectory;
  parentIdentity?: FileIdentity;
  fileIdentity?: FileIdentity;
  fileCreated: boolean;
  databaseCreateAttempted: boolean;
  databaseCreateResolved: boolean;
  collisionCount: number;
  stage: UploadAttemptStage;
  failureStage?: UploadAttemptStage;
  failureCode?: string;
}

interface CompensationIdentity {
  id: string;
  ownerEmployeeId: string;
  storageKey: string;
}

type DatabaseCompensationStage =
  | 'not-required'
  | 'lock-barrier-start'
  | 'lock-barrier-acquire'
  | 'transaction-start'
  | 'transaction-lock-acquire'
  | 'database-query'
  | 'database-conflict-count'
  | 'database-query-count'
  | 'database-delete'
  | 'database-delete-count'
  | 'database-remaining-count';

interface DatabaseCompensationOutcome {
  complete: boolean;
  stage: DatabaseCompensationStage;
  candidateCount: number;
  matchedCount: number;
  deletedCount: number;
}

interface FileCleanupFailure {
  attempt: UploadAttempt;
  errorCode: string;
}

interface FileCleanupOutcome {
  complete: boolean;
  candidateCount: number;
  deletedCount: number;
  absentCount: number;
  failures: FileCleanupFailure[];
}

@Injectable()
export class UploadService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UploadService.name);
  private readonly pathSecurity: UploadPathSecurity;
  private readonly baseUrl: string;
  private readonly downloadSigningSecret: string;
  private readonly apiPrefix: string;
  private readonly publicApiBaseUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService
  ) {
    const configuredDir = this.configService.get<string>('UPLOAD_DIR');
    const lexicalUploadDir =
      configuredDir && path.isAbsolute(configuredDir)
        ? configuredDir
        : path.join(process.cwd(), configuredDir || 'uploads');
    this.pathSecurity = new UploadPathSecurity(lexicalUploadDir);

    const configuredBaseUrl = this.configService.get<string>('UPLOAD_BASE_URL');
    if (configuredBaseUrl) {
      this.baseUrl = configuredBaseUrl.replace(/\/+$/, '');
    } else {
      const port = this.configService.get('PORT') || 3000;
      this.baseUrl = `http://localhost:${port}/uploads`;
    }

    const jwtSecret = this.configService.get<string>('JWT_SECRET');
    if (!jwtSecret) {
      throw new Error('JWT_SECRET environment variable is required for upload download signing');
    }
    this.downloadSigningSecret = jwtSecret;
    this.apiPrefix = (this.configService.get<string>('API_PREFIX') || 'api').replace(
      /^\/|\/$/g,
      ''
    );
    const port = this.configService.get<number>('PORT') || 3000;
    this.publicApiBaseUrl = (
      this.configService.get<string>('PUBLIC_API_BASE_URL') || `http://localhost:${port}`
    ).replace(/\/+$/, '');
  }

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test' && process.platform !== 'linux') {
      return;
    }
    await this.pathSecurity.initialize();
  }

  async onModuleDestroy(): Promise<void> {
    await this.pathSecurity.close();
  }

  /** Upload one file with the same compensation state machine used by a batch. */
  async uploadFile(file: UploadedFile, ownerEmployeeId: string): Promise<IUploadResult> {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    if (!ownerEmployeeId) {
      throw new BadRequestException('Invalid upload owner');
    }

    const [attempt] = this.prepareUploadAttempts([file], ownerEmployeeId);
    if (!attempt) {
      throw new InternalServerErrorException(SINGLE_UPLOAD_FAILED_MESSAGE);
    }

    try {
      const result = await this.executeUploadAttempt(attempt);
      await this.releaseAttemptDirectories([attempt]);
      return result;
    } catch {
      await this.finishFailedUpload('single', [attempt]);
      throw new InternalServerErrorException(SINGLE_UPLOAD_FAILED_MESSAGE);
    }
  }

  /**
   * Upload a batch with all-or-nothing semantics. Every ID and every collision
   * candidate path is prepared before any directory, file, or database mutation.
   */
  async uploadFiles(files: UploadedFile[], ownerEmployeeId: string): Promise<IUploadResult[]> {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files provided');
    }
    if (!ownerEmployeeId) {
      throw new BadRequestException('Invalid upload owner');
    }

    const attempts = this.prepareUploadAttempts(files, ownerEmployeeId);
    const settled = await Promise.allSettled(
      attempts.map((attempt) => this.executeUploadAttempt(attempt))
    );

    if (settled.every((result) => result.status === 'fulfilled')) {
      await this.releaseAttemptDirectories(attempts);
      return settled.map((result) => (result as PromiseFulfilledResult<IUploadResult>).value);
    }

    await this.finishFailedUpload('batch', attempts);
    throw new InternalServerErrorException(BATCH_UPLOAD_FAILED_MESSAGE);
  }

  private prepareUploadAttempts(
    files: readonly UploadedFile[],
    ownerEmployeeId: string
  ): UploadAttempt[] {
    const datePart = new Date().toISOString().split('T')[0] || '';
    const dateDirectory = datePart.replace(/-/g, '') || 'uploads';
    const timestamp = Date.now();
    const usedAssetIds = new Set<string>();

    return files.map((file, index) => {
      const extension = path.extname(file.originalname);
      if (
        !file.originalname ||
        file.originalname.includes('\0') ||
        file.originalname.includes('\\') ||
        !SAFE_STORAGE_EXTENSION.test(extension)
      ) {
        throw new BadRequestException('Invalid file metadata');
      }

      let assetId = crypto.randomUUID();
      while (usedAssetIds.has(assetId)) assetId = crypto.randomUUID();
      usedAssetIds.add(assetId);

      const candidates = Array.from({ length: MAX_FILE_CREATE_ATTEMPTS }, () => {
        const hash = crypto.randomBytes(16).toString('hex');
        const filename = `${timestamp}-${hash}${extension}`;
        const storageKey = `${dateDirectory}/${filename}`;
        const managedPath = this.pathSecurity.prepare(storageKey);
        const url = `${this.baseUrl}/${storageKey}`;
        return {
          ...managedPath,
          filename,
          url,
          result: {
            id: assetId,
            url,
            downloadUrl: this.createDownloadUrlFromStorageKey(
              storageKey,
              ownerEmployeeId,
              file.originalname
            ),
            filename,
            originalName: file.originalname,
            size: file.size,
            mimeType: file.mimetype,
          },
        };
      });

      return {
        index,
        assetId,
        ownerEmployeeId,
        file,
        candidates,
        fileCreated: false,
        databaseCreateAttempted: false,
        databaseCreateResolved: false,
        collisionCount: 0,
        stage: 'prepared',
      };
    });
  }

  private async executeUploadAttempt(attempt: UploadAttempt): Promise<IUploadResult> {
    try {
      await this.createFileExclusively(attempt);
      const selected = attempt.selectedCandidate;
      const parentDirectory = attempt.parentDirectory;
      const fileIdentity = attempt.fileIdentity;
      if (!selected || !parentDirectory || !fileIdentity) {
        throw new Error('Exclusive file candidate was not fully retained');
      }

      const compensationIdentity = this.compensationIdentity(attempt);
      attempt.stage = 'database-create-started';
      attempt.databaseCreateAttempted = true;
      await this.prisma.$transaction(
        async (transaction: Prisma.TransactionClient) => {
          await lockUploadAsset(transaction, compensationIdentity);
          await transaction.fileAsset.create({
            data: {
              id: attempt.assetId,
              storageKey: selected.storageKey,
              originalName: attempt.file.originalname,
              size: attempt.file.size,
              mimeType: attempt.file.mimetype,
              ownerEmployeeId: attempt.ownerEmployeeId,
            },
            select: { id: true },
          });
        },
        { isolationLevel: 'Serializable' }
      );
      attempt.databaseCreateResolved = true;

      await this.pathSecurity.validateParentBinding(parentDirectory, selected);
      const rebound = await this.pathSecurity.openParent(selected, {
        create: false,
        expectedIdentity: parentDirectory.identity,
      });
      try {
        const entry = await this.pathSecurity.openFileForIdentity(rebound, selected);
        try {
          if (!sameIdentity(entry.identity, fileIdentity)) {
            throw new BadRequestException('Invalid file path');
          }
        } finally {
          await entry.handle.close();
        }
      } finally {
        await this.pathSecurity.closeDirectory(rebound);
      }

      attempt.stage = 'completed';
      return selected.result;
    } catch (error) {
      attempt.failureStage = attempt.stage;
      attempt.failureCode = safeFailureCode(error);
      attempt.stage = 'failed';
      throw error;
    }
  }

  private async createFileExclusively(attempt: UploadAttempt): Promise<void> {
    const firstCandidate = attempt.candidates[0];
    if (!firstCandidate) throw new Error('No file candidates were prepared');

    const parentDirectory = await this.pathSecurity.openParent(firstCandidate, { create: true });
    attempt.parentDirectory = parentDirectory;
    attempt.parentIdentity = parentDirectory.identity;
    attempt.stage = 'directory-ready';

    for (const candidate of attempt.candidates) {
      let openedFile: AnchoredUploadFile;
      try {
        openedFile = await this.pathSecurity.openFileExclusively(parentDirectory, candidate);
      } catch (error) {
        if (errorCode(error) === 'EEXIST') {
          attempt.collisionCount += 1;
          continue;
        }
        throw error;
      }

      attempt.selectedCandidate = candidate;
      attempt.fileIdentity = openedFile.identity;
      attempt.fileCreated = true;
      attempt.stage = 'file-opened';

      try {
        await this.pathSecurity.validateOpenedFile(parentDirectory, candidate, openedFile);
        await openedFile.handle.writeFile(attempt.file.buffer);
        attempt.stage = 'file-written';
        await this.pathSecurity.validateOpenedFile(parentDirectory, candidate, openedFile);
        await this.pathSecurity.validateParentBinding(parentDirectory, candidate);
      } finally {
        await openedFile.handle.close();
      }
      return;
    }

    const collisionError = new Error('Exclusive file allocation failed') as NodeJS.ErrnoException;
    collisionError.code = 'EEXIST';
    throw collisionError;
  }

  private async finishFailedUpload(scope: UploadScope, attempts: UploadAttempt[]): Promise<never> {
    const failedAttempts = attempts.filter((attempt) => attempt.stage === 'failed');
    const ambiguousDatabaseAttempts = attempts.filter(
      (attempt) => attempt.databaseCreateAttempted && !attempt.databaseCreateResolved
    );

    this.logger.warn({
      event: `upload.${scope}.original-failure`,
      attemptCount: attempts.length,
      failedItems: failedAttempts.map((attempt) => this.safeAttemptLog(attempt)),
    });
    if (ambiguousDatabaseAttempts.length > 0) {
      this.logger.warn({
        event: `upload.${scope}.database-state-ambiguous`,
        ambiguousItems: ambiguousDatabaseAttempts.map((attempt) => this.safeAttemptLog(attempt)),
      });
    }

    const databaseOutcome = await this.compensateDatabase(attempts);
    if (!databaseOutcome.complete) {
      const residualAttempts = attempts.filter((attempt) => attempt.databaseCreateAttempted);
      this.logger.error({
        event: `upload.${scope}.db-compensation.failed`,
        stage: databaseOutcome.stage,
        candidateCount: databaseOutcome.candidateCount,
        residualItems: residualAttempts.map((attempt) => this.safeAttemptLog(attempt)),
      });
      this.logger.error({
        event: `upload.${scope}.file-cleanup.failed`,
        stage: 'blocked-by-database-compensation',
        candidateCount: attempts.filter((attempt) => attempt.fileCreated).length,
        residualItems: attempts
          .filter((attempt) => attempt.fileCreated)
          .map((attempt) => this.safeAttemptLog(attempt)),
      });
      await this.releaseAttemptDirectories(attempts);
      throw new InternalServerErrorException(cleanupIncompleteMessage(scope));
    }

    this.logger.log({
      event: `upload.${scope}.db-compensation.completed`,
      status: databaseOutcome.stage === 'not-required' ? 'not-required' : 'completed',
      candidateCount: databaseOutcome.candidateCount,
      matchedCount: databaseOutcome.matchedCount,
      deletedCount: databaseOutcome.deletedCount,
    });

    const fileOutcome = await this.cleanupFiles(attempts);
    if (!fileOutcome.complete) {
      this.logger.error({
        event: `upload.${scope}.file-cleanup.failed`,
        candidateCount: fileOutcome.candidateCount,
        deletedCount: fileOutcome.deletedCount,
        absentCount: fileOutcome.absentCount,
        failedItems: fileOutcome.failures.map(({ attempt, errorCode: cleanupFailureCode }) => ({
          ...this.safeAttemptLog(attempt),
          cleanupFailureCode,
        })),
        residualItems: fileOutcome.failures.map(({ attempt }) => this.safeAttemptLog(attempt)),
      });
      await this.releaseAttemptDirectories(attempts);
      throw new InternalServerErrorException(cleanupIncompleteMessage(scope));
    }

    this.logger.log({
      event: `upload.${scope}.file-cleanup.completed`,
      status: fileOutcome.candidateCount === 0 ? 'not-required' : 'completed',
      candidateCount: fileOutcome.candidateCount,
      deletedCount: fileOutcome.deletedCount,
      absentCount: fileOutcome.absentCount,
    });
    await this.releaseAttemptDirectories(attempts);
    throw new InternalServerErrorException(uploadFailedMessage(scope));
  }

  private async compensateDatabase(
    attempts: readonly UploadAttempt[]
  ): Promise<DatabaseCompensationOutcome> {
    const identities = attempts
      .filter((attempt) => attempt.databaseCreateAttempted)
      .map((attempt) => this.compensationIdentity(attempt));
    if (identities.length === 0) {
      return {
        complete: true,
        stage: 'not-required',
        candidateCount: 0,
        matchedCount: 0,
        deletedCount: 0,
      };
    }

    const identityKeys = new Set(identities.map(compensationIdentityKey));
    if (identityKeys.size !== identities.length) {
      return {
        complete: false,
        stage: 'database-query',
        candidateCount: identities.length,
        matchedCount: 0,
        deletedCount: 0,
      };
    }

    const orderedIdentities = sortUploadAssetLockIdentities(identities);
    const candidateWhere = { OR: identities.map(compensationIdentityWhere) };
    const identityConflictWhere = {
      OR: [
        { id: { in: identities.map((identity) => identity.id) } },
        { storageKey: { in: identities.map((identity) => identity.storageKey) } },
      ],
    };
    let stage: DatabaseCompensationStage = 'lock-barrier-start';

    try {
      // A transaction-level lock statement can establish a Serializable snapshot before it
      // finishes waiting. This lock-only barrier ends first, so the compensation transaction's
      // snapshot is necessarily created after every ambiguous creator holding the lock settled.
      await this.prisma.$transaction(
        async (transaction: Prisma.TransactionClient) => {
          stage = 'lock-barrier-acquire';
          for (const identity of orderedIdentities) {
            await lockUploadAsset(transaction, identity);
          }
        },
        { isolationLevel: 'Serializable' }
      );

      stage = 'transaction-start';
      const transactionResult = await this.prisma.$transaction(
        async (transaction: Prisma.TransactionClient) => {
          stage = 'transaction-lock-acquire';
          for (const identity of orderedIdentities) {
            await lockUploadAsset(transaction, identity);
          }

          stage = 'database-query';
          const matchedAssets = await transaction.fileAsset.findMany({
            where: candidateWhere,
            select: { id: true, ownerEmployeeId: true, storageKey: true },
          });
          if (matchedAssets.some((asset) => !identityKeys.has(compensationIdentityKey(asset)))) {
            throw new Error('Unexpected FileAsset identity during compensation');
          }

          stage = 'database-conflict-count';
          const conflictCount = await transaction.fileAsset.count({
            where: identityConflictWhere,
          });
          if (conflictCount !== matchedAssets.length) {
            throw new Error('Conflicting FileAsset identity during compensation');
          }

          stage = 'database-query-count';
          const matchedCount = await transaction.fileAsset.count({ where: candidateWhere });
          if (matchedCount !== matchedAssets.length) {
            throw new Error('FileAsset query count changed during compensation');
          }

          let deletedCount = 0;
          if (matchedAssets.length > 0) {
            stage = 'database-delete';
            const deletion = await transaction.fileAsset.deleteMany({
              where: { OR: matchedAssets.map(compensationIdentityWhere) },
            });
            deletedCount = deletion.count;

            stage = 'database-delete-count';
            if (deletedCount !== matchedAssets.length) {
              throw new Error('FileAsset delete count mismatch during compensation');
            }
          }

          stage = 'database-remaining-count';
          const remainingCount = await transaction.fileAsset.count({
            where: identityConflictWhere,
          });
          if (remainingCount !== 0) {
            throw new Error('FileAsset compensation left residual or conflicting rows');
          }

          return { matchedCount: matchedAssets.length, deletedCount };
        },
        { isolationLevel: 'Serializable' }
      );

      return {
        complete: true,
        stage: 'database-remaining-count',
        candidateCount: identities.length,
        matchedCount: transactionResult.matchedCount,
        deletedCount: transactionResult.deletedCount,
      };
    } catch {
      return {
        complete: false,
        stage,
        candidateCount: identities.length,
        matchedCount: 0,
        deletedCount: 0,
      };
    }
  }

  private async cleanupFiles(attempts: readonly UploadAttempt[]): Promise<FileCleanupOutcome> {
    const candidates = attempts.filter((attempt) => attempt.fileCreated);
    const settled = await Promise.allSettled(
      candidates.map(async (attempt) => {
        if (!attempt.selectedCandidate || !attempt.fileIdentity) {
          throw new Error('Created file identity is unavailable');
        }
        return this.pathSecurity.unlinkExact(
          attempt.selectedCandidate,
          attempt.fileIdentity,
          attempt.parentDirectory,
          attempt.parentIdentity
        );
      })
    );

    let deletedCount = 0;
    let absentCount = 0;
    const failures: FileCleanupFailure[] = [];
    settled.forEach((result, index) => {
      if (result.status === 'rejected') {
        const attempt = candidates[index];
        if (attempt) {
          failures.push({ attempt, errorCode: safeFailureCode(result.reason) });
        }
      } else if (result.value === 'deleted') {
        deletedCount += 1;
      } else {
        absentCount += 1;
      }
    });

    return {
      complete: failures.length === 0,
      candidateCount: candidates.length,
      deletedCount,
      absentCount,
      failures,
    };
  }

  private async releaseAttemptDirectories(attempts: readonly UploadAttempt[]): Promise<void> {
    const directories = Array.from(
      new Set(
        attempts
          .map((attempt) => attempt.parentDirectory)
          .filter((directory): directory is AnchoredUploadDirectory => Boolean(directory))
      )
    );
    const settled = await Promise.allSettled(
      directories.map((directory) => this.pathSecurity.closeDirectory(directory))
    );
    for (const attempt of attempts) attempt.parentDirectory = undefined;

    const failedCount = settled.filter((result) => result.status === 'rejected').length;
    if (failedCount > 0) {
      this.logger.error({
        event: 'upload.directory-handle-close.failed',
        directoryCount: directories.length,
        failedCount,
      });
    }
  }

  private compensationIdentity(attempt: UploadAttempt): CompensationIdentity {
    const selected = attempt.selectedCandidate;
    if (!selected) throw new Error('Database attempt has no selected storage key');
    return {
      id: attempt.assetId,
      ownerEmployeeId: attempt.ownerEmployeeId,
      storageKey: selected.storageKey,
    };
  }

  private safeAttemptLog(attempt: UploadAttempt): Record<string, unknown> {
    return {
      index: attempt.index,
      assetId: attempt.assetId,
      storageKey: attempt.selectedCandidate?.storageKey ?? attempt.candidates[0]?.storageKey,
      failureStage: attempt.failureStage,
      failureCode: attempt.failureCode,
      databaseState: attempt.databaseCreateResolved
        ? 'created'
        : attempt.databaseCreateAttempted
          ? 'ambiguous'
          : 'not-attempted',
    };
  }

  /**
   * 删除文件
   */
  async deleteFile(filename: string): Promise<{ success: boolean }> {
    if (
      !filename ||
      filename.includes('\0') ||
      filename.includes('/') ||
      filename.includes('\\') ||
      path.basename(filename) !== filename
    ) {
      return { success: false };
    }

    try {
      return { success: await this.pathSecurity.deleteFirstByBasename(filename) };
    } catch {
      return { success: false };
    }
  }

  /**
   * 为已经通过业务 RBAC 返回给当前员工的附件签发短时下载地址。
   * 令牌绑定员工、存储路径和过期时间，规范存储 URL 本身不再是访问凭证。
   */
  createDownloadUrl(fileUrl: string, employeeId: string, originalName?: string): string {
    const storageKey = this.storageKeyFromUrl(fileUrl);
    return this.createDownloadUrlFromStorageKey(storageKey, employeeId, originalName);
  }

  private createDownloadUrlFromStorageKey(
    storageKey: string,
    employeeId: string,
    originalName?: string
  ): string {
    const payload: DownloadTokenPayload = {
      v: 1,
      u: employeeId,
      p: storageKey,
      e: Math.floor(Date.now() / 1000) + DOWNLOAD_TOKEN_TTL_SECONDS,
      ...(originalName ? { n: path.basename(originalName).slice(0, 255) } : {}),
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = this.signDownloadPayload(encodedPayload);
    return `/${this.apiPrefix}/v1/upload/file/${encodedPayload}.${signature}`;
  }

  isManagedFileUrl(fileUrl: string): boolean {
    try {
      this.storageKeyFromUrl(fileUrl);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 只为「附件 ID + 规范 URL」与 FileAsset 登记完全一致的候选项签名。
   *
   * 业务响应已经完成记录级 RBAC；这里补文件身份校验，避免客户端把一个泄露的
   * 存储 URL 塞进自己可见的 JSON 对象后，借响应拦截器换取下载令牌。
   */
  async createRegisteredAttachmentDownloadUrls(
    candidates: readonly RegisteredAttachmentCandidate[],
    employeeId: string
  ): Promise<Map<string, string>> {
    const unique = new Map<string, RegisteredAttachmentCandidate>();
    for (const candidate of candidates) {
      if (!candidate.id || !candidate.url) continue;
      unique.set(this.attachmentCandidateKey(candidate.id, candidate.url), candidate);
    }
    if (unique.size === 0) return new Map();

    const assetIds = Array.from(new Set(Array.from(unique.values(), (candidate) => candidate.id)));
    const assets = await this.prisma.fileAsset.findMany({
      where: { id: { in: assetIds } },
      select: { id: true, storageKey: true },
    });
    const storageKeyById = new Map(assets.map((asset) => [asset.id, asset.storageKey]));
    const result = new Map<string, string>();

    for (const [candidateKey, candidate] of unique) {
      let storageKey: string;
      try {
        storageKey = this.storageKeyFromUrl(candidate.url);
      } catch {
        continue;
      }
      if (storageKeyById.get(candidate.id) !== storageKey) continue;
      result.set(candidateKey, this.createDownloadUrl(candidate.url, employeeId, candidate.name));
    }
    return result;
  }

  /**
   * 为钉钉群通知签发短时图片预览地址。
   * 只接受当前提交人上传并登记的图片，且附件 ID、规范 URL 对应的 storageKey 必须同时匹配。
   */
  async createRegisteredImagePreviewUrls(
    candidates: readonly RegisteredAttachmentCandidate[],
    uploaderEmployeeId: string
  ): Promise<Map<string, string>> {
    const unique = new Map<string, RegisteredAttachmentCandidate>();
    for (const candidate of candidates) {
      if (!candidate.id || !candidate.url) continue;
      unique.set(this.attachmentCandidateKey(candidate.id, candidate.url), candidate);
    }
    if (unique.size === 0) return new Map();

    const assetIds = Array.from(new Set(Array.from(unique.values(), (candidate) => candidate.id)));
    const assets = await this.prisma.fileAsset.findMany({
      where: { id: { in: assetIds }, ownerEmployeeId: uploaderEmployeeId },
      select: { id: true, storageKey: true, mimeType: true },
    });
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));
    const result = new Map<string, string>();

    for (const [candidateKey, candidate] of unique) {
      const asset = assetById.get(candidate.id);
      if (
        !candidate.mimeType?.startsWith('image/') ||
        !asset?.mimeType.startsWith('image/') ||
        candidate.mimeType !== asset.mimeType
      ) {
        continue;
      }

      let storageKey: string;
      try {
        storageKey = this.storageKeyFromUrl(candidate.url);
      } catch {
        continue;
      }
      if (asset.storageKey !== storageKey) continue;
      result.set(candidateKey, this.createImagePreviewUrl(storageKey, asset.mimeType));
    }
    return result;
  }

  attachmentCandidateKey(id: string, url: string): string {
    return `${id}\u0000${url}`;
  }

  async getFileStreamByToken(
    token: string,
    employeeId: string
  ): Promise<{
    stream: fs.ReadStream;
    filename: string;
    storageKey: string;
    mimeType: string;
  }> {
    const payload = this.verifyDownloadToken(token, employeeId);
    const managedPath = this.pathSecurity.prepare(payload.p);

    let stream: fs.ReadStream;
    try {
      stream = await this.pathSecurity.createReadStream(managedPath);
    } catch {
      throw new NotFoundException(`File not found: ${payload.p}`);
    }

    const filename = payload.n || path.posix.basename(payload.p);
    const mimeType = mime.lookup(payload.p) || 'application/octet-stream';
    return { stream, filename, storageKey: payload.p, mimeType };
  }

  /**
   * 为服务端解析任务打开已登记的上传文件。
   * 先由 FileAsset 定位 storageKey，再经 UploadPathSecurity 以 O_NOFOLLOW 打开 regular file；
   * 不接受 URL 或 basename，避免绕过根目录锚定。调用方的业务权限由各自 RBAC 控制。
   */
  async openRegisteredFileAsset(assetId: string): Promise<OpenedRegisteredFileAsset> {
    const asset = await this.prisma.fileAsset.findFirst({
      where: { id: assetId },
      select: { storageKey: true, originalName: true, size: true, mimeType: true },
    });
    if (!asset) throw new NotFoundException('Upload asset not found');
    const managedPath = this.pathSecurity.prepare(asset.storageKey);
    let opened: AnchoredUploadFile;
    try {
      opened = await this.pathSecurity.openReadFile(managedPath);
    } catch {
      throw new NotFoundException('Upload asset not found');
    }
    const stat = await opened.handle.stat();
    if (!stat.isFile() || stat.size !== asset.size) {
      await opened.handle.close().catch(() => undefined);
      throw new BadRequestException('Upload asset identity mismatch');
    }
    return { handle: opened.handle, ...asset };
  }

  async getImagePreviewStreamByToken(token: string): Promise<{
    stream: fs.ReadStream;
    storageKey: string;
    mimeType: string;
    expiresAt: number;
  }> {
    const payload = this.verifyImagePreviewToken(token);
    const managedPath = this.pathSecurity.prepare(payload.p);

    let stream: fs.ReadStream;
    try {
      stream = await this.pathSecurity.createReadStream(managedPath);
    } catch {
      throw new NotFoundException(`File not found: ${payload.p}`);
    }

    return {
      stream,
      storageKey: payload.p,
      mimeType: payload.m,
      expiresAt: payload.e,
    };
  }

  private createImagePreviewUrl(storageKey: string, mimeType: string): string {
    const payload: ImagePreviewTokenPayload = {
      v: 1,
      p: storageKey,
      m: mimeType,
      e: Math.floor(Date.now() / 1000) + IMAGE_PREVIEW_TOKEN_TTL_SECONDS,
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = this.signImagePreviewPayload(encodedPayload);
    return `${this.publicApiBaseUrl}/${this.apiPrefix}/v1/upload/preview/${encodedPayload}.${signature}`;
  }

  private storageKeyFromUrl(fileUrl: string): string {
    const baseUrlObj = this.tryParseUrl(this.baseUrl);
    const inputUrlObj = this.tryParseUrl(fileUrl);
    if (!baseUrlObj || !inputUrlObj || inputUrlObj.origin !== baseUrlObj.origin) {
      throw new BadRequestException('Invalid file URL');
    }

    const pathMatch = inputUrlObj.pathname.match(/^\/uploads?\/(.+)$/);
    if (!pathMatch?.[1]) {
      throw new BadRequestException('Invalid file URL');
    }

    let storageKey: string;
    try {
      storageKey = decodeURIComponent(pathMatch[1]);
    } catch {
      throw new BadRequestException('Invalid file URL encoding');
    }
    this.pathSecurity.prepare(storageKey);
    return storageKey;
  }

  private verifyDownloadToken(token: string, employeeId: string): DownloadTokenPayload {
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new BadRequestException('Invalid download token');
    }

    const expected = Buffer.from(this.signDownloadPayload(parts[0]), 'utf8');
    const actual = Buffer.from(parts[1], 'utf8');
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      throw new BadRequestException('Invalid download token');
    }

    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    } catch {
      throw new BadRequestException('Invalid download token');
    }

    if (!isDownloadTokenPayload(payload) || payload.u !== employeeId) {
      throw new BadRequestException('Invalid download token');
    }
    if (payload.e < Math.floor(Date.now() / 1000)) {
      throw new BadRequestException('Download token expired');
    }
    this.pathSecurity.prepare(payload.p);
    return payload;
  }

  private signDownloadPayload(encodedPayload: string): string {
    return crypto
      .createHmac('sha256', this.downloadSigningSecret)
      .update(`azeroth-upload-v1:${encodedPayload}`)
      .digest('base64url');
  }

  private verifyImagePreviewToken(token: string): ImagePreviewTokenPayload {
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new BadRequestException('Invalid image preview token');
    }

    const expected = Buffer.from(this.signImagePreviewPayload(parts[0]), 'utf8');
    const actual = Buffer.from(parts[1], 'utf8');
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
      throw new BadRequestException('Invalid image preview token');
    }

    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    } catch {
      throw new BadRequestException('Invalid image preview token');
    }

    if (!isImagePreviewTokenPayload(payload)) {
      throw new BadRequestException('Invalid image preview token');
    }
    if (payload.e < Math.floor(Date.now() / 1000)) {
      throw new BadRequestException('Image preview token expired');
    }
    this.pathSecurity.prepare(payload.p);
    return payload;
  }

  private signImagePreviewPayload(encodedPayload: string): string {
    return crypto
      .createHmac('sha256', this.downloadSigningSecret)
      .update(`azeroth-upload-preview-v1:${encodedPayload}`)
      .digest('base64url');
  }

  /**
   * 安全解析 URL：失败返回 null（而非抛错），让调用方走 BadRequestException 分支
   */
  private tryParseUrl(input: string): URL | null {
    try {
      return new URL(input);
    } catch {
      return null;
    }
  }
}

const SINGLE_UPLOAD_FAILED_MESSAGE = 'File upload failed';
const SINGLE_UPLOAD_CLEANUP_INCOMPLETE_MESSAGE = 'File upload failed and cleanup was incomplete';
const BATCH_UPLOAD_FAILED_MESSAGE = 'Batch upload failed';
const BATCH_UPLOAD_CLEANUP_INCOMPLETE_MESSAGE = 'Batch upload failed and cleanup was incomplete';
const DOWNLOAD_TOKEN_TTL_SECONDS = 60 * 60;
const IMAGE_PREVIEW_TOKEN_TTL_SECONDS = 60 * 60;
const MAX_FILE_CREATE_ATTEMPTS = 8;
const SAFE_STORAGE_EXTENSION = /^\.[a-z0-9]{1,12}$/i;

function uploadFailedMessage(scope: UploadScope): string {
  return scope === 'single' ? SINGLE_UPLOAD_FAILED_MESSAGE : BATCH_UPLOAD_FAILED_MESSAGE;
}

function cleanupIncompleteMessage(scope: UploadScope): string {
  return scope === 'single'
    ? SINGLE_UPLOAD_CLEANUP_INCOMPLETE_MESSAGE
    : BATCH_UPLOAD_CLEANUP_INCOMPLETE_MESSAGE;
}

function safeFailureCode(error: unknown): string {
  return errorCode(error) ?? (error instanceof BadRequestException ? 'INVALID_PATH' : 'UNKNOWN');
}

function compensationIdentityWhere(identity: CompensationIdentity): CompensationIdentity {
  return {
    id: identity.id,
    ownerEmployeeId: identity.ownerEmployeeId,
    storageKey: identity.storageKey,
  };
}

function compensationIdentityKey(identity: CompensationIdentity): string {
  return JSON.stringify([identity.id, identity.ownerEmployeeId, identity.storageKey]);
}

interface DownloadTokenPayload {
  v: 1;
  u: string;
  p: string;
  e: number;
  n?: string;
}

function isDownloadTokenPayload(value: unknown): value is DownloadTokenPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Record<string, unknown>;
  return (
    payload.v === 1 &&
    typeof payload.u === 'string' &&
    payload.u.length > 0 &&
    typeof payload.p === 'string' &&
    payload.p.length > 0 &&
    typeof payload.e === 'number' &&
    Number.isSafeInteger(payload.e) &&
    (payload.n === undefined || typeof payload.n === 'string')
  );
}

interface ImagePreviewTokenPayload {
  v: 1;
  p: string;
  m: string;
  e: number;
}

function isImagePreviewTokenPayload(value: unknown): value is ImagePreviewTokenPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Record<string, unknown>;
  return (
    payload.v === 1 &&
    typeof payload.p === 'string' &&
    payload.p.length > 0 &&
    typeof payload.m === 'string' &&
    payload.m.startsWith('image/') &&
    typeof payload.e === 'number' &&
    Number.isSafeInteger(payload.e)
  );
}
