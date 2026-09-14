import { Loader2, MapPin } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { type GeolocationPosition, useGeolocationOnDemand } from '@/hooks/use-geolocation';

interface GeolocationButtonProps {
  /** 定位成功后的回调，接收坐标信息 */
  onLocationDetected: (coords: GeolocationPosition) => void;
  /** 是否禁用按钮 */
  disabled?: boolean;
  /** 按钮尺寸 */
  size?: 'default' | 'sm' | 'icon';
  /** 额外的 className */
  className?: string;
}

/**
 * 地理定位按钮组件
 * 点击后获取当前地理位置，并通过回调返回坐标信息
 */
export function GeolocationButton({
  onLocationDetected,
  disabled = false,
  size = 'icon',
  className,
}: GeolocationButtonProps) {
  const { loading, error, position, getLocation } = useGeolocationOnDemand({
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 0,
  });

  // 使用 ref 跟踪上次回调的位置，避免重复回调
  const lastPositionRef = useRef<GeolocationPosition | null>(null);

  useEffect(() => {
    if (position && position !== lastPositionRef.current) {
      lastPositionRef.current = position;
      onLocationDetected(position);
      toast.success(`定位成功（精度: ${Math.round(position.accuracy)}米）`);
    }
  }, [position, onLocationDetected]);

  useEffect(() => {
    if (error) {
      toast.error(`定位失败: ${error}`);
    }
  }, [error]);

  const handleClick = useCallback(() => {
    lastPositionRef.current = null;
    getLocation();
  }, [getLocation]);

  return (
    <Button
      type="button"
      size={size}
      variant="outline"
      onClick={handleClick}
      disabled={disabled || loading}
      title="获取当前地理位置"
      className={className}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
    </Button>
  );
}
