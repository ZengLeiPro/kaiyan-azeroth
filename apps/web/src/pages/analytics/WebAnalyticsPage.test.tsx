import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import WebAnalyticsPage from './WebAnalyticsPage';

const analyticsHooks = vi.hoisted(() => ({
  useWebAnalyticsAttribution: vi.fn(),
  useWebAnalyticsBreakdown: vi.fn(),
  useWebAnalyticsCampaignConversion: vi.fn(),
  useWebAnalyticsContent: vi.fn(),
  useWebAnalyticsEngineLandingMatrix: vi.fn(),
  useWebAnalyticsEvents: vi.fn(),
  useWebAnalyticsFilterOptions: vi.fn(),
  useWebAnalyticsFunnel: vi.fn(),
  useWebAnalyticsLandingPages: vi.fn(),
  useWebAnalyticsLeadRadar: vi.fn(),
  useWebAnalyticsSearchKeywords: vi.fn(),
  useWebAnalyticsSummary: vi.fn(),
  useWebAnalyticsTrend: vi.fn(),
  useWebAnalyticsVisitorType: vi.fn(),
}));

vi.mock('./hooks/use-web-analytics-data', () => analyticsHooks);

const emptyQuery = { data: undefined, isLoading: false };

describe('WebAnalyticsPage section query isolation', () => {
  beforeEach(() => {
    for (const hook of Object.values(analyticsHooks)) {
      hook.mockReset();
      hook.mockReturnValue(emptyQuery);
    }
  });

  it('切 section 时只订阅当前分区 query，不触发无关请求', async () => {
    render(<WebAnalyticsPage />);

    expect(analyticsHooks.useWebAnalyticsSummary).toHaveBeenCalledTimes(1);
    expect(analyticsHooks.useWebAnalyticsTrend).toHaveBeenCalledTimes(1);
    expect(analyticsHooks.useWebAnalyticsFilterOptions).toHaveBeenCalledTimes(1);
    expect(analyticsHooks.useWebAnalyticsContent).not.toHaveBeenCalled();
    expect(analyticsHooks.useWebAnalyticsBreakdown).not.toHaveBeenCalled();
    expect(analyticsHooks.useWebAnalyticsEvents).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: '内容' }));

    await waitFor(() => {
      expect(analyticsHooks.useWebAnalyticsContent).toHaveBeenCalledTimes(1);
    });
    expect(analyticsHooks.useWebAnalyticsSummary).toHaveBeenCalledTimes(1);
    expect(analyticsHooks.useWebAnalyticsTrend).toHaveBeenCalledTimes(1);
    expect(analyticsHooks.useWebAnalyticsBreakdown).not.toHaveBeenCalled();
    expect(analyticsHooks.useWebAnalyticsEvents).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: '获客' }));

    await waitFor(() => {
      expect(analyticsHooks.useWebAnalyticsAttribution).toHaveBeenCalledTimes(1);
    });
    expect(analyticsHooks.useWebAnalyticsBreakdown).toHaveBeenCalledTimes(2);
    expect(analyticsHooks.useWebAnalyticsCampaignConversion).toHaveBeenCalledTimes(1);
    expect(analyticsHooks.useWebAnalyticsLandingPages).toHaveBeenCalledTimes(1);
    expect(analyticsHooks.useWebAnalyticsEngineLandingMatrix).toHaveBeenCalledTimes(1);
    expect(analyticsHooks.useWebAnalyticsVisitorType).toHaveBeenCalledTimes(1);
    expect(analyticsHooks.useWebAnalyticsSummary).toHaveBeenCalledTimes(1);
    expect(analyticsHooks.useWebAnalyticsContent).toHaveBeenCalledTimes(1);
    expect(analyticsHooks.useWebAnalyticsFunnel).not.toHaveBeenCalled();
    expect(analyticsHooks.useWebAnalyticsEvents).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: '转化' }));

    await waitFor(() => {
      expect(analyticsHooks.useWebAnalyticsFunnel).toHaveBeenCalledTimes(1);
    });
    expect(analyticsHooks.useWebAnalyticsSummary).toHaveBeenCalledTimes(2);
    expect(analyticsHooks.useWebAnalyticsBreakdown).toHaveBeenCalledTimes(3);
    expect(analyticsHooks.useWebAnalyticsAttribution).toHaveBeenCalledTimes(1);
    expect(analyticsHooks.useWebAnalyticsContent).toHaveBeenCalledTimes(1);
    expect(analyticsHooks.useWebAnalyticsEvents).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: '访客' }));

    await waitFor(() => {
      expect(analyticsHooks.useWebAnalyticsSearchKeywords).toHaveBeenCalledTimes(1);
    });
    expect(analyticsHooks.useWebAnalyticsLeadRadar).toHaveBeenCalledTimes(1);
    expect(analyticsHooks.useWebAnalyticsSummary).toHaveBeenCalledTimes(2);
    expect(analyticsHooks.useWebAnalyticsEvents).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: '数据健康' }));

    await waitFor(() => {
      expect(analyticsHooks.useWebAnalyticsEvents).toHaveBeenCalledTimes(1);
    });
    expect(analyticsHooks.useWebAnalyticsSummary).toHaveBeenCalledTimes(3);
    expect(analyticsHooks.useWebAnalyticsTrend).toHaveBeenCalledTimes(1);
    expect(analyticsHooks.useWebAnalyticsContent).toHaveBeenCalledTimes(1);
    expect(analyticsHooks.useWebAnalyticsBreakdown).toHaveBeenCalledTimes(3);
    expect(analyticsHooks.useWebAnalyticsAttribution).toHaveBeenCalledTimes(1);
  });
});
