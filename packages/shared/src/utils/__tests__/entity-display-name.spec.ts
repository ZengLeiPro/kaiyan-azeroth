import { describe, expect, it } from 'vitest';

import { getEntityDisplayName } from '../entity-display-name';

describe('getEntityDisplayName', () => {
  // ============ 通用兜底 ============
  describe('null / undefined / 空对象', () => {
    it('null entity 返回中文兜底名', () => {
      expect(getEntityDisplayName('opportunity', null)).toBe('商机');
      expect(getEntityDisplayName('sale-order', null)).toBe('订单');
      expect(getEntityDisplayName('payment', null)).toBe('回款');
      expect(getEntityDisplayName('invoice', null)).toBe('发票');
    });

    it('undefined entity 返回中文兜底名', () => {
      expect(getEntityDisplayName('opportunity', undefined)).toBe('商机');
    });

    it('opportunity/saleOrder 完全无字段时返回兜底', () => {
      expect(getEntityDisplayName('opportunity', {})).toBe('商机');
      expect(getEntityDisplayName('sale-order', {})).toBe('订单');
    });
  });

  // ============ 商机 Opportunity ============
  describe('opportunity', () => {
    const opp = {
      opportunityName: '示例家居 AI 项目',
      serialNumber: 'O-202606-0001',
    };

    it('short 只显示名字', () => {
      expect(getEntityDisplayName('opportunity', opp, 'short')).toBe('示例家居 AI 项目');
    });

    it('long 显示名字+编号', () => {
      expect(getEntityDisplayName('opportunity', opp, 'long')).toBe(
        '示例家居 AI 项目（O-202606-0001）'
      );
    });

    it('withContext 只显示名字（跨引用方关心名字不重复编号）', () => {
      expect(getEntityDisplayName('opportunity', opp, 'withContext')).toBe('示例家居 AI 项目');
    });

    it('只有编号没有名字时编号兜底', () => {
      expect(getEntityDisplayName('opportunity', { serialNumber: 'O-202606-0099' }, 'short')).toBe(
        'O-202606-0099'
      );
    });

    it('opportunityName 含空白会被 trim', () => {
      expect(getEntityDisplayName('opportunity', { opportunityName: '  示例家居  ' })).toBe(
        '示例家居'
      );
    });
  });

  // ============ 订单 SaleOrder ============
  describe('sale-order', () => {
    const order = {
      orderTitle: '示例家居一期定制',
      serialNumber: 'S-202606-0123',
    };

    it('short 只显示标题（列表已有独立编号列）', () => {
      expect(getEntityDisplayName('sale-order', order, 'short')).toBe('示例家居一期定制');
    });

    it('long 标题+编号', () => {
      expect(getEntityDisplayName('sale-order', order, 'long')).toBe(
        '示例家居一期定制（S-202606-0123）'
      );
    });

    it('withContext 标题+编号（合同标识必带编号）', () => {
      expect(getEntityDisplayName('sale-order', order, 'withContext')).toBe(
        '示例家居一期定制（S-202606-0123）'
      );
    });

    it('orderTitle 为空时（P0 阶段常见）回退到编号', () => {
      expect(
        getEntityDisplayName('sale-order', { serialNumber: 'S-202606-0124' }, 'withContext')
      ).toBe('S-202606-0124');
    });

    it('orderTitle 为 null 时回退到编号', () => {
      expect(
        getEntityDisplayName('sale-order', { orderTitle: null, serialNumber: 'S-202606-0125' })
      ).toBe('S-202606-0125');
    });
  });

  // ============ 回款 Payment ============
  describe('payment', () => {
    it('P0 阶段：direction=IN 无 subject，显示"回款·金额"', () => {
      expect(
        getEntityDisplayName(
          'payment',
          { direction: 'IN', paymentAmount: 30000, businessDate: '2026-06-14' },
          'short'
        )
      ).toBe('回款·¥30,000.00');
    });

    it('P0 阶段：direction=OUT 无 subject，refundType 作 subject', () => {
      expect(
        getEntityDisplayName(
          'payment',
          { direction: 'OUT', refundType: '客户退款', paymentAmount: 5000 },
          'short'
        )
      ).toBe('客户退款·¥5,000.00');
    });

    it('P0 阶段：direction=OUT 无 refundType 时显示"退款"', () => {
      expect(
        getEntityDisplayName('payment', { direction: 'OUT', paymentAmount: 5000 }, 'short')
      ).toBe('退款·¥5,000.00');
    });

    it('P2 阶段：有 subject 时优先使用 subject', () => {
      expect(
        getEntityDisplayName(
          'payment',
          { subject: '首期款', direction: 'IN', paymentAmount: 30000 },
          'short'
        )
      ).toBe('首期款·¥30,000.00');
    });

    it('withContext 含日期', () => {
      expect(
        getEntityDisplayName(
          'payment',
          {
            subject: '首期款',
            direction: 'IN',
            paymentAmount: 30000,
            businessDate: '2026-06-14',
          },
          'withContext'
        )
      ).toBe('首期款·¥30,000.00·2026-06-14');
    });

    it('long 含日期+编号', () => {
      expect(
        getEntityDisplayName(
          'payment',
          {
            subject: '尾款',
            direction: 'IN',
            paymentAmount: 70000,
            businessDate: '2026-08-01',
            serialNumber: 'PAY-202608-0017',
          },
          'long'
        )
      ).toBe('尾款·¥70,000.00·2026-08-01（PAY-202608-0017）');
    });

    it('paymentAmount 支持 Prisma.Decimal-like（toString 返回字符串）', () => {
      const decimalLike = { toString: () => '30000' };
      expect(
        getEntityDisplayName(
          'payment',
          { direction: 'IN', paymentAmount: decimalLike, businessDate: '2026-06-14' },
          'short'
        )
      ).toBe('回款·¥30,000.00');
    });

    it('paymentAmount 支持字符串', () => {
      expect(
        getEntityDisplayName('payment', { direction: 'IN', paymentAmount: '12500.50' }, 'short')
      ).toBe('回款·¥12,500.50');
    });

    it('paymentAmount 缺失视为 0', () => {
      expect(getEntityDisplayName('payment', { direction: 'IN' }, 'short')).toBe('回款·¥0.00');
    });

    it('businessDate 缺失时 withContext 不出日期段', () => {
      expect(
        getEntityDisplayName('payment', { subject: '首期款', paymentAmount: 30000 }, 'withContext')
      ).toBe('首期款·¥30,000.00');
    });
  });

  // ============ 开票 Invoice ============
  describe('invoice', () => {
    it('P0 阶段：无 subject 显示"开票·金额"', () => {
      expect(
        getEntityDisplayName(
          'invoice',
          { invoiceAmount: 30000, invoiceDate: '2026-06-14' },
          'short'
        )
      ).toBe('开票·¥30,000.00');
    });

    it('P2 阶段：有 subject 优先', () => {
      expect(
        getEntityDisplayName(
          'invoice',
          { subject: '软件开发服务费', invoiceAmount: 30000 },
          'short'
        )
      ).toBe('软件开发服务费·¥30,000.00');
    });

    it('long 优先用税务发票号', () => {
      expect(
        getEntityDisplayName(
          'invoice',
          {
            subject: '软件开发服务费',
            invoiceAmount: 30000,
            invoiceDate: '2026-06-14',
            invoiceNumber: '04400001234',
            serialNumber: 'INV-202606-0001',
          },
          'long'
        )
      ).toBe('软件开发服务费·¥30,000.00·2026-06-14（04400001234）');
    });

    it('long 无 invoiceNumber 时退回 serialNumber', () => {
      expect(
        getEntityDisplayName(
          'invoice',
          {
            subject: '软件开发服务费',
            invoiceAmount: 30000,
            invoiceDate: '2026-06-14',
            serialNumber: 'INV-202606-0001',
          },
          'long'
        )
      ).toBe('软件开发服务费·¥30,000.00·2026-06-14（INV-202606-0001）');
    });

    it('long 既无 invoiceNumber 也无 serialNumber 时只剩头', () => {
      expect(
        getEntityDisplayName(
          'invoice',
          { subject: '培训费', invoiceAmount: 5000, invoiceDate: '2026-06-14' },
          'long'
        )
      ).toBe('培训费·¥5,000.00·2026-06-14');
    });

    it('invoiceDate 为 ISO 字符串可正常截 yyyy-mm-dd', () => {
      expect(
        getEntityDisplayName(
          'invoice',
          {
            subject: '软件开发服务费',
            invoiceAmount: 30000,
            invoiceDate: '2026-06-14T08:30:00.000Z',
          },
          'withContext'
        )
      ).toBe('软件开发服务费·¥30,000.00·2026-06-14');
    });
  });

  // ============ 跨模块引用场景（业务驱动） ============
  describe('跨模块引用场景', () => {
    it('订单详情看回款 Tab：同订单两笔同额回款必须可区分', () => {
      const pay1 = {
        subject: '首期款',
        direction: 'IN',
        paymentAmount: 30000,
        businessDate: '2026-06-14',
      };
      const pay2 = {
        subject: '尾款',
        direction: 'IN',
        paymentAmount: 30000,
        businessDate: '2026-08-01',
      };
      expect(getEntityDisplayName('payment', pay1, 'withContext')).not.toBe(
        getEntityDisplayName('payment', pay2, 'withContext')
      );
      expect(getEntityDisplayName('payment', pay1, 'withContext')).toBe(
        '首期款·¥30,000.00·2026-06-14'
      );
      expect(getEntityDisplayName('payment', pay2, 'withContext')).toBe(
        '尾款·¥30,000.00·2026-08-01'
      );
    });

    it('回款列表关联订单：必带订单编号', () => {
      const order = { orderTitle: '示例家居一期定制', serialNumber: 'S-202606-0123' };
      expect(getEntityDisplayName('sale-order', order, 'withContext')).toBe(
        '示例家居一期定制（S-202606-0123）'
      );
    });
  });
});
