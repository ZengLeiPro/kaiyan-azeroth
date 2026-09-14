import { describe, expect, it } from 'vitest';

import { buildWebAnalyticsQueryParams } from './use-web-analytics-data';

describe('buildWebAnalyticsQueryParams', () => {
  it('保持既有 API 参数 contract，并清理空筛选', () => {
    expect(
      buildWebAnalyticsQueryParams(
        {
          preset: 'custom',
          startDate: '2026-08-01',
          endDate: '2026-08-20',
        },
        {
          site: '  example.com ',
          events: ['pageview'],
          pageTypes: [],
          utmSources: ['baidu'],
          refHosts: [],
          placements: ['hero'],
          channels: ['dingtalk'],
          pathSearch: '  /blog/agent ',
          vid: '   ',
          includeBots: true,
        }
      )
    ).toEqual({
      startDate: '2026-08-01',
      endDate: '2026-08-20',
      site: 'example.com',
      events: ['pageview'],
      pageTypes: undefined,
      utmSources: ['baidu'],
      refHosts: undefined,
      placements: ['hero'],
      channels: ['dingtalk'],
      pathSearch: '/blog/agent',
      vid: undefined,
      includeBots: 'true',
    });
  });

  it('不发送 false Bot 标记与空数组', () => {
    const params = buildWebAnalyticsQueryParams(
      { preset: 'custom', startDate: '2026-08-01', endDate: '2026-08-20' },
      { includeBots: false, events: [] }
    );

    expect(params.includeBots).toBeUndefined();
    expect(params.events).toBeUndefined();
  });
});
