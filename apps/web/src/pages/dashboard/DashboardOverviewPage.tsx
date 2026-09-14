// 复用 DashboardPage 中的 DesktopDashboard 组件
// 为了避免循环依赖，这里直接导入移动端组件，桌面端重定向到首页
import { Navigate } from 'react-router-dom';

import { useIsMobile } from '@/hooks/use-mobile';
import { MobileDashboard } from '@/pages/mobile/MobileDashboard';

/**
 * 首页概览页面
 * - 移动端：显示移动端仪表盘
 * - 桌面端：重定向到首页（桌面端首页就是仪表盘）
 */
export function DashboardOverviewPage() {
  const isMobile = useIsMobile();

  // 桌面端重定向到首页，因为首页就是仪表盘
  if (!isMobile) {
    return <Navigate to="/" replace />;
  }

  return <MobileDashboard />;
}
