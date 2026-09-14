import { serializeFilterRegistry } from '../../../common/filter-scheme';
import { NOTIFICATION_FILTER_REGISTRY } from '../notifications.filter-registry';

describe('NOTIFICATION_FILTER_REGISTRY', () => {
  it('exposes the existing notification filters in their current order', () => {
    const meta = serializeFilterRegistry(NOTIFICATION_FILTER_REGISTRY);

    expect(meta.pageKey).toBe('system.notifications');
    expect(meta.defaults.fields).toEqual([
      { fieldKey: 'type', control: 'multiSelect', width: 'w-36' },
      { fieldKey: 'readStatus', control: 'select', width: 'w-28' },
    ]);
    expect(meta.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldKey: 'type',
          allowedControls: ['multiSelect'],
          options: expect.arrayContaining([
            { value: 'system', label: '系统' },
            { value: 'approval', label: '待审批' },
          ]),
        }),
        expect.objectContaining({
          fieldKey: 'readStatus',
          allowedControls: ['select'],
          options: [
            { value: 'unread', label: '未读' },
            { value: 'read', label: '已读' },
          ],
        }),
      ])
    );
  });

  it('builds type and read-status filters defensively', () => {
    const { type, readStatus } = NOTIFICATION_FILTER_REGISTRY.fields;

    expect(type.build(['system', 'ghost'])).toEqual({ type: { in: ['system'] } });
    expect(type.build(['ghost'])).toBeNull();
    expect(readStatus.build('read')).toEqual({ isRead: true });
    expect(readStatus.build('unread')).toEqual({ isRead: false });
    expect(readStatus.build('all')).toBeNull();
  });
});
