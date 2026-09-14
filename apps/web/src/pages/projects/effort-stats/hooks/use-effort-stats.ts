import type {
  IEffortCompletionRecord,
  IEffortPersonStat,
  IEffortProjectStat,
} from '@ky-azeroth/shared/types';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

import type { CompletionCheckRow, PersonStatRow, ProjectStatRow, StatsFilter } from '../types';

// ──── hook ─────────────────────────────────

/**
 * axios 默认会把数组参数序列化为 `projectId[]=a&projectId[]=b`,但本系统后端
 * (FC 网关 + NestJS zod) 没把 `projectId[]` 识别为 `projectId` 数组,导致筛选
 * 完全不生效。改用 `indexes: null` 让序列化为重复 key 形式 `projectId=a&projectId=b`,
 * 后端 qs 默认解析为数组。
 */
const arrayParamsSerializer = { indexes: null as null };

export function useEffortStats(filter: StatsFilter) {
  const { startDate, endDate, ownerId, projectId } = filter;
  const hasDateRange = Boolean(startDate && endDate);
  const hasNoDateRange = !startDate && !endDate;

  const buildParams = (groupBy: string) => {
    const params: Record<string, string | string[]> = { groupBy };
    if (hasDateRange) {
      params.startDate = startDate;
      params.endDate = endDate;
    }
    if (ownerId && ownerId.length > 0) params.ownerId = ownerId;
    if (projectId && projectId.length > 0) params.projectId = projectId;
    return params;
  };

  // ──── Person stats ────
  const { data: personStats = [], isLoading: isLoadingPerson } = useQuery({
    queryKey: ['effort-stats', 'person', startDate, endDate, ownerId, projectId],
    enabled: hasDateRange,
    queryFn: async () => {
      const response = await api.get('/effort-records/stats', {
        params: buildParams('person'),
        paramsSerializer: arrayParamsSerializer,
      });
      const items = Array.isArray(response.data) ? response.data : [];
      return items.map(
        (r: IEffortPersonStat): PersonStatRow => ({
          employeeId: r.ownerId,
          employeeName: r.ownerName ?? '未知',
          totalHours: r.totalHours,
          recordCount: r.recordCount,
          saturation: Math.round(r.saturation * 100),
        })
      );
    },
    staleTime: 60 * 1000,
  });

  // ──── Project stats ────
  const { data: projectStats = [], isLoading: isLoadingProject } = useQuery({
    queryKey: ['effort-stats', 'project', startDate, endDate, ownerId, projectId],
    enabled: hasDateRange || hasNoDateRange,
    queryFn: async () => {
      const response = await api.get('/effort-records/stats', {
        params: buildParams('project'),
        paramsSerializer: arrayParamsSerializer,
      });
      const items = Array.isArray(response.data) ? response.data : [];
      return items.map(
        (r: IEffortProjectStat): ProjectStatRow => ({
          projectId: r.projectId,
          customerName: r.customerName ?? '未关联客户',
          projectName: r.projectName ?? '未关联项目',
          totalHours: r.totalHours,
          participantCount: r.participantCount,
        })
      );
    },
    staleTime: 60 * 1000,
  });

  // ──── Completion check ────
  const { data: completionCheck = [], isLoading: isLoadingCompletion } = useQuery({
    queryKey: ['effort-stats', 'completion', startDate, endDate, ownerId, projectId],
    enabled: hasDateRange,
    queryFn: async () => {
      const response = await api.get('/effort-records/stats', {
        params: buildParams('completion'),
        paramsSerializer: arrayParamsSerializer,
      });
      const items = Array.isArray(response.data) ? response.data : [];
      return items.map(
        (r: IEffortCompletionRecord): CompletionCheckRow => ({
          employeeId: r.employeeId,
          employeeName: r.employeeName,
          date: r.date,
          filled: r.filled,
        })
      );
    },
    staleTime: 60 * 1000,
  });

  return {
    isLoading: isLoadingPerson || isLoadingProject || isLoadingCompletion,
    personStats,
    projectStats,
    completionCheck,
  };
}
