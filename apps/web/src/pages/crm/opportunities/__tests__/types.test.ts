import type { IOpportunityResponse } from '@ky-azeroth/shared/types/opportunity';
import { describe, expect, it } from 'vitest';

import {
  type OpportunityFormData,
  toOpportunityFormData,
  toOpportunityPayload,
  toOpportunityProfile,
  toOpportunityUpdatePayload,
} from '../types';

describe('toOpportunityUpdatePayload', () => {
  const baseForm: OpportunityFormData = {
    opportunityName: '测试商机',
    customerId: '11111111-1111-1111-1111-111111111111',
    contactId: null,
    opportunityStage: '商务谈判',
    opportunityAmount: 100,
    winRate: null,
    expectedDealDate: null,
    chargerId: '22222222-2222-2222-2222-222222222222',
    loseReason: null,
    loseReasonDetail: null,
    remark: null,
    version: 1,
    products: [],
    productsTouched: false,
  };

  it('未触碰产品明细时不提交 products，避免 update 误清空子表', () => {
    const payload = toOpportunityUpdatePayload(baseForm);

    expect(payload).not.toHaveProperty('products');
  });

  it('触碰产品明细后提交空数组，用于显式清空子表', () => {
    const payload = toOpportunityUpdatePayload({
      ...baseForm,
      productsTouched: true,
    });

    expect(payload).toHaveProperty('products', []);
  });

  it('payload 不包含 realDealDate（已从前端表单隐藏，由后端在阶段=赢单时自动填）', () => {
    const payload = toOpportunityPayload(baseForm);
    expect(payload).not.toHaveProperty('realDealDate');
  });

  it('预计成交日期从响应到表单和 payload 都保持 YYYY-MM-DD', () => {
    const response = {
      id: 'opp-1',
      serialNumber: 'SJ0001',
      opportunityName: '测试商机',
      customerId: '11111111-1111-1111-1111-111111111111',
      contactId: null,
      opportunityStage: '商务谈判',
      opportunityAmount: 100,
      winRate: null,
      expectedDealDate: '2026-05-14T00:00:00.000Z',
      realDealDate: '2026-05-15T00:00:00.000Z',
      wonSourceType: null,
      wonSourceSaleOrderId: null,
      wonSourcePreviousStage: null,
      wonSourcePreviousDealDate: null,
      wonSourcePreviousWinRate: null,
      lostDate: null,
      chargerId: null,
      chargerName: null,
      chargerAvatar: null,
      loseReason: null,
      loseReasonDetail: null,
      remark: null,
      flowStatus: null,
      status: 'active',
      products: [],
    } satisfies IOpportunityResponse;

    const profile = toOpportunityProfile(response);
    const form = toOpportunityFormData(profile);
    const payload = toOpportunityPayload({
      ...form,
      expectedDealDate: '2026-05-14T00:00:00.000Z',
    });

    expect(profile.expectedDealDate).toBe('2026-05-14');
    expect(profile.realDealDate).toBe('2026-05-15');
    expect(payload).toMatchObject({
      expectedDealDate: '2026-05-14',
    });
  });
});
