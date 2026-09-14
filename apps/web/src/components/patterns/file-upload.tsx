import type { IAttachment } from '@ky-azeroth/shared/types/common';
import { CheckCircle, Download, FileIcon, Loader2, Upload, X } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

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

interface UploadProgress {
  status: 'idle' | 'uploading' | 'success' | 'error';
  progress: number;
  message?: string;
}

interface FileUploadProps {
  value?: UploadedFile | null;
  onChange?: (file: UploadedFile | null) => void;
  onUpload: (file: File) => Promise<UploadResult>;
  accept?: string;
  maxSize?: number;
  disabled?: boolean;
  'data-testid'?: string;
}

export function FileUpload({
  value,
  onChange,
  onUpload,
  accept = 'image/*,.pdf,.doc,.docx,.xls,.xlsx',
  maxSize = 10,
  disabled = false,
  'data-testid': testId = 'file-upload',
}: FileUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>({
    status: 'idle',
    progress: 0,
  });
  const authenticatedPreviewUrl = useAuthenticatedFileUrl(
    value?.mimeType?.startsWith('image/') ? value.downloadUrl : undefined
  );

  const handleFileSelect = useCallback(
    async (file: File) => {
      if (file.size > maxSize * 1024 * 1024) {
        setUploadProgress({
          status: 'error',
          progress: 0,
          message: `文件大小不能超过 ${maxSize}MB`,
        });
        return;
      }

      setUploadProgress({ status: 'uploading', progress: 0 });

      try {
        const progressInterval = setInterval(() => {
          setUploadProgress((prev) => {
            if (prev.progress >= 90) {
              clearInterval(progressInterval);
              return prev;
            }
            return { ...prev, progress: prev.progress + 10 };
          });
        }, 100);

        const result = await onUpload(file);

        clearInterval(progressInterval);

        setUploadProgress({ status: 'success', progress: 100 });

        const uploadedFile: UploadedFile = {
          id: result.id || Date.now().toString(),
          name: file.name,
          url: result.url,
          downloadUrl: result.downloadUrl,
          size: file.size,
          mimeType: file.type,
        };

        onChange?.(uploadedFile);

        setTimeout(() => {
          setUploadProgress({ status: 'idle', progress: 0 });
        }, 2000);
      } catch {
        setUploadProgress({
          status: 'error',
          progress: 0,
          message: '上传失败，请重试',
        });
      }
    },
    [maxSize, onChange, onUpload]
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

      const files = e.dataTransfer.files;
      if (files && files.length > 0 && files[0]) {
        handleFileSelect(files[0]);
      }
    },
    [disabled, handleFileSelect]
  );

  const handleClick = () => {
    if (!disabled) {
      fileInputRef.current?.click();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0 && files[0]) {
      handleFileSelect(files[0]);
    }
    e.target.value = '';
  };

  const handleRemove = () => {
    onChange?.(null);
    setUploadProgress({ status: 'idle', progress: 0 });
  };

  const handleDownload = async (
    e: React.MouseEvent,
    downloadUrl: string | undefined,
    filename: string
  ): Promise<void> => {
    e.stopPropagation();
    try {
      await downloadAuthenticatedFile(downloadUrl, filename);
    } catch (error) {
      logger.error('FileUpload', 'Download failed:', error);
    }
  };

  const isImage = (mimeType: string | undefined) => {
    if (!mimeType || typeof mimeType !== 'string') return false;
    return mimeType.startsWith('image/');
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div className="space-y-2" data-testid={testId}>
      {value && uploadProgress.status !== 'uploading' && (
        <div
          className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 p-3"
          data-testid={`${testId}-preview`}
        >
          <div className="group relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-background">
            {isImage(value.mimeType) && authenticatedPreviewUrl ? (
              <>
                <img
                  src={authenticatedPreviewUrl}
                  alt={value.name}
                  className="h-full w-full cursor-pointer object-cover transition-opacity hover:opacity-80"
                  data-testid={`${testId}-image-preview`}
                  onClick={() => setIsPreviewOpen(true)}
                />
                <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
                  <DialogContent className="w-full max-w-3xl overflow-hidden border-none bg-transparent p-0 shadow-none">
                    <DialogTitle className="sr-only">图片预览</DialogTitle>
                    <DialogDescription className="sr-only">预览上传的图片大图</DialogDescription>
                    <div className="pointer-events-auto relative flex flex-col items-center justify-center">
                      <img
                        src={authenticatedPreviewUrl}
                        alt={value.name}
                        className="max-h-[80vh] w-auto rounded-md shadow-2xl"
                      />
                      <div className="mt-4 flex gap-4">
                        <Button onClick={(e) => handleDownload(e, value.downloadUrl, value.name)}>
                          <Download className="mr-2 h-4 w-4" /> 下载原图
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </>
            ) : (
              <FileIcon className="h-6 w-6 text-muted-foreground" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium" data-testid={`${testId}-filename`}>
              {value.name}
            </p>
            <p className="text-xs text-muted-foreground">{formatFileSize(value.size)}</p>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleRemove}
            disabled={disabled}
            data-testid={`${testId}-remove-btn`}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {!value && (
        <div
          className={`relative flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors ${dragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
          onClick={handleClick}
          data-testid={`${testId}-dropzone`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={accept}
            onChange={handleInputChange}
            className="hidden"
            disabled={disabled}
            data-testid={`${testId}-input`}
          />

          {uploadProgress.status === 'uploading' ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">正在上传...</p>
              <div className="h-2 w-40 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${uploadProgress.progress}%` }}
                  data-testid={`${testId}-progress`}
                />
              </div>
              <p className="text-xs text-muted-foreground" data-testid={`${testId}-progress-text`}>
                {uploadProgress.progress}%
              </p>
            </div>
          ) : uploadProgress.status === 'success' ? (
            <div className="flex flex-col items-center gap-2">
              <CheckCircle className="h-8 w-8 text-primary" />
              <p className="text-sm text-primary">上传成功</p>
            </div>
          ) : uploadProgress.status === 'error' ? (
            <div className="flex flex-col items-center gap-2">
              <X className="h-8 w-8 text-destructive" />
              <p className="text-sm text-destructive">{uploadProgress.message}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={(e) => e.stopPropagation()}
              >
                重试
              </Button>
            </div>
          ) : (
            <>
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Upload className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                <span className="font-medium text-primary">点击上传</span> 或拖拽文件到此处
              </p>
              <p className="text-xs text-muted-foreground">
                支持 {accept.split(',').join('、')} 格式，最大 {maxSize}MB
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
