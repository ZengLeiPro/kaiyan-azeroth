import { serializeFilterRegistry } from '../../../common/filter-scheme';
import {
  FINANCE_LEDGER_FILTER_REGISTRY,
  FINANCE_PERSONAL_LEDGER_FILTER_REGISTRY,
  FINANCE_PNL_FILTER_REGISTRY,
} from '../finance.filter-registry';

describe('finance filter registries', () => {
  it('为三个真实列表视图暴露独立 pageKey 和默认字段', () => {
    const company = serializeFilterRegistry(FINANCE_LEDGER_FILTER_REGISTRY);
    const personal = serializeFilterRegistry(FINANCE_PERSONAL_LEDGER_FILTER_REGISTRY);
    const pnl = serializeFilterRegistry(FINANCE_PNL_FILTER_REGISTRY);

    expect([company.pageKey, personal.pageKey, pnl.pageKey]).toEqual([
      'finance.ledger',
      'finance.personal_ledger',
      'finance.pnl',
    ]);
    expect(new Set([company.pageKey, personal.pageKey, pnl.pageKey]).size).toBe(3);
    expect(company.defaults.fields.map((field) => field.fieldKey)).toEqual([
      'txDate',
      'accountId',
      'subjectId',
      'category',
      'direction',
      'source',
    ]);
    expect(personal.defaults).toEqual(company.defaults);
    expect(pnl.defaults.fields).toEqual([{ fieldKey: 'year', control: 'text' }]);
  });

  it('保留流水枚举白名单和日期查询构造语义', () => {
    expect(FINANCE_LEDGER_FILTER_REGISTRY.fields.direction.build('in')).toEqual({
      direction: { in: ['in'] },
    });
    expect(FINANCE_LEDGER_FILTER_REGISTRY.fields.direction.build('invalid')).toBeNull();
    expect(
      FINANCE_LEDGER_FILTER_REGISTRY.fields.txDate.build({
        from: '2026-01-01',
        to: '2026-01-31',
      })
    ).toEqual({
      txDate: {
        gte: new Date('2025-12-31T16:00:00.000Z'),
        lt: new Date('2026-01-31T16:00:00.000Z'),
      },
    });
  });
});
