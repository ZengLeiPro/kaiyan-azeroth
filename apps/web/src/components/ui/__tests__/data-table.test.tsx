import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DataTable } from '../data-table';

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/hooks/use-column-widths', () => ({
  useColumnWidths: () => ({ widths: {}, onResize: vi.fn() }),
}));

interface Row {
  id: string;
  name: string;
}

const columns = [{ key: 'name', header: '姓名', ellipsis: false }];

describe('DataTable error and keyboard states', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['403', new Error('Request failed with status code 403: internal permission policy')],
    ['500', new Error('Request failed with status code 500: database host db.internal')],
  ])('将 %s 首屏错误显示为脱敏失败态并允许重试', (_status, error) => {
    const onRetry = vi.fn();
    const { container } = render(
      <DataTable<Row>
        data={[]}
        columns={columns}
        error={error}
        onRetry={onRetry}
        emptyState={{ title: '暂无客户' }}
      />
    );

    expect(screen.getByText('数据加载失败')).toBeTruthy();
    expect(screen.queryByText('暂无客户')).toBeNull();
    expect(container.textContent).not.toContain(error.message);

    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('刷新失败时保留旧数据并显示可重试 stale 告警', () => {
    const onRetry = vi.fn();
    render(
      <DataTable<Row>
        data={[{ id: '1', name: '保留的客户' }]}
        columns={columns}
        loading={false}
        error={new Error('500 private stack trace')}
        stale
        onRetry={onRetry}
      />
    );

    expect(screen.getByText('保留的客户')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('当前显示上次加载结果');
    expect(screen.queryByText('数据加载失败')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('普通单元格与独立详情按钮各触发一次，行内操作不冒泡且行保持 row 语义', () => {
    const onRowClick = vi.fn();
    const nestedAction = vi.fn();
    render(
      <DataTable<Row>
        data={[{ id: '1', name: '键盘客户' }]}
        columns={[
          ...columns,
          {
            key: 'actions',
            header: '操作',
            ellipsis: false,
            render: () => (
              <button type="button" onClick={nestedAction}>
                行内操作
              </button>
            ),
          },
        ]}
        onRowClick={onRowClick}
      />
    );

    const row = screen.getByRole('row', { name: /键盘客户/ });
    const detailButton = screen.getByRole('button', { name: '查看键盘客户详情' });
    expect(row.getAttribute('role')).toBeNull();
    expect(row.getAttribute('tabindex')).toBeNull();
    expect(detailButton.tagName).toBe('BUTTON');
    detailButton.focus();
    expect(document.activeElement).toBe(detailButton);

    fireEvent.click(screen.getByText('键盘客户'));
    fireEvent.click(detailButton);
    expect(onRowClick).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: '行内操作' }));
    expect(nestedAction).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledTimes(2);
    expect(row.querySelector('[role="button"] button')).toBeNull();
    expect(row.querySelector('button button')).toBeNull();
  });
});
