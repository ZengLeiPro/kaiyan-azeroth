import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useXiaohongshuCenter, XiaohongshuCenterProvider } from './xiaohongshu-center-context';

const analytics = vi.hoisted(() => ({ useXiaohongshuAdvertisers: vi.fn() }));
vi.mock('../hooks/use-xiaohongshu-analytics-data', () => analytics);

function Probe() {
  const value = useXiaohongshuCenter();
  const location = useLocation();
  return (
    <div>
      <span data-testid="state">
        {value.range.preset}|{value.range.startDate}|{value.range.endDate}|{value.advertiserId}|
        {value.dataCaliber}
      </span>
      <span data-testid="search">{location.search}</span>
      <button type="button" onClick={() => value.setAdvertiserId('adv-2')}>
        换广告主
      </button>
      <button type="button" onClick={() => value.setDataCaliber(1)}>
        换口径
      </button>
      <button
        type="button"
        onClick={() =>
          value.setRange({ preset: 'custom', startDate: '2026-08-10', endDate: '2026-08-20' })
        }
      >
        换日期
      </button>
    </div>
  );
}

describe('XiaohongshuCenterProvider', () => {
  beforeEach(() => {
    analytics.useXiaohongshuAdvertisers.mockReturnValue({
      data: [
        { advertiserId: 'adv-1', advertiserName: '品牌一' },
        { advertiserId: 'adv-2', advertiserName: '品牌二' },
      ],
      isLoading: false,
    });
  });

  it('从 URL 恢复全局筛选，并把跨页面修改原子写回 URL', async () => {
    render(
      <MemoryRouter
        initialEntries={[
          '/analytics/xiaohongshu/data?range=custom&start=2026-08-01&end=2026-08-08&advertiser=adv-1',
        ]}
      >
        <XiaohongshuCenterProvider>
          <Probe />
        </XiaohongshuCenterProvider>
      </MemoryRouter>
    );

    expect(screen.getByTestId('state').textContent).toBe('custom|2026-08-01|2026-08-08|adv-1|0');
    fireEvent.click(screen.getByText('换广告主'));
    fireEvent.click(screen.getByText('换口径'));
    fireEvent.click(screen.getByText('换日期'));

    await waitFor(() => {
      expect(screen.getByTestId('state').textContent).toBe('custom|2026-08-10|2026-08-20|adv-2|1');
    });
    expect(screen.getByTestId('search').textContent).toContain('advertiser=adv-2');
    expect(screen.getByTestId('search').textContent).toContain('caliber=1');
  });

  it('URL 未指定广告主时自动选择第一个授权账户', async () => {
    render(
      <MemoryRouter initialEntries={['/analytics/xiaohongshu/overview']}>
        <XiaohongshuCenterProvider>
          <Probe />
        </XiaohongshuCenterProvider>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByTestId('state').textContent).toContain('|adv-1|0'));
  });
});
