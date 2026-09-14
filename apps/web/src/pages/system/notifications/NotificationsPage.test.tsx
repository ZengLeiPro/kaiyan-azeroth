import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { NotificationsPage } from './NotificationsPage';

const mocks = vi.hoisted(() => ({
  mapFilters: undefined as
    | ((filters: Record<string, unknown>) => Record<string, unknown>)
    | undefined,
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('@/hooks/use-filter-scheme', () => ({
  useFilterScheme: () => ({
    fields: [],
    initialFilters: {},
    version: 0,
    isLoading: false,
    isFallback: false,
  }),
}));

vi.mock('@/hooks/use-manual-filter', () => ({
  useManualFilter: (
    _initialFilters: Record<string, unknown>,
    mapFilters: (filters: Record<string, unknown>) => Record<string, unknown>
  ) => {
    mocks.mapFilters = mapFilters;
    return {
      apiParams: {},
      tempFilters: {},
      search: vi.fn(),
      reset: vi.fn(),
      setFilter: vi.fn(),
      replaceFilters: vi.fn(),
    };
  },
}));

vi.mock('@/hooks/use-crud', () => ({
  useCrud: () => ({
    data: [],
    pagination: {},
    refresh: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/lib/columns-from-schema', () => ({ deriveColumnsFromSchema: () => [] }));
vi.mock('@/components/patterns/crud-filter-bar', () => ({ CrudFilterBar: () => null }));
vi.mock('@/components/patterns/crud-table', () => ({ CrudTable: () => null }));
vi.mock('@/components/patterns/generic-mobile-card', () => ({ GenericMobileCard: () => null }));
vi.mock('@/components/patterns/filter-bar-skeleton', () => ({ FilterBarSkeleton: () => null }));
vi.mock('@/components/patterns/standard-toolbar', () => ({
  StandardToolbar: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/templates/standard-layout', () => ({
  StandardLayout: ({ children }: { children?: ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/components/mobile', () => ({
  MobileBottomBar: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  MobileBottomBarSpacer: () => null,
}));

describe('NotificationsPage 筛选映射', () => {
  it('把已读状态转换为通知接口参数', () => {
    render(<NotificationsPage />);

    expect(mocks.mapFilters?.({ 'filters[readStatus]': 'read' })).toEqual({
      type: undefined,
      read: 'true',
    });
    expect(mocks.mapFilters?.({ 'filters[readStatus]': 'unread' })).toEqual({
      type: undefined,
      read: 'false',
    });
    expect(mocks.mapFilters?.({ 'filters[readStatus]': '' })).toEqual({
      type: undefined,
      read: undefined,
    });
  });
});
