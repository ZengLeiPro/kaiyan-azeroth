import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { api } from '@/lib/api';

export function useHighlightNavigation<T>(
  endpoint: string,
  openViewDialog: (entity: T) => void,
  transform?: (data: unknown) => T
) {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const highlightId = params.get('highlight');
    if (highlightId) {
      api
        .get(`${endpoint}/${highlightId}`)
        .then((res) => {
          const entity = transform ? transform(res.data) : (res.data as T);
          openViewDialog(entity);
        })
        .catch(() => {
          toast.error('加载详情失败');
        });
      navigate(location.pathname, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
