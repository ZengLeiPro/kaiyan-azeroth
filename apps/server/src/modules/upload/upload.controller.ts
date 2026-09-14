import { IUploadResult } from '@ky-azeroth/shared/types';
import {
  BadRequestException,
  Controller,
  Get,
  Logger,
  MaxFileSizeValidator,
  NotFoundException,
  Param,
  ParseFilePipe,
  Post,
  Req,
  Res,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import * as path from 'path';

import { SkipAudit } from '../../common/decorators/skip-audit.decorator';
import { extractClientIp } from '../../common/utils/client-ip.helper';
import { AllowAnyAuthenticatedUser } from '../auth/decorators/allow-any-authenticated.decorator';
import { CurrentUser, CurrentUserType } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { OperationLogsService } from '../operation-logs/operation-logs.service';
import { UploadService } from './upload.service';

// 文件大小限制 (10MB)
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// P0 fix §4.4: MIME + 扩展名白名单
// 覆盖业务场景：CRM 头像、合同附件、报销单据、PPT/Excel/PDF 文档、CSV 导入。
// 任何 .html/.svg/.js 等可在浏览器执行的类型都不在列表里。
const ALLOWED_MIME_TYPES = new Set<string>([
  // 图片
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  // PDF
  'application/pdf',
  // Office 新版
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  // Office 旧版
  'application/msword', // .doc
  'application/vnd.ms-excel', // .xls
  'application/vnd.ms-powerpoint', // .ppt
  // 纯文本
  'text/plain',
  'text/csv',
  // 压缩包
  'application/zip',
  'application/x-zip-compressed',
]);

const ALLOWED_EXTENSIONS = new Set<string>([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.pdf',
  '.docx',
  '.xlsx',
  '.pptx',
  '.doc',
  '.xls',
  '.ppt',
  '.txt',
  '.csv',
  '.zip',
]);

// 显式拒绝清单：哪怕 mimetype 伪造，也按扩展名先拦
const DENIED_EXTENSIONS = new Set<string>([
  '.html',
  '.htm',
  '.svg',
  '.xml',
  '.xhtml',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.exe',
  '.bat',
  '.cmd',
  '.sh',
  '.ps1',
  '.vbs',
  '.swf',
  '.jar',
]);

/**
 * P0 fix §4.4: 上传文件 fileFilter
 * 三层校验：扩展名拒绝清单 → 扩展名白名单 → MIME 白名单。
 * 任何一层不通过即拒绝。
 */
export function uploadFileFilter(
  _req: unknown,
  file: { originalname: string; mimetype: string },
  cb: (err: Error | null, accept: boolean) => void
): void {
  const ext = path.extname(file.originalname).toLowerCase();
  if (DENIED_EXTENSIONS.has(ext)) {
    return cb(new BadRequestException(`禁止上传 ${ext} 文件（潜在 XSS / 可执行文件风险）`), false);
  }
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return cb(new BadRequestException(`不支持的文件扩展名: ${ext}`), false);
  }
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    return cb(new BadRequestException(`不支持的 MIME 类型: ${file.mimetype}`), false);
  }
  return cb(null, true);
}

// 简化的文件类型定义
interface UploadedFileType {
  originalname: string;
  buffer: Buffer;
  size: number;
  mimetype: string;
}

@Controller('upload')
// 类级 @SkipAudit：跳过全局 OperationLogInterceptor 的自动审计——
// 不是不审计，而是 controller 内手动调 operationLogsService.log() 写富信息
// （filename / originalName / size / url），拦截器默认只能记 module/action+
// 顶层 response.id，对 upload 返回 { url, filename, ... } 这种无 id 的结构
// 拿不到 target，价值很低。同时 GET 下载请求拦截器天然不记，必须手动写。
@SkipAudit()
export class UploadController {
  private readonly logger = new Logger(UploadController.name);
  constructor(
    private readonly uploadService: UploadService,
    private readonly operationLogsService: OperationLogsService
  ) {}

  /**
   * 上传单个文件
   * POST /api/v1/upload
   *
   * 2026-06-20 P0 加固：
   * - @CurrentUser 拿身份 + extractClientIp 拿 IP
   * - 写富信息 operation_logs（module=upload, action=create，target=存储文件名，
   *   details 含 originalName/size/mimeType/url），永久存 RDS，FC 日志滚动不丢
   * - logger.log 兜底应用日志（双重写盘冗余）
   */
  @Post()
  @AllowAnyAuthenticatedUser()
  @UseInterceptors(
    FileInterceptor('file', {
      fileFilter: uploadFileFilter,
      limits: { fileSize: MAX_FILE_SIZE },
    })
  )
  async uploadFile(
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: MAX_FILE_SIZE })],
        fileIsRequired: true,
      })
    )
    file: UploadedFileType,
    @CurrentUser() user: CurrentUserType,
    @Req() req: Request
  ): Promise<IUploadResult> {
    const employeeId = user.employeeId ?? user.id;
    const result = await this.uploadService.uploadFile(file, employeeId);
    this.logger.log(
      `upload by user=${user.id} username=${user.username} ` +
        `original=${file.originalname} size=${file.size} stored=${result.filename}`
    );
    this.writeAudit(user, req, 'create', result.filename, {
      originalName: file.originalname,
      storedName: result.filename,
      size: file.size,
      mimeType: file.mimetype,
      url: result.url,
    });
    return result;
  }

  /**
   * 上传多个文件
   * POST /api/v1/upload/multiple
   *
   * 2026-06-20 P0 加固：同上；批量上传写一条 audit，details 含每个文件明细。
   */
  @Post('multiple')
  @AllowAnyAuthenticatedUser()
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      fileFilter: uploadFileFilter,
      limits: { fileSize: MAX_FILE_SIZE },
    })
  )
  async uploadFiles(
    @UploadedFiles()
    files: UploadedFileType[],
    @CurrentUser() user: CurrentUserType,
    @Req() req: Request
  ): Promise<IUploadResult[]> {
    const employeeId = user.employeeId ?? user.id;
    const results = await this.uploadService.uploadFiles(files, employeeId);
    this.logger.log(
      `upload-multiple by user=${user.id} username=${user.username} ` +
        `count=${files.length} stored=${results.map((r) => r.filename).join(',')}`
    );
    this.writeAudit(user, req, 'create-batch', results.map((r) => r.filename).join(','), {
      count: files.length,
      items: results.map((r, idx) => ({
        originalName: files[idx]?.originalname,
        storedName: r.filename,
        size: files[idx]?.size,
        mimeType: files[idx]?.mimetype,
        url: r.url,
      })),
    });
    return results;
  }

  /**
   * 钉钉群机器人使用的短时图片预览端点。
   * 不依赖登录态，但令牌仅为已登记图片签发，并绑定存储路径、MIME 与过期时间。
   */
  @Public()
  @Get('preview/:token')
  async previewImage(@Param('token') token: string, @Res() res: Response): Promise<void> {
    try {
      const { stream, storageKey, mimeType, expiresAt } =
        await this.uploadService.getImagePreviewStreamByToken(token);
      const maxAge = Math.max(0, expiresAt - Math.floor(Date.now() / 1000));
      this.logger.log(`signed image preview storageKey=${storageKey}`);
      res.set({
        'Content-Type': mimeType,
        'Content-Disposition': 'inline',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': `public, max-age=${maxAge}, immutable`,
      });
      stream.once('error', (error) => {
        this.logger.error(`Signed image preview stream failed: ${error.message}`);
        if (res.headersSent) {
          res.destroy(error);
        } else {
          res.status(404).end();
        }
      });
      stream.pipe(res);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Signed image preview denied: ${message}`);
      throw new NotFoundException('Image preview not found or expired');
    }
  }

  /**
   * 使用短时、员工绑定的签名令牌读取文件。
   * 令牌只会在已经通过业务 RBAC 的响应中签发，规范存储 URL 本身不再提供访问权。
   */
  @Get('file/:token')
  @AllowAnyAuthenticatedUser()
  async downloadFile(
    @Param('token') token: string,
    @CurrentUser() user: CurrentUserType,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<void> {
    try {
      const employeeId = user.employeeId ?? user.id;
      const { stream, filename, storageKey, mimeType } =
        await this.uploadService.getFileStreamByToken(token, employeeId);

      this.logger.log(
        `download by user=${user.id} username=${user.username} storageKey=${storageKey}`
      );
      this.writeAudit(user, req, 'read', storageKey, {
        storageKey,
        downloadName: filename,
        mimeType,
      });

      const disposition = mimeType.startsWith('image/') ? 'inline' : 'attachment';
      res.set({
        'Content-Type': mimeType,
        'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      });

      stream.pipe(res);
    } catch (error) {
      const message = (error as Error).message;
      this.logger.warn(`Download denied for user=${user.id}: ${message}`);
      this.writeAudit(user, req, 'read-failed', undefined, {
        error: message,
      });
      throw new NotFoundException('File not found or access denied');
    }
  }

  /**
   * 统一 audit 写入：包装异步 fire-and-forget，写入失败不阻塞业务。
   * 失败兜底走 logger.error，便于排查。
   */
  private writeAudit(
    user: CurrentUserType,
    req: Request,
    action: string,
    target: string | undefined,
    details: Record<string, unknown>
  ): void {
    this.operationLogsService
      .log({
        employeeId: user.employeeId ?? user.id ?? null,
        ipAddress: extractClientIp(req),
        module: 'upload',
        action,
        target,
        details: { kind: 'request', ...details },
      })
      .catch((err: unknown) => {
        this.logger.error(
          `Failed to write upload audit log: ${err instanceof Error ? err.message : String(err)}`
        );
      });
  }
}
