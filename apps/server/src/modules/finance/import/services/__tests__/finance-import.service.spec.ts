import { vi } from 'vitest';

import {
  asPrismaService,
  createMockPrismaService,
  type MockPrismaService,
} from '../../../../../test/prisma-mock.factory';
import { DingtalkWorkbookReaderService } from '../dingtalk-workbook-reader.service';
import { FinanceImportService } from '../finance-import.service';

function makeReaderMock(): DingtalkWorkbookReaderService {
  return {
    listSheets: vi.fn(),
    readRange: vi.fn(),
    readRangeBatched: vi.fn(),
  } as unknown as DingtalkWorkbookReaderService;
}

function makePnlRow(name: string, january: string): string[] {
  return [name, january, '', '', '', '', '', '', '', '', '', '', '', ''];
}

describe('FinanceImportService', () => {
  let prisma: MockPrismaService;
  let reader: DingtalkWorkbookReaderService;
  let service: FinanceImportService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    reader = makeReaderMock();
    service = new FinanceImportService(asPrismaService(prisma), reader);

    prisma.financeAccount.findFirst.mockResolvedValue({
      id: 'account-total',
      code: 'company_total',
    });
    prisma.financeSubject.findMany.mockResolvedValue([
      { id: 'subject-service-group', name: '技术服务收入', level: 1, category: 'revenue' },
      { id: 'subject-service-custom', name: '定制开发收入', level: 2, category: 'revenue' },
      { id: 'subject-resale-cogs', name: '钉钉代付成本', level: 2, category: 'cogs' },
      { id: 'subject-labor', name: '人工成本', level: 2, category: 'opex' },
      { id: 'subject-sales-salary', name: '销售人员工资', level: 2, category: 'opex' },
      { id: 'subject-uncategorized', name: '待归类', level: 2, category: 'non_pl' },
      { id: 'subject-deposit', name: '保证金缴纳', level: 2, category: 'non_pl' },
    ]);
    prisma.financeImportBatch.create.mockResolvedValue({ id: 'batch-1' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('previewImport 只用 level=2 叶子科目做财报对账，并按 25 行读取钉钉表', async () => {
    vi.mocked(reader.listSheets).mockResolvedValue([
      { name: '2025', sheetId: 'detail-2025' },
      { name: '2025财报', sheetId: 'pnl-2025' },
    ]);
    vi.mocked(reader.readRangeBatched).mockImplementation(
      async (_workbookId, sheetId, colsRange) => {
        if (sheetId === 'detail-2025' && colsRange === 'A:E') {
          return [
            ['', '', '', '', '1000.00'],
            ['1月1日', '定制开发收入', '项目回款', '100.00', '1100.00'],
            ['1月2日', '钉钉代付成本', '采购支出', '-30.00', '1070.00'],
            ['1月3日', '人工成本', '工资汇总', '-50.00', '1020.00'],
            ['', '', '', '10.00', '1030.00'],
            ['1月4日', '个人', '注释行', '', '1030.00'],
            ['1月5日', '个人', '私账支出', '-20.00', '1010.00'],
            ['', '苏世源', '', '20.00', '1030.00'],
            ['1月6日', '个人', '还贷', '-20.00', '1010.00'],
          ];
        }
        if (sheetId === 'pnl-2025' && colsRange === 'A:N') {
          return [
            makePnlRow('科目', '1月'),
            makePnlRow('技术服务收入', '100.00'),
            makePnlRow('定制开发收入', '100.00'),
            makePnlRow('钉钉代付成本', '30.00'),
            makePnlRow('销售人员工资', '50.00'),
          ];
        }
        return [];
      }
    );

    const result = await service.previewImport(
      { workbookId: 'workbook-1', years: [2025] },
      { id: 'user-1', employeeId: 'emp-1' }
    );

    expect(result.summary).toEqual({
      totalRows: 7,
      companyRows: 5,
      personalRows: 2,
      errorRows: 0,
    });
    expect(result.reconciliation).toEqual({
      passed: true,
      balanceDiffs: [],
      pnlDiffs: [],
    });
    expect(reader.readRangeBatched).toHaveBeenCalledWith(
      'workbook-1',
      'detail-2025',
      'A:E',
      1500,
      25
    );
    expect(reader.readRangeBatched).toHaveBeenCalledWith('workbook-1', 'pnl-2025', 'A:N', 100, 25);
  });

  it('listBatches 将 status/source 同时透传给列表与计数查询', async () => {
    prisma.financeImportBatch.findMany.mockResolvedValue([]);
    prisma.financeImportBatch.count.mockResolvedValue(0);

    await expect(
      service.listBatches({
        page: 2,
        pageSize: 25,
        sortOrder: 'desc',
        status: 'committed',
        source: 'dingtalk',
      })
    ).resolves.toEqual({ items: [], total: 0, page: 2, pageSize: 25, totalPages: 0 });

    const expectedWhere = { deletedAt: null, status: 'committed', source: 'dingtalk' };
    expect(prisma.financeImportBatch.findMany).toHaveBeenCalledWith({
      where: expectedWhere,
      skip: 25,
      take: 25,
      orderBy: { createdAt: 'desc' },
    });
    expect(prisma.financeImportBatch.count).toHaveBeenCalledWith({ where: expectedWhere });
  });

  it('commitPreparedDingtalkImport 在生产端重映射科目并提交 replace_year', async () => {
    let previewJson: unknown;
    prisma.financeImportBatch.create.mockImplementation(async (args) => {
      previewJson = args.data.previewJson;
      return { id: 'batch-prepared' };
    });
    prisma.financeImportBatch.findFirst.mockImplementation(async () => ({
      id: 'batch-prepared',
      status: 'preview',
      previewJson,
      deletedAt: null,
    }));
    prisma.financeLedger.upsert.mockResolvedValue({});
    prisma.financePersonalLedger.upsert.mockResolvedValue({});
    prisma.financeLedger.updateMany.mockResolvedValue({ count: 0 });
    prisma.financePersonalLedger.updateMany.mockResolvedValue({ count: 0 });
    prisma.financeImportBatch.update.mockResolvedValue({});

    const result = await service.commitPreparedDingtalkImport(
      {
        workbookId: 'workbook-1',
        years: [2025],
        openingBalances: { '2025': 1000 },
        rows: [
          [2025, 'c', 2, '2025-01-01', '定制开发收入', '项目回款', 100, 1100],
          [2025, 'c', 3, '2025-01-02', '苏世源', null, 20, 1120],
          [2025, 'p', 4, '2025-01-03', '个人', '私账支出', -10, 1110],
        ],
        reconciliation: {
          passed: true,
          balanceDiffCount: 0,
          pnlDiffCount: 0,
        },
      },
      null
    );

    expect(result).toMatchObject({
      batchId: 'batch-prepared',
      status: 'committed',
      successRows: 2,
      personalRows: 1,
      skippedRows: 0,
      failedRows: 0,
      summary: {
        totalRows: 3,
        companyRows: 2,
        personalRows: 1,
        errorRows: 0,
      },
    });
    expect(prisma.financeLedger.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.financeLedger.upsert.mock.calls[1]?.[0].create).toMatchObject({
      subjectId: 'subject-uncategorized',
      remark: '苏世源',
      dingtalkSheetName: '2025',
      dingtalkRowIndex: 3,
    });
    expect(prisma.financeLedger.upsert.mock.calls[1]?.[0].update).toMatchObject({
      subjectId: 'subject-uncategorized',
      remark: '苏世源',
      deletedAt: null,
    });
    expect(prisma.financePersonalLedger.upsert.mock.calls[0]?.[0].create).toMatchObject({
      subjectId: 'subject-deposit',
      remark: '私账支出',
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 10_000,
      timeout: 120_000,
    });
    expect(prisma.financeLedger.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ source: 'dingtalk_import' }),
      })
    );
  });

  it('commitPreparedDingtalkImport 在写流水前拒绝零金额', async () => {
    await expect(
      service.commitPreparedDingtalkImport(
        {
          workbookId: 'workbook-1',
          years: [2025],
          openingBalances: { '2025': 1000 },
          rows: [[2025, 'c', 2, '2025-01-01', '定制开发收入', null, 0, 1000]],
          reconciliation: {
            passed: true,
            balanceDiffCount: 0,
            pnlDiffCount: 0,
          },
        },
        null
      )
    ).rejects.toThrow('prepared payload rows[0].amount 不能为 0');
    expect(prisma.financeLedger.upsert).not.toHaveBeenCalled();
    expect(prisma.financePersonalLedger.upsert).not.toHaveBeenCalled();
  });
});
