import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/stores/auth';

import { PermissionRoute, PrivateRoute, RoleRoute } from '../route-guards';

function renderPermissionRoute() {
  render(
    <MemoryRouter initialEntries={['/protected?tab=1']}>
      <Routes>
        <Route path="/login" element={<div>登录页</div>} />
        <Route path="/403" element={<div>无权限</div>} />
        <Route
          path="/protected"
          element={
            <PermissionRoute module="system" menu="filter_schemes">
              <div>受保护内容</div>
            </PermissionRoute>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

function renderGuard(element: React.ReactNode) {
  render(
    <MemoryRouter initialEntries={['/protected?tab=1#top']}>
      <Routes>
        <Route path="/login" element={<div>登录页</div>} />
        <Route path="/403" element={<div>无权限</div>} />
        <Route path="/protected" element={element} />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => {
  useAuthStore.setState({ isAuthenticated: false, user: null });
});

describe('PermissionRoute', () => {
  it('未登录时跳转登录页', () => {
    useAuthStore.setState({ isAuthenticated: false });
    renderPermissionRoute();
    expect(screen.getByText('登录页')).not.toBeNull();
  });

  it('缺少菜单权限时进入 403', () => {
    useAuthStore.setState({
      isAuthenticated: true,
      user: { roles: [] } as never,
      hasMenuPermission: vi.fn(() => false),
    });
    renderPermissionRoute();
    expect(screen.getByText('无权限')).not.toBeNull();
  });

  it('具备菜单权限时放行', () => {
    useAuthStore.setState({
      isAuthenticated: true,
      user: { roles: [] } as never,
      hasMenuPermission: vi.fn(() => true),
    });
    renderPermissionRoute();
    expect(screen.getByText('受保护内容')).not.toBeNull();
  });

  it('anyOf 任一菜单权限满足即放行，模块级权限作为无 menu 时的回退', () => {
    useAuthStore.setState({
      isAuthenticated: true,
      user: { roles: [] } as never,
      hasMenuPermission: vi.fn((_module: string, menu: string) => menu === 'projects'),
      hasPermission: vi.fn(() => false),
    });
    renderGuard(
      <PermissionRoute
        module="analytics"
        anyOf={[
          { module: 'analytics', menu: 'crm' },
          { module: 'analytics', menu: 'projects' },
        ]}
      >
        <div>任一权限内容</div>
      </PermissionRoute>
    );
    expect(screen.getByText('任一权限内容')).not.toBeNull();
  });

  it('无 menu 时按模块级 view 权限判断', () => {
    useAuthStore.setState({
      isAuthenticated: true,
      user: { roles: [] } as never,
      hasPermission: vi.fn(() => false),
    });
    renderGuard(
      <PermissionRoute module="analytics">
        <div>模块内容</div>
      </PermissionRoute>
    );
    expect(screen.getByText('无权限')).not.toBeNull();
  });
});

describe('PrivateRoute', () => {
  it('未登录时带原地址跳转登录页', () => {
    useAuthStore.setState({ isAuthenticated: false, isTokenValid: () => false });
    renderGuard(
      <PrivateRoute>
        <div>私有内容</div>
      </PrivateRoute>
    );
    expect(screen.getByText('登录页')).not.toBeNull();
  });

  it('已登录但 token 失效时同样要求重新登录', () => {
    useAuthStore.setState({ isAuthenticated: true, isTokenValid: () => false });
    renderGuard(
      <PrivateRoute>
        <div>私有内容</div>
      </PrivateRoute>
    );
    expect(screen.getByText('登录页')).not.toBeNull();
  });

  it('登录态与 token 均有效时渲染子节点', () => {
    useAuthStore.setState({ isAuthenticated: true, isTokenValid: () => true });
    renderGuard(
      <PrivateRoute>
        <div>私有内容</div>
      </PrivateRoute>
    );
    expect(screen.getByText('私有内容')).not.toBeNull();
  });
});

describe('RoleRoute', () => {
  it('未登录时跳转登录页', () => {
    useAuthStore.setState({ isAuthenticated: false, user: null });
    renderGuard(
      <RoleRoute requiredRoles={['ADMIN']}>
        <div>角色内容</div>
      </RoleRoute>
    );
    expect(screen.getByText('登录页')).not.toBeNull();
  });

  it('缺少所需角色时进入 403', () => {
    useAuthStore.setState({
      isAuthenticated: true,
      user: { roles: [{ code: 'SALES' }] } as never,
    });
    renderGuard(
      <RoleRoute requiredRoles={['ADMIN']}>
        <div>角色内容</div>
      </RoleRoute>
    );
    expect(screen.getByText('无权限')).not.toBeNull();
  });

  it('具备任一所需角色时放行', () => {
    useAuthStore.setState({
      isAuthenticated: true,
      user: { roles: [{ code: 'SALES' }, { code: 'ADMIN' }] } as never,
    });
    renderGuard(
      <RoleRoute requiredRoles={['ADMIN', 'MANAGER']}>
        <div>角色内容</div>
      </RoleRoute>
    );
    expect(screen.getByText('角色内容')).not.toBeNull();
  });
});
