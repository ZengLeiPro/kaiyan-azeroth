import type { IWebAnalyticsFunnelStage } from '@ky-azeroth/shared/types';

import { fmtNumber, fmtPercent } from './web-analytics-presenters';

export function SimpleFunnel({ stages }: { stages: IWebAnalyticsFunnelStage[] }) {
  const max = Math.max(stages[0]?.count ?? 0, 1);

  return (
    <div className="space-y-4 pt-2">
      {stages.map((stage) => {
        const width = Math.max((stage.count / max) * 100, stage.count > 0 ? 8 : 0);
        return (
          <div key={stage.key} className="space-y-1.5">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium">{stage.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {fmtNumber(stage.count)} · {fmtPercent(stage.rate)}
              </span>
            </div>
            <div className="h-8 overflow-hidden rounded bg-muted">
              <div
                className="flex h-full items-center justify-end bg-sky-500 px-2 text-xs font-medium text-white"
                style={{ width: `${width}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
