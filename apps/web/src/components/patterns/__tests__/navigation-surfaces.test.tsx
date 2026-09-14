import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { MobileWorkbench } from '@/pages/mobile/MobileWorkbench';

import { Sidebar } from '../sidebar';

vi.mock('@/hooks/use-filtered-menu-groups', () => ({
  useFilteredMenuGroups: () => [
    {
      key: 'crm',
      name: '客户管理',
      icon: () => null,
      items: [
        {
          key: 'customers',
          name: '客户',
          path: '/crm/customers',
          icon: () => null,
        },
      ],
    },
  ],
}));

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    user: { username: '测试用户', roles: [] },
    hasMenuPermission: () => false,
    hasViewScopeAll: () => false,
  }),
}));

vi.mock('@/components/patterns/sales-action', () => ({
  ATTACK_CARD_ICON: () => null,
  ATTACK_CARD_ICON_BG: '',
  ATTACK_CARD_ICON_FG: '',
  ATTACK_CATEGORIES: [],
  DEFENSE_CARD_ICON: () => null,
  DEFENSE_CARD_ICON_BG: '',
  DEFENSE_CARD_ICON_FG: '',
  DEFENSE_CATEGORIES: [],
  useAdminActionItemCount: () => ({ data: 0 }),
  useMyActionItemCount: () => ({ data: 0 }),
}));

describe('导航界面', () => {
  it('侧边栏折叠后展示工作台提示', () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByTestId('sidebar-collapse-btn'));

    expect(screen.getByTestId('menu-tooltip-dashboard')).not.toBeNull();
  });

  it('移动工作台展示有权限的菜单入口', () => {
    render(
      <MemoryRouter>
        <MobileWorkbench />
      </MemoryRouter>
    );

    expect(screen.getByText('客户管理')).not.toBeNull();
    expect(screen.getByText('客户')).not.toBeNull();
  });
});
