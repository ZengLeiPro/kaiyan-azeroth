import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { exportToCsv, exportToExcel } from '../export-excel';
import { parseExcelFile } from '../import-excel';

const readMock = vi.fn();
const sheetToJsonMock = vi.fn();
const bookNewMock = vi.fn(() => ({ SheetNames: [], Sheets: {} }));
const aoaToSheetMock = vi.fn(() => ({}));
const appendSheetMock = vi.fn();
const writeMock = vi.fn(() => new ArrayBuffer(8));

vi.mock('xlsx', () => ({
  read: readMock,
  write: writeMock,
  utils: {
    sheet_to_json: sheetToJsonMock,
    book_new: bookNewMock,
    aoa_to_sheet: aoaToSheetMock,
    book_append_sheet: appendSheetMock,
  },
}));

class ImmediateFileReader {
  onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
  onerror: (() => void) | null = null;

  readAsArrayBuffer(): void {
    this.onload?.({ target: { result: new ArrayBuffer(4) } } as ProgressEvent<FileReader>);
  }
}

describe('Excel import/export helpers', () => {
  const originalFileReader = globalThis.FileReader;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    readMock.mockReset();
    sheetToJsonMock.mockReset();
    bookNewMock.mockClear();
    aoaToSheetMock.mockClear();
    appendSheetMock.mockClear();
    writeMock.mockClear();
    globalThis.FileReader = ImmediateFileReader as unknown as typeof FileReader;
    URL.createObjectURL = vi.fn(() => 'blob:test');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    globalThis.FileReader = originalFileReader;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('parseExcelFile 会校验必填表头、转换数据并跳过空行', async () => {
    readMock.mockReturnValueOnce({ SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } });
    sheetToJsonMock.mockReturnValueOnce([
      ['名称', '金额'],
      [' 示例 ', '12.5'],
      ['', ''],
    ]);

    const result = await parseExcelFile<{ name: string; amount: number }>(
      new File(['x'], 't.xlsx'),
      {
        columns: [
          {
            header: '名称',
            key: 'name',
            required: true,
            transform: (value) => String(value).trim(),
          },
          {
            header: '金额',
            key: 'amount',
            transform: Number,
            validate: (value) => (Number(value) > 0 ? null : '金额必须大于 0'),
          },
        ],
      }
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ name: '示例', amount: 12.5 }]);
    expect(result.totalRows).toBe(2);
    expect(result.validRows).toBe(1);
  });

  it('parseExcelFile 缺少必填列表头时返回结构化错误', async () => {
    readMock.mockReturnValueOnce({ SheetNames: ['Sheet1'], Sheets: { Sheet1: {} } });
    sheetToJsonMock.mockReturnValueOnce([['金额'], ['10']]);

    const result = await parseExcelFile<{ name: string }>(new File(['x'], 't.xlsx'), {
      columns: [{ header: '名称', key: 'name', required: true }],
    });

    expect(result.success).toBe(false);
    expect(result.errors).toEqual([
      { row: 1, column: '名称', value: '', message: '缺少必填列: 名称' },
    ]);
  });

  it('exportToCsv 会处理嵌套字段、formatter 与 CSV 转义', async () => {
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    let blobParts: BlobPart[] = [];
    const OriginalBlob = globalThis.Blob;
    class CapturedBlob extends OriginalBlob {
      constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
        blobParts = parts ?? [];
        super(parts, options);
      }
    }
    vi.stubGlobal('Blob', CapturedBlob);

    exportToCsv({
      filename: '客户',
      columns: [
        { header: '名称', key: 'name' },
        { header: '城市', key: 'address.city' },
        { header: '备注', key: 'remark', formatter: (value) => `备注:${String(value)}` },
      ],
      data: [{ name: 'A,公司', address: { city: '杭州' }, remark: '含"引号"' }],
    });

    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(blobParts.join('')).toBe('\uFEFF名称,城市,备注\n"A,公司",杭州,"备注:含""引号"""');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });

  it('exportToExcel 会生成工作簿、设置列宽并触发下载', async () => {
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    clickSpy.mockClear();

    await exportToExcel({
      filename: '客户',
      sheetName: '客户表',
      columns: [{ header: '名称', key: 'name', width: 24 }],
      data: [{ name: '示例' }],
    });

    expect(aoaToSheetMock).toHaveBeenCalledWith([['名称'], ['示例']]);
    expect(appendSheetMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ '!cols': [{ wch: 24 }] }),
      '客户表'
    );
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });
});
