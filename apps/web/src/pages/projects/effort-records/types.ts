import { createEffortRecordSchema } from '@ky-azeroth/shared/schemas/effort-record';
import type {
  ICreateEffortRecord,
  IEffortRecordResponse,
} from '@ky-azeroth/shared/types/effort-record';

/**
 * 工时记录前端展示类型（强绑定 IEffortRecordResponse）
 */
export interface EffortRecordProfile extends IEffortRecordResponse {
  /** 关联项目名称（前端扩展字段） */
  projectName?: string;
  /** 关联客户名称（前端扩展字段） */
  customerName?: string;
}

/**
 * 工时记录表单数据类型
 */
export interface EffortRecordFormData extends ICreateEffortRecord {
  version?: number;
}

/**
 * 工时记录表单校验 Schema（直接使用 shared）
 */
export const effortRecordFormSchema = createEffortRecordSchema;

/**
 * API 响应 -> 前端展示
 */
export function toEffortRecordProfile(data: IEffortRecordResponse): EffortRecordProfile {
  return {
    ...data,
    projectName: data.project?.name ?? undefined,
    customerName: data.project?.customerName ?? undefined,
  };
}

/**
 * 展示/响应 -> 表单数据
 * Decimal 字段读取使用 Number()
 */
export function toEffortRecordFormData(entity: EffortRecordProfile): EffortRecordFormData {
  return {
    projectId: entity.projectId,
    actualTime: Number(entity.actualTime),
    description: entity.description ?? '',
    workType: entity.workType ?? null,
    startDate: entity.startDate ?? null,
    endDate: entity.endDate ?? null,
    ownerId: entity.ownerId ?? null,
    version: entity.version,
  };
}

/**
 * 表单 -> API payload
 * Decimal 字段使用 String() 提交
 */
export function toEffortRecordPayload(form: EffortRecordFormData) {
  return {
    projectId: form.projectId,
    actualTime: String(form.actualTime),
    description: form.description ?? null,
    workType: form.workType ?? null,
    startDate: form.startDate ?? null,
    endDate: form.endDate ?? null,
    ownerId: form.ownerId || null,
    version: form.version,
  };
}

// ─── 我的填报（周视图） ────────────────────────────────

export interface DayEffort {
  /** 日期 YYYY-MM-DD */
  date: string;
  /** 当天的工时行 */
  records: EffortRowData[];
  /** 当天合计工时 */
  totalHours: number;
  /** 填报状态 */
  status: 'empty' | 'partial' | 'complete';
}

export interface EffortRowData {
  /** 已保存的记录 ID（新建的没有） */
  id?: string;
  /** 临时行 ID（React key） */
  tempId: string;
  /** 关联项目 ID */
  projectId: string;
  /** 项目名称（展示用） */
  projectName?: string;
  /** 客户名称（展示用） */
  customerName?: string;
  /** 实际工时（PLAN 模式下为预估工时） */
  actualTime: number;
  /** 工时类型 */
  workType: string | null;
  /** 工时描述 */
  description: string;
  /** 记录类型 */
  recordType?: string;
  /** 乐观锁版本号 */
  version?: number;
  /** 行编辑状态 */
  _status: 'unchanged' | 'new' | 'modified' | 'deleted';
}

/**
 * 明日计划日视图
 */
export interface DayPlanEffort {
  /** 计划针对的日期（选中日的下一个工作日，节假日/周末顺延，以 system/holidays 配置为准） */
  targetDate: string;
  /** 计划行 */
  records: EffortRowData[];
  /** 预估合计工时 */
  totalPlannedHours: number;
}

/**
 * 获取下一个工作日的日期字符串。
 *
 * 优先用 `restDatesSet`（来自后端 `GET /holidays/work-dates` 的 restDates，
 * 已综合节假日表 HOLIDAY 排除 / WORKDAY 调休补班 / 周末默认休）；
 * 未传或集合为空时降级仅跳过周六周日，保证日历未就绪时仍能给出可用日期。
 *
 * `restDatesSet` 仅在覆盖范围内可信，超出范围时本函数会继续递增直至命中第一个
 * **不在 set 中** 的日期，因此调用方需保证 set 覆盖 dateStr 之后至少 ~30 天，
 * 否则可能错把超出范围的节假日当工作日。本周填报场景已由 use-my-effort 拉取了
 * 本周+后续 4 周的日历，足以覆盖春节等连续休假。
 *
 * 示例：
 *   周一 → 周二
 *   周五 → 下周一
 *   周六/周日 → 下周一
 *   节前最后一个工作日（如 2026-09-30 国庆前）→ 节后第一个工作日（如 2026-10-08）
 */
export function getNextWorkDate(dateStr: string, restDatesSet?: ReadonlySet<string>): string {
  const d = new Date(dateStr + 'T00:00:00');
  // 防御性上限：极端连续休假场景下也应在 ~30 天内找到工作日。
  // 超过 60 天找不到工作日通常意味着 restDatesSet 范围不足或日历有 bug，
  // 此时返回 dateStr+1，确保 UI 不会卡在死循环里。
  for (let i = 0; i < 60; i++) {
    d.setDate(d.getDate() + 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const iso = `${y}-${m}-${dd}`;
    if (restDatesSet && restDatesSet.size > 0) {
      // 节假日数据已就绪：以后端日历为准
      if (!restDatesSet.has(iso)) return iso;
    } else {
      // 降级：仅按周末跳过
      if (d.getDay() !== 0 && d.getDay() !== 6) return iso;
    }
  }
  // 兜底：60 天未找到工作日，返回 dateStr+1（不应到达这里）
  const fb = new Date(dateStr + 'T00:00:00');
  fb.setDate(fb.getDate() + 1);
  const y = fb.getFullYear();
  const m = String(fb.getMonth() + 1).padStart(2, '0');
  const dd = String(fb.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/**
 * 创建空行
 */
export function createEmptyEffortRow(): EffortRowData {
  return {
    tempId: crypto.randomUUID(),
    projectId: '',
    actualTime: 0,
    workType: null,
    description: '',
    _status: 'new',
  };
}

/**
 * 计算日填报状态
 */
export function getDayStatus(totalHours: number): DayEffort['status'] {
  if (totalHours === 0) return 'empty';
  if (totalHours < 8) return 'partial';
  return 'complete';
}
