import { Outlet } from 'react-router-dom';

import { Header } from '@/components/patterns/header';
import { Sidebar } from '@/components/patterns/sidebar';
import { useTokenManager } from '@/hooks/use-token-manager';

export function MainLayout() {
  // 启用 Token 管理：定期检查 token 有效性，自动刷新或跳转登录
  useTokenManager();

  return (
    <div className="flex h-screen overflow-hidden">
      {/* 侧边栏 */}
      <Sidebar />

      {/* 主内容区 */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* 顶部栏 */}
        <Header />

        {/* 内容区 */}
        <main className="flex-1 overflow-auto bg-muted/30 p-6 md:overflow-hidden md:p-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
