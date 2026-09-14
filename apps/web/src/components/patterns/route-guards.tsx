import type { ReactNode } from 'react';
import type { Location } from 'react-router-dom';
import { Navigate, useLocation } from 'react-router-dom';

import { useAuthStore } from '@/stores/auth';

function getLoginRedirectTarget(location: Location): string {
  const target = `${location.pathname}${location.search}${location.hash}`;
  return `/login?redirect=${encodeURIComponent(target)}`;
}

export function PrivateRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isTokenValid } = useAuthStore();
  const location = useLocation();

  if (!isAuthenticated || !isTokenValid()) {
    const target = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={getLoginRedirectTarget(location)} replace state={{ from: target }} />;
  }

  return <>{children}</>;
}

export function RoleRoute({
  children,
  requiredRoles,
}: {
  children: ReactNode;
  requiredRoles: string[];
}) {
  const { isAuthenticated, user } = useAuthStore();
  const location = useLocation();

  if (!isAuthenticated) {
    const target = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={getLoginRedirectTarget(location)} replace state={{ from: target }} />;
  }

  if (!user?.roles.some((role) => requiredRoles.includes(role.code))) {
    return <Navigate to="/403" replace />;
  }

  return <>{children}</>;
}

interface PermissionRouteProps {
  children: ReactNode;
  module: string;
  menu?: string;
  anyOf?: Array<{ module: string; menu: string; action?: 'view' }>;
}

export function PermissionRoute({ children, module, menu, anyOf }: PermissionRouteProps) {
  const { isAuthenticated, hasPermission, hasMenuPermission } = useAuthStore();
  const location = useLocation();

  if (!isAuthenticated) {
    const target = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={getLoginRedirectTarget(location)} replace state={{ from: target }} />;
  }

  const hasAccess =
    anyOf && anyOf.length > 0
      ? anyOf.some((permission) =>
          hasMenuPermission(permission.module, permission.menu, permission.action ?? 'view')
        )
      : menu
        ? hasMenuPermission(module, menu, 'view')
        : hasPermission(module, 'view');

  return hasAccess ? <>{children}</> : <Navigate to="/403" replace />;
}
