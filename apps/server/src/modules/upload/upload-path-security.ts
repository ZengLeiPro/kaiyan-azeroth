import { BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';

export interface ManagedUploadPath {
  storageKey: string;
  relativePath: string;
  segments: readonly string[];
  parentSegments: readonly string[];
  entryName: string;
}

export interface FileIdentity {
  dev: number | bigint;
  ino: number | bigint;
}

/**
 * A directory reached one segment at a time from the permanently-open root fd.
 * Every handle in the chain stays open until closeDirectory() so a rename cannot
 * redirect a later file operation to a replacement pathname.
 */
export interface AnchoredUploadDirectory {
  readonly handles: readonly fsp.FileHandle[];
  readonly handle: fsp.FileHandle;
  readonly identity: FileIdentity;
  readonly segments: readonly string[];
  closed: boolean;
}

export interface AnchoredUploadFile {
  readonly handle: fsp.FileHandle;
  readonly identity: FileIdentity;
}

const INVALID_PATH_MESSAGE = 'Invalid file path';
const PROC_FD_ROOT = '/proc/self/fd';
const ISOLATION_DIRECTORY = '.ky-upload-quarantine';
const MAX_ISOLATION_NAME_ATTEMPTS = 8;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

const DIRECTORY_OPEN_FLAGS =
  fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW;
const CREATE_FILE_FLAGS =
  fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW;
const READ_FILE_FLAGS = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;

/**
 * Linux-only upload filesystem boundary.
 *
 * Node does not expose openat(2), renameat2(2), or unlinkat(2). On Linux,
 * /proc/self/fd/<dirfd>/<segment> gives the same fixed-directory lookup property
 * needed here, provided every directory is opened with O_DIRECTORY|O_NOFOLLOW.
 * The constructor fails closed when that capability is unavailable; there is no
 * pathname-based fallback.
 */
export class UploadPathSecurity {
  readonly root: string;

  private rootHandle?: fsp.FileHandle;
  private rootIdentity?: FileIdentity;
  private initialization?: Promise<void>;
  private closed = false;

  constructor(configuredRoot: string) {
    this.root = path.resolve(configuredRoot);
    assertLinuxProcFdCapability();
  }

  /** Open/create the configured root safely and retain its FileHandle for this instance. */
  initialize(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Upload path security is closed'));
    this.initialization ??= this.initializeRoot();
    return this.initialization;
  }

  /** Close the long-lived trusted root handle during application shutdown. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.initialization;
    } catch {
      // initializeRoot() closes every transient handle before rejecting. A root
      // handle retained immediately before a late initialization failure is still
      // closed below rather than being abandoned by this catch path.
    }
    const rootHandle = this.rootHandle;
    this.rootHandle = undefined;
    this.rootIdentity = undefined;
    if (rootHandle) await rootHandle.close();
  }

  /** Lexically validate a storage key. No filesystem path is resolved by name here. */
  prepare(storageKey: string): ManagedUploadPath {
    if (
      !storageKey ||
      storageKey.includes('\0') ||
      storageKey.includes('\\') ||
      path.posix.isAbsolute(storageKey) ||
      path.win32.isAbsolute(storageKey)
    ) {
      throw invalidPath();
    }

    const segments = storageKey.split('/');
    if (
      segments.length < 2 ||
      segments.some((segment) => !segment || segment === '.' || segment === '..') ||
      path.posix.normalize(storageKey) !== storageKey
    ) {
      throw invalidPath();
    }

    const entryName = segments.at(-1);
    if (!entryName) throw invalidPath();
    return {
      storageKey,
      relativePath: segments.join(path.sep),
      segments,
      parentSegments: segments.slice(0, -1),
      entryName,
    };
  }

  /**
   * Traverse from the trusted root fd, opening each parent segment with
   * O_DIRECTORY|O_NOFOLLOW. Missing segments are mkdir'd beneath the already
   * fixed parent fd, then opened with the same no-follow flags.
   */
  async openParent(
    managedPath: ManagedUploadPath,
    options: { create: boolean; expectedIdentity?: FileIdentity }
  ): Promise<AnchoredUploadDirectory> {
    const rootHandle = await this.requireRootHandle();
    const openedHandles: fsp.FileHandle[] = [];
    let current = rootHandle;

    try {
      for (const segment of managedPath.parentSegments) {
        const next = await this.openDirectorySegment(current, segment, options.create);
        openedHandles.push(next);
        current = next;
      }

      const finalHandle = openedHandles.at(-1);
      if (!finalHandle) throw invalidPath();
      const identity = await validateDirectoryHandle(finalHandle);
      if (options.expectedIdentity && !sameIdentity(identity, options.expectedIdentity)) {
        throw invalidPath();
      }

      return {
        handles: openedHandles,
        handle: finalHandle,
        identity,
        segments: managedPath.parentSegments,
        closed: false,
      };
    } catch (error) {
      await closeHandles(openedHandles);
      throw error;
    }
  }

  async closeDirectory(directory: AnchoredUploadDirectory): Promise<void> {
    if (directory.closed) return;
    directory.closed = true;
    await closeHandles(directory.handles);
  }

  /** Open a new regular file relative to the retained parent fd, without following links. */
  async openFileExclusively(
    directory: AnchoredUploadDirectory,
    managedPath: ManagedUploadPath
  ): Promise<AnchoredUploadFile> {
    this.assertDirectoryForPath(directory, managedPath);
    const handle = await fsp.open(
      entryPath(directory.handle, managedPath.entryName),
      CREATE_FILE_FLAGS,
      FILE_MODE
    );
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw invalidPath();
      return { handle, identity: identityOf(stat) };
    } catch (error) {
      await handle.close().catch(() => undefined);
      throw error;
    }
  }

  /** Open an existing final entry without following it and bind its regular-file inode. */
  async openFileForIdentity(
    directory: AnchoredUploadDirectory,
    managedPath: ManagedUploadPath
  ): Promise<AnchoredUploadFile> {
    this.assertDirectoryForPath(directory, managedPath);
    const handle = await fsp.open(
      entryPath(directory.handle, managedPath.entryName),
      READ_FILE_FLAGS
    );
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw invalidPath();
      return { handle, identity: identityOf(stat) };
    } catch (error) {
      await handle.close().catch(() => undefined);
      throw error;
    }
  }

  /**
   * Prove both the bound file descriptor and its entry beneath the fixed parent
   * still identify the same regular inode. The caller writes only via handle.
   */
  async validateOpenedFile(
    directory: AnchoredUploadDirectory,
    managedPath: ManagedUploadPath,
    file: AnchoredUploadFile
  ): Promise<void> {
    this.assertDirectoryForPath(directory, managedPath);
    const handleStat = await file.handle.stat();
    if (!handleStat.isFile() || !sameIdentity(identityOf(handleStat), file.identity)) {
      throw invalidPath();
    }

    const entryStat = await safeLstat(entryPath(directory.handle, managedPath.entryName));
    if (
      !entryStat.isFile() ||
      entryStat.isSymbolicLink() ||
      !sameIdentity(identityOf(entryStat), file.identity)
    ) {
      throw invalidPath();
    }
  }

  /** Ensure the retained parent inode is still the directory named by the storage key. */
  async validateParentBinding(
    directory: AnchoredUploadDirectory,
    managedPath: ManagedUploadPath
  ): Promise<void> {
    this.assertDirectoryForPath(directory, managedPath);
    const rebound = await this.openParent(managedPath, {
      create: false,
      expectedIdentity: directory.identity,
    });
    await this.closeDirectory(rebound);
  }

  /**
   * Open the final entry O_NOFOLLOW, fstat it as a regular file, and construct the
   * stream from that same FileHandle. No pathname is opened a second time.
   */
  async createReadStream(managedPath: ManagedUploadPath): Promise<fs.ReadStream> {
    const directory = await this.openParent(managedPath, { create: false });
    let handle: fsp.FileHandle | undefined;
    try {
      handle = await fsp.open(entryPath(directory.handle, managedPath.entryName), READ_FILE_FLAGS);
      const stat = await handle.stat();
      if (!stat.isFile()) throw invalidPath();

      // Close every directory handle before transferring the file handle to the
      // stream. If directory close fails, the still-owned file handle is closed
      // in finally instead of being stranded behind an unreturned stream.
      await this.closeDirectory(directory);
      const stream = handle.createReadStream({ autoClose: true });
      handle = undefined;
      return stream;
    } finally {
      if (handle) await handle.close().catch(() => undefined);
      if (!directory.closed) await this.closeDirectory(directory);
    }
  }

  /**
   * Open an existing regular file beneath the retained root and return the bound fd.
   * Callers that pass the fd to a child process must close this parent handle in finally.
   */
  async openReadFile(managedPath: ManagedUploadPath): Promise<AnchoredUploadFile> {
    const directory = await this.openParent(managedPath, { create: false });
    let handle: fsp.FileHandle | undefined;
    try {
      handle = await fsp.open(entryPath(directory.handle, managedPath.entryName), READ_FILE_FLAGS);
      const stat = await handle.stat();
      if (!stat.isFile()) throw invalidPath();
      const identity = identityOf(stat);
      await this.closeDirectory(directory);
      const result = { handle, identity };
      handle = undefined;
      return result;
    } finally {
      if (handle) await handle.close().catch(() => undefined);
      if (!directory.closed) await this.closeDirectory(directory);
    }
  }

  /**
   * Atomically move the entry into a crypto-random private isolation slot, then
   * compare the isolated inode with the expected inode. An unexpected entry is
   * never unlinked: a no-replace hard-link restore is attempted and the isolated
   * entry is retained for recovery if restoration cannot be completed.
   */
  async unlinkExact(
    managedPath: ManagedUploadPath,
    expectedIdentity: FileIdentity,
    retainedDirectory?: AnchoredUploadDirectory,
    expectedParentIdentity?: FileIdentity
  ): Promise<'deleted' | 'absent'> {
    let directory = retainedDirectory;
    let ownsDirectory = false;
    if (!directory || directory.closed) {
      directory = await this.openParent(managedPath, {
        create: false,
        expectedIdentity: expectedParentIdentity,
      });
      ownsDirectory = true;
    }

    try {
      this.assertDirectoryForPath(directory, managedPath);
      if (expectedParentIdentity && !sameIdentity(directory.identity, expectedParentIdentity)) {
        throw invalidPath();
      }
      return await this.isolateAndDelete(directory.handle, managedPath.entryName, expectedIdentity);
    } finally {
      if (ownsDirectory) await this.closeDirectory(directory);
    }
  }

  /** Safely find and delete the first regular file with this basename beneath root. */
  async deleteFirstByBasename(filename: string): Promise<boolean> {
    const rootHandle = await this.requireRootHandle();
    const rootIdentity = await validateDirectoryHandle(rootHandle);
    const visited = new Set([identityKey(rootIdentity)]);
    return this.scanAndDelete(rootHandle, filename, visited);
  }

  private async initializeRoot(): Promise<void> {
    const rootSegments = this.root.split(path.sep).filter(Boolean);
    const handles: fsp.FileHandle[] = [];
    let trustedRoot: fsp.FileHandle | undefined;
    let trustedIdentity: FileIdentity | undefined;

    try {
      let current = await fsp.open(path.parse(this.root).root, DIRECTORY_OPEN_FLAGS);
      handles.push(current);
      for (const segment of rootSegments) {
        current = await this.openDirectorySegment(current, segment, true);
        handles.push(current);
      }

      trustedIdentity = await validateDirectoryHandle(current);
      await this.validateNamedRootBinding(current, trustedIdentity);
      trustedRoot = current;
      handles.pop();
    } catch (error) {
      await closeHandles(handles).catch(() => undefined);
      throw error;
    }

    try {
      await closeHandles(handles);
    } catch (error) {
      await trustedRoot?.close().catch(() => undefined);
      throw error;
    }

    if (!trustedRoot || !trustedIdentity) throw new Error('Upload root initialization failed');
    this.rootHandle = trustedRoot;
    this.rootIdentity = trustedIdentity;
  }

  private async requireRootHandle(): Promise<fsp.FileHandle> {
    await this.initialize();
    const rootHandle = this.rootHandle;
    const expectedIdentity = this.rootIdentity;
    if (!rootHandle || !expectedIdentity || this.closed) {
      throw new Error('Upload root handle is unavailable');
    }
    const identity = await validateDirectoryHandle(rootHandle);
    if (!sameIdentity(identity, expectedIdentity)) {
      throw new Error('Upload root handle identity changed');
    }
    await this.validateNamedRootBinding(rootHandle, expectedIdentity);
    return rootHandle;
  }

  private async validateNamedRootBinding(
    rootHandle: fsp.FileHandle,
    expectedIdentity: FileIdentity
  ): Promise<void> {
    const namedStat = await fsp.lstat(this.root);
    if (
      !namedStat.isDirectory() ||
      namedStat.isSymbolicLink() ||
      !sameIdentity(identityOf(namedStat), expectedIdentity)
    ) {
      throw new Error('UPLOAD_DIR identity verification failed');
    }

    const procTarget = await fsp.readlink(directoryPath(rootHandle));
    if (!samePath(procTarget, this.root)) {
      throw new Error('UPLOAD_DIR must remain bound to the trusted root handle');
    }
  }

  private async openDirectorySegment(
    parentHandle: fsp.FileHandle,
    segment: string,
    create: boolean
  ): Promise<fsp.FileHandle> {
    assertEntryName(segment);
    const target = entryPath(parentHandle, segment);
    let handle: fsp.FileHandle;
    try {
      handle = await fsp.open(target, DIRECTORY_OPEN_FLAGS);
    } catch (error) {
      if (!create || errorCode(error) !== 'ENOENT') throw error;
      try {
        await fsp.mkdir(target, { mode: DIRECTORY_MODE });
      } catch (mkdirError) {
        if (errorCode(mkdirError) !== 'EEXIST') throw mkdirError;
      }
      handle = await fsp.open(target, DIRECTORY_OPEN_FLAGS);
    }

    try {
      await validateDirectoryHandle(handle);
      return handle;
    } catch (error) {
      await handle.close().catch(() => undefined);
      throw error;
    }
  }

  private assertDirectoryForPath(
    directory: AnchoredUploadDirectory,
    managedPath: ManagedUploadPath
  ): void {
    if (directory.closed || !sameSegments(directory.segments, managedPath.parentSegments)) {
      throw invalidPath();
    }
  }

  private async isolateAndDelete(
    parentHandle: fsp.FileHandle,
    entryName: string,
    expectedIdentity: FileIdentity
  ): Promise<'deleted' | 'absent'> {
    let quarantine: fsp.FileHandle | undefined;
    let slot: { handle: fsp.FileHandle; path: string } | undefined;
    try {
      quarantine = await this.openPrivateQuarantine(parentHandle);
      slot = await this.createIsolationSlot(quarantine);
      const source = entryPath(parentHandle, entryName);
      const isolated = entryPath(slot.handle, 'entry');

      try {
        await fsp.rename(source, isolated);
      } catch (error) {
        if (errorCode(error) === 'ENOENT') return 'absent';
        throw error;
      }

      let isolatedHandle: fsp.FileHandle | undefined;
      try {
        isolatedHandle = await fsp.open(isolated, READ_FILE_FLAGS);
        const isolatedStat = await isolatedHandle.stat();
        if (!isolatedStat.isFile() || !sameIdentity(identityOf(isolatedStat), expectedIdentity)) {
          await isolatedHandle.close().catch(() => undefined);
          isolatedHandle = undefined;
          await this.restoreUnexpectedEntry(isolated, source);
          throw invalidPath();
        }

        // The random 0700 isolation slot removes the attacker-controlled source
        // name from the deletion step. Re-check the slot entry immediately before
        // unlink and never unlink when its inode no longer matches the opened fd.
        const finalStat = await safeLstat(isolated);
        if (
          !finalStat.isFile() ||
          finalStat.isSymbolicLink() ||
          !sameIdentity(identityOf(finalStat), expectedIdentity)
        ) {
          await this.restoreUnexpectedEntry(isolated, source);
          throw invalidPath();
        }
        await fsp.unlink(isolated);
        return 'deleted';
      } finally {
        await isolatedHandle?.close().catch(() => undefined);
      }
    } finally {
      await slot?.handle.close().catch(() => undefined);
      if (slot) await fsp.rmdir(slot.path).catch(() => undefined);
      await quarantine?.close().catch(() => undefined);
    }
  }

  private async openPrivateQuarantine(parentHandle: fsp.FileHandle): Promise<fsp.FileHandle> {
    const target = entryPath(parentHandle, ISOLATION_DIRECTORY);
    try {
      await fsp.mkdir(target, { mode: DIRECTORY_MODE });
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error;
    }
    const handle = await fsp.open(target, DIRECTORY_OPEN_FLAGS);
    try {
      await validateDirectoryHandle(handle);
      await handle.chmod(DIRECTORY_MODE);
      return handle;
    } catch (error) {
      await handle.close().catch(() => undefined);
      throw error;
    }
  }

  private async createIsolationSlot(
    quarantineHandle: fsp.FileHandle
  ): Promise<{ handle: fsp.FileHandle; path: string }> {
    for (let attempt = 0; attempt < MAX_ISOLATION_NAME_ATTEMPTS; attempt += 1) {
      const randomName = `q-${crypto.randomBytes(24).toString('hex')}`;
      const slotPath = entryPath(quarantineHandle, randomName);
      try {
        await fsp.mkdir(slotPath, { mode: DIRECTORY_MODE });
      } catch (error) {
        if (errorCode(error) === 'EEXIST') continue;
        throw error;
      }

      let handle: fsp.FileHandle | undefined;
      try {
        handle = await fsp.open(slotPath, DIRECTORY_OPEN_FLAGS);
        await validateDirectoryHandle(handle);
        await handle.chmod(DIRECTORY_MODE);
        return { handle, path: slotPath };
      } catch (error) {
        await handle?.close().catch(() => undefined);
        await fsp.rmdir(slotPath).catch(() => undefined);
        throw error;
      }
    }
    throw new Error('Unable to allocate upload isolation slot');
  }

  private async restoreUnexpectedEntry(isolated: string, source: string): Promise<void> {
    try {
      // link(2) creates the source atomically only when it is absent; unlike rename(2),
      // it never replaces a concurrent entry. The isolated link intentionally remains.
      await fsp.link(isolated, source);
    } catch {
      // Best effort only. Never unlink an inode that failed the expected-identity check.
    }
  }

  private async scanAndDelete(
    directoryHandle: fsp.FileHandle,
    filename: string,
    visited: Set<string>
  ): Promise<boolean> {
    const entries = await fsp.readdir(directoryPath(directoryHandle), { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (entry.name === ISOLATION_DIRECTORY) continue;
      if (entry.name === filename) {
        let targetHandle: fsp.FileHandle | undefined;
        try {
          targetHandle = await fsp.open(entryPath(directoryHandle, entry.name), READ_FILE_FLAGS);
          const stat = await targetHandle.stat();
          if (!stat.isFile()) return false;
          const outcome = await this.isolateAndDelete(
            directoryHandle,
            entry.name,
            identityOf(stat)
          );
          return outcome === 'deleted';
        } catch (error) {
          if (errorCode(error) === 'ENOENT') continue;
          throw error;
        } finally {
          await targetHandle?.close().catch(() => undefined);
        }
      }

      if (!entry.isDirectory()) continue;
      let child: fsp.FileHandle | undefined;
      try {
        child = await this.openDirectorySegment(directoryHandle, entry.name, false);
        const childIdentity = identityOf(await child.stat());
        const key = identityKey(childIdentity);
        if (visited.has(key)) continue;
        visited.add(key);
        if (await this.scanAndDelete(child, filename, visited)) return true;
      } catch (error) {
        if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(errorCode(error) ?? '')) continue;
        throw error;
      } finally {
        await child?.close().catch(() => undefined);
      }
    }
    return false;
  }
}

function assertLinuxProcFdCapability(): void {
  if (process.platform !== 'linux') {
    // 测试进程允许在 macOS 上启动 Nest 应用，以便跑登录/业务链 HTTP。
    // 真实路径穿越与句柄校验仍只在 Linux 上成立（initialize / 写入路径会失败）。
    if (process.env.NODE_ENV === 'test') return;
    throw new Error('Secure upload storage requires Linux /proc/self/fd support');
  }
  try {
    const stat = fs.statSync(PROC_FD_ROOT);
    if (!stat.isDirectory()) throw new Error('not a directory');
  } catch {
    throw new Error('Secure upload storage requires mounted /proc/self/fd support');
  }
}

async function validateDirectoryHandle(handle: fsp.FileHandle): Promise<FileIdentity> {
  const handleStat = await handle.stat();
  if (!handleStat.isDirectory()) throw invalidPath();
  const procStat = await fsp.stat(directoryPath(handle));
  const identity = identityOf(handleStat);
  if (!procStat.isDirectory() || !sameIdentity(identityOf(procStat), identity)) {
    throw invalidPath();
  }
  return identity;
}

function directoryPath(handle: fsp.FileHandle): string {
  return `${PROC_FD_ROOT}/${handle.fd}`;
}

function entryPath(handle: fsp.FileHandle, entryName: string): string {
  assertEntryName(entryName);
  return `${directoryPath(handle)}/${entryName}`;
}

function assertEntryName(entryName: string): void {
  if (
    !entryName ||
    entryName === '.' ||
    entryName === '..' ||
    entryName.includes('/') ||
    entryName.includes('\\') ||
    entryName.includes('\0')
  ) {
    throw invalidPath();
  }
}

async function safeLstat(target: string): Promise<fs.Stats> {
  try {
    return await fsp.lstat(target);
  } catch {
    throw invalidPath();
  }
}

async function closeHandles(handles: readonly fsp.FileHandle[]): Promise<void> {
  const settled = await Promise.allSettled([...handles].reverse().map((handle) => handle.close()));
  const failure = settled.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}

function invalidPath(): BadRequestException {
  return new BadRequestException(INVALID_PATH_MESSAGE);
}

function identityOf(stat: Pick<fs.Stats, 'dev' | 'ino'>): FileIdentity {
  return { dev: stat.dev, ino: stat.ino };
}

export function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function identityKey(identity: FileIdentity): string {
  return `${String(identity.dev)}:${String(identity.ino)}`;
}

function sameSegments(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

function samePath(left: string, right: string): boolean {
  return path.relative(left, right) === '' && path.relative(right, left) === '';
}

export function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}
