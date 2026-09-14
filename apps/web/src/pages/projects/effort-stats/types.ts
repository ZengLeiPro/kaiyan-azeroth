/**
 * 工时统计 - 类型定义
 */

/** 按人统计行（对应后端 PersonStats） */
export interface PersonStatRow {
  employeeId: string;
  employeeName: string;
  totalHours: number;
  recordCount: number;
  /** 饱和度 = totalHours / (工作日数 × 8) */
  saturation: number;
}

/** 按项目统计行（对应后端 ProjectStats） */
export interface ProjectStatRow {
  projectId: string;
  customerName: string;
  projectName: string;
  totalHours: number;
  participantCount: number;
}

/** 填报完整性检查行（对应后端 CompletionRecord） */
export interface CompletionCheckRow {
  employeeId: string;
  employeeName: string;
  date: string;
  filled: boolean;
}

/**
 * 统计筛选条件(stats endpoint 期望的扁平形态)
 *
 * 注意:前端 UI 通过 useFilterScheme('projects.effort_stats') + useManualFilter
 * 收集的是 bracket key 形态(`filters[workDate][from]` / `filters[ownerId][]` 等),
 * 由 EffortStatsPage 的 transformParams 函数转换成本类型再传给 useEffortStats。
 */
export interface StatsFilter {
  startDate: string;
  endDate: string;
  ownerId?: string[];
  projectId?: string[];
}
