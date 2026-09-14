import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { HeaderRight } from '@/components/patterns/header-right';
import { SegmentedToggle } from '@/components/ui/segmented-toggle';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

import { ImportView } from './components/ImportView';
import { MonthlySheetView } from './components/MonthlySheetView';
import { RecordListView } from './components/RecordListView';

type PayrollTab = 'monthly' | 'records' | 'import';

const VALID_TABS: readonly PayrollTab[] = ['monthly', 'records', 'import'] as const;

function parseTab(value: string | null): PayrollTab | null {
  return value && (VALID_TABS as readonly string[]).includes(value) ? (value as PayrollTab) : null;
}

export function PayrollPage() {
  const isMobile = useIsMobile();
  const { hasMenuPermission } = useAuthStore();
  const canImport = hasMenuPermission('finance', 'payroll_import', 'view');

  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab: PayrollTab = (() => {
    const fromUrl = parseTab(searchParams.get('tab'));
    if (fromUrl === 'import' && !canImport) return 'monthly';
    return fromUrl ?? 'monthly';
  })();
  const [activeTab, setActiveTab] = useState<PayrollTab>(initialTab);

  // 无权限用户跳过 import tab（兜底：从他处跳进来后才校验）
  useEffect(() => {
    if (activeTab === 'import' && !canImport) {
      setActiveTab('monthly');
    }
  }, [activeTab, canImport]);

  // tab → URL（保留其他 query 参数）
  const handleTabChange = useCallback(
    (next: PayrollTab) => {
      setActiveTab(next);
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === 'monthly') {
            params.delete('tab');
          } else {
            params.set('tab', next);
          }
          return params;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const tabOptions: { value: PayrollTab; label: string }[] = [
    { value: 'monthly', label: '月度工资表' },
    { value: 'records', label: '记录列表' },
    ...(canImport ? [{ value: 'import' as PayrollTab, label: '薪资导入' }] : []),
  ];

  return (
    <div className={cn('flex h-full flex-col', isMobile && 'px-3 pt-3')}>
      <HeaderRight>
        <SegmentedToggle<PayrollTab>
          value={activeTab}
          onChange={handleTabChange}
          options={tabOptions}
          ariaLabel="薪资视图"
        />
      </HeaderRight>

      {/* 三个 view 都常驻 mount，仅 display 切换 —— 等价于原 forceMount + data-[state=inactive]:hidden */}
      <div className={cn('min-h-0 flex-1 overflow-auto', activeTab !== 'monthly' && 'hidden')}>
        <MonthlySheetView />
      </div>
      <div className={cn('flex min-h-0 flex-1 flex-col', activeTab !== 'records' && 'hidden')}>
        <RecordListView />
      </div>
      {canImport && (
        <div className={cn('min-h-0 flex-1 overflow-auto', activeTab !== 'import' && 'hidden')}>
          <ImportView />
        </div>
      )}
    </div>
  );
}
