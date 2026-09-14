import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StandardToolbar } from '../standard-toolbar';

const mobileState = vi.hoisted(() => ({ value: false }));

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => mobileState.value }));

vi.mock('../export-button', () => ({
  ExportButton: ({
    onExport,
    loading,
  }: {
    onExport: (format: 'xlsx') => void;
    loading?: boolean;
  }) => (
    <button type="button" disabled={loading} onClick={() => onExport('xlsx')}>
      导出
    </button>
  ),
}));

vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => (
    <div data-open={open}>{children}</div>
  ),
  SheetContent: ({ children }: { children: React.ReactNode }) => (
    <div role="dialog">{children}</div>
  ),
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

describe('StandardToolbar', () => {
  beforeEach(() => {
    mobileState.value = false;
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserver {
        observe(): void {}
        disconnect(): void {}
      }
    );
  });

  it('桌面端支持搜索、查询、重置、导入、导出和新建动作', () => {
    const onChange = vi.fn();
    const onSearch = vi.fn();
    const onReset = vi.fn();
    const onImport = vi.fn();
    const onExport = vi.fn();
    const onCreate = vi.fn();

    render(
      <StandardToolbar
        search={{ value: 'abc', onChange, placeholder: '搜索客户' }}
        filters={<button type="button">筛选项</button>}
        onSearch={onSearch}
        onReset={onReset}
        onImport={onImport}
        onExport={onExport}
        onCreate={onCreate}
        createLabel="新建客户"
      />
    );

    fireEvent.change(screen.getByPlaceholderText('搜索客户'), { target: { value: '示例' } });
    fireEvent.click(screen.getByTitle('搜索'));
    fireEvent.click(screen.getByTitle('重置筛选'));
    fireEvent.click(screen.getByText('导入'));
    fireEvent.click(screen.getByText('导出'));
    fireEvent.click(screen.getByTitle('新建客户'));

    expect(onChange).toHaveBeenCalledWith('示例');
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(onExport).toHaveBeenCalledWith('xlsx');
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('批量选择模式优先渲染批量操作并隐藏普通工具栏', () => {
    const onClearSelection = vi.fn();
    const onBulkEdit = vi.fn();
    const onBulkDelete = vi.fn();

    render(
      <StandardToolbar
        search={{ value: '', onChange: vi.fn() }}
        bulkSelection={{ selectedCount: 3, onClearSelection, onBulkEdit, onBulkDelete }}
      />
    );

    expect(screen.getByText('已选择 3 项')).toBeTruthy();
    fireEvent.click(screen.getByText('编辑'));
    fireEvent.click(screen.getByText('删除'));
    fireEvent.click(screen.getAllByRole('button')[0]!);

    expect(onBulkEdit).toHaveBeenCalledTimes(1);
    expect(onBulkDelete).toHaveBeenCalledTimes(1);
    expect(onClearSelection).toHaveBeenCalledTimes(1);
    expect(screen.queryByPlaceholderText('搜索...')).toBeNull();
  });

  it('移动端筛选抽屉点击搜索后会执行查询并关闭抽屉', () => {
    mobileState.value = true;
    const onSearch = vi.fn();

    render(
      <StandardToolbar
        search={{ value: '', onChange: vi.fn() }}
        filters={<input aria-label="筛选字段" />}
        onSearch={onSearch}
      />
    );

    fireEvent.click(screen.getAllByRole('button')[0]!);
    fireEvent.click(screen.getByText('搜索'));

    expect(onSearch).toHaveBeenCalledTimes(1);
  });
});
