import { Bot } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { AnalyticsRangeValue } from '@/pages/analytics/components/AnalyticsDateRangePicker';
import { EVENT_LABELS, fmtTime } from '@/pages/analytics/components/web-analytics-presenters';
import { useWebAnalyticsEvents } from '@/pages/analytics/hooks/use-web-analytics-data';

interface VidDetailDrawerProps {
  vid: string | null;
  range: AnalyticsRangeValue;
  onClose: () => void;
}

export function VidDetailDrawer({ vid, range, onClose }: VidDetailDrawerProps) {
  return (
    <Sheet
      open={!!vid}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-2xl">
        {vid && <VidDetailPanel vid={vid} range={range} />}
      </SheetContent>
    </Sheet>
  );
}

/**
 * vid 串联抽屉（B3-2）：展示某访客在当前时间范围内的所有事件，时间倒序，
 * 上限 200 条。pageviews/consult_/article_ 全部列出，便于追踪"这个用户都干了啥"。
 * include bots=true 避免漏看疑似 bot 的真实 vid（万一是真人被误标）。
 */
function VidDetailPanel({ vid, range }: { vid: string; range: AnalyticsRangeValue }) {
  const events = useWebAnalyticsEvents(range, { vid, includeBots: true }, 1, 200);

  return (
    <>
      <SheetHeader>
        <SheetTitle className="break-all font-mono text-sm">{vid}</SheetTitle>
        <SheetDescription>
          该访客在当前时间范围内的全部事件（时间倒序，最多 200 条）
        </SheetDescription>
      </SheetHeader>
      <div className="mt-4 flex-1 overflow-auto">
        {events.isLoading && <div className="text-sm text-muted-foreground">加载中…</div>}
        {events.data && events.data.items.length === 0 && (
          <div className="text-sm text-muted-foreground">该 vid 在所选时间范围内无事件。</div>
        )}
        {events.data && events.data.items.length > 0 && (
          <ol className="space-y-3 text-sm">
            {events.data.items.map((it) => (
              <li key={it.id} className="border-l-2 border-muted pl-3">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {fmtTime(it.receivedAt)}
                  </span>
                  <Badge variant={it.event === 'pageview' ? 'secondary' : 'default'}>
                    {EVENT_LABELS[it.event] ?? it.event}
                  </Badge>
                  {it.isBot && <Bot className="h-3 w-3 text-amber-600" aria-label="bot" />}
                </div>
                {it.title && <div className="mt-1 text-xs font-medium">{it.title}</div>}
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {it.path ?? '-'} <span className="opacity-60">· {it.pageType ?? '-'}</span>
                </div>
                {(it.placement || it.channel) && (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {it.placement ?? '-'} / {it.channel ?? '-'}
                  </div>
                )}
                {(it.utmSource || it.refHost) && (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    来源：{it.utmSource ?? it.refHost ?? '-'}
                  </div>
                )}
                {it.ip && (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    IP：
                    <a
                      href={`https://whois.domaintools.com/${it.ip}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-primary hover:underline"
                    >
                      {it.ip}
                    </a>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
        {events.data && events.data.total > events.data.items.length && (
          <div className="mt-4 text-xs text-muted-foreground">
            共 {events.data.total} 条，当前只展示前 {events.data.items.length} 条。
          </div>
        )}
      </div>
    </>
  );
}
