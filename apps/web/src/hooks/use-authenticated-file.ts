import { useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { logger } from '@/lib/logger';

export function toAuthenticatedFileEndpoint(downloadUrl: string): string {
  const marker = '/api/v1/';
  const markerIndex = downloadUrl.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error('Invalid authenticated file URL');
  }
  const endpoint = downloadUrl.slice(markerIndex + marker.length);
  if (!/^upload\/file\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(endpoint)) {
    throw new Error('Invalid authenticated file URL');
  }
  return endpoint;
}

async function fetchAuthenticatedFile(downloadUrl: string): Promise<Blob> {
  const response = await api.get<Blob>(toAuthenticatedFileEndpoint(downloadUrl), {
    responseType: 'blob',
  });
  return response.data;
}

export function useAuthenticatedFileUrl(downloadUrl: string | undefined): string | undefined {
  const [objectUrl, setObjectUrl] = useState<string>();

  useEffect(() => {
    if (!downloadUrl) {
      setObjectUrl(undefined);
      return;
    }

    let active = true;
    let createdUrl: string | undefined;
    setObjectUrl(undefined);
    void fetchAuthenticatedFile(downloadUrl)
      .then((blob) => {
        if (!active) return;
        createdUrl = URL.createObjectURL(blob);
        setObjectUrl(createdUrl);
      })
      .catch((error: unknown) => {
        if (!active) return;
        logger.error('AuthenticatedFile', 'Preview failed:', error);
        setObjectUrl(undefined);
      });

    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [downloadUrl]);

  return objectUrl;
}

export async function downloadAuthenticatedFile(
  downloadUrl: string | undefined,
  filename: string
): Promise<void> {
  if (!downloadUrl) {
    throw new Error('Download URL is unavailable');
  }

  const objectUrl = URL.createObjectURL(await fetchAuthenticatedFile(downloadUrl));
  try {
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
