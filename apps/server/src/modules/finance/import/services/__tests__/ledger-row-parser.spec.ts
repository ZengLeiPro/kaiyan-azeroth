import { parseLedgerSheet } from '../ledger-row-parser';

describe('ledger-row-parser', () => {
  it('跳过有日期和备注但金额为空的注释行', () => {
    const result = parseLedgerSheet([['2月20日', '个人', '妈', '', '338,178.74']], '2026', 2026, 1);

    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('跳过有金额但余额为空的表尾调整行', () => {
    const result = parseLedgerSheet([['', '个人', '苏世源', '20,000.00', '']], '2025', 2025, 755);

    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('拒绝零金额流水，避免与数据库方向约束冲突', () => {
    const result = parseLedgerSheet(
      [['2月20日', '收入', '零金额', '0.00', '338,178.74']],
      '2026',
      2026,
      1
    );

    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([
      expect.objectContaining({ rowIndex: 2, reason: 'D 列金额不能为 0' }),
    ]);
  });

  it('解析日期空白但有金额的续行，优先继承同组日期', () => {
    const result = parseLedgerSheet(
      [
        ['', '苏世源', '', '20,000.00', '380,157.41'],
        ['6月30日', '个人', '建行还贷', '-10,000.00', '370,157.41'],
        ['', '振家', '短信分成', '-63,227.13', '306,930.28'],
      ],
      '2026',
      2026,
      397
    );

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((row) => row.txDate)).toEqual([
      '2026-06-30',
      '2026-06-30',
      '2026-06-30',
    ]);
    expect(result.rows.map((row) => row.amount)).toEqual([20000, -10000, -63227.13]);
    expect(result.rows.map((row) => row.rowIndex)).toEqual([398, 399, 400]);
    expect(result.rows.map((row) => row.isDateInferred)).toEqual([true, false, true]);
  });

  it('保留余额链中无科目的金额行，归为待归类', () => {
    const result = parseLedgerSheet(
      [
        ['6月8日', '基础设施租赁成本', '阿里云 函数CU包', '-202.00', '284,402.31'],
        ['', '', '', '27,520.60', '311,922.91'],
        ['', '', '', '', '311,922.91'],
        ['', '', '', '48,234.50', '360,157.41'],
      ],
      '2026',
      2026,
      345
    );

    expect(result.errors).toEqual([]);
    expect(result.rows.map((row) => row.rowIndex)).toEqual([346, 347, 349]);
    expect(result.rows.map((row) => row.subjectName)).toEqual([
      '基础设施租赁成本',
      '待归类',
      '待归类',
    ]);
    expect(result.rows.map((row) => row.txDate)).toEqual([
      '2026-06-08',
      '2026-06-08',
      '2026-06-08',
    ]);
    expect(result.rows.map((row) => row.amount)).toEqual([-202, 27520.6, 48234.5]);
    expect(result.rows.map((row) => row.isDateInferred)).toEqual([false, true, true]);
  });
});
