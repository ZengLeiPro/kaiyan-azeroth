/**
 * 业务编号类型枚举
 */
export enum SerialNumberType {
  // 基础档案（无日期）
  EMPLOYEE = 'EMPLOYEE',
  DEPARTMENT = 'DEPARTMENT',

  // CRM（无日期）
  CUSTOMER = 'CUSTOMER',
  OPPORTUNITY = 'OPPORTUNITY',
  SALE_ORDER = 'SALE_ORDER',
  PAYMENT = 'PAYMENT',
  PAYMENT_REFUND = 'PAYMENT_REFUND',
  INVOICE = 'INVOICE',

  // 审批（含日期）
  APPROVAL = 'APPROVAL',

  // 项目工单（含日期）
  PROJECT_TICKET = 'PROJECT_TICKET',
}

/**
 * 编号配置
 */
export interface SerialNumberConfig {
  prefix: string; // 前缀
  hasDate: boolean; // 是否包含日期
  seqLength: number; // 序号位数
}

/**
 * 编号配置映射表
 *
 * 档案类格式: [前缀][序号]
 * 单据类格式: [前缀][YYMMDD][序号]
 */
export const SERIAL_NUMBER_CONFIG: Record<SerialNumberType, SerialNumberConfig> = {
  // 基础档案（无日期）
  [SerialNumberType.EMPLOYEE]: { prefix: 'E', hasDate: false, seqLength: 5 },
  [SerialNumberType.DEPARTMENT]: { prefix: 'DEPT-', hasDate: false, seqLength: 3 },

  // CRM（无日期）
  [SerialNumberType.CUSTOMER]: { prefix: 'CUS', hasDate: false, seqLength: 5 },
  [SerialNumberType.OPPORTUNITY]: { prefix: 'OPP', hasDate: false, seqLength: 5 },
  [SerialNumberType.SALE_ORDER]: { prefix: 'SO', hasDate: false, seqLength: 5 },
  [SerialNumberType.PAYMENT]: { prefix: 'PAY', hasDate: false, seqLength: 5 },
  // 退款编号独立 REF- 前缀，与 PAY- 隔离，便于审计区分
  [SerialNumberType.PAYMENT_REFUND]: { prefix: 'REF', hasDate: false, seqLength: 5 },
  [SerialNumberType.INVOICE]: { prefix: 'INV', hasDate: false, seqLength: 5 },

  // 审批（含日期）
  [SerialNumberType.APPROVAL]: { prefix: 'APR', hasDate: true, seqLength: 3 },

  // 项目工单（含日期）格式：TK251209001
  [SerialNumberType.PROJECT_TICKET]: { prefix: 'TK', hasDate: true, seqLength: 3 },
};
