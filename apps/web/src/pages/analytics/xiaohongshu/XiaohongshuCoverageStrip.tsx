import type { XiaohongshuReportLevel } from '@ky-azeroth/shared/types';
import { AlertTriangle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useXiaohongshuSummary } from '@/pages/analytics/hooks/use-xiaohongshu-analytics-data';

import { useXiaohongshuCenter } from './xiaohongshu-center-context';

const LEVELS: Array<{ level: XiaohongshuReportLevel; label: string }> = [
  { level: 'account', label: '账户' },
  { level: 'campaign', label: '计划' },
  { level: 'unit', label: '单元' },
  { level: 'creative', label: '创意' },
  { level: 'note', label: '笔记' },
];

export function XiaohongshuCoverageStrip() {
  const { range, dataCaliber, advertiserId } = useXiaohongshuCenter();
  const account = useXiaohongshuSummary(range, dataCaliber, advertiserId, 'account');
  const campaign = useXiaohongshuSummary(range, dataCaliber, advertiserId, 'campaign');
  const unit = useXiaohongshuSummary(range, dataCaliber, advertiserId, 'unit');
  const creative = useXiaohongshuSummary(range, dataCaliber, advertiserId, 'creative');
  const note = useXiaohongshuSummary(range, dataCaliber, advertiserId, 'note');
  const queries = { account, campaign, unit, creative, note };
  const accountFee = Number(account.data?.totals.fee ?? 0);
  const noteFee = Number(note.data?.totals.fee ?? 0);
  const noteCoverage = accountFee > 0 ? noteFee / accountFee : null;

  return (
    <Card
      className={
        noteCoverage !== null && noteCoverage < 0.8 ? 'border-amber-300 bg-amber-50/40' : ''
      }
    >
      <CardContent className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-3">
        <div className="flex items-center gap-2">
          {noteCoverage !== null && noteCoverage < 0.8 && (
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          )}
          <div>
            <p className="text-sm font-medium">层级消费覆盖</p>
            <p className="text-xs text-muted-foreground">下层排行不自动等同于账户全量</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {LEVELS.map(({ level, label }) => {
            const fee = Number(queries[level].data?.totals.fee ?? 0);
            const coverage = accountFee > 0 ? fee / accountFee : null;
            return (
              <Badge
                key={level}
                variant={coverage !== null && coverage < 0.8 ? 'outline' : 'secondary'}
                className={
                  coverage !== null && coverage < 0.8
                    ? 'border-amber-300 bg-white text-amber-900'
                    : ''
                }
              >
                {label} ¥
                {fee.toLocaleString('zh-CN', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
                {level !== 'account' && coverage !== null
                  ? ` · ${(coverage * 100).toFixed(1)}%`
                  : ''}
              </Badge>
            );
          })}
        </div>
        {noteCoverage !== null && noteCoverage < 0.8 && (
          <p className="text-xs font-medium text-amber-900">
            笔记层仅覆盖账户消费 {(noteCoverage * 100).toFixed(1)}%，笔记排行是局部样本。
          </p>
        )}
      </CardContent>
    </Card>
  );
}
