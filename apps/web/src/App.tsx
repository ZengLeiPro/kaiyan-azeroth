import { Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';

// 布局
import { ResponsiveLayout } from '@/components/templates/responsive-layout';

import { AppUpdatePrompt } from './components/patterns/app-update-prompt';
import { DrawerStackHost, DrawerStackProvider } from './components/patterns/drawer-stack';
import { NetworkErrorDialog } from './components/patterns/network-error';
import { RateLimitToast } from './components/patterns/rate-limit-toast';
import { PermissionRoute, PrivateRoute } from './components/patterns/route-guards';
import { PageSkeleton } from './components/ui/skeleton';
import { useAuthBootstrap } from './hooks/use-auth-bootstrap';
import { useSchemeVersionWatcher } from './hooks/use-scheme-version-watcher';
import { lazyLoad } from './lib/lazy-load';
// 核心页面 - 保持静态导入
import { LoginPage } from './pages/auth/LoginPage';
import { bootstrapCrmDrawerEntities } from './pages/crm/bootstrap-drawer-entities';
import { DashboardOverviewPage } from './pages/dashboard/DashboardOverviewPage';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { ForbiddenPage } from './pages/error/ForbiddenPage';
import { NotFoundPage } from './pages/error/NotFoundPage';

bootstrapCrmDrawerEntities();

// 个人设置
const ProfileSettingsPage = lazyLoad(() =>
  import('./pages/profile/ProfileSettingsPage').then((m) => ({ default: m.ProfileSettingsPage }))
);

// ==================== 经营分析 ====================
const AnalyticsOverviewPage = lazyLoad(() =>
  import('./pages/analytics/AnalyticsOverviewPage').then((m) => ({ default: m.default }))
);
const CrmAnalyticsPage = lazyLoad(() =>
  import('./pages/analytics/CrmAnalyticsPage').then((m) => ({ default: m.default }))
);
const ProjectAnalyticsPage = lazyLoad(() =>
  import('./pages/analytics/ProjectAnalyticsPage').then((m) => ({ default: m.default }))
);
const OrgAnalyticsPage = lazyLoad(() =>
  import('./pages/analytics/OrgAnalyticsPage').then((m) => ({ default: m.default }))
);
const SeoAnalyticsPage = lazyLoad(() =>
  import('./pages/analytics/SeoAnalyticsPage').then((m) => ({ default: m.default }))
);
const SeoSyncLogsPage = lazyLoad(() =>
  import('./pages/analytics/SeoSyncLogsPage').then((m) => ({ default: m.default }))
);
const WebAnalyticsPage = lazyLoad(() =>
  import('./pages/analytics/WebAnalyticsPage').then((m) => ({ default: m.default }))
);
const XiaohongshuCenterPage = lazyLoad(() =>
  import('./pages/analytics/xiaohongshu/XiaohongshuCenterPage').then((m) => ({
    default: m.default,
  }))
);

// ==================== CRM ====================
const CustomersPage = lazyLoad(() =>
  import('./pages/crm/customers/CustomersPage').then((m) => ({ default: m.CustomersPage }))
);
const ContactsPage = lazyLoad(() =>
  import('./pages/crm/contacts/ContactsPage').then((m) => ({ default: m.ContactsPage }))
);
const OpportunitiesPage = lazyLoad(() =>
  import('./pages/crm/opportunities/OpportunitiesPage').then((m) => ({
    default: m.OpportunitiesPage,
  }))
);
const SaleOrdersPage = lazyLoad(() =>
  import('./pages/crm/sale-orders/SaleOrdersPage').then((m) => ({ default: m.SaleOrdersPage }))
);
const PaymentsPage = lazyLoad(() =>
  import('./pages/crm/payments/PaymentsPage').then((m) => ({ default: m.PaymentsPage }))
);
const InvoicesPage = lazyLoad(() =>
  import('./pages/crm/invoices/InvoicesPage').then((m) => ({ default: m.InvoicesPage }))
);
const KeepRecordsPage = lazyLoad(() =>
  import('./pages/crm/keep-records/KeepRecordsPage').then((m) => ({ default: m.KeepRecordsPage }))
);
const VisitRecordsPage = lazyLoad(() =>
  import('./pages/crm/visit-records/VisitRecordsPage').then((m) => ({
    default: m.VisitRecordsPage,
  }))
);
const CrmProductsPage = lazyLoad(() =>
  import('./pages/crm/products/CrmProductsPage').then((m) => ({ default: m.CrmProductsPage }))
);
const SalesActionItemsPage = lazyLoad(() =>
  import('./pages/sales-action-items/SalesActionItemsPage').then((m) => ({
    default: m.SalesActionItemsPage,
  }))
);
// ==================== 项目管理 ====================
const ProjectsPage = lazyLoad(() =>
  import('./pages/projects/list/ProjectsPage').then((m) => ({ default: m.ProjectsPage }))
);
const EffortRecordsPage = lazyLoad(() =>
  import('./pages/projects/effort-records/EffortRecordsPage').then((m) => ({
    default: m.EffortRecordsPage,
  }))
);
const EffortStatsPage = lazyLoad(() =>
  import('./pages/projects/effort-stats/EffortStatsPage').then((m) => ({
    default: m.EffortStatsPage,
  }))
);
const ProjectTicketsPage = lazyLoad(() =>
  import('./pages/projects/tickets/ProjectTicketsPage').then((m) => ({
    default: m.ProjectTicketsPage,
  }))
);

// ==================== 工作汇报 ====================
const WorkDailiesPage = lazyLoad(() =>
  import('./pages/reports/work-dailies/WorkDailiesPage').then((m) => ({
    default: m.WorkDailiesPage,
  }))
);
const TelesalesDailiesPage = lazyLoad(() =>
  import('./pages/reports/telesales-dailies/TelesalesDailiesPage').then((m) => ({
    default: m.TelesalesDailiesPage,
  }))
);
const DingtalkLogsPage = lazyLoad(() =>
  import('./pages/reports/dingtalk-logs/DingtalkLogsPage').then((m) => ({
    default: m.DingtalkLogsPage,
  }))
);
const CalendarEventsPage = lazyLoad(() =>
  import('./pages/reports/calendar-events/CalendarEventsPage').then((m) => ({
    default: m.CalendarEventsPage,
  }))
);
const EmployeeLeavesPage = lazyLoad(() =>
  import('./pages/reports/employee-leaves/EmployeeLeavesPage').then((m) => ({
    default: m.EmployeeLeavesPage,
  }))
);

// ==================== 组织架构 ====================
const EmployeesPage = lazyLoad(() =>
  import('./pages/organization/employees/EmployeesPage').then((m) => ({
    default: m.EmployeesPage,
  }))
);
const DepartmentsPage = lazyLoad(() =>
  import('./pages/organization/departments/DepartmentsPage').then((m) => ({
    default: m.DepartmentsPage,
  }))
);

// ==================== 审批管理 ====================
const ApprovalsPage = lazyLoad(() =>
  import('./pages/approvals/ApprovalsPage').then((m) => ({
    default: m.ApprovalsPage,
  }))
);
const ApprovalFlowsPage = lazyLoad(() =>
  import('./pages/approval-flows/ApprovalFlowsPage').then((m) => ({
    default: m.ApprovalFlowsPage,
  }))
);
const ApprovalFlowDesignPage = lazyLoad(() =>
  import('./pages/approval-flows/ApprovalFlowDesignPage').then((m) => ({
    default: m.ApprovalFlowDesignPage,
  }))
);
const ApprovalFlowHistoryPage = lazyLoad(() =>
  import('./pages/approval-flows/ApprovalFlowHistoryPage').then((m) => ({
    default: m.ApprovalFlowHistoryPage,
  }))
);
const ApprovalSettingsPage = lazyLoad(() =>
  import('./pages/approval-flows/ApprovalSettingsPage').then((m) => ({
    default: m.ApprovalSettingsPage,
  }))
);

// ==================== 财务管理 ====================
const PayrollPage = lazyLoad(() =>
  import('./pages/finance/payroll/PayrollPage').then((m) => ({ default: m.PayrollPage }))
);
// 财务总账综合视图（system/roles 控制可见性）
// 顶部 SegmentedToggle 切换公司流水 / 个人流水 / 损益表三个子视图。
const FinanceLedgerHub = lazyLoad(() =>
  import('./pages/finance/ledger/FinanceLedgerHub').then((m) => ({ default: m.FinanceLedgerHub }))
);
const FinanceAccountsPage = lazyLoad(() =>
  import('./pages/finance/accounts/AccountsPage').then((m) => ({ default: m.AccountsPage }))
);
const FinanceSubjectsPage = lazyLoad(() =>
  import('./pages/finance/subjects/SubjectsPage').then((m) => ({ default: m.SubjectsPage }))
);
const FinanceImportPage = lazyLoad(() =>
  import('./pages/finance/import/FinanceImportPage').then((m) => ({
    default: m.FinanceImportPage,
  }))
);

// ==================== 运维 / 云成本 ====================
const CloudCostDashboardPage = lazyLoad(() =>
  import('./pages/ops/cloud-cost/dashboard/CloudCostDashboardPage').then((m) => ({
    default: m.CloudCostDashboardPage,
  }))
);
const CloudUsageMonitorPage = lazyLoad(() =>
  import('./pages/ops/cloud-cost/usage/CloudUsageMonitorPage').then((m) => ({
    default: m.CloudUsageMonitorPage,
  }))
);
const CloudPackagesPage = lazyLoad(() =>
  import('./pages/ops/cloud-cost/packages/CloudPackagesPage').then((m) => ({
    default: m.CloudPackagesPage,
  }))
);
const CloudInstancesPage = lazyLoad(() =>
  import('./pages/ops/cloud-cost/instances/CloudInstancesPage').then((m) => ({
    default: m.CloudInstancesPage,
  }))
);
const CloudRenewalPage = lazyLoad(() =>
  import('./pages/ops/cloud-cost/renewal/CloudRenewalPage').then((m) => ({
    default: m.CloudRenewalPage,
  }))
);
const CloudBillsPage = lazyLoad(() =>
  import('./pages/ops/cloud-cost/bills/CloudBillsPage').then((m) => ({
    default: m.CloudBillsPage,
  }))
);
const CloudAlertsPage = lazyLoad(() =>
  import('./pages/ops/cloud-cost/alerts/CloudAlertsPage').then((m) => ({
    default: m.CloudAlertsPage,
  }))
);

// ==================== 系统管理 ====================
const SettingsPage = lazyLoad(() =>
  import('./pages/system/SettingsPage').then((m) => ({ default: m.SettingsPage }))
);
const RolesPage = lazyLoad(() =>
  import('./pages/system/roles/RolesPage').then((m) => ({ default: m.RolesPage }))
);
const UsersPage = lazyLoad(() =>
  import('./pages/system/users/UsersPage').then((m) => ({ default: m.UsersPage }))
);
const OperationLogsPage = lazyLoad(() =>
  import('./pages/system/operation-logs/OperationLogsPage').then((m) => ({
    default: m.OperationLogsPage,
  }))
);
const TrashPage = lazyLoad(() =>
  import('./pages/system/trash/TrashPage').then((m) => ({ default: m.TrashPage }))
);
const RateLimitTestPage = lazyLoad(() =>
  import('./pages/system/RateLimitTestPage').then((m) => ({ default: m.RateLimitTestPage }))
);
const UIDemoPage = lazyLoad(() =>
  import('./pages/system/ui-demo/UIDemoPage').then((m) => ({ default: m.UIDemoPage }))
);
const NotificationsPage = lazyLoad(() =>
  import('./pages/system/notifications/NotificationsPage').then((m) => ({
    default: m.NotificationsPage,
  }))
);
const FilterSchemesPage = lazyLoad(() =>
  import('./pages/system/filter-schemes/FilterSchemesPage').then((m) => ({
    default: m.FilterSchemesPage,
  }))
);
const HolidaysPage = lazyLoad(() =>
  import('./pages/system/holidays').then((m) => ({ default: m.HolidaysPage }))
);

function App() {
  const authReady = useAuthBootstrap();

  // 全局监听筛选方案版本变化 —— 仅 focus/visibilitychange 触发，不轮询
  useSchemeVersionWatcher();

  if (!authReady) return <PageSkeleton />;

  return (
    <BrowserRouter>
      <DrawerStackProvider>
        <Routes>
          {/* 公开页面 */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/403" element={<ForbiddenPage />} />

          {/* 受保护页面 */}
          <Route
            path="/"
            element={
              <PrivateRoute>
                <ResponsiveLayout />
              </PrivateRoute>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="dashboard" element={<DashboardOverviewPage />} />

            {/* 经营分析 */}
            <Route
              path="analytics"
              element={
                <PermissionRoute module="analytics" menu="overview">
                  <Suspense fallback={<PageSkeleton />}>
                    <AnalyticsOverviewPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="analytics/crm"
              element={
                <PermissionRoute module="analytics" menu="crm">
                  <Suspense fallback={<PageSkeleton />}>
                    <CrmAnalyticsPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="analytics/projects"
              element={
                <PermissionRoute module="analytics" menu="projects">
                  <Suspense fallback={<PageSkeleton />}>
                    <ProjectAnalyticsPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="analytics/organization"
              element={
                <PermissionRoute module="analytics" menu="organization">
                  <Suspense fallback={<PageSkeleton />}>
                    <OrgAnalyticsPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="analytics/seo"
              element={
                <PermissionRoute module="analytics" menu="seo">
                  <Suspense fallback={<PageSkeleton />}>
                    <SeoAnalyticsPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="analytics/seo/sync-runs"
              element={
                <PermissionRoute module="analytics" menu="seo">
                  <Suspense fallback={<PageSkeleton />}>
                    <SeoSyncLogsPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="analytics/web"
              element={
                <PermissionRoute module="analytics" menu="web">
                  <Suspense fallback={<PageSkeleton />}>
                    <WebAnalyticsPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="analytics/xiaohongshu/*"
              element={
                <PermissionRoute module="analytics" menu="xiaohongshu">
                  <Suspense fallback={<PageSkeleton />}>
                    <XiaohongshuCenterPage />
                  </Suspense>
                </PermissionRoute>
              }
            />

            {/* 个人设置 */}
            <Route
              path="profile"
              element={
                <Suspense fallback={<PageSkeleton />}>
                  <ProfileSettingsPage />
                </Suspense>
              }
            />

            {/* CRM */}
            <Route
              path="crm/customers"
              element={
                <PermissionRoute module="crm" menu="customers">
                  <Suspense fallback={<PageSkeleton />}>
                    <CustomersPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="crm/contacts"
              element={
                <PermissionRoute module="crm" menu="contacts">
                  <Suspense fallback={<PageSkeleton />}>
                    <ContactsPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="crm/opportunities"
              element={
                <PermissionRoute module="crm" menu="opportunities">
                  <Suspense fallback={<PageSkeleton />}>
                    <OpportunitiesPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="crm/sale-orders"
              element={
                <PermissionRoute module="crm" menu="sale_orders">
                  <Suspense fallback={<PageSkeleton />}>
                    <SaleOrdersPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="crm/payments"
              element={
                <PermissionRoute module="crm" menu="payments">
                  <Suspense fallback={<PageSkeleton />}>
                    <PaymentsPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="crm/invoices"
              element={
                <PermissionRoute module="crm" menu="invoices">
                  <Suspense fallback={<PageSkeleton />}>
                    <InvoicesPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="crm/keep-records"
              element={
                <PermissionRoute module="crm" menu="keep_records">
                  <Suspense fallback={<PageSkeleton />}>
                    <KeepRecordsPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="crm/sales-action-items"
              element={
                <PermissionRoute module="crm" menu="sales_action_items">
                  <Suspense fallback={<PageSkeleton />}>
                    <SalesActionItemsPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="crm/visit-records"
              element={
                <PermissionRoute module="crm" menu="visit_records">
                  <Suspense fallback={<PageSkeleton />}>
                    <VisitRecordsPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="crm/products"
              element={
                <PermissionRoute module="crm" menu="products">
                  <Suspense fallback={<PageSkeleton />}>
                    <CrmProductsPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            {/* 项目管理 */}
            <Route
              path="projects"
              element={
                <PermissionRoute module="projects" menu="project_list">
                  <Suspense fallback={<PageSkeleton />}>
                    <ProjectsPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="projects/effort-records"
              element={
                <PermissionRoute module="projects" menu="effort_records">
                  <Suspense fallback={<PageSkeleton />}>
                    <EffortRecordsPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="projects/effort-stats"
              element={
                <PermissionRoute module="projects" menu="effort_stats">
                  <Suspense fallback={<PageSkeleton />}>
                    <EffortStatsPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="projects/tickets"
              element={
                <PermissionRoute module="projects" menu="project_tickets">
                  <Suspense fallback={<PageSkeleton />}>
                    <ProjectTicketsPage />
                  </Suspense>
                </PermissionRoute>
              }
            />

            {/* 工作汇报 */}
            <Route
              path="reports/work-dailies"
              element={
                <PermissionRoute module="reports" menu="work_dailies">
                  <Suspense fallback={<PageSkeleton />}>
                    <WorkDailiesPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            {/* 电销日报：与 CRM 日报共表共接口，使用 telesales_dailies 独立入口权限 */}
            <Route
              path="reports/telesales-dailies"
              element={
                <PermissionRoute module="reports" menu="telesales_dailies">
                  <Suspense fallback={<PageSkeleton />}>
                    <TelesalesDailiesPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="reports/dingtalk-logs"
              element={
                <PermissionRoute module="reports" menu="dingtalk_logs">
                  <Suspense fallback={<PageSkeleton />}>
                    <DingtalkLogsPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="reports/calendar-events"
              element={
                <PermissionRoute module="reports" menu="calendar_events">
                  <Suspense fallback={<PageSkeleton />}>
                    <CalendarEventsPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="reports/employee-leaves"
              element={
                <PermissionRoute module="reports" menu="employee_leaves">
                  <Suspense fallback={<PageSkeleton />}>
                    <EmployeeLeavesPage />
                  </Suspense>
                </PermissionRoute>
              }
            />

            {/* 组织架构 */}
            <Route
              path="organization/employees"
              element={
                <PermissionRoute module="organization" menu="employees">
                  <Suspense fallback={<PageSkeleton />}>
                    <EmployeesPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="organization/departments"
              element={
                <PermissionRoute module="organization" menu="departments">
                  <Suspense fallback={<PageSkeleton />}>
                    <DepartmentsPage />
                  </Suspense>
                </PermissionRoute>
              }
            />

            {/* 审批管理 */}
            <Route
              path="approval/list"
              element={
                <PermissionRoute module="approval" menu="approval_list">
                  <Suspense fallback={<PageSkeleton />}>
                    <ApprovalsPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="approval/settings"
              element={
                <PermissionRoute module="approval" menu="approval_flows">
                  <Suspense fallback={<PageSkeleton />}>
                    <ApprovalSettingsPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="approval/flows"
              element={
                <PermissionRoute module="approval" menu="approval_flows">
                  <Suspense fallback={<PageSkeleton />}>
                    <ApprovalFlowsPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="approval/flows/history/:groupId"
              element={
                <PermissionRoute module="approval" menu="approval_flows">
                  <Suspense fallback={<PageSkeleton />}>
                    <ApprovalFlowHistoryPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="approval/flows/:id"
              element={
                <PermissionRoute module="approval" menu="approval_flows">
                  <Suspense fallback={<PageSkeleton />}>
                    <ApprovalFlowDesignPage />
                  </Suspense>
                </PermissionRoute>
              }
            />

            {/* 财务管理 */}
            <Route
              path="finance/payroll"
              element={
                <PermissionRoute module="finance" menu="payroll">
                  <Suspense fallback={<PageSkeleton />}>
                    <PayrollPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            {/* 旧路径合并到 /finance/payroll?tab=import；保留半年防书签 404 */}
            <Route
              path="finance/payroll-import"
              element={<Navigate to="/finance/payroll?tab=import" replace />}
            />
            {/* 财务总账综合视图（system/roles 控制可见性） */}
            {/* 顶部 tab 切换公司流水 / 个人流水 / 损益表，URL `?tab=personal|pnl` 同步。 */}
            <Route
              path="finance/ledger"
              element={
                <PermissionRoute
                  module="finance"
                  anyOf={[
                    { module: 'finance', menu: 'ledger' },
                    { module: 'finance', menu: 'personal_ledger' },
                    { module: 'finance', menu: 'pnl' },
                  ]}
                >
                  <Suspense fallback={<PageSkeleton />}>
                    <FinanceLedgerHub />
                  </Suspense>
                </PermissionRoute>
              }
            />
            {/* 旧路径重定向到新综合视图对应 tab，保留书签可用性 */}
            <Route
              path="finance/personal-ledger"
              element={<Navigate to="/finance/ledger?tab=personal" replace />}
            />
            <Route path="finance/pnl" element={<Navigate to="/finance/ledger?tab=pnl" replace />} />
            <Route
              path="finance/accounts"
              element={
                <PermissionRoute module="finance" menu="accounts">
                  <Suspense fallback={<PageSkeleton />}>
                    <FinanceAccountsPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="finance/subjects"
              element={
                <PermissionRoute module="finance" menu="subjects">
                  <Suspense fallback={<PageSkeleton />}>
                    <FinanceSubjectsPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="finance/import"
              element={
                <PermissionRoute module="finance" menu="finance_import">
                  <Suspense fallback={<PageSkeleton />}>
                    <FinanceImportPage />
                  </Suspense>
                </PermissionRoute>
              }
            />

            {/* 运维 / 云成本（仅 ADMIN 可见） */}
            <Route
              path="ops/cloud-cost/dashboard"
              element={
                <PermissionRoute module="ops" menu="cloud_cost_dashboard">
                  <Suspense fallback={<PageSkeleton />}>
                    <CloudCostDashboardPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="ops/cloud-cost/usage"
              element={
                <PermissionRoute module="ops" menu="cloud_usage">
                  <Suspense fallback={<PageSkeleton />}>
                    <CloudUsageMonitorPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="ops/cloud-cost/packages"
              element={
                <PermissionRoute module="ops" menu="cloud_packages">
                  <Suspense fallback={<PageSkeleton />}>
                    <CloudPackagesPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="ops/cloud-cost/instances"
              element={
                <PermissionRoute module="ops" menu="cloud_instances">
                  <Suspense fallback={<PageSkeleton />}>
                    <CloudInstancesPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="ops/cloud-cost/renewal"
              element={
                <PermissionRoute module="ops" menu="cloud_renewal">
                  <Suspense fallback={<PageSkeleton />}>
                    <CloudRenewalPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="ops/cloud-cost/bills"
              element={
                <PermissionRoute module="ops" menu="cloud_bills">
                  <Suspense fallback={<PageSkeleton />}>
                    <CloudBillsPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="ops/cloud-cost/alerts"
              element={
                <PermissionRoute module="ops" menu="cloud_alerts">
                  <Suspense fallback={<PageSkeleton />}>
                    <CloudAlertsPage />
                  </Suspense>
                </PermissionRoute>
              }
            />

            {/* 系统管理 */}
            <Route
              path="system/users"
              element={
                <PermissionRoute module="system" menu="user_account">
                  <Suspense fallback={<PageSkeleton />}>
                    <UsersPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="system/roles"
              element={
                <PermissionRoute module="system" menu="user_role">
                  <Suspense fallback={<PageSkeleton />}>
                    <RolesPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="system/params"
              element={
                <PermissionRoute module="system" menu="system_config">
                  <Suspense fallback={<PageSkeleton />}>
                    <SettingsPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="system/logs"
              element={
                <PermissionRoute module="system" menu="operation_logs">
                  <Suspense fallback={<PageSkeleton />}>
                    <OperationLogsPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="system/filter-schemes"
              element={
                <PermissionRoute module="system" menu="filter_schemes">
                  <Suspense fallback={<PageSkeleton />}>
                    <FilterSchemesPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="system/holidays"
              element={
                <PermissionRoute module="system" menu="holidays">
                  <Suspense fallback={<PageSkeleton />}>
                    <HolidaysPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="notifications"
              element={
                <Suspense fallback={<PageSkeleton />}>
                  <NotificationsPage />
                </Suspense>
              }
            />
            <Route
              path="rate-limit-test"
              element={
                <PermissionRoute module="system" menu="system_config">
                  <Suspense fallback={<PageSkeleton />}>
                    <RateLimitTestPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="trash"
              element={
                <PermissionRoute module="crm" menu="customers">
                  <Suspense fallback={<PageSkeleton />}>
                    <TrashPage />
                  </Suspense>
                </PermissionRoute>
              }
            />
            <Route
              path="ui-demo"
              element={
                <Suspense fallback={<PageSkeleton />}>
                  <UIDemoPage />
                </Suspense>
              }
            />
          </Route>

          {/* 404 */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>

        {/* Toast 通知 */}
        <Toaster
          position="top-right"
          richColors
          closeButton
          toastOptions={{
            duration: 3000,
          }}
        />

        {/* 网络错误弹窗 */}
        <NetworkErrorDialog />

        {/* 速率限制提示 */}
        <RateLimitToast />

        {/* 应用更新提示（PWA Service Worker 新版本检测） */}
        <AppUpdatePrompt />

        {/* 全局叠加抽屉宿主：从客户抽屉里下钻关联实体时用 */}
        <DrawerStackHost />
      </DrawerStackProvider>
    </BrowserRouter>
  );
}

export default App;
