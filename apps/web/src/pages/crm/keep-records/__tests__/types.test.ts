import {
  createKeepRecordSchema,
  updateKeepRecordSchema,
} from '@ky-azeroth/shared/schemas/keep-record';
import type { IKeepRecordResponse } from '@ky-azeroth/shared/types/keep-record';
import { describe, expect, it } from 'vitest';

import {
  keepRecordFormSchema,
  toKeepRecordFormData,
  toKeepRecordIntentFormData,
  toKeepRecordPayload,
  toKeepRecordProfile,
} from '../types';

const record: IKeepRecordResponse = {
  id: 'keep-1',
  customerId: '11111111-1111-4111-8111-111111111111',
  contactId: null,
  keepRecordType: 'phone',
  keepRecordTime: '2026-09-08T02:00:00.000Z',
  keepRecordContent: '确认演示安排',
  keepRecordStatus: '客户维护',
  chargerId: 'employee-1',
  chargerName: '负责人',
  intentTemperature: 'HIGH',
  intentReasons: ['DEMO'],
  nextFollowUpAt: '2026-09-11T00:00:00.000Z',
  attachments: null,
  flowStatus: 'approved',
  source: null,
  sourceActionItemId: null,
  createdAt: '2026-09-08T02:00:00.000Z',
  updatedAt: '2026-09-08T02:00:00.000Z',
  version: 1,
};

describe('跟进回访日期契约', () => {
  it.each(['2026-09-11', '2026-09-11T00:00:00.000Z'])(
    '回读%s后编辑表单与更新payload均可通过校验',
    (nextFollowUpAt) => {
      const form = toKeepRecordFormData(toKeepRecordProfile({ ...record, nextFollowUpAt }));
      expect(form.nextFollowUpAt).toBe('2026-09-11');
      expect(keepRecordFormSchema.safeParse(form).success).toBe(true);
      const input = document.createElement('input');
      input.type = 'date';
      input.value = form.nextFollowUpAt ?? '';
      expect(input.value).toBe('2026-09-11');
      expect(updateKeepRecordSchema.safeParse(toKeepRecordPayload(form)).success).toBe(true);
    }
  );

  it('客户详情的完整ISO经自动预填转换后可以新增跟进', () => {
    const form = {
      ...toKeepRecordFormData(toKeepRecordProfile(record)),
      ...toKeepRecordIntentFormData({
        intentTemperature: 'HIGH',
        intentReasons: ['DEMO'],
        nextFollowUpAt: record.nextFollowUpAt,
      }),
    };
    expect(form.nextFollowUpAt).toBe('2026-09-11');
    expect(keepRecordFormSchema.safeParse(form).success).toBe(true);
    expect(createKeepRecordSchema.safeParse(toKeepRecordPayload(form)).success).toBe(true);
  });

  it('未填写日期仍保留null，不把日期时间字段误截断', () => {
    const form = toKeepRecordFormData(
      toKeepRecordProfile({
        ...record,
        intentTemperature: null,
        intentReasons: null,
        nextFollowUpAt: null,
      })
    );
    expect(form.nextFollowUpAt).toBeNull();
    expect(toKeepRecordPayload(form).nextFollowUpAt).toBeNull();
    expect(toKeepRecordPayload(form).keepRecordTime).toBe(record.keepRecordTime);
  });
});
