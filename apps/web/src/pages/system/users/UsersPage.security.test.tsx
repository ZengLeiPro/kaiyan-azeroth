import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';

import { UsersPage } from './UsersPage';

const mocks = vi.hoisted(() => ({
  request: vi.fn(() => false),
  confirm: vi.fn(async () => undefined),
  cancel: vi.fn(),
  onDialogOpenChange: vi.fn(),
  setPassword: vi.fn(),
  handleSubmit: vi.fn(async () => undefined),
  handleDelete: vi.fn(async () => undefined),
  handleBulkDelete: vi.fn(async () => undefined),
  deleteOpenChange: vi.fn(),
  bulkDeleteOpenChange: vi.fn(),
}));

vi.mock('./use-sensitive-action-reauthentication', () => ({
  useSensitiveActionReauthentication: () => ({
    dialogOpen: true,
    password: 'secret-123',
    loading: false,
    request: mocks.request,
    confirm: mocks.confirm,
    cancel: mocks.cancel,
    onDialogOpenChange: mocks.onDialogOpenChange,
    setPassword: mocks.setPassword,
  }),
}));

vi.mock('@/hooks/use-crud', () => ({
  useCrud: () => ({
    formData: {
      username: 'admin01',
      phone: '13800138000',
      email: 'admin@example.com',
      password: 'Abcdef12',
      employeeId: '',
      roleIds: ['role-1'],
    },
    handleSubmit: mocks.handleSubmit,
    handleDelete: mocks.handleDelete,
    handleBulkDelete: mocks.handleBulkDelete,
    deleteConfirmProps: { open: true, onOpenChange: mocks.deleteOpenChange },
    bulkDeleteConfirmProps: { open: true, onOpenChange: mocks.bulkDeleteOpenChange },
    formDialogProps: {},
    pagination: {},
    tableProps: {},
    data: [],
    loading: false,
    sorting: [],
    rowSelectionProps: {},
    selectedKeys: new Set<string>(),
    clearSelection: vi.fn(),
    openBulkDeleteDialog: vi.fn(),
    openCreateDialog: vi.fn(),
    openViewDialog: vi.fn(),
    openEditDialog: vi.fn(),
    openDeleteDialog: vi.fn(),
    refresh: vi.fn(),
    updateFormField: vi.fn(),
    getFieldError: vi.fn(),
    closeDialog: vi.fn(),
    isEditing: false,
    isViewMode: false,
    editingEntity: null,
  }),
}));

vi.mock('@/hooks/use-manual-filter', () => ({
  useManualFilter: () => ({
    apiParams: {},
    tempFilters: { keyword: '', status: [], roleId: [] },
    search: vi.fn(),
    reset: vi.fn(),
    setFilter: vi.fn(),
    replaceFilters: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-filter-scheme', () => ({
  useFilterScheme: () => ({
    fields: [],
    initialFilters: {},
    keywordFieldKeys: [],
    version: 0,
    isLoading: false,
    isFallback: true,
    registry: null,
    config: null,
    defaultConfig: null,
  }),
}));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/lib/columns-from-schema', () => ({ deriveColumnsFromSchema: () => [] }));
vi.mock('@/components/patterns/row-actions-helpers', () => ({
  createStandardActions: () => [],
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: { get: vi.fn(), patch: vi.fn() },
  };
});

vi.mock('@/components/mobile', () => ({
  MobileBottomBar: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  MobileBottomBarSpacer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/mobile/ResponsiveDialog', () => ({
  ResponsiveDialog: ({ children, footer }: { children?: ReactNode; footer?: ReactNode }) => (
    <section>
      {children}
      {footer}
    </section>
  ),
}));
vi.mock('@/components/patterns/standard-toolbar', () => ({
  StandardToolbar: ({ filters }: { filters?: ReactNode }) => <div>{filters}</div>,
}));
vi.mock('@/components/templates/standard-layout', () => ({
  StandardLayout: ({ toolbar, children }: { toolbar?: ReactNode; children?: ReactNode }) => (
    <main>
      {toolbar}
      {children}
    </main>
  ),
}));
vi.mock('@/components/patterns/form-dialog', () => ({
  FormDialog: ({
    children,
    onSubmit,
  }: {
    children?: ReactNode;
    onSubmit: () => Promise<unknown>;
  }) => (
    <section>
      <button data-testid="submit-user" onClick={() => void onSubmit()}>
        提交用户
      </button>
      {children}
    </section>
  ),
}));
vi.mock('@/components/patterns/form-field', () => ({
  FormField: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/patterns/crud-table', () => ({ CrudTable: () => null }));
vi.mock('@/components/patterns/generic-mobile-card', () => ({ GenericMobileCard: () => null }));
vi.mock('@/components/ui/select', () => ({ MultiSelect: () => null, Select: () => null }));
vi.mock('@/components/patterns/delete-confirm', () => ({
  DeleteConfirm: ({ onConfirm }: { onConfirm: () => unknown }) => (
    <button data-testid="confirm-delete" onClick={() => void onConfirm()}>
      删除
    </button>
  ),
}));
vi.mock('@/components/patterns/bulk-delete-confirm', () => ({
  BulkDeleteConfirm: ({ onConfirm }: { onConfirm: () => unknown }) => (
    <button data-testid="confirm-bulk-delete" onClick={() => void onConfirm()}>
      批量删除
    </button>
  ),
}));

describe('UsersPage 敏感操作二次认证接线', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get)
      .mockResolvedValueOnce({ data: { items: [{ id: 'role-1', name: '管理员' }] } })
      .mockResolvedValueOnce({ data: [] });
  });

  it('新增、删除和批量删除都先进入统一二次认证流程', async () => {
    render(<UsersPage />);
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByTestId('submit-user'));
    expect(mocks.request).toHaveBeenCalledWith(mocks.handleSubmit);

    fireEvent.change(screen.getByTestId('reauthentication-password-input'), {
      target: { value: 'changed-password' },
    });
    fireEvent.keyDown(screen.getByTestId('reauthentication-password-input'), { key: 'Enter' });
    fireEvent.click(screen.getByTestId('confirm-reauthentication-btn'));
    expect(mocks.setPassword).toHaveBeenCalledWith('changed-password');
    expect(mocks.confirm).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByTestId('confirm-delete'));
    expect(mocks.deleteOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.request).toHaveBeenCalledWith(mocks.handleDelete);

    fireEvent.click(screen.getByTestId('confirm-bulk-delete'));
    expect(mocks.bulkDeleteOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.request).toHaveBeenCalledWith(mocks.handleBulkDelete);
  });
});
