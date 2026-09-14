import { useCallback, useEffect, useMemo, useState } from 'react';

export interface GeolocationPosition {
  latitude: number;
  longitude: number;
  accuracy: number;
}

interface GeolocationState {
  loading: boolean;
  error: string | null;
  position: GeolocationPosition | null;
}

/**
 * 自动获取地理位置（组件挂载时触发）
 */
export function useGeolocation(options?: PositionOptions) {
  const [state, setState] = useState<GeolocationState>({
    loading: true,
    error: null,
    position: null,
  });

  const stableOptions = useMemo(
    () => options,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options?.enableHighAccuracy, options?.maximumAge, options?.timeout]
  );

  useEffect(() => {
    if (!navigator.geolocation) {
      setState({
        loading: false,
        error: '浏览器不支持地理位置',
        position: null,
      });
      return;
    }

    const handleSuccess = (position: globalThis.GeolocationPosition) => {
      setState({
        loading: false,
        error: null,
        position: {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        },
      });
    };

    const handleError = (error: GeolocationPositionError) => {
      setState({
        loading: false,
        error: error.message,
        position: null,
      });
    };

    navigator.geolocation.getCurrentPosition(handleSuccess, handleError, stableOptions);
  }, [stableOptions]);

  return state;
}

/**
 * 按需获取地理位置（手动触发）
 * 适用于签到等场景，用户点击按钮后获取当前位置
 */
export function useGeolocationOnDemand(options?: PositionOptions) {
  const [state, setState] = useState<GeolocationState>({
    loading: false,
    error: null,
    position: null,
  });

  const getLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setState({
        loading: false,
        error: '浏览器不支持地理位置',
        position: null,
      });
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    navigator.geolocation.getCurrentPosition(
      (position: globalThis.GeolocationPosition) => {
        setState({
          loading: false,
          error: null,
          position: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          },
        });
      },
      (error: GeolocationPositionError) => {
        setState({
          loading: false,
          error: error.message,
          position: null,
        });
      },
      options
    );
  }, [options]);

  return { ...state, getLocation };
}
