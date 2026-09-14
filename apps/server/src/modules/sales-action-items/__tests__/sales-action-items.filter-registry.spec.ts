import { serializeFilterRegistry } from '../../../common/filter-scheme';
import { SALES_ACTION_ITEMS_FILTER_REGISTRY } from '../sales-action-items.filter-registry';

describe('SALES_ACTION_ITEMS_FILTER_REGISTRY', () => {
  it('should expose serializable metadata for the page', () => {
    const meta = serializeFilterRegistry(SALES_ACTION_ITEMS_FILTER_REGISTRY);

    expect(meta.pageKey).toBe('crm.sales_action_items');
    expect(meta.defaults.keyword).toEqual(
      expect.objectContaining({
        enabled: true,
        fieldKeys: ['title', 'reason'],
      })
    );
    expect(meta.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldKey: 'employeeId',
          entity: 'employee',
          isScopeField: true,
        }),
        expect.objectContaining({
          fieldKey: 'status',
          options: expect.arrayContaining([expect.objectContaining({ value: 'pending' })]),
        }),
      ])
    );
  });

  it('should build enum and exact string filters defensively', () => {
    const { status, sourceRunId } = SALES_ACTION_ITEMS_FILTER_REGISTRY.fields;

    expect(status.build(['pending', 'ghost'])).toEqual({ status: { in: ['pending'] } });
    expect(status.build(['ghost'])).toBeNull();
    expect(sourceRunId.build(' nightly-20260608 ')).toEqual({
      sourceRunId: 'nightly-20260608',
    });
    expect(sourceRunId.build(['nightly-20260608'])).toBeNull();
  });

  it('should build employee and customer filters', () => {
    const { employeeId, customerId } = SALES_ACTION_ITEMS_FILTER_REGISTRY.fields;

    expect(employeeId.build(['emp-1', 123] as never)).toEqual({
      employeeId: { in: ['emp-1'] },
    });
    expect(employeeId.build([])).toBeNull();
    expect(customerId.build(['cust-1', 'cust-2'])).toEqual({
      OR: [
        { refType: 'Customer', refId: { in: ['cust-1', 'cust-2'] } },
        { aiDraft: { path: ['matchedCustomerId'], equals: 'cust-1' } },
        { aiDraft: { path: ['payload', 'customerId'], equals: 'cust-1' } },
        { aiDraft: { path: ['matchedCustomerId'], equals: 'cust-2' } },
        { aiDraft: { path: ['payload', 'customerId'], equals: 'cust-2' } },
      ],
    });
  });
});
