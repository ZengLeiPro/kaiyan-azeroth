import { serializeFilterRegistry } from '../../../common/filter-scheme';
import { DINGTALK_CALENDAR_EVENT_FILTER_REGISTRY } from '../dingtalk-calendar-events.filter-registry';

describe('DINGTALK_CALENDAR_EVENT_FILTER_REGISTRY', () => {
  it('exposes the existing keyword filter as personalizable metadata', () => {
    const meta = serializeFilterRegistry(DINGTALK_CALENDAR_EVENT_FILTER_REGISTRY);

    expect(meta.pageKey).toBe('reports.calendar_events');
    expect(meta.defaults.fields).toEqual([]);
    expect(meta.defaults.keyword).toEqual({
      enabled: true,
      fieldKeys: ['title'],
      placeholder: '标题/创建者/地点',
    });
    expect(meta.fields).toEqual([
      expect.objectContaining({
        fieldKey: 'title',
        searchable: true,
        allowedControls: ['text'],
      }),
    ]);
  });

  it('builds the title filter defensively', () => {
    const { title } = DINGTALK_CALENDAR_EVENT_FILTER_REGISTRY.fields;

    expect(title.build('周会')).toEqual({
      title: { contains: '周会', mode: 'insensitive' },
    });
    expect(title.build([])).toBeNull();
  });
});
