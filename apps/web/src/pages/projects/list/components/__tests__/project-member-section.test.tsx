import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectMemberSection } from '../ProjectMemberSection';

const mocks = vi.hoisted(() => ({ apiGet: vi.fn(), apiDelete: vi.fn(), apiPost: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { get: mocks.apiGet, delete: mocks.apiDelete, post: mocks.apiPost },
  getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : '操作失败'),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/components/patterns/employee-select', () => ({
  EmployeeSelect: () => <div>员工选择器</div>,
}));

function member(version?: number) {
  return { id: 'member-1', employeeId: 'emp-1', userName: '张三', role: null, version };
}

function removeButtonFor(name: string): HTMLButtonElement {
  const row = screen.getByText(name).closest('div.justify-between');
  const button = row?.querySelector('button');
  if (!button) throw new Error('未找到移除按钮');
  return button;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.apiDelete.mockResolvedValue({ data: { success: true } });
});

describe('ProjectMemberSection 移除成员', () => {
  it('成员缺少 version 时拒绝移除并重新拉取列表', async () => {
    mocks.apiGet.mockResolvedValue({ data: [member()] });
    render(<ProjectMemberSection projectId="project-1" isViewMode={false} />);
    await screen.findByText('张三');

    fireEvent.click(removeButtonFor('张三'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('成员数据版本缺失，请刷新后重试'));
    expect(mocks.apiDelete).not.toHaveBeenCalled();
    expect(mocks.apiGet).toHaveBeenCalledTimes(2);
  });

  it('移除成员时携带 version 作为乐观锁', async () => {
    mocks.apiGet.mockResolvedValue({ data: [member(2)] });
    render(<ProjectMemberSection projectId="project-1" isViewMode={false} />);
    await screen.findByText('张三');

    fireEvent.click(removeButtonFor('张三'));

    await waitFor(() =>
      expect(mocks.apiDelete).toHaveBeenCalledWith('/projects/project-1/members/member-1', {
        params: { version: 2 },
      })
    );
    expect(toast.success).toHaveBeenCalledWith('已移除成员: 张三');
  });
});
