import { useCallback, useState } from 'react';

import { HeaderRight } from '@/components/patterns/header-right';
import { SegmentedToggle } from '@/components/ui/segmented-toggle';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

import { MyEntryView } from './components/MyEntryView';
import { RecordListView } from './components/RecordListView';

type EffortRecordsTab = 'my-entry' | 'records';

export function EffortRecordsPage() {
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState<EffortRecordsTab>('my-entry');
  const [myEntryDirty, setMyEntryDirty] = useState(false);

  const handleTabChange = useCallback(
    (value: EffortRecordsTab) => {
      if (activeTab === 'my-entry' && myEntryDirty) {
        if (!window.confirm('有未保存的工时变更，切换将丢失，是否继续？')) return;
      }
      setActiveTab(value);
    },
    [activeTab, myEntryDirty]
  );

  return (
    <div className={cn('flex h-full flex-col', isMobile && 'px-3 pt-3')}>
      <HeaderRight>
        <SegmentedToggle<EffortRecordsTab>
          value={activeTab}
          onChange={handleTabChange}
          options={[
            { value: 'my-entry', label: '我的填报' },
            { value: 'records', label: '全部记录' },
          ]}
          ariaLabel="工时视图"
        />
      </HeaderRight>

      {/* 两个 view 都常驻 mount，仅 display 切换 —— 等价于原 forceMount + data-[state=inactive]:hidden */}
      <div
        className={cn(
          'min-h-0 flex-1 overflow-auto p-4 md:p-6',
          activeTab !== 'my-entry' && 'hidden'
        )}
      >
        <MyEntryView onDirtyChange={setMyEntryDirty} />
      </div>
      <div className={cn('flex min-h-0 flex-1 flex-col', activeTab !== 'records' && 'hidden')}>
        <RecordListView />
      </div>
    </div>
  );
}
