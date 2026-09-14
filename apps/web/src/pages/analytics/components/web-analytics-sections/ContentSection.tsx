import { ChartCard } from '@/pages/analytics/components/ChartCard';
import { ContentEngagementTable } from '@/pages/analytics/components/ContentEngagementTable';
import { ContentQuadrantChart } from '@/pages/analytics/components/ContentQuadrantChart';
import type { WebAnalyticsSectionProps } from '@/pages/analytics/components/web-analytics-sections/types';
import { useWebAnalyticsContent } from '@/pages/analytics/hooks/use-web-analytics-data';

export function ContentSection({ dashboard }: WebAnalyticsSectionProps) {
  const { range, effectiveFilters } = dashboard;
  const content = useWebAnalyticsContent(range, effectiveFilters, 50);

  return (
    <>
      <ChartCard
        title="内容质量四象限"
        description="X=PV 曝光 · Y=读完率 质量 · 点大小=UV。右下：高曝光低质量（改内容）；左上：高质量低曝光（抢排名）。"
        loading={content.isLoading}
        empty={!content.data || content.data.items.length === 0}
        height={380}
      >
        {content.data && <ContentQuadrantChart items={content.data.items} height={340} />}
      </ChartCard>

      <ChartCard
        title="博客内容质量榜"
        description="按 path 聚合滚动深度/停留里程碑事件，点表头排序。滚动/停留为档位估算，非连续精确值。"
        loading={content.isLoading}
        empty={!content.data || content.data.items.length === 0}
      >
        {content.data && <ContentEngagementTable items={content.data.items} />}
      </ChartCard>
    </>
  );
}
