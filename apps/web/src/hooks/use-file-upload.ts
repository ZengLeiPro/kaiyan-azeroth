import { useCallback } from 'react';

import type { UploadResult } from '@/components/patterns/file-upload';
import { api } from '@/lib/api';

interface UseFileUploadOptions {
  endpoint?: string;
}

export function useFileUpload(options: UseFileUploadOptions = {}) {
  const { endpoint = '/upload' } = options;

  const uploadFile = useCallback(
    async (file: File): Promise<UploadResult> => {
      const formData = new FormData();
      formData.append('file', file);

      const response = await api.post(endpoint, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      return {
        id: response.data.id,
        url: response.data.url,
        downloadUrl: response.data.downloadUrl,
      };
    },
    [endpoint]
  );

  return { uploadFile };
}
