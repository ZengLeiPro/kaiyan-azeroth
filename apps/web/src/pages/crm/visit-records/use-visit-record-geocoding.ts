import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import type { GeolocationPosition } from '@/hooks/use-geolocation';
import { reverseGeocode, wgs84ToGcj02 } from '@/lib/geocoding';
import { logger } from '@/lib/logger';

import type { VisitRecordFormData } from './types';

interface UseVisitRecordGeocodingOptions {
  dialogOpen: boolean;
  entityId: string | null;
  setFormData: React.Dispatch<React.SetStateAction<VisitRecordFormData>>;
}

interface FormSession {
  id: number;
  entityIdentity: string;
}

function getEntityIdentity(entityId: string | null): string {
  return entityId === null ? 'create' : `entity:${entityId}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * 将逆地理编码请求绑定到一次明确的表单会话。
 *
 * 弹窗开关或编辑实体变化时会创建/销毁会话并推进 generation；同一会话内的新定位也会
 * 推进 generation 并中止上一请求。异步结果只有在组件、弹窗、会话、实体及 generation
 * 全部仍与发起时一致，且用户未修改定位写入的临时值时，才允许回写表单。
 */
export function useVisitRecordGeocoding({
  dialogOpen,
  entityId,
  setFormData,
}: UseVisitRecordGeocodingOptions) {
  const [isResolvingAddress, setIsResolvingAddress] = useState(false);
  const mountedRef = useRef(true);
  const dialogOpenRef = useRef(dialogOpen);
  const entityIdentity = getEntityIdentity(entityId);
  const entityIdentityRef = useRef(entityIdentity);
  const sessionSequenceRef = useRef(0);
  const activeSessionRef = useRef<FormSession | null>(null);
  const generationRef = useRef(0);
  const activeAbortControllerRef = useRef<AbortController | null>(null);

  const invalidateGeneration = useCallback((updateResolvingState: boolean) => {
    generationRef.current += 1;
    activeAbortControllerRef.current?.abort();
    activeAbortControllerRef.current = null;
    if (updateResolvingState && mountedRef.current) {
      setIsResolvingAddress(false);
    }
  }, []);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      invalidateGeneration(false);
      activeSessionRef.current = null;
    };
  }, [invalidateGeneration]);

  useLayoutEffect(() => {
    dialogOpenRef.current = dialogOpen;
    entityIdentityRef.current = entityIdentity;
    invalidateGeneration(true);
    activeSessionRef.current = dialogOpen
      ? {
          id: sessionSequenceRef.current + 1,
          entityIdentity,
        }
      : null;
    if (dialogOpen) {
      sessionSequenceRef.current += 1;
    }
  }, [dialogOpen, entityIdentity, invalidateGeneration]);

  const handleLocationDetected = useCallback(
    (coords: GeolocationPosition) => {
      const session = activeSessionRef.current;
      if (
        !mountedRef.current ||
        !dialogOpenRef.current ||
        !session ||
        session.entityIdentity !== entityIdentityRef.current
      ) {
        return;
      }

      invalidateGeneration(false);
      const generation = generationRef.current;
      const requestEntityIdentity = entityIdentityRef.current;
      const abortController = new AbortController();
      activeAbortControllerRef.current = abortController;

      const [gcjLng, gcjLat] = wgs84ToGcj02(coords.longitude, coords.latitude);
      const location = `${gcjLng.toFixed(6)},${gcjLat.toFixed(6)}`;
      const fallbackText = `纬度 ${coords.latitude.toFixed(6)}, 经度 ${coords.longitude.toFixed(6)} (精度 ${Math.round(coords.accuracy)}米)`;

      const isRequestCurrent = () => {
        const currentSession = activeSessionRef.current;
        return (
          mountedRef.current &&
          dialogOpenRef.current &&
          generationRef.current === generation &&
          entityIdentityRef.current === requestEntityIdentity &&
          currentSession?.id === session.id &&
          currentSession.entityIdentity === requestEntityIdentity
        );
      };

      setFormData((previous) => {
        if (!isRequestCurrent()) return previous;
        return {
          ...previous,
          signAddress: fallbackText,
          signLocation: location,
        };
      });
      if (isRequestCurrent()) {
        setIsResolvingAddress(true);
      }

      void reverseGeocode({
        longitude: coords.longitude,
        latitude: coords.latitude,
        signal: abortController.signal,
      })
        .then((result) => {
          if (!isRequestCurrent()) return;
          setFormData((previous) => {
            if (
              !isRequestCurrent() ||
              previous.signAddress !== fallbackText ||
              previous.signLocation !== location
            ) {
              return previous;
            }
            return {
              ...previous,
              signAddress: result.address ?? previous.signAddress,
              signLocation: result.location,
            };
          });
        })
        .catch((error: unknown) => {
          if (!isAbortError(error) && isRequestCurrent()) {
            logger.warn('VisitRecordGeocoding', '逆地理编码失败，已保留坐标文本', error);
          }
        })
        .finally(() => {
          if (!isRequestCurrent()) return;
          activeAbortControllerRef.current = null;
          setIsResolvingAddress(false);
        });
    },
    [invalidateGeneration, setFormData]
  );

  return { isResolvingAddress, handleLocationDetected };
}
