import type { XiaohongshuDataCaliber } from '@ky-azeroth/shared/types';
import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import type { AnalyticsRangeValue } from '@/pages/analytics/components/AnalyticsDateRangePicker';

import { useXiaohongshuAdvertisers } from '../hooks/use-xiaohongshu-analytics-data';

const RANGE_PRESETS = new Set<AnalyticsRangeValue['preset']>([
  'mtd',
  'last30d',
  'qtd',
  'ytd',
  'custom',
]);

interface XiaohongshuCenterContextValue {
  range: AnalyticsRangeValue;
  setRange: (value: AnalyticsRangeValue) => void;
  advertiserId: string;
  setAdvertiserId: (value: string) => void;
  dataCaliber: XiaohongshuDataCaliber;
  setDataCaliber: (value: XiaohongshuDataCaliber) => void;
  advertisers: ReturnType<typeof useXiaohongshuAdvertisers>;
}

const XiaohongshuCenterContext = createContext<XiaohongshuCenterContextValue | null>(null);

export function XiaohongshuCenterProvider({ children }: { children: React.ReactNode }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const advertisers = useXiaohongshuAdvertisers();
  const presetValue = searchParams.get('range') as AnalyticsRangeValue['preset'] | null;
  const preset = presetValue && RANGE_PRESETS.has(presetValue) ? presetValue : 'last30d';
  const range = useMemo<AnalyticsRangeValue>(
    () =>
      preset === 'custom'
        ? {
            preset,
            startDate: searchParams.get('start') ?? undefined,
            endDate: searchParams.get('end') ?? undefined,
          }
        : { preset },
    [preset, searchParams]
  );
  const advertiserId = searchParams.get('advertiser') ?? '';
  const dataCaliber: XiaohongshuDataCaliber = searchParams.get('caliber') === '1' ? 1 : 0;

  const update = useCallback(
    (values: Record<string, string | null>) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(values)) {
            if (value) next.set(key, value);
            else next.delete(key);
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  useEffect(() => {
    if (advertisers.isLoading || !advertisers.data) return;
    const isValid = advertisers.data.some((item) => item.advertiserId === advertiserId);
    if (!isValid) update({ advertiser: advertisers.data[0]?.advertiserId ?? null });
  }, [advertiserId, advertisers.data, advertisers.isLoading, update]);

  const value = useMemo<XiaohongshuCenterContextValue>(
    () => ({
      range,
      setRange: (next) =>
        update({
          range: next.preset,
          start: next.preset === 'custom' ? (next.startDate ?? null) : null,
          end: next.preset === 'custom' ? (next.endDate ?? null) : null,
        }),
      advertiserId,
      setAdvertiserId: (next) => update({ advertiser: next }),
      dataCaliber,
      setDataCaliber: (next) => update({ caliber: String(next) }),
      advertisers,
    }),
    [range, advertiserId, dataCaliber, advertisers, update]
  );

  return (
    <XiaohongshuCenterContext.Provider value={value}>{children}</XiaohongshuCenterContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- Provider 与配套 hook 必须共享私有 Context。
export function useXiaohongshuCenter() {
  const value = useContext(XiaohongshuCenterContext);
  if (!value) throw new Error('useXiaohongshuCenter 必须在 XiaohongshuCenterProvider 内使用');
  return value;
}
