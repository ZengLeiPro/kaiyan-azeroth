import { createCrmWorkDailySchema } from '@ky-azeroth/shared/schemas/crm-work-daily';
import type { ICrmWorkDailyResponse } from '@ky-azeroth/shared/types/crm-work-daily';
import { describe, expect, it } from 'vitest';

import { toCrmWorkDailyFormData, toCrmWorkDailyPayload, toCrmWorkDailyProfile } from '../types';

const daily: ICrmWorkDailyResponse = {
  id: 'daily-1',
  reportDate: '2026-09-14',
  reportType: 'telesales',
  submitStatus: '按时提交',
  senderId: 'emp-1',
  senderName: '李电销',
  keyCustomerSummary: null,
  tomorrowVisitPlan: null,
  otherPlanArrangements: null,
  coordinationItems: null,
  callsMadeCount: 20,
  callsConnectedCount: 8,
  callsOver30sCount: 3,
  totalCallMinutes: 45,
  visitCustomerCount: null,
  newCustomerCount: 1,
  newContactMethodCount: 4,
  attachments: null,
  remark: null,
  flowStatus: null,
  status: 'active',
  createdAt: '2026-09-14T02:00:00.000Z',
  updatedAt: '2026-09-14T02:00:00.000Z',
  version: 1,
};

describe('crm work daily types converters', () => {
  it('回读新增联系方式并写入创建 payload', () => {
    const profile = toCrmWorkDailyProfile(daily);
    const form = toCrmWorkDailyFormData(profile);
    const payload = toCrmWorkDailyPayload(form);

    expect(profile.newContactMethodCount).toBe(4);
    expect(form.newContactMethodCount).toBe(4);
    expect(payload.newContactMethodCount).toBe(4);
    expect(createCrmWorkDailySchema.safeParse(payload).success).toBe(true);
  });

  it('未填写新增联系方式时保持 null', () => {
    const form = toCrmWorkDailyFormData(
      toCrmWorkDailyProfile({ ...daily, newContactMethodCount: null })
    );
    expect(form.newContactMethodCount).toBeNull();
    expect(toCrmWorkDailyPayload(form).newContactMethodCount).toBeNull();
  });
});
