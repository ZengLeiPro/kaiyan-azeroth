import { dingtalkLogSectionSchema } from '@ky-azeroth/shared/schemas/dingtalk-log';
import type {
  IDingtalkLogResponse,
  IDingtalkLogSection,
} from '@ky-azeroth/shared/types/dingtalk-log';
import { z } from 'zod';

/** 「今日工作」/「明日计划」固定两段，key 只读、不可增删 */
export const SECTION_KEYS = ['今日工作', '明日计划'] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

/**
 * 钉钉日志前端展示类型（强绑定 IDingtalkLogResponse）
 */
export interface DingtalkLogProfile extends IDingtalkLogResponse {
  /** 用于 useCrud 兼容的 id 字段，映射自 reportId */
  id: string;
}

/**
 * API 响应 -> 前端展示
 */
export function toDingtalkLogProfile(data: IDingtalkLogResponse): DingtalkLogProfile {
  return {
    ...data,
    id: data.reportId,
  };
}

/**
 * 表单 Schema（用 zod 校验）
 *
 * 本地新增/编辑钉钉日志的硬约束：
 * - 提交人/部门/报告日期/日志模板均必填
 * - sections 固定「今日工作」「明日计划」两段，key 只读，每段 value 必填
 * - 真正的"系统创建时间"由后端自动写入，前端不再填
 */
export const dingtalkLogFormSchema = z.object({
  templateName: z.string().min(1, '请选择日志模板').max(50, '模板名不超过 50 字'),
  creatorId: z.string().min(1, '请选择提交人'),
  creatorName: z.string().min(1, '提交人姓名缺失'),
  deptId: z.string().min(1, '请选择部门'),
  deptName: z.string().min(1, '部门名称缺失'),
  /** YYYY-MM-DD，仅日期 */
  reportDate: z
    .string()
    .min(1, '请选择报告日期')
    .regex(/^\d{4}-\d{2}-\d{2}$/, '报告日期格式应为 YYYY-MM-DD'),
  sections: z
    .array(
      dingtalkLogSectionSchema.extend({
        value: z.string().min(1, '内容不能为空').max(5000, '段内容不超过 5000 字'),
      })
    )
    .length(2, '日志内容必须包含「今日工作」与「明日计划」两段'),
});

export type DingtalkLogFormData = z.infer<typeof dingtalkLogFormSchema>;

/** 把 Date 转为 YYYY-MM-DD（按本地时区） */
function dateToYmd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayYmd(): string {
  return dateToYmd(new Date());
}

/** YYYY-MM-DD -> Date（解析为本地时间 00:00:00） */
export function ymdToDate(ymd: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return undefined;
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

/**
 * 把 contents 字符串（带换行）兜底解析为 sections（编辑同步过来的日志时使用）。
 * 钉钉日志正文一般是 `key: value\nkey: value` 格式。
 * 解析后只取「今日工作」「明日计划」两段；缺失的段补空字符串，多余的段忽略。
 */
function parseContentsToSectionMap(contents: string): Record<string, string> {
  const lines = contents.replace(/\r\n|\r/g, '\n').split('\n');
  const map: Record<string, string> = {};
  let currentKey: string | null = null;
  for (const line of lines) {
    const m = line.match(/^([^:：]+)[：:]\s*(.*)$/);
    if (m && m[1] && m[1].length <= 50) {
      currentKey = m[1].trim();
      map[currentKey] = m[2] ?? '';
    } else if (currentKey) {
      map[currentKey] = map[currentKey] ? `${map[currentKey]}\n${line}` : line;
    }
  }
  return map;
}

function normalizeSections(
  rawSections: IDingtalkLogSection[] | null | undefined,
  rawContents: string | null | undefined
): { key: SectionKey; value: string }[] {
  const map: Record<string, string> = {};
  if (rawSections && rawSections.length > 0) {
    for (const s of rawSections) {
      if (s.key) map[s.key.trim()] = s.value ?? '';
    }
  } else if (rawContents) {
    Object.assign(map, parseContentsToSectionMap(rawContents));
  }
  return SECTION_KEYS.map((key) => ({ key, value: map[key] ?? '' }));
}

/**
 * 实体 -> 表单数据（编辑场景）
 *
 * 注意：DingtalkLog 实体只存 deptName 不存 deptId，钉钉同步过来的部门名常常和
 * azeroth 部门表对不上；这里只能预填 deptName 字段，deptId 留空让用户重新选。
 */
export function toDingtalkLogFormData(entity: DingtalkLogProfile): DingtalkLogFormData {
  const reportDate = entity.createTime ? dateToYmd(new Date(entity.createTime)) : todayYmd();

  return {
    templateName: entity.templateName ?? '日报',
    creatorId: entity.creatorId ?? '',
    creatorName: entity.creatorName ?? '',
    deptId: '',
    deptName: entity.deptName ?? '',
    reportDate,
    sections: normalizeSections(entity.contentsJson, entity.contents),
  };
}

/**
 * 表单数据 -> 后端 payload
 *
 * - deptId 是前端 UI 状态，不传给后端（DingtalkLog 实体只存 deptName）
 * - reportDate (YYYY-MM-DD) 转为当日 00:00:00 ISO 字符串，传给后端 createTime 字段
 */
export function toDingtalkLogPayload(form: DingtalkLogFormData): Record<string, unknown> {
  const reportDateObj = ymdToDate(form.reportDate);
  return {
    templateName: form.templateName.trim(),
    creatorId: form.creatorId,
    creatorName: form.creatorName.trim(),
    deptName: form.deptName.trim(),
    sections: form.sections.map((s) => ({ key: s.key, value: s.value ?? '' })),
    createTime: reportDateObj ? reportDateObj.toISOString() : undefined,
  };
}
