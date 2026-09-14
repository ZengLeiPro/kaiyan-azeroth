/**
 * 工时工作类型 - 前后端共享
 * 数据库保持 String 类型，通过 Zod 在应用层做枚举校验
 */

/**
 * 工时工作类型值
 */
export const EFFORT_WORK_TYPE = {
  DEVELOPMENT: 'DEVELOPMENT',
  TESTING: 'TESTING',
  DESIGN: 'DESIGN',
  DEPLOYMENT: 'DEPLOYMENT',
  COMMUNICATION: 'COMMUNICATION',
  DOCUMENTATION: 'DOCUMENTATION',
  SUPPORT: 'SUPPORT',
  OTHER: 'OTHER',
} as const;
export type EffortWorkTypeValue = (typeof EFFORT_WORK_TYPE)[keyof typeof EFFORT_WORK_TYPE];

/**
 * 工时工作类型值数组（用于 Zod enum 校验）
 */
export const EFFORT_WORK_TYPE_VALUES = Object.values(EFFORT_WORK_TYPE) as [
  EffortWorkTypeValue,
  ...EffortWorkTypeValue[],
];

/**
 * 工时工作类型中文标签
 */
export const EFFORT_WORK_TYPE_LABELS: Record<EffortWorkTypeValue, string> = {
  DEVELOPMENT: '开发',
  TESTING: '测试',
  DESIGN: '设计',
  DEPLOYMENT: '部署运维',
  COMMUNICATION: '沟通协调',
  DOCUMENTATION: '文档编写',
  SUPPORT: '技术支持',
  OTHER: '其他',
};

/**
 * 工时工作类型选项（用于前端下拉组件）
 */
export const EFFORT_WORK_TYPE_OPTIONS = Object.entries(EFFORT_WORK_TYPE_LABELS).map(
  ([value, label]) => ({ value: value as EffortWorkTypeValue, label })
);
