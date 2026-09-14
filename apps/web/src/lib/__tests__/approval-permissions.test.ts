import { describe, expect, it } from 'vitest';

import { canDeleteApprovalBusiness } from '../approval-permissions';

describe('canDeleteApprovalBusiness', () => {
  it('仅允许删除未进入审批或已驳回的业务单据', () => {
    expect(canDeleteApprovalBusiness(undefined)).toBe(true);
    expect(canDeleteApprovalBusiness('draft')).toBe(true);
    expect(canDeleteApprovalBusiness('rejected')).toBe(true);
    expect(canDeleteApprovalBusiness('pending')).toBe(false);
    expect(canDeleteApprovalBusiness('approved')).toBe(false);
  });
});
