import type { ICustomerResponse } from '@ky-azeroth/shared/types/customer';
import { describe, expect, it } from 'vitest';

import {
  type CustomerFormData,
  toCustomerCreatePayload,
  toCustomerFormData,
  toCustomerPayload,
  toCustomerProfile,
  toCustomerUpdatePayload,
} from '../types';

const FORBIDDEN_ORDINARY_UPDATE_FIELDS = [
  'id',
  'serialNumber',
  'aiInfoSummary',
  'aiInfoGeneratedAt',
  'chargerName',
  'collaboratorName',
  'contactStatus',
  'dealStatus',
  'leadStage',
  'leadStageUpdatedAt',
  'leadStageUpdatedById',
  'leadStageUpdatedByName',
  'leadStageQualifiedById',
  'leadStageQualifiedByName',
  'leadStageQualifiedAt',
  'firstMqlAt',
  'firstSqlAt',
  'leadProgressStatus',
  'leadAppointmentAt',
  'leadProgressReason',
  'leadProgressUpdatedAt',
  'leadProgressUpdatedById',
  'lastKeepRecordTime',
  'lastKeepRecordContent',
  'accountsReceivable',
  'flowStatus',
  'status',
  'createdAt',
  'createdBy',
  'updatedAt',
  'updatedBy',
  'deletedAt',
] as const;

const baseCustomer: ICustomerResponse = {
  id: 'cus-1',
  serialNumber: 'C0001',
  customerName: ' 示例科技 ',
  shortName: null,
  industry: 'software',
  customerLevel: null,
  customerSource: null,
  customerRelationship: null,
  customerTags: ['重点'],
  country: null,
  province: '浙江省',
  city: '杭州市',
  district: null,
  address: ' 西湖区 ',
  remark: ' 备注 ',
  aiInfoSummary: null,
  aiInfoGeneratedAt: null,
  organizationId: null,
  uncId: null,
  headcountRange: null,
  chargerId: null,
  chargerName: null,
  collaboratorName: ' 协作人 ',
  collaboratorIds: ['emp-1'],
  contactStatus: null,
  dealStatus: null,
  leadStage: 'MQL',
  leadStageUpdatedAt: null,
  leadStageUpdatedById: null,
  leadStageUpdatedByName: null,
  leadStageQualifiedById: 'emp-2',
  leadStageQualifiedByName: null,
  leadStageQualifiedAt: null,
  firstMqlAt: null,
  firstSqlAt: null,
  leadProgressStatus: 'ACTIVE',
  leadAppointmentAt: null,
  leadProgressReason: null,
  leadProgressUpdatedAt: null,
  leadProgressUpdatedById: null,
  intentTemperature: 'UNJUDGED',
  intentReasons: null,
  nextFollowUpAt: null,
  intentUpdatedAt: null,
  intentUpdatedById: null,
  intentUpdatedByName: null,
  intentSourceKeepRecordId: null,
  leadValidity: 'VALID',
  leadInvalidReason: null,
  lastKeepRecordTime: null,
  lastKeepRecordContent: null,
  accountsReceivable: 0,
  flowStatus: null,
  status: 'active',
  version: 3,
};

describe('customer types converters', () => {
  it('API 响应转 Profile 时保持强绑定字段', () => {
    expect(toCustomerProfile(baseCustomer)).toEqual(baseCustomer);
  });

  it('表单回填时清理白名单外 industry 脏值并保留 version', () => {
    const form = toCustomerFormData({ ...baseCustomer, industry: '-' });

    expect(form.industry).toBeNull();
    expect(form.leadStage).toBe('MQL');
    expect(form.leadStageQualifiedById).toBe('emp-2');
    expect(form.version).toBe(3);
  });

  it('create payload 规范化录入字段，并由兼容别名保持创建语义', () => {
    const form = {
      customerName: ' 示例科技 ',
      industry: null,
      customerLevel: '',
      customerSource: '',
      customerRelationship: '',
      customerTags: [],
      remark: ' 备注 ',
      aiInfoSummary: ' AI 摘要 ',
      country: '',
      province: '',
      city: '',
      district: '',
      address: ' 西湖区 ',
      chargerId: '',
      collaboratorName: ' 协作人 ',
      collaboratorIds: [],
      organizationId: '',
      uncId: '',
      headcountRange: '',
      leadStage: 'MQL' as const,
      leadStageQualifiedById: 'emp-2',
      version: 3,
    };
    const payload = toCustomerCreatePayload(form);

    expect(payload.customerName).toBe('示例科技');
    expect(payload.customerLevel).toBeNull();
    expect(payload.aiInfoSummary).toBe('AI 摘要');
    expect(payload.address).toBe('西湖区');
    expect(payload.collaboratorName).toBe('协作人');
    expect(payload.collaboratorIds).toBeNull();
    expect(payload.leadStage).toBe('MQL');
    expect(payload).not.toHaveProperty('version');
    expect(toCustomerPayload(form)).toEqual(payload);
  });

  it('update payload 规范化可编辑字段并保留乐观锁 version', () => {
    const payload = toCustomerUpdatePayload({
      customerName: ' 示例科技 ',
      industry: null,
      customerLevel: '',
      customerSource: '',
      customerRelationship: '',
      customerTags: [],
      remark: ' 备注 ',
      country: '',
      province: '',
      city: '',
      district: '',
      address: ' 西湖区 ',
      chargerId: '',
      collaboratorIds: [],
      organizationId: '',
      uncId: '',
      headcountRange: '',
      version: 3,
    });

    expect(payload.customerName).toBe('示例科技');
    expect(payload.customerLevel).toBeNull();
    expect(payload.address).toBe('西湖区');
    expect(payload.collaboratorIds).toBeNull();
    expect(payload.version).toBe(3);
  });

  const ordinaryEditCases = (['MQL', 'SQL'] as const).flatMap((leadStage) => [
    {
      leadStage,
      field: 'remark' as const,
      value: ` ${leadStage} 新备注 `,
      expected: `${leadStage} 新备注`,
    },
    {
      leadStage,
      field: 'address' as const,
      value: ` ${leadStage} 新地址 `,
      expected: `${leadStage} 新地址`,
    },
    {
      leadStage,
      field: 'chargerId' as const,
      value: `${leadStage.toLowerCase()}-charger`,
      expected: `${leadStage.toLowerCase()}-charger`,
    },
  ]);

  it.each(ordinaryEditCases)(
    '$leadStage 客户从 profile 回填后只改 $field，update payload 不携带 AI/阶段/只读事实',
    ({ leadStage, field, value, expected }) => {
      const profile = toCustomerProfile({
        ...baseCustomer,
        leadStage,
        leadStageUpdatedAt: '2026-08-23T01:00:00.000Z',
        leadStageUpdatedById: 'emp-stage-updater',
        leadStageUpdatedByName: '阶段更新人',
        leadStageQualifiedById: 'emp-stage-qualifier',
        leadStageQualifiedByName: '阶段判定人',
        leadStageQualifiedAt: '2026-08-23T01:00:00.000Z',
        firstMqlAt: '2026-08-22T01:00:00.000Z',
        firstSqlAt: leadStage === 'SQL' ? '2026-08-23T01:00:00.000Z' : null,
        leadProgressStatus: 'ACTIVE',
        leadProgressUpdatedAt: '2026-08-23T02:00:00.000Z',
        leadProgressUpdatedById: 'emp-progress-updater',
        createdAt: '2026-08-20T01:00:00.000Z',
        createdBy: 'emp-creator',
        updatedAt: '2026-08-23T02:00:00.000Z',
        updatedBy: 'emp-updater',
        deletedAt: null,
      });
      const form = toCustomerFormData(profile);
      const enrichedForm: CustomerFormData & Record<string, unknown> = { ...form };
      enrichedForm[field] = value;
      for (const [key, profileValue] of Object.entries(profile)) {
        if (!(key in enrichedForm)) enrichedForm[key] = profileValue;
      }
      enrichedForm.aiInfoGeneratedAt = '2026-08-23T03:00:00.000Z';
      const payload = toCustomerUpdatePayload(enrichedForm);

      // 回填数据确实带阶段/AI/只读事实，防止测试因 fixture 未进入风险路径而误通过。
      expect(form.leadStage).toBe(leadStage);
      expect(form.leadStageQualifiedById).toBe('emp-stage-qualifier');
      expect(payload).toHaveProperty(field, expected);
      for (const forbiddenField of FORBIDDEN_ORDINARY_UPDATE_FIELDS) {
        expect(payload).not.toHaveProperty(forbiddenField);
      }
    }
  );
});
