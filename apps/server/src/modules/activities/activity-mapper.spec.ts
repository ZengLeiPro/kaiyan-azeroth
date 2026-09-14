import {
  ACTIVITY_CATEGORY,
  ACTIVITY_IMPORTANCE,
  ACTIVITY_SOURCE,
} from '@ky-azeroth/shared/schemas/activity';
import { describe, expect, it } from 'vitest';

import {
  buildOperationLogSummary,
  deriveImportance,
  type KeepRecordRow,
  mapKeepRecord,
  mapOperationLog,
  mapSalesActionItem,
  mapVisitRecord,
  moduleToCategory,
  type OperationLogRow,
  type SalesActionItemRow,
  type VisitRecordRow,
} from './activity-mapper';

const SAMPLE_DATE = new Date('2026-06-16T10:00:00.000Z');

function makeKeep(overrides: Partial<KeepRecordRow> = {}): KeepRecordRow {
  return {
    id: 'k1',
    customerId: 'c1',
    keepRecordType: '电话',
    keepRecordTime: SAMPLE_DATE,
    keepRecordContent: '客户对方案表示认可，下周看合同',
    keepRecordStatus: '已沟通',
    chargerId: 'emp1',
    chargerName: '吴销售',
    createdAt: SAMPLE_DATE,
    ...overrides,
  };
}

function makeVisit(overrides: Partial<VisitRecordRow> = {}): VisitRecordRow {
  return {
    id: 'v1',
    customerId: 'c1',
    visitType: '现场',
    content: '到客户工厂现场调研',
    signInTime: SAMPLE_DATE,
    signOutTime: new Date('2026-06-16T11:30:00.000Z'),
    signAddress: '泉州市丰泽区',
    duration: 90,
    visitStatus: '已完成',
    chargerId: 'emp1',
    chargerName: '周销售',
    createdAt: SAMPLE_DATE,
    ...overrides,
  };
}

function makeOpLog(overrides: Partial<OperationLogRow> = {}): OperationLogRow {
  return {
    id: 'log1',
    employeeId: 'emp1',
    module: 'sale-orders',
    action: 'update',
    target: 'so1',
    targetCustomerId: 'c1',
    createdAt: SAMPLE_DATE,
    details: {
      kind: 'change',
      targetName: 'SO90001',
      changes: [],
    },
    employee: { id: 'emp1', name: '吴销售', username: 'sales_wu' },
    ...overrides,
  };
}

describe('moduleToCategory', () => {
  it('CRM 主要 module 映射到对应 category', () => {
    expect(moduleToCategory('customers')).toBe(ACTIVITY_CATEGORY.CUSTOMER);
    expect(moduleToCategory('sale-orders')).toBe(ACTIVITY_CATEGORY.ORDER);
    expect(moduleToCategory('opportunities')).toBe(ACTIVITY_CATEGORY.OPPORTUNITY);
    expect(moduleToCategory('payments')).toBe(ACTIVITY_CATEGORY.PAYMENT);
    expect(moduleToCategory('invoices')).toBe(ACTIVITY_CATEGORY.INVOICE);
    expect(moduleToCategory('contacts')).toBe(ACTIVITY_CATEGORY.CONTACT);
  });

  it('非 CRM module 返回 null（不进时间线）', () => {
    expect(moduleToCategory('crm-products')).toBeNull();
    expect(moduleToCategory('approvals')).toBeNull();
    expect(moduleToCategory('users')).toBeNull();
  });
});

describe('mapKeepRecord', () => {
  it('投影成 follow_up + milestone', () => {
    const item = mapKeepRecord(makeKeep());
    expect(item.source).toBe(ACTIVITY_SOURCE.KEEP);
    expect(item.category).toBe(ACTIVITY_CATEGORY.FOLLOW_UP);
    expect(item.importance).toBe(ACTIVITY_IMPORTANCE.MILESTONE);
    expect(item.id).toBe('keep:k1');
    expect(item.refType).toBe('KeepRecord');
    expect(item.refId).toBe('k1');
    expect(item.actorName).toBe('吴销售');
    expect(item.customerId).toBe('c1');
    expect(item.summary).toContain('客户对方案');
    expect(item.detail?.content).toBe('客户对方案表示认可，下周看合同');
  });

  it('keepRecordTime 为 null 时回退到 createdAt 作为 occurredAt', () => {
    const item = mapKeepRecord(makeKeep({ keepRecordTime: null }));
    expect(item.occurredAt).toBe(SAMPLE_DATE.toISOString());
  });
});

describe('mapVisitRecord', () => {
  it('投影成 visit + milestone，summary 含地址和时长', () => {
    const item = mapVisitRecord(makeVisit());
    expect(item.source).toBe(ACTIVITY_SOURCE.VISIT);
    expect(item.category).toBe(ACTIVITY_CATEGORY.VISIT);
    expect(item.importance).toBe(ACTIVITY_IMPORTANCE.MILESTONE);
    expect(item.summary).toContain('泉州市丰泽区');
    expect(item.summary).toContain('90 分钟');
    expect(item.detail?.location).toBe('泉州市丰泽区');
    expect(item.detail?.duration).toBe(90);
  });
});

describe('mapOperationLog', () => {
  it('正常 change log 投影成 op_log activity', () => {
    const item = mapOperationLog(makeOpLog());
    expect(item).not.toBeNull();
    expect(item!.source).toBe(ACTIVITY_SOURCE.OPERATION_LOG);
    expect(item!.category).toBe(ACTIVITY_CATEGORY.ORDER);
    expect(item!.id).toBe('op:log1');
    expect(item!.refType).toBe('SaleOrder');
    expect(item!.refName).toBe('SO90001');
  });

  it('targetCustomerId=null 直接 drop（不进客户时间线）', () => {
    expect(mapOperationLog(makeOpLog({ targetCustomerId: null }))).toBeNull();
  });

  it('details.kind!="change" 直接 drop（其他非 CRM 日志不挂时间线）', () => {
    const log = makeOpLog({ details: { kind: 'login', targetName: 'x' } });
    expect(mapOperationLog(log)).toBeNull();
  });

  it('未知 module（crm-products 等）直接 drop', () => {
    const log = makeOpLog({ module: 'crm-products' });
    expect(mapOperationLog(log)).toBeNull();
  });
});

describe('deriveImportance', () => {
  it('create/delete on CRM 主实体 = milestone', () => {
    expect(deriveImportance('sale-orders', 'create', [])).toBe(ACTIVITY_IMPORTANCE.MILESTONE);
    expect(deriveImportance('opportunities', 'delete', [])).toBe(ACTIVITY_IMPORTANCE.MILESTONE);
    expect(deriveImportance('payments', 'create', [])).toBe(ACTIVITY_IMPORTANCE.MILESTONE);
    expect(deriveImportance('contacts', 'create', [])).toBe(ACTIVITY_IMPORTANCE.MILESTONE);
  });

  it('订单状态切换 → milestone', () => {
    const changes = [{ field: 'orderStatus', label: '合同状态', before: '草稿', after: '已签订' }];
    expect(deriveImportance('sale-orders', 'update', changes)).toBe(ACTIVITY_IMPORTANCE.MILESTONE);
  });

  it('商机阶段切换 → milestone', () => {
    const changes = [
      { field: 'opportunityStage', label: '商机阶段', before: '方案沟通', after: '商务报价' },
    ];
    expect(deriveImportance('opportunities', 'update', changes)).toBe(
      ACTIVITY_IMPORTANCE.MILESTONE
    );
  });

  it('订单金额变化 > 20% → milestone', () => {
    const changes = [{ field: 'orderAmount', label: '合同金额', before: 100000, after: 150000 }];
    expect(deriveImportance('sale-orders', 'update', changes)).toBe(ACTIVITY_IMPORTANCE.MILESTONE);
  });

  it('订单金额变化 < 20% → normal', () => {
    const changes = [{ field: 'orderAmount', label: '合同金额', before: 100000, after: 110000 }];
    expect(deriveImportance('sale-orders', 'update', changes)).toBe(ACTIVITY_IMPORTANCE.NORMAL);
  });

  it('备注/标签 变化 → trivial（不抬级）', () => {
    const changes = [{ field: 'remark', label: '备注', before: 'a', after: 'b' }];
    expect(deriveImportance('sale-orders', 'update', changes)).toBe(ACTIVITY_IMPORTANCE.TRIVIAL);
  });

  it('混合：包含 milestone 字段时取最高档', () => {
    const changes = [
      { field: 'remark', label: '备注', before: 'a', after: 'b' },
      { field: 'orderStatus', label: '合同状态', before: '草稿', after: '已签订' },
    ];
    expect(deriveImportance('sale-orders', 'update', changes)).toBe(ACTIVITY_IMPORTANCE.MILESTONE);
  });
});

describe('buildOperationLogSummary', () => {
  it('create 动作 → "新增{module} {targetName}"', () => {
    const log = makeOpLog({ action: 'create' });
    expect(buildOperationLogSummary(log)).toBe('新增订单 SO90001');
  });

  it('update 含 milestone 字段 → 显示 milestone 字段 diff', () => {
    const log = makeOpLog({
      details: {
        kind: 'change',
        targetName: 'SO90001',
        changes: [{ field: 'orderStatus', label: '合同状态', before: '草稿', after: '已签订' }],
      },
    });
    expect(buildOperationLogSummary(log)).toContain('合同状态');
    expect(buildOperationLogSummary(log)).toContain('已签订');
  });

  it('update 无 milestone 字段，回退到前 2 个非 trivial 字段', () => {
    const log = makeOpLog({
      details: {
        kind: 'change',
        targetName: 'SO90001',
        changes: [{ field: 'paymentDate', label: '付款日期', before: null, after: '2026-07-01' }],
      },
    });
    const summary = buildOperationLogSummary(log);
    expect(summary).toContain('付款日期');
  });

  it('payments OUT（退款）summary 用"退款"标签而非"回款"', () => {
    const log = makeOpLog({
      module: 'payments',
      action: 'create',
      details: {
        kind: 'change',
        targetName: 'REF-001',
        after: { direction: 'OUT', paymentAmount: 5000 },
        changes: [],
      },
    });
    expect(buildOperationLogSummary(log)).toContain('退款');
    expect(buildOperationLogSummary(log)).not.toContain('回款');
  });

  it('payments IN 仍走"回款"标签', () => {
    const log = makeOpLog({
      module: 'payments',
      action: 'create',
      details: {
        kind: 'change',
        targetName: 'PAY-001',
        after: { direction: 'IN', paymentAmount: 5000 },
        changes: [],
      },
    });
    expect(buildOperationLogSummary(log)).toContain('回款');
  });
});

describe('mapOperationLog — P1 payments direction 分流', () => {
  it('payments direction=OUT 的 create → category=refund', () => {
    const log = makeOpLog({
      module: 'payments',
      action: 'create',
      details: {
        kind: 'change',
        targetName: 'REF-001',
        after: { direction: 'OUT', paymentAmount: 5000 },
        changes: [],
      },
    });
    const item = mapOperationLog(log);
    expect(item).not.toBeNull();
    expect(item!.category).toBe(ACTIVITY_CATEGORY.REFUND);
  });

  it('payments direction=IN 的 create → category=payment', () => {
    const log = makeOpLog({
      module: 'payments',
      action: 'create',
      details: {
        kind: 'change',
        targetName: 'PAY-001',
        after: { direction: 'IN', paymentAmount: 5000 },
        changes: [],
      },
    });
    const item = mapOperationLog(log);
    expect(item!.category).toBe(ACTIVITY_CATEGORY.PAYMENT);
  });

  it('payments update 时缺 direction → 默认 payment（向后兼容）', () => {
    // update 不会改 direction，details.after 通常无 direction 字段
    const log = makeOpLog({
      module: 'payments',
      action: 'update',
      details: {
        kind: 'change',
        targetName: 'PAY-001',
        after: { paymentAmount: 6000 },
        before: { paymentAmount: 5000 },
        changes: [{ field: 'paymentAmount', label: '金额', before: 5000, after: 6000 }],
      },
    });
    const item = mapOperationLog(log);
    expect(item!.category).toBe(ACTIVITY_CATEGORY.PAYMENT);
  });
});

describe('mapOperationLog — P2 create 用业务时间', () => {
  it('payments create 用 after.businessDate 作为 occurredAt', () => {
    const businessDate = new Date('2026-05-10T08:00:00.000Z');
    const log = makeOpLog({
      module: 'payments',
      action: 'create',
      // createdAt 是 SAMPLE_DATE（6/16），但业务日期是 5/10
      details: {
        kind: 'change',
        targetName: 'PAY-001',
        after: { direction: 'IN', paymentAmount: 5000, businessDate: businessDate.toISOString() },
        changes: [],
      },
    });
    const item = mapOperationLog(log);
    expect(item!.occurredAt).toBe(businessDate.toISOString());
  });

  it('sale-orders create 用 after.businessDate', () => {
    const businessDate = new Date('2026-05-01T00:00:00.000Z');
    const log = makeOpLog({
      module: 'sale-orders',
      action: 'create',
      details: {
        kind: 'change',
        targetName: 'SO-001',
        after: { businessDate: businessDate.toISOString() },
        changes: [],
      },
    });
    expect(mapOperationLog(log)!.occurredAt).toBe(businessDate.toISOString());
  });

  it('invoices create 用 after.invoiceDate', () => {
    const invoiceDate = new Date('2026-04-15T00:00:00.000Z');
    const log = makeOpLog({
      module: 'invoices',
      action: 'create',
      details: {
        kind: 'change',
        targetName: 'INV-001',
        after: { invoiceDate: invoiceDate.toISOString() },
        changes: [],
      },
    });
    expect(mapOperationLog(log)!.occurredAt).toBe(invoiceDate.toISOString());
  });

  it('opportunities create 优先 realDealDate，回退 expectedDealDate', () => {
    const expected = new Date('2026-08-01T00:00:00.000Z');
    const log = makeOpLog({
      module: 'opportunities',
      action: 'create',
      details: {
        kind: 'change',
        targetName: 'OPP-1',
        after: { expectedDealDate: expected.toISOString() },
        changes: [],
      },
    });
    expect(mapOperationLog(log)!.occurredAt).toBe(expected.toISOString());
  });

  it('update 即使 after 含业务时间，也不切换 occurredAt（保留动作时间）', () => {
    const businessDate = new Date('2026-05-10T08:00:00.000Z');
    const log = makeOpLog({
      module: 'payments',
      action: 'update',
      details: {
        kind: 'change',
        targetName: 'PAY-001',
        after: { businessDate: businessDate.toISOString() },
        changes: [{ field: 'businessDate', label: '业务日期', before: null, after: businessDate }],
      },
    });
    const item = mapOperationLog(log);
    expect(item!.occurredAt).toBe(SAMPLE_DATE.toISOString());
  });

  it('create 但业务时间缺失 → 回退到 createdAt', () => {
    const log = makeOpLog({
      module: 'payments',
      action: 'create',
      details: {
        kind: 'change',
        targetName: 'PAY-001',
        after: { direction: 'IN', paymentAmount: 5000 },
        changes: [],
      },
    });
    expect(mapOperationLog(log)!.occurredAt).toBe(SAMPLE_DATE.toISOString());
  });
});

// ── P0: sales_action_items 投影 ────────────────────────────────────

function makeSai(overrides: Partial<SalesActionItemRow> = {}): SalesActionItemRow {
  return {
    id: 'sai1',
    category: 'FOLLOW_UP_DUE',
    priority: 80,
    refType: 'Customer',
    refId: 'c1',
    title: '客户 A 已 7 天未跟进',
    reason: '上次跟进时间 2026-06-09，已超过 7 天',
    status: 'pending',
    doneType: null,
    resolveNote: null,
    employeeId: 'emp1',
    employee: { id: 'emp1', name: '吴销售', username: 'sales_wu' },
    resolvedById: null,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: SAMPLE_DATE,
    customerId: 'c1',
    ...overrides,
  };
}

describe('mapSalesActionItem (P0)', () => {
  it('pending 高优先 → milestone，occurredAt 用 createdAt，actor 是收件销售', () => {
    const item = mapSalesActionItem(makeSai({ status: 'pending', priority: 80 }));
    expect(item.source).toBe(ACTIVITY_SOURCE.SALES_ACTION_ITEM);
    expect(item.category).toBe(ACTIVITY_CATEGORY.TODO);
    expect(item.importance).toBe(ACTIVITY_IMPORTANCE.MILESTONE);
    expect(item.occurredAt).toBe(SAMPLE_DATE.toISOString());
    expect(item.actorName).toBe('吴销售');
    expect(item.refType).toBe('SalesActionItem');
    expect(item.summary).toContain('跟进到期');
    expect(item.summary).toContain('待处理');
  });

  it('pending 低优先 → normal', () => {
    const item = mapSalesActionItem(makeSai({ priority: 30 }));
    expect(item.importance).toBe(ACTIVITY_IMPORTANCE.NORMAL);
  });

  it('done → milestone，occurredAt 切到 resolvedAt，actor 切到 resolvedBy', () => {
    const resolvedAt = new Date('2026-06-15T12:00:00.000Z');
    const item = mapSalesActionItem(
      makeSai({
        status: 'done',
        doneType: 'progressed',
        resolvedAt,
        resolvedById: 'emp2',
        resolvedBy: { id: 'emp2', name: '周销售', username: 'sales_zhou' },
      })
    );
    expect(item.importance).toBe(ACTIVITY_IMPORTANCE.MILESTONE);
    expect(item.occurredAt).toBe(resolvedAt.toISOString());
    expect(item.actorName).toBe('周销售');
    expect(item.summary).toContain('已办结');
  });

  it('ignored / auto_expired → trivial（不打扰）', () => {
    expect(
      mapSalesActionItem(
        makeSai({ status: 'ignored', resolvedAt: SAMPLE_DATE, resolvedById: 'emp1' })
      ).importance
    ).toBe(ACTIVITY_IMPORTANCE.TRIVIAL);
    expect(
      mapSalesActionItem(makeSai({ status: 'auto_expired', resolvedAt: SAMPLE_DATE })).importance
    ).toBe(ACTIVITY_IMPORTANCE.TRIVIAL);
  });

  it('adopted → milestone（采纳=已生成跟进记录）', () => {
    expect(
      mapSalesActionItem(makeSai({ status: 'adopted', resolvedAt: SAMPLE_DATE })).importance
    ).toBe(ACTIVITY_IMPORTANCE.MILESTONE);
  });

  it('customerId 由 service 反查后注入，直接用', () => {
    const item = mapSalesActionItem(makeSai({ customerId: 'cust-xyz' }));
    expect(item.customerId).toBe('cust-xyz');
  });
});
