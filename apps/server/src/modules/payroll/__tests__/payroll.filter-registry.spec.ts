import { serializeFilterRegistry } from '../../../common/filter-scheme';
import { PAYROLL_FILTER_REGISTRY } from '../payroll.filter-registry';

describe('PAYROLL_FILTER_REGISTRY', () => {
  it('暴露稳定 pageKey、原有默认字段和关键词字段', () => {
    const meta = serializeFilterRegistry(PAYROLL_FILTER_REGISTRY);

    expect(meta.pageKey).toBe('finance.payroll');
    expect(meta.defaults.fields.map((field) => field.fieldKey)).toEqual([
      'periodKey',
      'employeeId',
      'departmentId',
      'position',
      'hasRemark',
    ]);
    expect(meta.defaults.keyword).toEqual({
      enabled: true,
      fieldKeys: ['employeeName', 'departmentName', 'bankCardNo'],
      placeholder: '员工/部门/银行卡号',
    });
  });

  it('保留期间、职位和备注筛选的既有查询语义', () => {
    expect(PAYROLL_FILTER_REGISTRY.fields.periodKey.build('2026-08')).toEqual({
      payrollPeriod: { periodKey: '2026-08' },
    });
    expect(PAYROLL_FILTER_REGISTRY.fields.position.build('研发')).toEqual({
      positionSnapshot: { contains: '研发', mode: 'insensitive' },
    });
    expect(PAYROLL_FILTER_REGISTRY.fields.hasRemark.build('true')).toEqual({
      remarkSnapshot: { not: null },
    });
    expect(PAYROLL_FILTER_REGISTRY.fields.hasRemark.build('false')).toEqual({
      remarkSnapshot: null,
    });
  });
});
