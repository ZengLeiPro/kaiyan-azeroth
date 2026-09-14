/**
 * 工时记录类型 - 前后端共享
 * ACTUAL=实际工时，PLAN=工作计划
 */

export const EFFORT_RECORD_TYPE = {
  ACTUAL: 'ACTUAL',
  PLAN: 'PLAN',
} as const;
export type EffortRecordTypeValue = (typeof EFFORT_RECORD_TYPE)[keyof typeof EFFORT_RECORD_TYPE];

export const EFFORT_RECORD_TYPE_VALUES = Object.values(EFFORT_RECORD_TYPE) as [
  EffortRecordTypeValue,
  ...EffortRecordTypeValue[],
];

export const EFFORT_RECORD_TYPE_LABELS: Record<EffortRecordTypeValue, string> = {
  ACTUAL: '实际工时',
  PLAN: '工作计划',
};
