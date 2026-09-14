import { PROJECT_TICKET_STATUS } from '@ky-azeroth/shared/constants/project-ticket-constants';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invalidateAnalyticsQueries } from '@/hooks/analytics-invalidation';

import { TicketReassignDialog } from '../TicketReassignDialog';
import { TicketTransitionDialog } from '../TicketTransitionDialog';

const mocks = vi.hoisted(() => ({ apiPatch: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: { patch: mocks.apiPatch },
  getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : '操作失败'),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/hooks/analytics-invalidation', () => ({
  invalidateAnalyticsQueries: vi.fn(async () => undefined),
}));
vi.mock('@/components/patterns/employee-select', () => ({
  EmployeeSelect: ({ onChange }: { onChange: (value: string) => void }) => (
    <button type="button" onClick={() => onChange('emp-2')}>
      选择员工
    </button>
  ),
}));

function ticket(version?: number) {
  return {
    id: 'ticket-1',
    ticketNo: 'T-001',
    title: '测试工单',
    assigneeId: 'emp-1',
    assignee: { id: 'emp-1', name: '甲' },
    version,
  } as never;
}

function renderWithClient(node: React.ReactElement) {
  const client = new QueryClient();
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.apiPatch.mockResolvedValue({ data: {} });
});

describe('TicketReassignDialog', () => {
  it('工单缺少 version 时拒绝改派并关闭对话框', async () => {
    const onOpenChange = vi.fn();
    const onSuccess = vi.fn();
    renderWithClient(
      <TicketReassignDialog
        open
        ticket={ticket()}
        onOpenChange={onOpenChange}
        onSuccess={onSuccess}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '选择员工' }));
    fireEvent.click(screen.getByRole('button', { name: '确认改派' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('工单数据版本缺失，请刷新后重试'));
    expect(mocks.apiPatch).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSuccess).toHaveBeenCalled();
  });

  it('改派成功后携带 version 并刷新项目分析缓存', async () => {
    const onSuccess = vi.fn();
    renderWithClient(
      <TicketReassignDialog open ticket={ticket(4)} onOpenChange={vi.fn()} onSuccess={onSuccess} />
    );
    fireEvent.click(screen.getByRole('button', { name: '选择员工' }));
    fireEvent.click(screen.getByRole('button', { name: '确认改派' }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(mocks.apiPatch).toHaveBeenCalledWith('/project-tickets/ticket-1/assignee', {
      assigneeId: 'emp-2',
      version: 4,
    });
    expect(invalidateAnalyticsQueries).toHaveBeenCalledWith(expect.anything(), '/project-tickets');
    expect(toast.success).toHaveBeenCalledWith('改派成功');
  });
});

describe('TicketTransitionDialog', () => {
  it('工单缺少 version 时拒绝流转并关闭对话框', async () => {
    const onOpenChange = vi.fn();
    const onSuccess = vi.fn();
    renderWithClient(
      <TicketTransitionDialog
        open
        ticket={ticket()}
        toStatus={PROJECT_TICKET_STATUS.IN_PROGRESS}
        onOpenChange={onOpenChange}
        onSuccess={onSuccess}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '确认' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('工单数据版本缺失，请刷新后重试'));
    expect(mocks.apiPatch).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSuccess).toHaveBeenCalled();
  });

  it('流转成功后携带 version 并刷新项目分析缓存', async () => {
    const onSuccess = vi.fn();
    renderWithClient(
      <TicketTransitionDialog
        open
        ticket={ticket(2)}
        toStatus={PROJECT_TICKET_STATUS.IN_PROGRESS}
        onOpenChange={vi.fn()}
        onSuccess={onSuccess}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: '确认' }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(mocks.apiPatch).toHaveBeenCalledWith(
      '/project-tickets/ticket-1/status',
      expect.objectContaining({ version: 2 })
    );
    expect(invalidateAnalyticsQueries).toHaveBeenCalledWith(expect.anything(), '/project-tickets');
  });
});
