import type { IAttachment } from '@ky-azeroth/shared/types/common';
import { CheckCircle, Download, FileIcon, Loader2, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { downloadAuthenticatedFile, useAuthenticatedFileUrl } from '@/hooks/use-authenticated-file';
import { logger } from '@/lib/logger';

export type UploadedFile = IAttachment;

export interface UploadResult {
  id: string;
  url: string;
  downloadUrl: string;
}

interface MultiFileUploadProps {
  value?: UploadedFile[];
  onChange?: (files: UploadedFile[]) => void;
  onUpload: (file: File) => Promise<UploadResult>;
  accept?: string;
  maxSize?: number;
  maxFiles?: number;
  disabled?: boolean;
  /**
   * 只读展示模式：不渲染 dropzone、不允许移除文件，仅用作 view 模式下展示已上传附件。
   * 与 disabled 的区别在于 disabled 仍渲染（灰色的）上传区，view 模式下不该出现。
   * preview Dialog 保留，便于点击缩略图放大查看。
   */
  readOnly?: boolean;
  'data-testid'?: string;
}

interface FileUploadState {
  id: string;
  file: File;
  status: 'pending' | 'uploading' | 'success' | 'error';
  progress: number;
  error?: string;
  result?: UploadedFile;
}

function AuthenticatedImage({
  file,
  className,
  onClick,
}: {
  file: UploadedFile;
  className: string;
  onClick?: () => void;
}) {
  const objectUrl = useAuthenticatedFileUrl(file.downloadUrl);
  if (!objectUrl) return <FileIcon className="h-5 w-5 text-muted-foreground" />;
  return <img src={objectUrl} alt={file.name} className={className} onClick={onClick} />;
}

export function MultiFileUpload({
  value = [],
  onChange,
  onUpload,
  accept = 'image/*,.pdf,.doc,.docx,.xls,.xlsx',
  maxSize = 10,
  maxFiles = 10,
  disabled = false,
  readOnly = false,
  'data-testid': testId = 'multi-file-upload',
}: MultiFileUploadProps) {
  const generatedId = useId();
  const inputId = `${generatedId}-input`;
  const triggerId = `${generatedId}-trigger`;
  const helpId = `${generatedId}-help`;
  const errorId = `${generatedId}-error`;
  const uploadErrorId = `${generatedId}-upload-error`;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(false);
  const latestValueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const reservedFilesRef = useRef(0);
  const batchSequenceRef = useRef(0);
  const commitQueueRef = useRef<Promise<void>>(Promise.resolve());
  const progressTimersRef = useRef<Set<ReturnType<typeof setInterval>>>(new Set());
  const cleanupTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const [dragActive, setDragActive] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<FileUploadState[]>([]);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<UploadedFile | null>(null);

  useEffect(() => {
    latestValueRef.current = value;
  }, [value]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const progressTimers = progressTimersRef.current;
    const cleanupTimers = cleanupTimersRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const timer of progressTimers) clearInterval(timer);
      for (const timer of cleanupTimers) clearTimeout(timer);
      progressTimers.clear();
      cleanupTimers.clear();
    };
  }, []);

  const updateUploadState = useCallback(
    (id: string, update: (current: FileUploadState) => FileUploadState) => {
      if (!mountedRef.current) return;
      setUploadingFiles((current) =>
        current.map((fileState) => (fileState.id === id ? update(fileState) : fileState))
      );
    },
    []
  );

  const handleDownload = async (
    e: React.MouseEvent,
    downloadUrl: string | undefined,
    filename: string
  ): Promise<void> => {
    e.stopPropagation();
    try {
      await downloadAuthenticatedFile(downloadUrl, filename);
    } catch (error) {
      logger.error('MultiFileUpload', 'Download failed:', error);
    }
  };

  const uploadSingleFile = useCallback(
    async (file: File): Promise<UploadedFile | null> => {
      try {
        const result = await onUpload(file);

        return {
          id: result.id || Date.now().toString(),
          name: file.name,
          url: result.url,
          downloadUrl: result.downloadUrl,
          size: file.size,
          mimeType: file.type,
        };
      } catch (error) {
        logger.error('MultiFileUpload', 'Upload error:', error);
        return null;
      }
    },
    [onUpload]
  );

  const handleFilesSelect = useCallback(
    async (files: FileList) => {
      const fileArray = Array.from(files);
      if (fileArray.length === 0 || !mountedRef.current) return;
      setSelectionError(null);

      const batchId = `batch-${++batchSequenceRef.current}`;
      const batchStates: FileUploadState[] = fileArray.map((file, index) => ({
        id: `${batchId}-${index}`,
        file,
        status: file.size > maxSize * 1024 * 1024 ? 'error' : 'pending',
        progress: 0,
        ...(file.size > maxSize * 1024 * 1024 ? { error: `文件大小超过 ${maxSize}MB` } : {}),
      }));
      const uploadableCount = batchStates.filter((state) => state.status === 'pending').length;
      const occupiedFiles = latestValueRef.current.length + reservedFilesRef.current;

      if (occupiedFiles + uploadableCount > maxFiles) {
        setSelectionError(
          occupiedFiles >= maxFiles
            ? `最多只能上传 ${maxFiles} 个文件，请移除文件或等待当前上传完成`
            : `本次最多还能选择 ${maxFiles - occupiedFiles} 个文件`
        );
        return;
      }

      reservedFilesRef.current += uploadableCount;
      setUploadingFiles((current) => [...current, ...batchStates]);

      const uploadResultsPromise = Promise.all(
        batchStates.map(async (fileState): Promise<FileUploadState> => {
          if (fileState.status === 'error') return fileState;

          updateUploadState(fileState.id, (current) => ({
            ...current,
            status: 'uploading',
            progress: 30,
          }));

          const progressTimer = setInterval(() => {
            updateUploadState(fileState.id, (current) =>
              current.status === 'uploading' && current.progress < 90
                ? { ...current, progress: current.progress + 20 }
                : current
            );
          }, 200);
          progressTimersRef.current.add(progressTimer);

          const result = await uploadSingleFile(fileState.file);
          clearInterval(progressTimer);
          progressTimersRef.current.delete(progressTimer);

          const completed: FileUploadState = result
            ? { ...fileState, status: 'success', progress: 100, result }
            : { ...fileState, status: 'error', progress: 0, error: '上传失败' };
          updateUploadState(fileState.id, () => completed);
          return completed;
        })
      );

      const commitBatch = async () => {
        const results = await uploadResultsPromise;
        const successfulFiles = results.flatMap((result) =>
          result.status === 'success' && result.result ? [result.result] : []
        );
        reservedFilesRef.current = Math.max(0, reservedFilesRef.current - uploadableCount);
        if (!mountedRef.current || successfulFiles.length === 0) return;

        // onChange 可能尚未驱动父组件重渲染；先原子推进 latest ref，后续并发批次
        // 必须基于这份最新提交值合并，不能继续捕获选择时的 value 快照。
        const nextValue = [...latestValueRef.current, ...successfulFiles];
        latestValueRef.current = nextValue;
        onChangeRef.current?.(nextValue);
      };
      const queuedCommit = commitQueueRef.current.then(commitBatch, commitBatch);
      commitQueueRef.current = queuedCommit;
      await uploadResultsPromise;
      await queuedCommit;

      if (!mountedRef.current) return;
      const batchStateIds = new Set(batchStates.map((state) => state.id));
      const cleanupTimer = setTimeout(() => {
        cleanupTimersRef.current.delete(cleanupTimer);
        if (!mountedRef.current) return;
        setUploadingFiles((current) =>
          current.filter((fileState) => !batchStateIds.has(fileState.id))
        );
      }, 2000);
      cleanupTimersRef.current.add(cleanupTimer);
    },
    [maxFiles, maxSize, updateUploadState, uploadSingleFile]
  );

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      if (disabled) return;
      if (latestValueRef.current.length + reservedFilesRef.current >= maxFiles) {
        setSelectionError(`最多只能上传 ${maxFiles} 个文件，请先移除文件`);
        return;
      }

      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        handleFilesSelect(files);
      }
    },
    [disabled, handleFilesSelect, maxFiles]
  );

  const handleClick = () => {
    if (disabled) return;
    if (latestValueRef.current.length + reservedFilesRef.current >= maxFiles) {
      setSelectionError(`最多只能上传 ${maxFiles} 个文件，请先移除文件`);
      return;
    }
    fileInputRef.current?.click();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFilesSelect(files);
    }
    e.target.value = '';
  };

  const handleRemoveFile = (indexToRemove: number) => {
    const nextValue = value.filter((_, index) => index !== indexToRemove);
    latestValueRef.current = nextValue;
    onChangeRef.current?.(nextValue);
    setSelectionError(null);
  };

  const isImage = (mimeType?: string) => mimeType?.startsWith('image/') ?? false;

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const uploadErrors = uploadingFiles
    .filter((fileState) => fileState.status === 'error' && fileState.error)
    .map((fileState) => `${fileState.file.name}：${fileState.error}`);
  const errorSummary = selectionError || uploadErrors.join('；');
  const describedBy = [
    helpId,
    selectionError ? errorId : null,
    uploadErrors.length ? uploadErrorId : null,
  ]
    .filter(Boolean)
    .join(' ');
  const activeUploadCount = uploadingFiles.filter(
    (fileState) => fileState.status === 'pending' || fileState.status === 'uploading'
  ).length;
  const atCapacity = value.length + activeUploadCount >= maxFiles;

  return (
    <div className="space-y-3" data-testid={testId}>
      {readOnly && value.length === 0 && (
        <span className="text-sm text-muted-foreground">无附件</span>
      )}
      {value.length > 0 && (
        <div className="space-y-2" data-testid={`${testId}-file-list`}>
          {value.map((file, index) => (
            <div
              key={file.id || index}
              className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 p-2"
              data-testid={`${testId}-file-${file.id || index}`}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded bg-background">
                {isImage(file.mimeType) && file.downloadUrl ? (
                  <button
                    type="button"
                    className="h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`预览 ${file.name}`}
                    onClick={() => setPreviewFile(file)}
                  >
                    <AuthenticatedImage
                      file={file}
                      className="h-full w-full cursor-pointer object-cover transition-opacity hover:opacity-80"
                    />
                  </button>
                ) : (
                  <FileIcon className="h-5 w-5 text-muted-foreground" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p
                  className="truncate text-sm font-medium"
                  data-testid={`${testId}-filename-${file.id || index}`}
                >
                  {file.name}
                </p>
                <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
              </div>

              {!readOnly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemoveFile(index)}
                  disabled={disabled}
                  aria-label={`移除 ${file.name}`}
                  data-testid={`${testId}-remove-${file.id || index}`}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {selectionError && (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {selectionError}
        </p>
      )}

      {uploadingFiles.length > 0 && (
        <div
          id={uploadErrors.length > 0 ? uploadErrorId : undefined}
          className="space-y-2"
          role={uploadErrors.length > 0 ? 'alert' : 'status'}
          aria-live="polite"
          data-testid={`${testId}-uploading-list`}
        >
          {uploadingFiles.map((fileState, index) => (
            <div
              key={fileState.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-2"
              data-testid={`${testId}-uploading-${index}`}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-background">
                {fileState.status === 'uploading' ? (
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                ) : fileState.status === 'success' ? (
                  <CheckCircle className="h-5 w-5 text-green-500" />
                ) : fileState.status === 'error' ? (
                  <X className="h-5 w-5 text-destructive" />
                ) : (
                  <FileIcon className="h-5 w-5 text-muted-foreground" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{fileState.file.name}</p>
                {fileState.status === 'uploading' && (
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary transition-all duration-300"
                      style={{ width: `${fileState.progress}%` }}
                      data-testid={`${testId}-progress-${index}`}
                    />
                  </div>
                )}
                {fileState.status === 'error' && (
                  <p className="text-xs text-destructive">{fileState.error}</p>
                )}
                {fileState.status === 'success' && (
                  <p className="text-xs text-green-600">上传成功</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!readOnly && (
        <div
          className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-4 transition-colors ${dragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
          data-testid={`${testId}-dropzone`}
        >
          <input
            ref={fileInputRef}
            id={inputId}
            type="file"
            accept={accept}
            multiple
            onChange={handleInputChange}
            className="hidden"
            disabled={disabled || atCapacity}
            aria-labelledby={triggerId}
            aria-describedby={describedBy}
            aria-invalid={Boolean(errorSummary)}
            data-testid={`${testId}-input`}
          />

          <button
            id={triggerId}
            type="button"
            className="flex flex-col items-center rounded-md px-3 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            onClick={handleClick}
            disabled={disabled || atCapacity}
            aria-controls={inputId}
            aria-describedby={describedBy}
            aria-invalid={Boolean(errorSummary)}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
              <Upload className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            </span>
            <span className="mt-2 text-sm text-muted-foreground">
              <span className="font-medium text-primary">点击上传</span> 或拖拽文件到此处
            </span>
          </button>
          <p id={helpId} className="text-center text-xs text-muted-foreground">
            支持多文件上传，最多 {maxFiles} 个，单个文件最大 {maxSize}MB
            <br />
            已上传 {value.length}/{maxFiles} 个文件
            {activeUploadCount > 0 ? `，上传中 ${activeUploadCount} 个` : ''}
          </p>
          {atCapacity && (
            <p role="status" className="mt-1 text-center text-xs text-muted-foreground">
              已达到最多 {maxFiles} 个文件，请移除文件或等待上传完成后再选择。
            </p>
          )}
        </div>
      )}
      <Dialog open={!!previewFile} onOpenChange={(open) => !open && setPreviewFile(null)}>
        <DialogContent className="w-full max-w-3xl overflow-hidden border-none bg-transparent p-0 shadow-none">
          <DialogTitle className="sr-only">图片预览</DialogTitle>
          <DialogDescription className="sr-only">预览上传的图片大图</DialogDescription>
          {previewFile && (
            <div className="pointer-events-auto relative flex flex-col items-center justify-center">
              <AuthenticatedImage
                file={previewFile}
                className="max-h-[80vh] w-auto rounded-md shadow-2xl"
              />
              <div className="mt-4 flex gap-4">
                <Button
                  onClick={(e) => handleDownload(e, previewFile.downloadUrl, previewFile.name)}
                >
                  <Download className="mr-2 h-4 w-4" /> 下载原图
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
