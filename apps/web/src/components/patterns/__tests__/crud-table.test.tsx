import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CrudTable } from '../crud-table';

const { mockUseIsMobile } = vi.hoisted(() => ({
  mockUseIsMobile: vi.fn(() => false),
}));

interface Row {
  id: string;
  name: string;
  age: number;
}

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: mockUseIsMobile }));

vi.mock('@/components/mobile/ResponsiveDataList', () => ({
  ResponsiveDataList: ({ data, loading }: { data: Row[]; loading?: boolean }) => (
    <div
      data-testid="responsive-data-list"
      data-count={data.length}
      data-loading={String(loading)}
    />
  ),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock('@/components/ui/empty-state', () => ({
  EmptyState: ({
    title,
    description,
    children,
  }: {
    title: string;
    description: string;
    children?: React.ReactNode;
  }) => (
    <div>
      <div>{title}</div>
      <div>{description}</div>
      {children}
    </div>
  ),
}));

vi.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({
    checked,
    onCheckedChange,
    'aria-label': ariaLabel,
    onClick,
  }: {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    'aria-label'?: string;
    onClick?: (event: { stopPropagation: () => void }) => void;
  }) => (
    <button
      type="button"
      aria-label={ariaLabel}
      data-checked={checked ? 'true' : 'false'}
      onClick={() => {
        onClick?.({ stopPropagation: vi.fn() });
        onCheckedChange?.(!checked);
      }}
    />
  ),
}));

vi.mock('@/components/ui/data-table', () => ({
  DataTable: ({
    data,
    columns,
    error,
    stale,
    onRetry,
  }: {
    data: Row[];
    columns: Array<{
      key: string;
      header?: string;
      render?: (row: Row, index: number) => React.ReactNode;
    }>;
    error?: unknown;
    stale?: boolean;
    onRetry?: () => void;
  }) => (
    <div
      data-testid="data-table"
      data-columns={columns.map((c) => c.key).join(',')}
      data-error={error ? 'true' : 'false'}
      data-stale={stale ? 'true' : 'false'}
    >
      {onRetry && (
        <button type="button" onClick={onRetry}>
          mock retry
        </button>
      )}
      <div>
        {columns.map((col) => (
          <div key={col.key}>{typeof col.header === 'string' ? col.header : col.header}</div>
        ))}
      </div>
      {data.map((row, index) => (
        <div key={row.id}>
          {columns.map((col) => (
            <div key={col.key}>
              {col.render ? col.render(row, index) : row[col.key as keyof Row]}
            </div>
          ))}
        </div>
      ))}
    </div>
  ),
}));

vi.mock('../row-actions-menu', () => ({
  RowActionsMenu: ({ item }: { item: Row }) => <button type="button">操作 {item.name}</button>,
}));

describe('CrudTable', () => {
  const rows: Row[] = [
    { id: 'r1', name: '张三', age: 30 },
    { id: 'r2', name: '李四', age: 28 },
  ];
  const columns = [
    { key: 'name', header: '姓名' },
    { key: 'age', header: '年龄' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseIsMobile.mockReturnValue(false);
  });

  it('按列显隐配置过滤并排序列，同时追加选择列和操作列', () => {
    const onSelectionChange = vi.fn();

    render(
      <CrudTable
        data={rows}
        columns={columns}
        rowSelection={{ selectedKeys: new Set(['r1']), onSelectionChange }}
        columnVisibility={{
          columns: [
            { key: 'age', label: '年龄', visible: true },
            { key: 'name', label: '姓名', visible: false },
          ],
          onToggle: vi.fn(),
          onShowAll: vi.fn(),
        }}
        actions={[{ key: 'view', label: '查看', onClick: vi.fn() }]}
      />
    );

    expect(screen.getByTestId('data-table').getAttribute('data-columns')).toBe(
      '_selection,age,_actions'
    );
    expect(screen.getAllByText(/操作/)).toHaveLength(3);
  });

  it('把 error/retry/stale 通用请求状态传给 DataTable', () => {
    const onRetry = vi.fn();
    render(
      <CrudTable
        data={rows}
        columns={columns}
        error={new Error('private 500 detail')}
        stale
        onRetry={onRetry}
      />
    );

    expect(screen.getByTestId('data-table').getAttribute('data-error')).toBe('true');
    expect(screen.getByTestId('data-table').getAttribute('data-stale')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'mock retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('移动端首次加载失败时隐藏原始错误并允许重试', () => {
    mockUseIsMobile.mockReturnValue(true);
    const onRetry = vi.fn();

    render(
      <CrudTable<Row>
        data={[]}
        columns={columns}
        error={new Error('private database detail')}
        onRetry={onRetry}
        renderMobileCard={(row) => <div>{row.name}</div>}
      />
    );

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('数据加载失败')).toBeTruthy();
    expect(screen.queryByText(/private database detail/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('responsive-data-list')).toBeNull();
  });

  it('移动端刷新失败时保留旧数据、停止 loading 覆盖并允许重试', () => {
    mockUseIsMobile.mockReturnValue(true);
    const onRetry = vi.fn();

    render(
      <CrudTable
        data={rows}
        columns={columns}
        loading
        error={new Error('refresh failed')}
        onRetry={onRetry}
        renderMobileCard={(row) => <div>{row.name}</div>}
      />
    );

    expect(screen.getByRole('alert').textContent).toContain('当前显示上次加载结果');
    expect(screen.getByTestId('responsive-data-list').getAttribute('data-count')).toBe('2');
    expect(screen.getByTestId('responsive-data-list').getAttribute('data-loading')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('全选与行选择会产出新的 selectedKeys 集合', () => {
    const onSelectionChange = vi.fn();

    render(
      <CrudTable
        data={rows}
        columns={columns}
        rowSelection={{ selectedKeys: new Set(['r1']), onSelectionChange }}
      />
    );

    fireEvent.click(screen.getByLabelText('Select all'));
    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['r1', 'r2']));

    fireEvent.click(screen.getAllByLabelText('Select row')[0]!);
    expect(onSelectionChange).toHaveBeenLastCalledWith(new Set<string>());
  });
});
