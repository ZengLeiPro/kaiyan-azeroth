import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  update: vi.fn(),
  actionOptions: undefined as
    | {
        onOffSale: (product: { id: string; version?: number }) => void;
      }
    | undefined,
}));

vi.mock('@/hooks/use-crud', () => ({
  useCrud: () => ({
    data: [],
    loading: false,
    tableProps: {},
    pagination: {},
    sorting: {},
    openViewDialog: vi.fn(),
    openEditDialog: vi.fn(),
    openDeleteDialog: vi.fn(),
    update: state.update,
    rowSelectionProps: { selectedKeys: new Set(), onSelectionChange: vi.fn() },
    selectedKeys: new Set(),
    clearSelection: vi.fn(),
    openBulkDeleteDialog: vi.fn(),
    formDialogProps: {},
    isEditing: false,
    handleSubmit: vi.fn(),
    editingEntity: null,
    formData: {},
    getFieldError: vi.fn(),
    deleteConfirmProps: {},
    bulkDeleteConfirmProps: {},
  }),
}));

vi.mock('@/hooks/use-filter-scheme', () => ({
  useFilterScheme: () => ({
    isLoading: false,
    fields: [],
    initialFilters: {},
    version: 1,
  }),
}));
vi.mock('@/hooks/use-manual-filter', () => ({
  useManualFilter: () => ({
    apiParams: {},
    tempFilters: {},
    search: vi.fn(),
    reset: vi.fn(),
    setFilter: vi.fn(),
  }),
}));
vi.mock('@/hooks/use-column-visibility', () => ({
  useColumnVisibility: () => ({
    columns: [],
    toggleColumn: vi.fn(),
    showAll: vi.fn(),
    resetToDefault: vi.fn(),
    reorderColumns: vi.fn(),
  }),
}));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ hasMenuPermission: () => true }),
}));
vi.mock('@/lib/columns-from-schema', () => ({
  deriveColumnsFromSchema: () => [],
}));
vi.mock('../product-actions', () => ({
  createCrmProductActions: vi.fn((options) => {
    state.actionOptions = options;
    return [];
  }),
}));
vi.mock('@/components/mobile', () => ({
  MobileBottomBar: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  MobileBottomBarSpacer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/templates/standard-layout', () => ({
  StandardLayout: ({
    toolbar,
    children,
  }: {
    toolbar: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <>
      {toolbar}
      {children}
    </>
  ),
}));
vi.mock('@/components/patterns/standard-toolbar', () => ({
  StandardToolbar: () => null,
}));
vi.mock('@/components/patterns/crud-table', () => ({ CrudTable: () => null }));
vi.mock('@/components/patterns/form-dialog', () => ({
  FormDialog: () => null,
}));
vi.mock('@/components/patterns/delete-confirm', () => ({
  DeleteConfirm: () => null,
}));
vi.mock('@/components/patterns/bulk-delete-confirm', () => ({
  BulkDeleteConfirm: () => null,
}));
vi.mock('@/components/patterns/column-visibility', () => ({
  ColumnVisibilityDropdown: () => null,
}));
vi.mock('@/components/patterns/crud-filter-bar', () => ({
  CrudFilterBar: () => null,
}));
vi.mock('@/components/patterns/filter-bar-skeleton', () => ({
  FilterBarSkeleton: () => null,
}));

import { CrmProductsPage } from '../CrmProductsPage';

describe('CrmProductsPage', () => {
  beforeEach(() => {
    state.update.mockReset();
    state.actionOptions = undefined;
  });

  it('should wire the off-sale action to an optimistic product update', () => {
    render(<CrmProductsPage />);

    expect(state.actionOptions).toBeDefined();
    state.actionOptions?.onOffSale({ id: 'product-1', version: 2 });
    expect(state.update).toHaveBeenCalledWith('product-1', {
      productStatus: 'off_sale',
      version: 2,
    });
  });
});
