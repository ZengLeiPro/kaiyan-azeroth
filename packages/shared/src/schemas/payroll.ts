import { z } from 'zod';

import { withColumn } from './column-meta';
import { COL_AMOUNT, COL_DATE, COL_DATETIME, COL_NUMBER } from './column-widths';
import { optionalDateString, paginationSchema } from './common';

const nullableNumberField = z.preprocess((value) => {
  if (value === '' || value === undefined) return null;
  return value;
}, z.coerce.number().nullable().optional());

const nullableBooleanField = z.preprocess((value) => {
  if (value === '' || value === undefined || value === null) return undefined;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return value;
}, z.boolean().optional());

const nullableStringField = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value === '') return null;
  return value;
}, z.string().nullable().optional());

export const payrollPeriodKeySchema = z
  .string()
  .regex(/^\d{4}-(?:0[1-9]|1[0-2])$/, '期间格式应为 YYYY-MM，月份必须为 01-12');

export const payrollPeriodSummarySchema = z.object({
  id: z.string(),
  periodKey: payrollPeriodKeySchema,
  year: z.number().int(),
  month: z.number().int(),
  sheetName: z.string().optional().nullable(),
  companyName: z.string().optional().nullable(),
  expectedWorkDays: z.number().optional().nullable(),
  statementDate: z.string().optional().nullable(),
  sourceFileName: z.string().optional().nullable(),
  importBatchId: z.string().optional().nullable(),
  status: z.string(),
  rowCount: z.number().int(),
  remark: z.string().optional().nullable(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const payrollEmployeeInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  serialNumber: z.string().optional().nullable(),
});

export const payrollDepartmentInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const createPayrollSchema = z.object({
  periodKey: payrollPeriodKeySchema,
  employeeId: nullableStringField,
  departmentId: nullableStringField,
  employeeNameSnapshot: z.string().min(1, '员工姓名不能为空'),
  departmentNameSnapshot: nullableStringField,
  positionSnapshot: nullableStringField,
  entryDateSnapshot: optionalDateString,
  bankNameSnapshot: nullableStringField,
  bankCardNoSnapshot: nullableStringField,
  remarkSnapshot: nullableStringField,
  actualAttendanceDays: nullableNumberField,
  absenceDays: nullableNumberField,
  grossBaseSalary: nullableNumberField,
  grossPerformance: nullableNumberField,
  grossCommission: nullableNumberField,
  grossOther: nullableNumberField,
  grossBonusYearEnd: nullableNumberField,
  grossTotal: nullableNumberField,
  absenceDeductionAmount: nullableNumberField,
  lateDeductionAmount: nullableNumberField,
  adminDeductionAmount: nullableNumberField,
  socialSecurityPersonalAmount: nullableNumberField,
  housingFundPersonalAmount: nullableNumberField,
  deductionOtherTotal: nullableNumberField,
  deductionTotal: nullableNumberField,
  socialSecurityCompanyAmount: nullableNumberField,
  housingFundCompanyAmount: nullableNumberField,
  companyBurdenTotal: nullableNumberField,
  netSalary: nullableNumberField,
  totalLaborCost: nullableNumberField,
});

export const updatePayrollSchema = createPayrollSchema.partial().extend({
  version: z
    .number({
      required_error: '请携带乐观锁版本号',
      invalid_type_error: '乐观锁版本号必须是整数',
    })
    .int('乐观锁版本号必须是整数')
    .min(1, '乐观锁版本号必须大于等于 1'),
});

export const queryPayrollSchema = paginationSchema.extend({
  keyword: z.string().max(100).optional(),
  periodKey: payrollPeriodKeySchema.optional(),
  employeeId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  position: z.string().max(100).optional(),
  importBatchId: z.string().uuid().optional(),
  hasRemark: nullableBooleanField,
});

/**
 * 薪资响应 Schema
 *
 * 列 UI 元数据附着在字段 schema 上，供前端 `deriveColumnsFromSchema` 派生表格列。
 * 大多数金额列使用内置 `decimal` 渲染（右对齐 font-mono、2 位小数）；
 * netSalary 需要额外 font-medium 所以保留 custom + overrides；
 * periodKey 用 font-medium 也保留 custom。
 */
export const payrollResponseSchema = z.object({
  id: z.string(),
  payrollPeriodId: z.string(),
  periodKey: withColumn(z.string(), {
    label: '期间',
    width: COL_DATE,
    sortable: true,
    type: 'custom',
    required: true,
    order: 10,
  }),
  employeeId: z.string().optional().nullable(),
  departmentId: z.string().optional().nullable(),
  employeeNameSnapshot: withColumn(z.string(), {
    label: '员工',
    minWidth: 120,
    type: 'text',
    order: 20,
  }),
  departmentNameSnapshot: withColumn(z.string().optional().nullable(), {
    label: '部门',
    minWidth: 120,
    type: 'text',
    order: 30,
  }),
  positionSnapshot: withColumn(z.string().optional().nullable(), {
    label: '职位',
    minWidth: 120,
    type: 'text',
    order: 40,
  }),
  entryDateSnapshot: z.string().optional().nullable(),
  bankNameSnapshot: withColumn(z.string().optional().nullable(), {
    label: '银行',
    minWidth: 120,
    type: 'text',
    order: 100,
  }),
  bankCardNoSnapshot: withColumn(z.string().optional().nullable(), {
    label: '银行卡号',
    minWidth: 180,
    type: 'text',
    order: 110,
  }),
  remarkSnapshot: withColumn(z.string().optional().nullable(), {
    label: '备注',
    minWidth: 180,
    type: 'text',
    hidden: true,
    order: 120,
  }),
  actualAttendanceDays: withColumn(z.number().optional().nullable(), {
    label: '出勤天数',
    width: COL_NUMBER,
    align: 'right',
    type: 'custom',
    order: 50,
  }),
  absenceDays: z.number().optional().nullable(),
  grossBaseSalary: z.number().optional().nullable(),
  grossPerformance: z.number().optional().nullable(),
  grossCommission: z.number().optional().nullable(),
  grossOther: z.number().optional().nullable(),
  grossBonusYearEnd: z.number().optional().nullable(),
  /** @precision Decimal */
  grossTotal: withColumn(z.number().optional().nullable(), {
    label: '应发合计',
    width: COL_AMOUNT,
    align: 'right',
    type: 'decimal',
    order: 60,
  }),
  absenceDeductionAmount: z.number().optional().nullable(),
  lateDeductionAmount: z.number().optional().nullable(),
  adminDeductionAmount: z.number().optional().nullable(),
  socialSecurityPersonalAmount: z.number().optional().nullable(),
  housingFundPersonalAmount: z.number().optional().nullable(),
  deductionOtherTotal: z.number().optional().nullable(),
  /** @precision Decimal */
  deductionTotal: withColumn(z.number().optional().nullable(), {
    label: '扣款合计',
    width: COL_AMOUNT,
    align: 'right',
    type: 'decimal',
    order: 70,
  }),
  socialSecurityCompanyAmount: z.number().optional().nullable(),
  housingFundCompanyAmount: z.number().optional().nullable(),
  companyBurdenTotal: z.number().optional().nullable(),
  /** @precision Decimal */
  netSalary: withColumn(z.number().optional().nullable(), {
    label: '实发工资',
    width: COL_AMOUNT,
    align: 'right',
    sortable: true,
    type: 'custom',
    order: 80,
  }),
  /** @precision Decimal */
  totalLaborCost: withColumn(z.number().optional().nullable(), {
    label: '人工成本',
    width: COL_AMOUNT,
    align: 'right',
    type: 'decimal',
    order: 90,
  }),
  sourceSheetName: z.string().optional().nullable(),
  sourceRowIndex: z.number().int().optional().nullable(),
  sourceRawJson: z.unknown().optional().nullable(),
  importBatchId: z.string().optional().nullable(),
  createdAt: z.string().optional(),
  createdBy: z.string().optional().nullable(),
  updatedAt: withColumn(z.string().optional(), {
    label: '最近修改',
    width: COL_DATETIME,
    type: 'datetime',
    hidden: true,
    order: 130,
  }),
  updatedBy: z.string().optional().nullable(),
  deletedAt: z.string().optional().nullable(),
  version: z.number().optional(),
  payrollPeriod: payrollPeriodSummarySchema.optional(),
  employee: payrollEmployeeInfoSchema.optional().nullable(),
  department: payrollDepartmentInfoSchema.optional().nullable(),
});

export const payrollImportIssueSchema = z.object({
  sheetName: z.string().optional().nullable(),
  rowIndex: z.number().int().optional().nullable(),
  level: z.enum(['warning', 'error']),
  message: z.string(),
});

export const payrollImportPreviewRecordSchema = z.object({
  employeeNameSnapshot: z.string(),
  departmentNameSnapshot: z.string().optional().nullable(),
  positionSnapshot: z.string().optional().nullable(),
  netSalary: z.number().optional().nullable(),
  totalLaborCost: z.number().optional().nullable(),
});

export const payrollImportPreviewPeriodSchema = payrollPeriodSummarySchema.extend({
  sampleRecords: z.array(payrollImportPreviewRecordSchema),
  warnings: z.array(payrollImportIssueSchema),
});

export const payrollImportPreviewResponseSchema = z.object({
  sourceFileName: z.string(),
  totalSheets: z.number().int(),
  parsedSheets: z.number().int(),
  totalRows: z.number().int(),
  periods: z.array(payrollImportPreviewPeriodSchema),
  warnings: z.array(payrollImportIssueSchema),
  errors: z.array(payrollImportIssueSchema),
});

export const payrollImportBatchResponseSchema = z.object({
  id: z.string(),
  sourceFileName: z.string().optional().nullable(),
  totalSheets: z.number().int(),
  parsedSheets: z.number().int(),
  totalRows: z.number().int(),
  successRows: z.number().int(),
  failedRows: z.number().int(),
  skippedRows: z.number().int(),
  strategy: z.string(),
  status: z.string(),
  summaryJson: z.unknown().optional().nullable(),
  errorReportJson: z.unknown().optional().nullable(),
  createdAt: z.string().optional(),
  createdBy: z.string().optional().nullable(),
  updatedAt: z.string().optional(),
  updatedBy: z.string().optional().nullable(),
  deletedAt: z.string().optional().nullable(),
  version: z.number().optional(),
  periods: z.array(payrollPeriodSummarySchema).optional(),
});

export const payrollImportPreviewInputSchema = z.object({
  fileAssetId: z.string().uuid('文件资产 ID 格式无效'),
  /** 仅供调用方回显与旧审计记录兼容；服务端不得据此解析文件路径。 */
  fileUrl: z.string().url('文件地址格式无效').optional(),
});

export const payrollImportCommitSchema = z.object({
  fileAssetId: z.string().uuid('文件资产 ID 格式无效'),
  /** 仅供调用方回显与旧审计记录兼容；服务端不得据此解析文件路径。 */
  fileUrl: z.string().url('文件地址格式无效').optional(),
  strategy: z.enum(['replace_period']).default('replace_period'),
});

export const payrollImportCommitResponseSchema = z.object({
  batch: payrollImportBatchResponseSchema,
  replacedPeriods: z.array(z.string()),
  createdRecords: z.number().int(),
});

export const payrollPeriodListResponseSchema = z.object({
  items: z.array(payrollPeriodSummarySchema),
});

export const payrollImportBatchListResponseSchema = z.object({
  items: z.array(payrollImportBatchResponseSchema),
});

const payrollBatchDeleteIdSchema = z.string().uuid('无效的薪资记录 ID 格式');
const payrollBatchDeleteVersionSchema = z
  .number({
    required_error: '每条薪资记录都必须携带乐观锁版本号',
    invalid_type_error: '薪资记录乐观锁版本号必须是整数',
  })
  .int('薪资记录乐观锁版本号必须是整数')
  .min(1, '薪资记录乐观锁版本号必须大于等于 1');

export const batchPayrollDeleteSchema = z
  .object({
    ids: z.array(payrollBatchDeleteIdSchema).min(1, '至少选择一项').max(200, '单次最多删除 200 条'),
    versions: z.record(payrollBatchDeleteIdSchema, payrollBatchDeleteVersionSchema),
  })
  .strict()
  .superRefine(({ ids, versions }, ctx) => {
    const idSet = new Set(ids);
    if (idSet.size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ids'],
        message: '批量薪资记录 ID 不得重复',
      });
    }

    const missingIds = [...idSet].filter((id) => !(id in versions));
    const extraIds = Object.keys(versions).filter((id) => !idSet.has(id));
    if (missingIds.length > 0 || extraIds.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['versions'],
        message: 'versions 必须与 ids 一一对应，不得缺漏或包含额外 ID',
      });
    }
  });

export type PayrollPeriodSummaryOutput = z.infer<typeof payrollPeriodSummarySchema>;
export type CreatePayrollInput = z.infer<typeof createPayrollSchema>;
export type UpdatePayrollInput = z.infer<typeof updatePayrollSchema>;
export type QueryPayrollInput = z.infer<typeof queryPayrollSchema>;
export type PayrollResponseOutput = z.infer<typeof payrollResponseSchema>;
export type PayrollImportIssueOutput = z.infer<typeof payrollImportIssueSchema>;
export type PayrollImportPreviewResponseOutput = z.infer<typeof payrollImportPreviewResponseSchema>;
export type PayrollImportBatchResponseOutput = z.infer<typeof payrollImportBatchResponseSchema>;
export type PayrollImportCommitInput = z.infer<typeof payrollImportCommitSchema>;
export type PayrollImportCommitResponseOutput = z.infer<typeof payrollImportCommitResponseSchema>;
export type BatchPayrollDeleteInput = z.infer<typeof batchPayrollDeleteSchema>;
