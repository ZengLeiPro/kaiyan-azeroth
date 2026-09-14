import {
  type FinanceAccountResponseOutput,
  type FinanceSubjectResponseOutput,
} from '@ky-azeroth/shared/schemas';
import { BookOpen, LineChart, Wallet } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import type { FilterOption } from '@/components/patterns/crud-filter-bar';
import { HeaderRight } from '@/components/patterns/header-right';
import { SegmentedToggle } from '@/components/ui/segmented-toggle';
import { useIsMobile } from '@/hooks/use-mobile';
import { api, getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

import { CompanyLedgerView } from './components/CompanyLedgerView';
import { PersonalLedgerView } from './components/PersonalLedgerView';
import { PnLView } from './components/PnLView';

type FinanceLedgerTab = 'company' | 'personal' | 'pnl';

const VALID_TABS: readonly FinanceLedgerTab[] = ['company', 'personal', 'pnl'] as const;

function parseTab(value: string | null): FinanceLedgerTab {
  return value && (VALID_TABS as readonly string[]).includes(value)
    ? (value as FinanceLedgerTab)
    : 'company';
}

/**
 * 财务账综合视图容器。
 *
 * 设计要点：
 * 1) 顶部 SegmentedToggle 切换：公司流水 / 个人流水 / 损益表。
 *    URL `?tab=personal|pnl` 同步，默认（company）不写 query 保持地址简洁。
 *    activeTab 由 URL 单向驱动 —— 这样 PnL 钻取通过 setSearchParams 即可触发 tab 切换。
 * 2) 三个子视图常驻 mount（hidden 切换），保持各自筛选/滚动/分页状态。
 * 3) 账户字典 / 科目字典在 Hub 层一次 fetch，传给两个流水视图，
 *    避免 CompanyLedgerView 和 PersonalLedgerView 各自重复拉取（两边其实拉的是同一份数据）。
 */
export function FinanceLedgerHub() {
  const isMobile = useIsMobile();
  const hasMenuPermission = useAuthStore((s) => s.hasMenuPermission);
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = parseTab(searchParams.get('tab'));
  const canViewCompany = hasMenuPermission('finance', 'ledger', 'view');
  const canViewPersonal = hasMenuPermission('finance', 'personal_ledger', 'view');
  const canViewPnl = hasMenuPermission('finance', 'pnl', 'view');

  // 账户 / 科目下拉：Hub 层一次 fetch，传给 Company/Personal 两个流水视图共用。
  const [accountOptions, setAccountOptions] = useState<FilterOption[]>([
    { value: '', label: '全部账户' },
  ]);
  const [subjectOptions, setSubjectOptions] = useState<FilterOption[]>([
    { value: '', label: '全部科目' },
  ]);

  useEffect(() => {
    if (!canViewCompany && !canViewPersonal) return;
    Promise.all([
      api.get<{ items: FinanceAccountResponseOutput[] }>('/finance-accounts?pageSize=10000'),
      api.get<{ items: FinanceSubjectResponseOutput[] }>(
        '/finance-subjects?pageSize=10000&level=2'
      ),
    ])
      .then(([accountsResp, subjectsResp]) => {
        setAccountOptions([
          { value: '', label: '全部账户' },
          ...accountsResp.data.items.map((item) => ({
            value: item.id,
            label: item.name,
          })),
        ]);
        setSubjectOptions([
          { value: '', label: '全部科目' },
          ...subjectsResp.data.items.map((item) => ({
            value: item.id,
            label: item.name,
          })),
        ]);
      })
      .catch((e) => toast.error(getErrorMessage(e, '加载财务字典失败')));
  }, [canViewCompany, canViewPersonal]);

  const handleTabChange = useCallback(
    (next: FinanceLedgerTab) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === 'company') {
            params.delete('tab');
          } else {
            params.set('tab', next);
          }
          // 用户主动点 tab 时清理钻取参数，避免上次钻取的筛选粘在切换间。
          params.delete('subjectId');
          params.delete('startDate');
          params.delete('endDate');
          return params;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const tabOptions = useMemo(
    (): { value: FinanceLedgerTab; label: string; icon: typeof BookOpen }[] =>
      [
        canViewCompany ? { value: 'company' as const, label: '公司流水', icon: BookOpen } : null,
        canViewPersonal ? { value: 'personal' as const, label: '个人流水', icon: Wallet } : null,
        canViewPnl ? { value: 'pnl' as const, label: '损益表', icon: LineChart } : null,
      ].filter((item): item is { value: FinanceLedgerTab; label: string; icon: typeof BookOpen } =>
        Boolean(item)
      ),
    [canViewCompany, canViewPersonal, canViewPnl]
  );

  const activeTab = tabOptions.some((option) => option.value === requestedTab)
    ? requestedTab
    : (tabOptions[0]?.value ?? 'company');

  useEffect(() => {
    if (activeTab === requestedTab) return;
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (activeTab === 'company') params.delete('tab');
        else params.set('tab', activeTab);
        return params;
      },
      { replace: true }
    );
  }, [activeTab, requestedTab, setSearchParams]);

  return (
    <div className={cn('flex h-full flex-col', isMobile && 'px-3 pt-3')}>
      <HeaderRight>
        <SegmentedToggle<FinanceLedgerTab>
          value={activeTab}
          onChange={handleTabChange}
          options={tabOptions}
          ariaLabel="财务账视图"
        />
      </HeaderRight>

      {canViewCompany && (
        <div className={cn('flex min-h-0 flex-1 flex-col', activeTab !== 'company' && 'hidden')}>
          <CompanyLedgerView accountOptions={accountOptions} subjectOptions={subjectOptions} />
        </div>
      )}
      {canViewPersonal && (
        <div className={cn('flex min-h-0 flex-1 flex-col', activeTab !== 'personal' && 'hidden')}>
          <PersonalLedgerView accountOptions={accountOptions} subjectOptions={subjectOptions} />
        </div>
      )}
      {canViewPnl && (
        <div className={cn('min-h-0 flex-1 overflow-auto', activeTab !== 'pnl' && 'hidden')}>
          <PnLView />
        </div>
      )}
    </div>
  );
}
