import type { QueryClient, QueryKey } from '@tanstack/react-query';

const OVERVIEW = ['analytics', 'overview'] as const;
const CRM = ['analytics', 'crm'] as const;
const PROJECTS = ['analytics', 'projects'] as const;
const ORGANIZATION = ['analytics', 'organization'] as const;

const ENDPOINT_QUERY_KEYS: Record<string, readonly QueryKey[]> = {
  '/customers': [OVERVIEW, CRM],
  '/contacts': [OVERVIEW, CRM],
  '/opportunities': [OVERVIEW, CRM],
  '/sale-orders': [OVERVIEW, CRM],
  '/payments': [OVERVIEW, CRM],
  '/payments/refund': [OVERVIEW, CRM],
  '/invoices': [OVERVIEW, CRM],
  '/keep-records': [OVERVIEW, CRM, ORGANIZATION],
  '/visit-records': [OVERVIEW, CRM, ORGANIZATION],
  '/crm-products': [CRM],
  '/projects': [OVERVIEW, PROJECTS],
  '/project-tickets': [OVERVIEW, PROJECTS],
  '/effort-records': [OVERVIEW, PROJECTS, ORGANIZATION],
  '/employees': [OVERVIEW, ORGANIZATION],
  '/departments': [OVERVIEW, ORGANIZATION],
  '/crm-work-dailies': [ORGANIZATION],
  '/dingtalk-logs': [ORGANIZATION],
  '/dingtalk-calendar-events': [ORGANIZATION],
  '/employee-leaves': [ORGANIZATION],
};

export function getAnalyticsInvalidationKeys(endpoint: string): readonly QueryKey[] {
  const normalized = endpoint.split('?')[0]?.replace(/\/+$/, '') || endpoint;
  return ENDPOINT_QUERY_KEYS[normalized] ?? [];
}

/** 所有直接写 API 与 useCrud 共用的经营分析缓存失效入口。 */
export async function invalidateAnalyticsQueries(
  queryClient: Pick<QueryClient, 'invalidateQueries'>,
  endpoint: string
): Promise<void> {
  await Promise.all(
    getAnalyticsInvalidationKeys(endpoint).map((queryKey) =>
      queryClient.invalidateQueries({ queryKey })
    )
  );
}
