import { describe, expect, it } from 'vitest';

import {
  batchPayrollDeleteSchema,
  createPayrollSchema,
  payrollPeriodKeySchema,
  queryPayrollSchema,
  updatePayrollSchema,
} from '../payroll';

const validPayroll = {
  periodKey: '2026-04',
  employeeNameSnapshot: '张三',
};

describe('payroll period contract', () => {
  it('accepts canonical YYYY-MM periods', () => {
    expect(payrollPeriodKeySchema.safeParse('2026-01').success).toBe(true);
    expect(payrollPeriodKeySchema.safeParse('2026-12').success).toBe(true);
    expect(createPayrollSchema.safeParse(validPayroll).success).toBe(true);
  });

  it.each(['2026-00', '2026-13', '2026-99'])('rejects invalid month %s', (periodKey) => {
    expect(createPayrollSchema.safeParse({ ...validPayroll, periodKey }).success).toBe(false);
    expect(queryPayrollSchema.safeParse({ periodKey }).success).toBe(false);
  });

  it.each(['2026-1', '26-01', ' 2026-01 '])('rejects non-canonical period %s', (periodKey) => {
    expect(payrollPeriodKeySchema.safeParse(periodKey).success).toBe(false);
  });
});

describe('payroll optimistic lock contract', () => {
  it('requires a positive integer version on update', () => {
    expect(updatePayrollSchema.safeParse({ grossBaseSalary: 100 }).success).toBe(false);
    expect(updatePayrollSchema.safeParse({ version: 0 }).success).toBe(false);
    expect(updatePayrollSchema.safeParse({ version: -1 }).success).toBe(false);
    expect(updatePayrollSchema.safeParse({ version: 1.5 }).success).toBe(false);
    expect(updatePayrollSchema.safeParse({ version: 1, grossBaseSalary: 100 }).success).toBe(true);
  });
});

const PAYROLL_ID_1 = '11111111-1111-4111-8111-111111111111';
const PAYROLL_ID_2 = '22222222-2222-4222-8222-222222222222';
const PAYROLL_ID_3 = '33333333-3333-4333-8333-333333333333';

describe('payroll versioned batch delete contract', () => {
  const validSelection = {
    ids: [PAYROLL_ID_1, PAYROLL_ID_2],
    versions: { [PAYROLL_ID_1]: 1, [PAYROLL_ID_2]: 7 },
  };

  it('accepts unique ids with an exact positive-integer version map', () => {
    expect(batchPayrollDeleteSchema.safeParse(validSelection).success).toBe(true);
  });

  it('rejects missing versions and missing or extra version keys', () => {
    expect(batchPayrollDeleteSchema.safeParse({ ids: validSelection.ids }).success).toBe(false);
    expect(
      batchPayrollDeleteSchema.safeParse({ ...validSelection, versions: { [PAYROLL_ID_1]: 1 } })
        .success
    ).toBe(false);
    expect(
      batchPayrollDeleteSchema.safeParse({
        ...validSelection,
        versions: { ...validSelection.versions, [PAYROLL_ID_3]: 2 },
      }).success
    ).toBe(false);
  });

  it('rejects duplicate ids and unknown top-level fields', () => {
    expect(
      batchPayrollDeleteSchema.safeParse({
        ids: [PAYROLL_ID_1, PAYROLL_ID_1],
        versions: { [PAYROLL_ID_1]: 1 },
      }).success
    ).toBe(false);
    expect(
      batchPayrollDeleteSchema.safeParse({ ...validSelection, unexpected: true }).success
    ).toBe(false);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1', null])(
    'rejects invalid row version %s',
    (version) => {
      expect(
        batchPayrollDeleteSchema.safeParse({
          ...validSelection,
          versions: { [PAYROLL_ID_1]: version, [PAYROLL_ID_2]: 7 },
        }).success
      ).toBe(false);
    }
  );
});
