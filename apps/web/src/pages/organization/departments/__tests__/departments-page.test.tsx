import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invalidateAnalyticsQueries } from '@/hooks/analytics-invalidation';
import { useAuthStore } from '@/stores/auth';

import { DepartmentsPage } from '../DepartmentsPage';

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  api: { get: mocks.apiGet, post: mocks.apiPost, put: mocks.apiPut, delete: mocks.apiDelete },
  getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : '操作失败'),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/hooks/analytics-invalidation', () => ({
  invalidateAnalyticsQueries: vi.fn(async () => undefined),
}));
vi.mock('@/components/patterns/employee-select', () => ({
  EmployeeSelect: ({ onChange }: { onChange: (value: string) => void }) => (
    <button type="button" onClick={() => onChange('emp-9')}>
      挑选员工
    </button>
  ),
}));
vi.mock('@/components/patterns/department-select', () => ({
  DepartmentSelect: () => <div>上级部门选择器</div>,
}));

const tree = [
  {
    id: 'dept-1',
    name: '研发部',
    parentId: null,
    sortOrder: 0,
    managerId: null,
    status: 'ACTIVE',
    employeeCount: 1,
    children: [],
  },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DepartmentsPage />
    </QueryClientProvider>
  );
}

async function selectDepartment() {
  renderPage();
  fireEvent.click(await screen.findByText('研发部'));
  await screen.findByText('部门详细信息');
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ hasMenuPermission: () => true } as never);
  mocks.apiGet.mockImplementation(async (url: string) => {
    if (url === '/departments/tree') return { data: tree };
    if (url.endsWith('/employees')) {
      return {
        data: {
          items: [{ id: 'emp-1', name: '张三', isPrimary: true, phone: null, position: null }],
          total: 1,
          page: 1,
          pageSize: 50,
          totalPages: 1,
        },
      };
    }
    throw new Error(`未预期的请求 ${url}`);
  });
  mocks.apiPost.mockResolvedValue({ data: {} });
  mocks.apiPut.mockResolvedValue({ data: {} });
  mocks.apiDelete.mockResolvedValue({ data: {} });
  vi.stubGlobal(
    'ResizeObserver',
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
  );
});

describe('DepartmentsPage 写操作后刷新', () => {
  it('新建部门成功后刷新树并让组织分析缓存失效', async () => {
    renderPage();
    await screen.findByText('研发部');
    fireEvent.click(screen.getByRole('button', { name: /新建/ }));
    await screen.findByText('新建部门');
    fireEvent.change(screen.getByPlaceholderText('请输入部门名称'), {
      target: { value: '市场部' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('部门创建成功'));
    expect(mocks.apiPost).toHaveBeenCalledWith(
      '/departments',
      expect.objectContaining({ name: '市场部' })
    );
    expect(invalidateAnalyticsQueries).toHaveBeenCalledWith(expect.anything(), '/departments');
  });

  it('编辑部门成功后刷新树', async () => {
    await selectDepartment();
    fireEvent.click(screen.getByRole('button', { name: /编辑/ }));
    await screen.findByText('编辑部门');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('部门更新成功'));
    expect(mocks.apiPut).toHaveBeenCalledWith(
      '/departments/dept-1',
      expect.objectContaining({ name: '研发部' })
    );
    expect(invalidateAnalyticsQueries).toHaveBeenCalledWith(expect.anything(), '/departments');
  });

  it('删除部门成功后清空选中并刷新', async () => {
    await selectDepartment();
    fireEvent.click(screen.getByRole('button', { name: /删除/ }));
    fireEvent.click(await screen.findByRole('button', { name: '确认删除' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('部门删除成功'));
    expect(mocks.apiDelete).toHaveBeenCalledWith('/departments/dept-1');
    expect(invalidateAnalyticsQueries).toHaveBeenCalledWith(expect.anything(), '/departments');
  });

  it('添加员工成功后刷新员工列表与树', async () => {
    await selectDepartment();
    fireEvent.click(screen.getByRole('button', { name: /添加员工/ }));
    await screen.findByText(/添加员工到/);
    fireEvent.click(await screen.findByText('挑选员工'));
    fireEvent.click(screen.getByRole('button', { name: '添加' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('员工添加成功'));
    expect(mocks.apiPost).toHaveBeenCalledWith(
      expect.stringContaining('/departments/dept-1'),
      expect.objectContaining({ employeeId: 'emp-9' })
    );
    expect(invalidateAnalyticsQueries).toHaveBeenCalledWith(expect.anything(), '/departments');
  });

  it('移除员工成功后刷新员工列表与树', async () => {
    await selectDepartment();
    await screen.findByText('张三');
    fireEvent.click(screen.getByTitle('移除员工'));
    fireEvent.click(await screen.findByRole('button', { name: '确认移除' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('员工已移除'));
    expect(mocks.apiDelete).toHaveBeenCalledWith('/departments/dept-1/employees/emp-1');
    expect(invalidateAnalyticsQueries).toHaveBeenCalledWith(expect.anything(), '/departments');
  });
});
