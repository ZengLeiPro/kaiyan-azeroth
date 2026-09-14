import { AcquisitionSection } from '@/pages/analytics/components/web-analytics-sections/AcquisitionSection';
import { ContentSection } from '@/pages/analytics/components/web-analytics-sections/ContentSection';
import { ConversionSection } from '@/pages/analytics/components/web-analytics-sections/ConversionSection';
import { HealthSection } from '@/pages/analytics/components/web-analytics-sections/HealthSection';
import { OverviewSection } from '@/pages/analytics/components/web-analytics-sections/OverviewSection';
import type { WebAnalyticsSectionProps } from '@/pages/analytics/components/web-analytics-sections/types';
import { VisitorsSection } from '@/pages/analytics/components/web-analytics-sections/VisitorsSection';

export type { WebAnalyticsSectionProps } from '@/pages/analytics/components/web-analytics-sections/types';

export function WebAnalyticsActiveSection({ dashboard }: WebAnalyticsSectionProps) {
  switch (dashboard.section) {
    case 'overview':
      return <OverviewSection dashboard={dashboard} />;
    case 'acquisition':
      return <AcquisitionSection dashboard={dashboard} />;
    case 'content':
      return <ContentSection dashboard={dashboard} />;
    case 'conversion':
      return <ConversionSection dashboard={dashboard} />;
    case 'visitors':
      return <VisitorsSection dashboard={dashboard} />;
    case 'health':
      return <HealthSection dashboard={dashboard} />;
  }
}
